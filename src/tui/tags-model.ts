import { Option, Schema } from "effect";
import type { ScopeKind } from "../encoding.ts";
import { DurmemoRpc } from "../rpc.ts";

export interface TagEntry {
  readonly topic: string;
  readonly key: string;
  readonly scope: ScopeKind;
  readonly owner: string | null;
  readonly value: Schema.Json;
  readonly schema?: Schema.Json;
  readonly isPrivate: boolean;
  readonly locked: boolean;
  readonly allowlist: ReadonlyArray<string>;
  readonly reason: string;
}

export interface TagTopic {
  readonly name: string;
  readonly by: string;
  readonly discoverable: boolean;
}

export type TagRow =
  | {
      readonly kind: "header";
      readonly topic: string;
      readonly count: number;
      readonly untagged: boolean;
    }
  | { readonly kind: "key"; readonly entry: TagEntry };

export interface SelectedRow {
  readonly topic: string;
  readonly key: string;
}

const ListEffectiveOutput = DurmemoRpc.methods["keys.listEffective"].output;
const TopicsListOutput = DurmemoRpc.methods["topics.list"].output;
const ReadExactOutput = DurmemoRpc.methods["keys.readExact"].output;

export const parseWinners = (value: unknown): TagEntry[] => {
  const decoded = Schema.decodeUnknownOption(ListEffectiveOutput)(value);
  if (Option.isNone(decoded)) return [];
  return decoded.value.winners.map((winner) => ({
    topic: winner.entry.topic,
    key: winner.entry.key,
    scope: winner.entry.scope,
    owner: winner.entry.owner,
    value: winner.entry.value,
    ...(winner.entry.schema === undefined ? {} : { schema: winner.entry.schema }),
    isPrivate: winner.entry.isPrivate,
    locked: winner.entry.locked,
    allowlist: [...winner.entry.allowlist],
    reason: winner.reason,
  }));
};

export const parseTopics = (value: unknown): TagTopic[] => {
  const decoded = Schema.decodeUnknownOption(TopicsListOutput)(value);
  if (Option.isNone(decoded)) return [];
  return decoded.value.topics.map((topic) => ({
    name: topic.name,
    by: topic.by,
    discoverable: topic.discoverable,
  }));
};

export const parseReadExactFound = (value: unknown): boolean => {
  const decoded = Schema.decodeUnknownOption(ReadExactOutput)(value);
  return Option.isSome(decoded) && decoded.value.found;
};

export const describeScope = (
  entry: Pick<TagEntry, "scope" | "owner">,
  sessionID: string,
): string => {
  if (entry.scope === "global") return "global";
  if (entry.scope === "project") return "project";
  return entry.owner === sessionID ? "session" : "ancestor";
};

export const previewValue = (value: Schema.Json, limit = 60): string => {
  const text = JSON.stringify(value) ?? "null";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

export const buildRows = (args: {
  readonly entries: ReadonlyArray<TagEntry>;
  readonly topics: ReadonlyArray<TagTopic>;
  readonly showAll: boolean;
}): TagRow[] => {
  const tagged = new Set(args.topics.map((topic) => topic.name));
  const visible = args.showAll
    ? args.entries
    : args.entries.filter((entry) => tagged.has(entry.topic));
  const remaining = new Map<string, TagEntry[]>();
  for (const entry of visible) {
    const group = remaining.get(entry.topic) ?? [];
    group.push(entry);
    remaining.set(entry.topic, group);
  }
  const byKey = (a: TagEntry, b: TagEntry): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const rows: TagRow[] = [];
  const pushGroup = (topic: string, group: TagEntry[], untagged: boolean): void => {
    rows.push({ kind: "header", topic, count: group.length, untagged });
    for (const entry of [...group].sort(byKey)) rows.push({ kind: "key", entry });
  };
  for (const topic of args.topics) {
    const group = remaining.get(topic.name);
    remaining.delete(topic.name);
    if (group === undefined) continue;
    pushGroup(topic.name, group, false);
  }
  for (const [topic, group] of [...remaining.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    pushGroup(topic, group, true);
  }
  return rows;
};

export const selectableEntries = (rows: ReadonlyArray<TagRow>): TagEntry[] => {
  const out: TagEntry[] = [];
  for (const row of rows) {
    if (row.kind === "key") out.push(row.entry);
  }
  return out;
};

export const parseJsonValue = (
  text: string,
):
  | { readonly ok: true; readonly value: Schema.Json }
  | { readonly ok: false; readonly error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON. Nothing changed." };
  }
  if (!Schema.is(Schema.Json)(parsed)) {
    return { ok: false, error: "That is not valid JSON. Nothing changed." };
  }
  return { ok: true, value: parsed };
};
