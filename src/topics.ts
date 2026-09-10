import { Effect, Schema } from "effect";
import { InvalidName } from "./errors.ts";
import { parseTagKey, sessionTagPrefix, tagKey } from "./encoding.ts";
import { normalizeTopic } from "./names.ts";
import { scanAll, type StorageLike } from "./store.ts";

export interface TagRecord {
  readonly topic: string;
  readonly sessionID: string;
  readonly by: "user" | "plugin";
  readonly at: number;
}

const TagValueSchema = Schema.Struct({
  by: Schema.Literals(["user", "plugin"]),
  at: Schema.Number,
});

const isTagValue = Schema.is(TagValueSchema);

export const HASHTAG_PATTERN = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9-_]{0,63})/g;

export const extractHashtagTopics = (text: string): ReadonlyArray<string> => {
  const out = new Set<string>();
  HASHTAG_PATTERN.lastIndex = 0;
  for (;;) {
    const match = HASHTAG_PATTERN.exec(text);
    if (match === null) break;
    const topic = normalizeTopic(match[1] ?? "");
    if (topic !== null) out.add(topic);
  }
  HASHTAG_PATTERN.lastIndex = 0;
  return [...out];
};

export const tagTopic = (
  storage: StorageLike,
  sessionID: string,
  topic: string,
  by: "user" | "plugin",
): Effect.Effect<TagRecord, InvalidName> =>
  Effect.gen(function* () {
    const normalized = normalizeTopic(topic);
    if (normalized === null) {
      return yield* Effect.fail(
        new InvalidName({
          message: `Invalid topic '${topic}'. Use lowercase letters, digits, dash or underscore (1-64 chars, must start alphanumeric).`,
          what: "topic",
          value: topic,
        }),
      );
    }
    if (sessionID.trim() === "") {
      return yield* Effect.fail(new InvalidName({ message: "Session ID must not be empty." }));
    }
    const at = yield* Effect.sync(() => Date.now());
    const record: TagRecord = { topic: normalized, sessionID, by, at };
    yield* storage.set(tagKey(sessionID, normalized), { by, at });
    return record;
  });

export const listOwnTags = (
  storage: StorageLike,
  sessionID: string,
): Effect.Effect<ReadonlyArray<TagRecord>> =>
  Effect.gen(function* () {
    const raw = yield* scanAll(storage, sessionTagPrefix(sessionID));
    const out: Array<TagRecord> = [];
    for (const item of raw) {
      const parsed = parseTagKey(item.key);
      if (parsed === null || parsed.sessionID !== sessionID) continue;
      if (!isTagValue(item.value)) continue;
      out.push({ topic: parsed.topic, sessionID, by: item.value.by, at: item.value.at });
    }
    return out;
  });

export const resolveEffectiveTags = (args: {
  readonly own: ReadonlyArray<TagRecord>;
  readonly ancestors: ReadonlyArray<ReadonlyArray<TagRecord>>;
}): ReadonlyArray<TagRecord> => {
  const byTopic = new Map<string, TagRecord>();
  for (const tag of args.own) {
    if (!byTopic.has(tag.topic)) byTopic.set(tag.topic, tag);
  }
  for (const level of args.ancestors) {
    for (const tag of level) {
      if (!byTopic.has(tag.topic)) byTopic.set(tag.topic, tag);
    }
  }
  return [...byTopic.values()].sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
};

export const collectEffectiveTags = (
  storage: StorageLike,
  ancestry: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<TagRecord>> =>
  Effect.gen(function* () {
    if (ancestry.length === 0) return [];
    const [self, ...rest] = ancestry;
    const own = yield* listOwnTags(storage, self ?? "");
    const ancestors: Array<ReadonlyArray<TagRecord>> = [];
    for (const id of rest) {
      ancestors.push(yield* listOwnTags(storage, id));
    }
    return resolveEffectiveTags({ own, ancestors });
  });

export const discoverableTopics = (args: {
  readonly effectiveTags: ReadonlyArray<TagRecord>;
  readonly topicsWithKeys: ReadonlySet<string>;
}): ReadonlyArray<TagRecord> =>
  args.effectiveTags.filter((tag) => args.topicsWithKeys.has(tag.topic));
