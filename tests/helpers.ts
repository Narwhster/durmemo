import { Effect, type Schema } from "effect";
import type { StorageLike } from "../src/store.ts";

export const makeMemoryStorage = (): StorageLike & {
  readonly entries: Map<string, Schema.Json>;
} => {
  const entries = new Map<string, Schema.Json>();
  const storage: StorageLike & { readonly entries: Map<string, Schema.Json> } = {
    entries,
    get: (key: string) => Effect.succeed(entries.get(key)),
    set: (key: string, value: Schema.Json) =>
      Effect.sync(() => {
        entries.set(key, value);
      }),
    remove: (key: string) =>
      Effect.sync(() => {
        entries.delete(key);
      }),
    scan: (options: {
      readonly prefix: string;
      readonly after?: string;
      readonly limit?: number;
    }) =>
      Effect.sync(() => {
        const keys = [...entries.keys()].filter((k) => k.startsWith(options.prefix)).sort();
        let start = 0;
        if (options.after !== undefined) {
          const idx = keys.findIndex((k) => k > options.after!);
          start = idx === -1 ? keys.length : idx;
        }
        const limit = options.limit ?? 100;
        const slice = keys.slice(start, start + limit);
        const resultEntries = slice.map((k) => ({ key: k, value: entries.get(k)! }));
        const next = start + limit < keys.length ? slice[slice.length - 1] : undefined;
        return {
          entries: resultEntries,
          ...(next === undefined ? {} : { next }),
        };
      }),
  };
  return storage;
};

export const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(Effect.orDie(effect));

export const runEither = <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<{ ok: true; value: A } | { ok: false; error: E }> =>
  Effect.runPromise(
    Effect.match(effect, {
      onFailure: (error) => ({ ok: false as const, error }),
      onSuccess: (value) => ({ ok: true as const, value }),
    }),
  );
