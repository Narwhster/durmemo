export type { StorageLike, SessionInfo, SessionResolver } from "./store/storage.ts";
export { scanAll } from "./store/storage.ts";
export { StoredEntrySchema, decodeEntry } from "./store/entries.ts";
export type { StoredEntry, WinnerView } from "./store/entries.ts";
export type { Caller } from "./store/access.ts";
export { userCaller, pluginCaller, sessionCaller } from "./store/access.ts";
export type { ScopeContext } from "./store/resolve.ts";
export { resolveAncestry, pickWinners, loadAllEntries } from "./store/resolve.ts";
export type { UpsertInput } from "./store/mutations.ts";
export {
  getExact,
  upsertExact,
  removeExact,
  getEffective,
  listEffective,
  listAllVersions,
} from "./store/mutations.ts";
