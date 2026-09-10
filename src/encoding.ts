import type { KeyName, SessionID, Topic } from "./names.ts";

export const ENTRY_PREFIX = "durmemo/v1/entry/";
export const TAG_PREFIX = "durmemo/v1/tag/";
export const INIT_PREFIX = "durmemo/v1/init/";

const enc = (segment: string): string => encodeURIComponent(segment);
const dec = (segment: string): string => decodeURIComponent(segment);

export type ScopeKind = "global" | "project" | "session";

export interface ScopeRef {
  readonly scope: ScopeKind;
  readonly owner: string | null;
}

export const entryKey = (topic: Topic | string, key: KeyName | string, ref: ScopeRef): string => {
  const t = enc(topic);
  const k = enc(key);
  if (ref.scope === "global") return `${ENTRY_PREFIX}global/${t}/${k}`;
  return `${ENTRY_PREFIX}${ref.scope}/${enc(ref.owner ?? "")}/${t}/${k}`;
};

export interface ParsedEntryKey {
  readonly topic: string;
  readonly key: string;
  readonly scope: ScopeKind;
  readonly owner: string | null;
}

export const parseEntryKey = (storageKey: string): ParsedEntryKey | null => {
  if (!storageKey.startsWith(ENTRY_PREFIX)) return null;
  const rest = storageKey.slice(ENTRY_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length < 3) return null;
  const scope = parts[0];
  if (scope !== "global" && scope !== "project" && scope !== "session") return null;
  try {
    if (scope === "global") {
      if (parts.length !== 3) return null;
      return { topic: dec(parts[1] ?? ""), key: dec(parts[2] ?? ""), scope, owner: null };
    }
    if (parts.length !== 4) return null;
    return {
      topic: dec(parts[2] ?? ""),
      key: dec(parts[3] ?? ""),
      scope,
      owner: dec(parts[1] ?? ""),
    };
  } catch {
    return null;
  }
};

export const tagKey = (sessionID: SessionID | string, topic: Topic | string): string =>
  `${TAG_PREFIX}${enc(sessionID)}/${enc(topic)}`;

export const parseTagKey = (storageKey: string): { sessionID: string; topic: string } | null => {
  if (!storageKey.startsWith(TAG_PREFIX)) return null;
  const rest = storageKey.slice(TAG_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  try {
    return { sessionID: dec(parts[0] ?? ""), topic: dec(parts[1] ?? "") };
  } catch {
    return null;
  }
};

export const sessionTagPrefix = (sessionID: SessionID | string): string =>
  `${TAG_PREFIX}${enc(sessionID)}/`;

export const initKey = (args: {
  readonly scope: ScopeKind;
  readonly owner: string | null;
  readonly pluginId: string;
  readonly topic: string;
  readonly key: string;
}): string => {
  const owner = args.scope === "global" ? "-" : enc(args.owner ?? "");
  return `${INIT_PREFIX}${args.scope}/${owner}/${enc(args.pluginId)}/${enc(args.topic)}/${enc(args.key)}`;
};
