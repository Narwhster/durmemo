import { Effect, Schema } from "effect";
import { AccessDenied, InvalidName, SchemaInvalid, ValidationFailed } from "../errors.ts";
import { entryKey, type ScopeKind, type ScopeRef } from "../encoding.ts";
import { normalizeKey, normalizeTopic } from "../names.ts";
import { assertSchemaObject, validateValue } from "../validation/json-schema.ts";
import { canReadValue, checkDeleteAccess, checkWriteAccess, type Caller } from "./access.ts";
import { decodeEntry, type StoredEntry, type WinnerView } from "./entries.ts";
import { listAllInScope, loadAllEntries, pickWinners, type ScopeContext } from "./resolve.ts";
import type { StorageLike } from "./storage.ts";

export interface UpsertInput {
  readonly topic: string;
  readonly key: string;
  readonly scope: ScopeKind;
  readonly owner: string | null;
  readonly value: Schema.Json;
  readonly schema?: Schema.Json;
  readonly removeSchema?: boolean;
  readonly isPrivate?: boolean;
  readonly locked?: boolean;
  readonly allowlist?: ReadonlyArray<string>;
}

const validateNames = (
  topic: string,
  key: string,
): Effect.Effect<{ topic: string; key: string }, InvalidName> => {
  const t = normalizeTopic(topic);
  if (t === null) {
    return Effect.fail(
      new InvalidName({
        message: `Invalid topic '${topic}'. Use lowercase letters, digits, dash or underscore (1-64 chars, must start alphanumeric).`,
        what: "topic",
        value: topic,
      }),
    );
  }
  const k = normalizeKey(key);
  if (k === null) {
    return Effect.fail(
      new InvalidName({
        message: `Invalid key '${key}'. Use lowercase letters, digits, dash or underscore (1-64 chars, must start alphanumeric).`,
        what: "key",
        value: key,
      }),
    );
  }
  return Effect.succeed({ topic: t, key: k });
};

export const getExact = (
  storage: StorageLike,
  topic: string,
  key: string,
  ref: ScopeRef,
): Effect.Effect<StoredEntry | undefined, InvalidName> =>
  Effect.gen(function* () {
    const names = yield* validateNames(topic, key);
    const raw = yield* storage.get(entryKey(names.topic, names.key, ref));
    if (raw === undefined) return undefined;
    return decodeEntry(raw) ?? undefined;
  });

export const upsertExact = (
  storage: StorageLike,
  input: UpsertInput,
  caller: Caller,
): Effect.Effect<StoredEntry, InvalidName | SchemaInvalid | ValidationFailed | AccessDenied> =>
  Effect.gen(function* () {
    const names = yield* validateNames(input.topic, input.key);
    if (input.scope !== "global" && (input.owner === null || input.owner === "")) {
      return yield* Effect.fail(
        new InvalidName({
          message: `Scope '${input.scope}' needs an owner (project canonical or session ID).`,
          scope: input.scope,
        }),
      );
    }
    if (input.scope === "global" && input.owner !== null) {
      return yield* Effect.fail(
        new InvalidName({ message: "Global scope must not have an owner." }),
      );
    }

    const storageKey = entryKey(names.topic, names.key, { scope: input.scope, owner: input.owner });
    const existingRaw = yield* storage.get(storageKey);
    const existing: StoredEntry | undefined =
      existingRaw === undefined ? undefined : (decodeEntry(existingRaw) ?? undefined);

    const touchesMetadata =
      input.schema !== undefined ||
      input.removeSchema === true ||
      input.isPrivate !== undefined ||
      input.locked !== undefined ||
      input.allowlist !== undefined;
    yield* checkWriteAccess(existing, caller, { touchesMetadata });

    const nextSchema: Schema.Json | undefined =
      input.removeSchema === true
        ? undefined
        : input.schema !== undefined
          ? input.schema
          : existing?.schema;
    if (nextSchema !== undefined) {
      yield* assertSchemaObject(nextSchema);
      yield* validateValue(nextSchema, input.value);
    } else if (existing?.schema !== undefined) {
      yield* validateValue(existing.schema, input.value);
    }

    const requestedPrivate = input.isPrivate ?? existing?.isPrivate ?? false;
    let requestedLocked = input.locked ?? existing?.locked ?? false;
    if (requestedPrivate) requestedLocked = true;

    let nextAllowlist: ReadonlyArray<string>;
    if (!requestedLocked) {
      nextAllowlist = [];
    } else if (input.allowlist !== undefined) {
      nextAllowlist = [...input.allowlist];
    } else if (
      existing !== undefined &&
      (input.locked === undefined || input.locked === existing.locked)
    ) {
      nextAllowlist = [...existing.allowlist];
      if (caller.kind === "session" && existing.locked === false && requestedLocked) {
        if (!nextAllowlist.includes(caller.sessionID))
          nextAllowlist = [...nextAllowlist, caller.sessionID];
      }
      if (
        requestedPrivate &&
        caller.kind === "session" &&
        !nextAllowlist.includes(caller.sessionID)
      ) {
        nextAllowlist = [...nextAllowlist, caller.sessionID];
      }
    } else if (existing !== undefined) {
      if (caller.kind === "session") {
        nextAllowlist = [caller.sessionID];
      } else if (caller.kind === "plugin") {
        nextAllowlist = [];
      } else {
        nextAllowlist = [...existing.allowlist];
      }
    } else {
      nextAllowlist = caller.kind === "session" ? [caller.sessionID] : [];
    }
    if (
      requestedPrivate &&
      caller.kind === "plugin" &&
      input.allowlist === undefined &&
      existing === undefined
    ) {
      nextAllowlist = [];
    }

    const createdBy: StoredEntry["createdBy"] =
      caller.kind === "plugin" ? "plugin" : caller.kind === "user" ? "user" : "agent";
    const existingPluginId: string | undefined = existing?.pluginId;
    const updatedAt = yield* Effect.sync(() => Date.now());
    const next: StoredEntry = {
      topic: names.topic,
      key: names.key,
      scope: input.scope,
      owner: input.owner,
      value: input.value,
      ...(nextSchema === undefined ? {} : { schema: nextSchema }),
      isPrivate: requestedPrivate,
      locked: requestedLocked,
      allowlist: [...nextAllowlist],
      createdBy,
      ...(caller.kind === "plugin"
        ? { pluginId: caller.pluginId }
        : existingPluginId !== undefined
          ? { pluginId: existingPluginId }
          : {}),
      updatedAt,
    };
    yield* storage.set(storageKey, next);
    return next;
  });

