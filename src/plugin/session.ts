import type { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";
import { collectEffectiveTags, type TagRecord } from "../topics.ts";
import { resolveAncestry, type ScopeContext, type StorageLike } from "../store.ts";

type Context = Parameters<Parameters<typeof Plugin.define>[0]["effect"]>[0];
type SessionID = Parameters<Context["session"]["get"]>[0]["sessionID"];

export const projectCanonicalOf = (ctx: Context): string => ctx.location.project.canonical;

export const projectCanonicalFor = (ctx: Context, sessionID: string): Effect.Effect<string> =>
  ctx.session
    .get({
      sessionID: sessionID as SessionID,
    })
    .pipe(
      Effect.map((info) => info.location.directory),
      Effect.orElseSucceed(() => projectCanonicalOf(ctx)),
    );

export const ancestryFor = (
  ctx: Context,
  sessionID: string,
): Effect.Effect<ReadonlyArray<string>> =>
  resolveAncestry(
    (id) =>
      ctx.session
        .get({
          sessionID: id as SessionID,
        })
        .pipe(
          Effect.map((info) => ({ id: info.id, parentID: info.parentID })),
          Effect.orElseSucceed(() => undefined),
        ),
    sessionID,
  );

export const scopeFor = (ctx: Context, sessionID: string): Effect.Effect<ScopeContext> =>
  Effect.gen(function* () {
    const ancestry = yield* ancestryFor(ctx, sessionID);
    const projectCanonical = yield* projectCanonicalFor(ctx, sessionID);
    return { ancestry, projectCanonical };
  });

export const taggedFor = (
  ctx: Context,
  storage: StorageLike,
  sessionID: string,
): Effect.Effect<ReadonlySet<string>> =>
  Effect.gen(function* () {
    const ancestry = yield* ancestryFor(ctx, sessionID);
    const effective: ReadonlyArray<TagRecord> = yield* collectEffectiveTags(storage, ancestry);
    return new Set<string>(effective.map((t) => t.topic));
  });
