import { Effect, type Schema } from "effect";

export interface StorageLike {
  readonly get: (key: string) => Effect.Effect<Schema.Json | undefined>;
  readonly set: (key: string, value: Schema.Json) => Effect.Effect<void>;
  readonly remove: (key: string) => Effect.Effect<void>;
  readonly scan: (options: {
    readonly prefix: string;
    readonly after?: string;
    readonly limit?: number;
  }) => Effect.Effect<{
    readonly entries: ReadonlyArray<{ readonly key: string; readonly value: Schema.Json }>;
    readonly next?: string;
  }>;
}

export interface SessionInfo {
  readonly id: string;
  readonly parentID?: string;
}

export type SessionResolver = (sessionID: string) => Effect.Effect<SessionInfo | undefined>;

const SCAN_PAGE_LIMIT = 100;

export const scanAll = (
  storage: StorageLike,
  prefix: string,
): Effect.Effect<ReadonlyArray<{ readonly key: string; readonly value: Schema.Json }>> =>
  Effect.gen(function* () {
    const out: Array<{ readonly key: string; readonly value: Schema.Json }> = [];
    let after: string | undefined = undefined;
    for (;;) {
      const page: {
        readonly entries: ReadonlyArray<{ readonly key: string; readonly value: Schema.Json }>;
        readonly next?: string;
      } = yield* storage.scan(
        after === undefined
          ? { prefix, limit: SCAN_PAGE_LIMIT }
          : { prefix, after, limit: SCAN_PAGE_LIMIT },
      );
      for (const item of page.entries) out.push(item);
      if (page.next === undefined) break;
      after = page.next;
    }
    return out;
  });
