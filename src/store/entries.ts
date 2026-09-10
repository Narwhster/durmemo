import { Option, Schema } from "effect";

export const StoredEntrySchema = Schema.Struct({
  topic: Schema.String,
  key: Schema.String,
  scope: Schema.Literals(["global", "project", "session"]),
  owner: Schema.NullOr(Schema.String),
  value: Schema.Json,
  schema: Schema.optional(Schema.Json),
  isPrivate: Schema.Boolean,
  locked: Schema.Boolean,
  allowlist: Schema.Array(Schema.String),
  createdBy: Schema.Literals(["user", "agent", "plugin"]),
  pluginId: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
});

export type StoredEntry = typeof StoredEntrySchema.Type;

export interface WinnerView {
  readonly entry: StoredEntry;
  readonly reason: string;
}

export const decodeEntry = (value: Schema.Json): StoredEntry | null => {
  const result = Schema.decodeUnknownOption(StoredEntrySchema)(value);
  if (Option.isNone(result)) return null;
  return { ...result.value, allowlist: [...result.value.allowlist] };
};
