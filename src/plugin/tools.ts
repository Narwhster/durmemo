import type { Plugin } from "@opencode-ai/plugin/effect";
import { Error as ToolError } from "@opencode-ai/plugin/promise/tool";
import { Effect } from "effect";
import {
  DeleteInput,
  DeleteOutput,
  ListKeysInput,
  ListKeysOutput,
  ReadInput,
  ReadOutput,
  TOOL_DELETE,
  TOOL_LIST_KEYS,
  TOOL_NAMESPACE,
  TOOL_READ,
  TOOL_WRITE,
  WriteInput,
  WriteOutput,
  agentDelete,
  agentListKeys,
  agentRead,
  agentWrite,
  type AgentDeps,
  type AgentError,
} from "../agent-tools.ts";

type Context = Parameters<Parameters<typeof Plugin.define>[0]["effect"]>[0];

const errorCode = (error: AgentError): string => {
  switch (error._tag) {
    case "InvalidName":
      return "invalid_name";
    case "Untagged":
      return "untagged";
    case "NotFound":
      return "not_found";
    case "AccessDenied":
      return "access_denied";
    case "SchemaInvalid":
      return "schema_invalid";
    case "ValidationFailed":
      return "validation";
  }
};

const toToolError = (error: AgentError): ToolError =>
  new ToolError({ message: error.message, metadata: { code: errorCode(error) } });

export const registerAgentTools = (ctx: Context, deps: AgentDeps) =>
  ctx.tool.transform((editor) => {
    editor.add({
      name: TOOL_LIST_KEYS,
      description:
        "List DurMemo keys across topics tagged in this session (winners only, with topic and winning scope).",
      input: ListKeysInput,
      output: ListKeysOutput,
      options: { namespace: TOOL_NAMESPACE },
      execute: (input, toolCtx) =>
        Effect.gen(function* () {
          const rows = yield* agentListKeys(deps, toolCtx.sessionID, input).pipe(
            Effect.mapError((e) => toToolError(e)),
          );
          return {
            output: { keys: [...rows] },
            content: JSON.stringify({ keys: rows }),
          };
        }),
    });
    editor.add({
      name: TOOL_READ,
      description:
        "Read a DurMemo value (winning session, project, or global entry) for a tagged topic.",
      input: ReadInput,
      output: ReadOutput,
      options: { namespace: TOOL_NAMESPACE },
      execute: (input, toolCtx) =>
        Effect.gen(function* () {
          const result = yield* agentRead(deps, toolCtx.sessionID, input).pipe(
            Effect.mapError((e) => toToolError(e)),
          );
          return {
            output: { ...result },
            content: JSON.stringify(result.value),
          };
        }),
    });
    editor.add({
      name: TOOL_WRITE,
      description:
        "Create or update a DurMemo key at an exact scope (global, project, or own session). May shadow intentionally.",
      input: WriteInput,
      output: WriteOutput,
      options: { namespace: TOOL_NAMESPACE },
      execute: (input, toolCtx) =>
        Effect.gen(function* () {
          const result = yield* agentWrite(deps, toolCtx.sessionID, input).pipe(
            Effect.mapError((e) => toToolError(e)),
          );
          return {
            output: { ...result },
            content: `Wrote ${result.topic}/${result.key} at ${result.scope}:${result.owner ?? "-"}.`,
          };
        }),
    });
    editor.add({
      name: TOOL_DELETE,
      description: "Delete a DurMemo key at an exact scope.",
      input: DeleteInput,
      output: DeleteOutput,
      options: { namespace: TOOL_NAMESPACE },
      execute: (input, toolCtx) =>
        Effect.gen(function* () {
          const result = yield* agentDelete(deps, toolCtx.sessionID, input).pipe(
            Effect.mapError((e) => toToolError(e)),
          );
          return {
            output: { ...result },
            content: `Deleted ${result.topic}/${result.key} at ${result.scope}:${result.owner ?? "-"}.`,
          };
        }),
    });
  });
