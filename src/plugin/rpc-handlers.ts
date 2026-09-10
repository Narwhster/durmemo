import type { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";
import { ensureInitializer } from "../plugin-api.ts";
import { DurmemoRpc } from "../rpc.ts";
import {
  getEffective,
  getExact,
  listAllVersions,
  listEffective,
  loadAllEntries,
  pickWinners,
  pluginCaller,
  removeExact,
  upsertExact,
  type ScopeContext,
  type StorageLike,
} from "../store.ts";
import { collectEffectiveTags, discoverableTopics, tagTopic } from "../topics.ts";
import { ancestryFor, projectCanonicalFor } from "./session.ts";

type Context = Parameters<Parameters<typeof Plugin.define>[0]["effect"]>[0];

export const registerRpc = (ctx: Context, storage: StorageLike) =>
  ctx.rpc
    .register(DurmemoRpc, {
      "topics.list": ({ sessionID, projectCanonical: projectOverride, includeUndiscoverable }) =>
        Effect.gen(function* () {
          const ancestry = yield* ancestryFor(ctx, sessionID);
          const canonical = projectOverride ?? (yield* projectCanonicalFor(ctx, sessionID));
          const effective = yield* collectEffectiveTags(storage, ancestry);
          const all = yield* loadAllEntries(storage);
          const winners = pickWinners({ entries: all, ancestry, projectCanonical: canonical });
          const withKeys = new Set(winners.map((w) => w.entry.topic));
          const discoverable = new Set(
            discoverableTopics({ effectiveTags: effective, topicsWithKeys: withKeys }).map(
              (t) => t.topic,
            ),
          );
          const topics = effective
            .filter((t) => includeUndiscoverable === true || discoverable.has(t.topic))
            .map((t) => ({
              name: t.topic,
              by: t.by,
              discoverable: discoverable.has(t.topic),
            }));
          return { topics };
        }),
      "topics.tag": ({ sessionID, topic }, rpcCtx) =>
        tagTopic(storage, sessionID, topic, "plugin").pipe(
          Effect.map((record) => ({
            topic: record.topic,
            sessionID: record.sessionID,
            by: record.by,
          })),
          Effect.catchTag("InvalidName", (error) =>
            Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
          ),
        ),
      "keys.readEffective": (
        { sessionID, projectCanonical: projectOverride, topic, key },
        rpcCtx,
      ) =>
        Effect.gen(function* () {
          const ancestry = yield* ancestryFor(ctx, sessionID);
          const scope: ScopeContext = {
            ancestry,
            projectCanonical: projectOverride ?? (yield* projectCanonicalFor(ctx, sessionID)),
          };
          const winner = yield* getEffective(storage, topic, key, scope, pluginCaller("rpc"));
          if (winner === undefined) return { found: false as const };
          return {
            found: true as const,
            winner: { entry: { ...winner.entry }, reason: winner.reason },
          };
        }).pipe(
          Effect.catchTags({
            InvalidName: (error) =>
              Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
            AccessDenied: (error) =>
              Effect.fail(rpcCtx.error("access_denied", error.message, { message: error.message })),
          }),
        ),
      "keys.readExact": ({ topic, key, scope, owner }, rpcCtx) =>
        getExact(storage, topic, key, { scope, owner: owner ?? null }).pipe(
          Effect.map((entry) =>
            entry === undefined
              ? { found: false as const }
              : { found: true as const, entry: { ...entry } },
          ),
          Effect.catchTag("InvalidName", (error) =>
            Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
          ),
        ),
      "keys.listEffective": ({ sessionID, projectCanonical: projectOverride, topics }) =>
        Effect.gen(function* () {
          const ancestry = yield* ancestryFor(ctx, sessionID);
          const scope: ScopeContext = {
            ancestry,
            projectCanonical: projectOverride ?? (yield* projectCanonicalFor(ctx, sessionID)),
          };
          const winners = yield* listEffective(storage, scope, pluginCaller("rpc"), topics);
          return {
            winners: winners.map((w) => ({ entry: { ...w.entry }, reason: w.reason })),
          };
        }),
      "keys.listAll": ({ sessionID, projectCanonical: projectOverride, topic, key }, rpcCtx) =>
        Effect.gen(function* () {
          const ancestry = yield* ancestryFor(ctx, sessionID);
          const scope: ScopeContext = {
            ancestry,
            projectCanonical: projectOverride ?? (yield* projectCanonicalFor(ctx, sessionID)),
          };
          const entries = yield* listAllVersions(storage, scope, topic, key);
          return { entries: entries.map((entry) => ({ ...entry })) };
        }).pipe(
          Effect.catchTag("InvalidName", (error) =>
            Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
          ),
        ),
      "keys.upsert": (
        {
          topic,
          key,
          scope,
          owner,
          value,
          schema,
          removeSchema,
          isPrivate,
          locked,
          allowlist,
          pluginId,
        },
        rpcCtx,
      ) =>
        upsertExact(
          storage,
          {
            topic,
            key,
            scope,
            owner: owner ?? null,
            value,
            ...(schema === undefined ? {} : { schema }),
            ...(removeSchema === undefined ? {} : { removeSchema }),
            ...(isPrivate === undefined ? {} : { isPrivate }),
            ...(locked === undefined ? {} : { locked }),
            ...(allowlist === undefined ? {} : { allowlist }),
          },
          pluginCaller(pluginId),
        ).pipe(
          Effect.map((entry) => ({ entry: { ...entry } })),
          Effect.catchTags({
            InvalidName: (error) =>
              Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
            SchemaInvalid: (error) =>
              Effect.fail(
                rpcCtx.error("schema_invalid", error.message, { message: error.message }),
              ),
            ValidationFailed: (error) =>
              Effect.fail(rpcCtx.error("validation", error.message, { message: error.message })),
            AccessDenied: (error) =>
              Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
          }),
        ),
      "keys.remove": ({ topic, key, scope, owner, pluginId }, rpcCtx) =>
        Effect.gen(function* () {
          const before = yield* getExact(storage, topic, key, {
            scope,
            owner: owner ?? null,
          });
          if (before === undefined) return { removed: false };
          yield* removeExact(
            storage,
            topic,
            key,
            { scope, owner: owner ?? null },
            pluginCaller(pluginId ?? "rpc"),
          );
          return { removed: true };
        }).pipe(
          Effect.catchTags({
            InvalidName: (error) =>
              Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
            AccessDenied: (error) =>
              Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
          }),
        ),
      "init.ensure": (
        { pluginId, topic, key, scope, owner, initialValue, schema, isPrivate, locked },
        rpcCtx,
      ) =>
        ensureInitializer(
          storage,
          {
            pluginId,
            topic,
            key,
            scope,
            ...(initialValue === undefined ? {} : { initialValue }),
            ...(schema === undefined ? {} : { schema }),
            ...(isPrivate === undefined ? {} : { isPrivate }),
            ...(locked === undefined ? {} : { locked }),
          },
          owner ?? null,
        ).pipe(
          Effect.catchTags({
            InvalidName: (error) =>
              Effect.fail(rpcCtx.error("invalid_name", error.message, { message: error.message })),
            SchemaInvalid: (error) =>
              Effect.fail(
                rpcCtx.error("schema_invalid", error.message, { message: error.message }),
              ),
            ValidationFailed: (error) =>
              Effect.fail(rpcCtx.error("validation", error.message, { message: error.message })),
            InitFailed: (error) =>
              Effect.fail(rpcCtx.error("init_failed", error.message, { message: error.message })),
          }),
        ),
    })
    .pipe(Effect.orDie);
