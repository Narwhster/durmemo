import { Effect, type Schema } from "effect";
import { InitFailed, InvalidName, SchemaInvalid, ValidationFailed } from "./errors.ts";
import { initKey, type ScopeKind } from "./encoding.ts";
import { normalizeKey, normalizeTopic } from "./names.ts";
import { assertSchemaObject } from "./validation/json-schema.ts";
import { getExact, pluginCaller, upsertExact, type StorageLike } from "./store.ts";

export interface InitializerDeclaration {
  readonly pluginId: string;
  readonly topic: string;
  readonly key: string;
  readonly scope: ScopeKind;
  readonly initialValue?: Schema.Json;
  readonly schema?: Schema.Json;
  readonly isPrivate?: boolean;
  readonly locked?: boolean;
}

const validateDeclaration = (
  decl: InitializerDeclaration,
  owner: string | null,
): Effect.Effect<{ topic: string; key: string }, InvalidName | SchemaInvalid | InitFailed> =>
  Effect.gen(function* () {
    if (decl.pluginId.trim() === "") {
      return yield* Effect.fail(
        new InvalidName({ message: "Initializer needs a non-empty pluginId." }),
      );
    }
    const topic = normalizeTopic(decl.topic);
    if (topic === null) {
      return yield* Effect.fail(
        new InvalidName({ message: `Invalid topic '${decl.topic}'.`, value: decl.topic }),
      );
    }
    const key = normalizeKey(decl.key);
    if (key === null) {
      return yield* Effect.fail(
        new InvalidName({ message: `Invalid key '${decl.key}'.`, value: decl.key }),
      );
    }
    if (decl.scope !== "global" && (owner === null || owner === "")) {
      return yield* Effect.fail(
        new InitFailed({
          message: `Initializer scope '${decl.scope}' needs an owner when ensured.`,
        }),
      );
    }
    if (decl.schema !== undefined) {
      yield* assertSchemaObject(decl.schema);
    }
    return { topic, key };
  });

export const ensureInitializer = (
  storage: StorageLike,
  decl: InitializerDeclaration,
  owner: string | null,
): Effect.Effect<
  { readonly status: "initialized" | "skipped"; readonly reason?: string },
  InvalidName | SchemaInvalid | ValidationFailed | InitFailed
> =>
  Effect.gen(function* () {
    const names = yield* validateDeclaration(decl, owner);
    const markerKey = initKey({
      scope: decl.scope,
      owner: decl.scope === "global" ? null : owner,
      pluginId: decl.pluginId,
      topic: names.topic,
      key: names.key,
    });
    const marker = yield* storage.get(markerKey);
    if (marker !== undefined) {
      return { status: "skipped" as const, reason: "already initialized" };
    }
    const existing = yield* getExact(storage, names.topic, names.key, { scope: decl.scope, owner });
    if (existing !== undefined) {
      const at = yield* Effect.sync(() => Date.now());
      yield* storage.set(markerKey, { at });
      return { status: "skipped" as const, reason: "key already exists, preserved" };
    }
    if (decl.initialValue === undefined) {
      const at = yield* Effect.sync(() => Date.now());
      yield* storage.set(markerKey, { at });
      return { status: "skipped" as const, reason: "no initial value, marker recorded" };
    }
    yield* upsertExact(
      storage,
      {
        topic: names.topic,
        key: names.key,
        scope: decl.scope,
        owner,
        value: decl.initialValue,
        ...(decl.schema === undefined ? {} : { schema: decl.schema }),
        ...(decl.isPrivate === undefined ? {} : { isPrivate: decl.isPrivate }),
        ...(decl.locked === undefined ? {} : { locked: decl.locked }),
      },
      pluginCaller(decl.pluginId),
    ).pipe(
      Effect.mapError(
        (error) =>
          new InitFailed({
            message: `Initializer failed for '${names.topic}/${names.key}': ${error.message}`,
            cause: error,
          }),
      ),
    );
    const at = yield* Effect.sync(() => Date.now());
    yield* storage.set(markerKey, { at });
    return { status: "initialized" as const };
  });

export const hasInitMarker = (
  storage: StorageLike,
  decl: Pick<InitializerDeclaration, "pluginId" | "topic" | "key" | "scope">,
  owner: string | null,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const topic = normalizeTopic(decl.topic);
    const key = normalizeKey(decl.key);
    if (topic === null || key === null) return false;
    const marker = yield* storage.get(
      initKey({
        scope: decl.scope,
        owner: decl.scope === "global" ? null : owner,
        pluginId: decl.pluginId,
        topic,
        key,
      }),
    );
    return marker !== undefined;
  });
