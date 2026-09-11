import { Rpc } from "@opencode-ai/plugin/effect";
import type { RpcClient } from "@opencode-ai/plugin/effect/rpc";
import { Schema } from "effect";

const messageData = Schema.Struct({ message: Schema.String });

const ScopeInput = Schema.Literals(["global", "project", "session"]);

const JsonValue = Schema.Json;

const EntryOutput = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: ScopeInput,
  owner: Schema.NullOr(Schema.String),
  value: JsonValue,
  schema: Schema.optional(JsonValue),
  isPrivate: Schema.Boolean,
  locked: Schema.Boolean,
  allowlist: Schema.Array(Schema.String),
  createdBy: Schema.String,
  pluginId: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
});

const WinnerOutput = Schema.Struct({
  entry: EntryOutput,
  reason: Schema.String,
});

const TopicView = Schema.Struct({
  name: Schema.String,
  by: Schema.String,
  discoverable: Schema.Boolean,
  inputs: Schema.Array(JsonValue),
});

export const DurmemoRpc = Rpc.define({
  id: "durmemo",
  methods: {
    "topics.list": {
      input: Schema.Struct({
        sessionID: Schema.String,
        projectCanonical: Schema.optional(Schema.String),
        includeUndiscoverable: Schema.optional(Schema.Boolean),
      }),
      output: Schema.Struct({ topics: Schema.Array(TopicView) }),
      errors: {
        invalid_name: messageData,
      },
    },
    "topics.tag": {
      input: Schema.Struct({
        sessionID: Schema.String,
        topic: Schema.String,
        inputs: Schema.optional(Schema.Array(JsonValue)),
      }),
      output: Schema.Struct({
        topic: Schema.String,
        sessionID: Schema.String,
        by: Schema.String,
        inputs: Schema.Array(JsonValue),
      }),
      errors: {
        invalid_name: messageData,
      },
    },
    "keys.readEffective": {
      input: Schema.Struct({
        sessionID: Schema.String,
        projectCanonical: Schema.optional(Schema.String),
        topic: Schema.String,
        key: Schema.String,
      }),
      output: Schema.Struct({ found: Schema.Boolean, winner: Schema.optional(WinnerOutput) }),
      errors: {
        invalid_name: messageData,
        access_denied: messageData,
      },
    },
    "keys.readExact": {
      input: Schema.Struct({
        topic: Schema.String,
        key: Schema.String,
        scope: ScopeInput,
        owner: Schema.optional(Schema.String),
      }),
      output: Schema.Struct({ found: Schema.Boolean, entry: Schema.optional(EntryOutput) }),
      errors: {
        invalid_name: messageData,
        access_denied: messageData,
      },
    },
    "keys.listEffective": {
      input: Schema.Struct({
        sessionID: Schema.String,
        projectCanonical: Schema.optional(Schema.String),
        topics: Schema.optional(Schema.Array(Schema.String)),
      }),
      output: Schema.Struct({ winners: Schema.Array(WinnerOutput) }),
      errors: {
        invalid_name: messageData,
      },
    },
    "keys.listAll": {
      input: Schema.Struct({
        sessionID: Schema.String,
        projectCanonical: Schema.optional(Schema.String),
        topic: Schema.String,
        key: Schema.String,
      }),
      output: Schema.Struct({ entries: Schema.Array(EntryOutput) }),
      errors: {
        invalid_name: messageData,
      },
    },
    "keys.upsert": {
      input: Schema.Struct({
        topic: Schema.String,
        key: Schema.String,
        scope: ScopeInput,
        owner: Schema.optional(Schema.String),
        value: JsonValue,
        schema: Schema.optional(JsonValue),
        removeSchema: Schema.optional(Schema.Boolean),
        isPrivate: Schema.optional(Schema.Boolean),
        locked: Schema.optional(Schema.Boolean),
        allowlist: Schema.optional(Schema.Array(Schema.String)),
        pluginId: Schema.String,
      }),
      output: Schema.Struct({ entry: EntryOutput }),
      errors: {
        invalid_name: messageData,
        schema_invalid: messageData,
        validation: messageData,
      },
    },
    "keys.remove": {
      input: Schema.Struct({
        topic: Schema.String,
        key: Schema.String,
        scope: ScopeInput,
        owner: Schema.optional(Schema.String),
        pluginId: Schema.optional(Schema.String),
      }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      errors: {
        invalid_name: messageData,
      },
    },
    "init.ensure": {
      input: Schema.Struct({
        pluginId: Schema.String,
        topic: Schema.String,
        key: Schema.String,
        scope: ScopeInput,
        owner: Schema.optional(Schema.String),
        initialValue: Schema.optional(JsonValue),
        schema: Schema.optional(JsonValue),
        isPrivate: Schema.optional(Schema.Boolean),
        locked: Schema.optional(Schema.Boolean),
      }),
      output: Schema.Struct({
        status: Schema.Literals(["initialized", "skipped"]),
        reason: Schema.optional(Schema.String),
      }),
      errors: {
        invalid_name: messageData,
        schema_invalid: messageData,
        validation: messageData,
        init_failed: messageData,
      },
    },
  },
  events: {},
});

export type DurmemoRpcDefinition = typeof DurmemoRpc;

export type DurmemoClient = RpcClient<DurmemoRpcDefinition, unknown>;
