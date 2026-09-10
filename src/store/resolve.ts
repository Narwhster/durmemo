import { Effect } from "effect";
import { ENTRY_PREFIX, parseEntryKey } from "../encoding.ts";
import { decodeEntry, type StoredEntry, type WinnerView } from "./entries.ts";
import type { SessionInfo, SessionResolver, StorageLike } from "./storage.ts";
import { scanAll } from "./storage.ts";

export interface ScopeContext {
  readonly ancestry: ReadonlyArray<string>;
  readonly projectCanonical: string | null;
}

const MAX_ANCESTRY_DEPTH = 32;

export const resolveAncestry = (
  resolver: SessionResolver,
  sessionID: string,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const chain: Array<string> = [sessionID];
    const seen = new Set<string>([sessionID]);
    let current: string | undefined = sessionID;
    for (let depth = 0; depth < MAX_ANCESTRY_DEPTH && current !== undefined; depth += 1) {
      const info: SessionInfo | undefined = yield* resolver(current);
      const parent: string | undefined = info?.parentID;
      if (parent === undefined || parent === "" || seen.has(parent)) break;
      chain.push(parent);
      seen.add(parent);
      current = parent;
    }
    return chain;
  });

const PROJECT_RANK = 1_000_000;
const GLOBAL_RANK = 2_000_000;

const scopeRank = (entry: StoredEntry, ancestryIndex: Map<string, number>): number => {
  if (entry.scope === "session" && entry.owner !== null) {
    const idx = ancestryIndex.get(entry.owner);
    if (idx !== undefined) return idx;
    return Number.MAX_SAFE_INTEGER;
  }
  if (entry.scope === "project") return PROJECT_RANK;
  return GLOBAL_RANK;
};

const winnerReason = (winner: StoredEntry, ancestry: ReadonlyArray<string>): string => {
  if (winner.scope === "session" && winner.owner !== null) {
    const idx = ancestry.indexOf(winner.owner);
    if (idx === 0) return "current session entry wins over project and global";
    if (idx > 0) return `ancestor session entry (${String(idx)} up) wins over project and global`;
    return "session entry wins";
  }
  if (winner.scope === "project") return "project entry wins over global (no closer session entry)";
  return "global entry wins (no session or project entry)";
};

const isInScope = (
  entry: StoredEntry,
  ancestrySet: ReadonlySet<string>,
  projectCanonical: string | null,
): boolean => {
  if (entry.scope === "global") return true;
  if (entry.scope === "project") return entry.owner === projectCanonical;
  return entry.owner !== null && ancestrySet.has(entry.owner);
};

export const pickWinners = (args: {
  readonly entries: ReadonlyArray<StoredEntry>;
  readonly ancestry: ReadonlyArray<string>;
  readonly projectCanonical: string | null;
}): ReadonlyArray<WinnerView> => {
  const ancestryIndex = new Map<string, number>();
  args.ancestry.forEach((id, index) => {
    if (!ancestryIndex.has(id)) ancestryIndex.set(id, index);
  });
  const ancestrySet = new Set(args.ancestry);
  const inScope = args.entries.filter((entry) =>
    isInScope(entry, ancestrySet, args.projectCanonical),
  );
  const byTopicKey = new Map<string, StoredEntry>();
  for (const entry of inScope) {
    const id = `${entry.topic}/${entry.key}`;
    const current = byTopicKey.get(id);
    if (current === undefined) {
      byTopicKey.set(id, entry);
      continue;
    }
    if (scopeRank(entry, ancestryIndex) < scopeRank(current, ancestryIndex)) {
      byTopicKey.set(id, entry);
    }
  }
  return [...byTopicKey.values()].map((entry) => ({
    entry,
    reason: winnerReason(entry, args.ancestry),
  }));
};

export const listAllInScope = (args: {
  readonly entries: ReadonlyArray<StoredEntry>;
  readonly ancestry: ReadonlyArray<string>;
  readonly projectCanonical: string | null;
}): ReadonlyArray<StoredEntry> => {
  const ancestrySet = new Set(args.ancestry);
  return args.entries.filter((entry) => isInScope(entry, ancestrySet, args.projectCanonical));
};

export const loadAllEntries = (storage: StorageLike): Effect.Effect<ReadonlyArray<StoredEntry>> =>
  Effect.gen(function* () {
    const raw = yield* scanAll(storage, ENTRY_PREFIX);
    const out: Array<StoredEntry> = [];
    for (const item of raw) {
      const parsed = parseEntryKey(item.key);
      if (parsed === null) continue;
      const entry = decodeEntry(item.value);
      if (entry === null) continue;
      out.push(entry);
    }
    return out;
  });
