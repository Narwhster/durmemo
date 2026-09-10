import { Effect, Schema } from "effect";
import {
  AccessDenied,
  InvalidName,
  NotFound,
  SchemaInvalid,
  Untagged,
  ValidationFailed,
} from "./errors.ts";
import { normalizeTopic } from "./names.ts";
import {
  getEffective,
  listEffective,
  removeExact,
  sessionCaller,
  upsertExact,
  type Caller,
  type ScopeContext,
  type StorageLike,
  type StoredEntry,
} from "./store.ts";

export const TOOL_NAMESPACE = "durmemo";
export const TOOL_LIST_KEYS = "list_keys";
export const TOOL_READ = "read";
export const TOOL_WRITE = "write";
export const TOOL_DELETE = "delete";

export const ListKeysInput = Schema.Struct({
  topics: Schema.optional(Schema.Array(Schema.String)),
});
export type ListKeysInput = typeof ListKeysInput.Type;

export const ListKeysRow = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: Schema.Literals(["global", "project", "session"]),
  owner: Schema.NullOr(Schema.String),
  isPrivate: Schema.Boolean,
  hasValue: Schema.Boolean,
  value: Schema.optional(Schema.Json),
});
export type ListKeysRow = typeof ListKeysRow.Type;

export const ListKeysOutput = Schema.Struct({ keys: Schema.Array(ListKeysRow) });

export const ReadInput = Schema.Struct({ topic: Schema.String, key: Schema.String });
export type ReadInput = typeof ReadInput.Type;

export const ReadOutput = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: Schema.Literals(["global", "project", "session"]),
  owner: Schema.NullOr(Schema.String),
  value: Schema.Json,
});

export const WriteInput = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: Schema.Literals(["global", "project", "session"]),
  value: Schema.Json,
  schema: Schema.optional(Schema.Json),
  removeSchema: Schema.optional(Schema.Boolean),
  isPrivate: Schema.optional(Schema.Boolean),
  locked: Schema.optional(Schema.Boolean),
  allowlist: Schema.optional(Schema.Array(Schema.String)),
});
export type WriteInput = typeof WriteInput.Type;

export const WriteOutput = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: Schema.Literals(["global", "project", "session"]),
  owner: Schema.NullOr(Schema.String),
});

export const DeleteInput = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: Schema.Literals(["global", "project", "session"]),
});
export type DeleteInput = typeof DeleteInput.Type;

export const DeleteOutput = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: Schema.Literals(["global", "project", "session"]),
  owner: Schema.NullOr(Schema.String),
  removed: Schema.Boolean,
});

export type AgentError =
  | InvalidName
  | Untagged
  | NotFound
  | AccessDenied
  | SchemaInvalid
  | ValidationFailed;

export interface AgentDeps {
  readonly storage: StorageLike;
  readonly taggedTopics: (sessionID: string) => Effect.Effect<ReadonlySet<string>>;
  readonly scopeFor: (sessionID: string) => Effect.Effect<ScopeContext>;
}

const requireTagged = (
  topic: string,
  tagged: ReadonlySet<string>,
): Effect.Effect<string, InvalidName | Untagged> =>
  Effect.gen(function* () {
    const normalized = normalizeTopic(topic);
    if (normalized === null) {
      return yield* Effect.fail(
        new InvalidName({ message: `Invalid topic '${topic}'.`, value: topic }),
      );
    }
    if (!tagged.has(normalized)) {
      return yield* Effect.fail(
        new Untagged({
          message: `Topic '${normalized}' is not tagged in this session. Tagged topics: ${tagged.size === 0 ? "(none)" : [...tagged].join(", ")}. Ask the user to tag it first.`,
          topic: normalized,
          tagged: [...tagged],
        }),
      );
    }
    return normalized;
  });

const toListRow = (winner: { readonly entry: StoredEntry }, caller: Caller): ListKeysRow => {
  const entry = winner.entry;
  if (entry.isPrivate && caller.kind === "session" && !entry.allowlist.includes(caller.sessionID)) {
    return {
      topic: entry.topic,
      key: entry.key,
      scope: entry.scope,
      owner: entry.owner,
      isPrivate: true,
      hasValue: false,
    };
  }
  return {
    topic: entry.topic,
    key: entry.key,
    scope: entry.scope,
    owner: entry.owner,
    isPrivate: entry.isPrivate,
    hasValue: true,
    value: entry.value,
  };
};

