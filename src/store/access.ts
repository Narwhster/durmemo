import { Effect } from "effect";
import { AccessDenied } from "../errors.ts";
import type { StoredEntry } from "./entries.ts";

export type Caller =
  | { readonly kind: "user" }
  | { readonly kind: "plugin"; readonly pluginId: string }
  | { readonly kind: "session"; readonly sessionID: string };

export const userCaller: Caller = { kind: "user" };
export const pluginCaller = (pluginId: string): Caller => ({ kind: "plugin", pluginId });
export const sessionCaller = (sessionID: string): Caller => ({ kind: "session", sessionID });

const callerBypasses = (caller: Caller): boolean =>
  caller.kind === "user" || caller.kind === "plugin";

export const canReadValue = (entry: StoredEntry, caller: Caller): boolean => {
  if (caller.kind !== "session") return true;
  if (!entry.locked) return true;
  if (entry.isPrivate) return entry.allowlist.includes(caller.sessionID);
  return true;
};

export const checkWriteAccess = (
  existing: StoredEntry | undefined,
  caller: Caller,
  change: { readonly touchesMetadata: boolean },
): Effect.Effect<void, AccessDenied> => {
  if (callerBypasses(caller)) return Effect.void;
  if (caller.kind !== "session") return Effect.void;
  if (existing === undefined) return Effect.void;
  if (!existing.locked) return Effect.void;
  if (existing.allowlist.includes(caller.sessionID)) return Effect.void;
  if (existing.isPrivate) {
    return Effect.fail(
      new AccessDenied({
        message: `Access denied: '${existing.topic}/${existing.key}' is private and locked. Only allowlisted sessions, plugins, or the user may change it.`,
        topic: existing.topic,
        key: existing.key,
      }),
    );
  }
  if (change.touchesMetadata) {
    return Effect.fail(
      new AccessDenied({
        message: `Access denied: '${existing.topic}/${existing.key}' is locked. Outsiders may only update the value of a public key; schema, privacy, lock, and allowlist need an allowlisted session, plugin, or user.`,
        topic: existing.topic,
        key: existing.key,
      }),
    );
  }
  return Effect.void;
};

export const checkDeleteAccess = (
  existing: StoredEntry | undefined,
  caller: Caller,
): Effect.Effect<void, AccessDenied> => {
  if (existing === undefined) return Effect.void;
  if (callerBypasses(caller)) return Effect.void;
  if (caller.kind !== "session") return Effect.void;
  if (!existing.locked) return Effect.void;
  if (existing.allowlist.includes(caller.sessionID)) return Effect.void;
  return Effect.fail(
    new AccessDenied({
      message: `Access denied: cannot delete locked '${existing.topic}/${existing.key}' from this session.`,
      topic: existing.topic,
      key: existing.key,
    }),
  );
};