export const removeExact = (
  storage: StorageLike,
  topic: string,
  key: string,
  ref: ScopeRef,
  caller: Caller,
): Effect.Effect<void, InvalidName | AccessDenied> =>
  Effect.gen(function* () {
    const names = yield* validateNames(topic, key);
    const storageKey = entryKey(names.topic, names.key, ref);
    const existingRaw = yield* storage.get(storageKey);
    const existing: StoredEntry | undefined =
      existingRaw === undefined ? undefined : (decodeEntry(existingRaw) ?? undefined);
    if (existing === undefined) return;
    yield* checkDeleteAccess(existing, caller);
    yield* storage.remove(storageKey);
  });

export const getEffective = (
  storage: StorageLike,
  topic: string,
  key: string,
  scope: ScopeContext,
  caller: Caller,
): Effect.Effect<WinnerView | undefined, InvalidName | AccessDenied> =>
  Effect.gen(function* () {
    const names = yield* validateNames(topic, key);
    const all = yield* loadAllEntries(storage);
    const winners = pickWinners({
      entries: all,
      ancestry: scope.ancestry,
      projectCanonical: scope.projectCanonical,
    });
    const found = winners.find((w) => w.entry.topic === names.topic && w.entry.key === names.key);
    if (found === undefined) return undefined;
    if (!canReadValue(found.entry, caller)) {
      return yield* Effect.fail(
        new AccessDenied({
          message: `Access denied: '${names.topic}/${names.key}' is private.`,
          topic: names.topic,
          key: names.key,
        }),
      );
    }
    return found;
  });

export const listEffective = (
  storage: StorageLike,
  scope: ScopeContext,
  _caller: Caller,
  onlyTopics?: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<WinnerView>, never> =>
  Effect.gen(function* () {
    const filter: Set<string> | undefined =
      onlyTopics === undefined
        ? undefined
        : new Set<string>(
            onlyTopics.flatMap((t) => {
              const n = normalizeTopic(t);
              return n === null ? [] : [n];
            }),
          );
    const all = yield* loadAllEntries(storage);
    const winners = pickWinners({
      entries: all,
      ancestry: scope.ancestry,
      projectCanonical: scope.projectCanonical,
    });
    return filter === undefined ? winners : winners.filter((w) => filter.has(w.entry.topic));
  });

export const listAllVersions = (
  storage: StorageLike,
  scope: ScopeContext,
  topic: string,
  key: string,
): Effect.Effect<ReadonlyArray<StoredEntry>, InvalidName> =>
  Effect.gen(function* () {
    const names = yield* validateNames(topic, key);
    const all = yield* loadAllEntries(storage);
    return listAllInScope({
      entries: all,
      ancestry: scope.ancestry,
      projectCanonical: scope.projectCanonical,
    }).filter((entry) => entry.topic === names.topic && entry.key === names.key);
  });
