import { Effect, Schema } from "effect";
import { InvalidName } from "./errors.ts";
import { parseTagKey, sessionTagPrefix, tagKey } from "./encoding.ts";
import { normalizeTopic } from "./names.ts";
import { scanAll, type StorageLike } from "./store.ts";

export interface TaggedTopic {
  readonly topic: string;
  readonly inputs: ReadonlyArray<Schema.Json>;
}

export interface TagRecord extends TaggedTopic {
  readonly sessionID: string;
  readonly by: "user" | "plugin";
  readonly at: number;
}

const TagValueSchema = Schema.Struct({
  by: Schema.Literals(["user", "plugin"]),
  at: Schema.Number,
  inputs: Schema.optional(Schema.Array(Schema.Json)),
});

const isTagValue = Schema.is(TagValueSchema);

export const HASHTAG_PATTERN = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9-_]{0,63})/g;

const blankPreservingNewlines = (segment: string): string => segment.replace(/[^\n]/g, " ");

export const stripCodeSegments = (text: string): string => {
  const withoutFenced = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, (match) =>
    blankPreservingNewlines(match),
  );
  return withoutFenced.replace(/(`+)[\s\S]*?\1/g, (match) => blankPreservingNewlines(match));
};

const isSpace = (ch: string): boolean => ch === " " || ch === "\t";

const findInputsEnd = (text: string, open: number): number => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0 && ch === "]") return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
};

const splitTopLevel = (inner: string): Array<string> => {
  const parts: Array<string> = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] ?? "";
    if (quote !== null) {
      current += ch;
      if (ch === "\\" && i + 1 < inner.length) {
        current += inner[i + 1] ?? "";
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === "]" || ch === "}") {
      depth--;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
};

const parseInput = (raw: string): Schema.Json | undefined => {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Schema.is(Schema.Json)(parsed) ? parsed : trimmed;
  } catch {
    return trimmed;
  }
};

const parseSuffixInputs = (text: string, end: number): Array<Schema.Json> | null => {
  let i = end;
  while (i < text.length && isSpace(text[i] ?? "")) i++;
  if (text[i] === "=") {
    i++;
    while (i < text.length && isSpace(text[i] ?? "")) i++;
  }
  if (text[i] !== "[") return null;
  const close = findInputsEnd(text, i);
  if (close === -1) return null;
  const inputs: Array<Schema.Json> = [];
  for (const part of splitTopLevel(text.slice(i + 1, close))) {
    const value = parseInput(part);
    if (value !== undefined) inputs.push(value);
  }
  return inputs;
};

export const extractTopics = (text: string): ReadonlyArray<TaggedTopic> => {
  const visible = stripCodeSegments(text);
  const byTopic = new Map<string, Array<Schema.Json>>();
  HASHTAG_PATTERN.lastIndex = 0;
  for (;;) {
    const match = HASHTAG_PATTERN.exec(visible);
    if (match === null) break;
    const topic = normalizeTopic(match[1] ?? "");
    if (topic === null) continue;
    const suffix = parseSuffixInputs(visible, match.index + match[0].length);
    byTopic.set(topic, suffix ?? []);
  }
  HASHTAG_PATTERN.lastIndex = 0;
  return [...byTopic].map(([topic, inputs]) => ({ topic, inputs }));
};

export const tagTopic = (
  storage: StorageLike,
  sessionID: string,
  topic: string,
  by: "user" | "plugin",
  inputs: ReadonlyArray<Schema.Json> = [],
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
    const record: TagRecord = { topic: normalized, sessionID, by, at, inputs: [...inputs] };
    yield* storage.set(tagKey(sessionID, normalized), { by, at, inputs: [...inputs] });
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
      const inputs = Array.isArray(item.value.inputs) ? [...item.value.inputs] : [];
      out.push({ topic: parsed.topic, sessionID, by: item.value.by, at: item.value.at, inputs });
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