export const agentListKeys = (
  deps: AgentDeps,
  sessionID: string,
  input: ListKeysInput,
): Effect.Effect<ReadonlyArray<ListKeysRow>, InvalidName | Untagged> =>
  Effect.gen(function* () {
    const tagged = yield* deps.taggedTopics(sessionID);
    const scope = yield* deps.scopeFor(sessionID);
    const caller = sessionCaller(sessionID);
    const filter = input.topics?.flatMap((t) => {
      const n = normalizeTopic(t);
      return n === null ? [] : [n];
    });
    if (filter !== undefined) {
      for (const t of filter) {
        if (!tagged.has(t)) {
          return yield* Effect.fail(
            new Untagged({
              message: `Topic '${t}' is not tagged in this session. Tagged: ${[...tagged].join(", ") || "(none)"}.`,
              topic: t,
              tagged: [...tagged],
            }),
          );
        }
      }
    }
    const taggedFilter = filter ?? [...tagged];
    const winners = yield* listEffective(deps.storage, scope, caller, taggedFilter);
    return winners.map((w) => toListRow(w, caller));
  });

export const agentRead = (
  deps: AgentDeps,
  sessionID: string,
  input: ReadInput,
): Effect.Effect<
  {
    topic: string;
    key: string;
    scope: "global" | "project" | "session";
    owner: string | null;
    value: Schema.Json;
  },
  InvalidName | Untagged | AccessDenied | NotFound
> =>
  Effect.gen(function* () {
    const tagged = yield* deps.taggedTopics(sessionID);
    const topic = yield* requireTagged(input.topic, tagged);
    const scope = yield* deps.scopeFor(sessionID);
    const winner = yield* getEffective(
      deps.storage,
      topic,
      input.key,
      scope,
      sessionCaller(sessionID),
    );
    if (winner === undefined) {
      return yield* Effect.fail(
        new NotFound({
          message: `No in-scope entry for '${topic}/${input.key}'.`,
          topic,
          key: input.key,
        }),
      );
    }
    return {
      topic: winner.entry.topic,
      key: winner.entry.key,
      scope: winner.entry.scope,
      owner: winner.entry.owner,
      value: winner.entry.value,
    };
  });

export const agentWrite = (
  deps: AgentDeps,
  sessionID: string,
  input: WriteInput,
): Effect.Effect<
  { topic: string; key: string; scope: "global" | "project" | "session"; owner: string | null },
  InvalidName | Untagged | SchemaInvalid | ValidationFailed | AccessDenied
> =>
  Effect.gen(function* () {
    const tagged = yield* deps.taggedTopics(sessionID);
    const topic = yield* requireTagged(input.topic, tagged);
    const scope = yield* deps.scopeFor(sessionID);
    const owner =
      input.scope === "global"
        ? null
        : input.scope === "project"
          ? scope.projectCanonical
          : sessionID;
    if (input.scope !== "global" && (owner === null || owner === "")) {
      return yield* Effect.fail(
        new InvalidName({
          message: `Scope '${input.scope}' has no owner in this session (missing project canonical).`,
          scope: input.scope,
        }),
      );
    }
    const next = yield* upsertExact(
      deps.storage,
      {
        topic,
        key: input.key,
        scope: input.scope,
        owner,
        value: input.value,
        ...(input.schema === undefined ? {} : { schema: input.schema }),
        ...(input.removeSchema === undefined ? {} : { removeSchema: input.removeSchema }),
        ...(input.isPrivate === undefined ? {} : { isPrivate: input.isPrivate }),
        ...(input.locked === undefined ? {} : { locked: input.locked }),
        ...(input.allowlist === undefined ? {} : { allowlist: input.allowlist }),
      },
      sessionCaller(sessionID),
    );
    return { topic: next.topic, key: next.key, scope: next.scope, owner: next.owner };
  });

export const agentDelete = (
  deps: AgentDeps,
  sessionID: string,
  input: DeleteInput,
): Effect.Effect<
  {
    topic: string;
    key: string;
    scope: "global" | "project" | "session";
    owner: string | null;
    removed: boolean;
  },
  InvalidName | Untagged | AccessDenied
> =>
  Effect.gen(function* () {
    const tagged = yield* deps.taggedTopics(sessionID);
    const topic = yield* requireTagged(input.topic, tagged);
    const scope = yield* deps.scopeFor(sessionID);
    const owner =
      input.scope === "global"
        ? null
        : input.scope === "project"
          ? scope.projectCanonical
          : sessionID;
    if (input.scope !== "global" && (owner === null || owner === "")) {
      return yield* Effect.fail(
        new InvalidName({
          message: `Scope '${input.scope}' has no owner in this session.`,
          scope: input.scope,
        }),
      );
    }
    yield* removeExact(
      deps.storage,
      topic,
      input.key,
      { scope: input.scope, owner },
      sessionCaller(sessionID),
    );
    return { topic, key: input.key, scope: input.scope, owner, removed: true };
  });
