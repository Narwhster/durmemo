import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";
import type { AgentDeps } from "./agent-tools.ts";
import type { StorageLike } from "./store.ts";
import { extractTopics, tagTopic } from "./topics.ts";
import { registerRpc } from "./plugin/rpc-handlers.ts";
import { scopeFor, taggedFor } from "./plugin/session.ts";
import { registerSystemTopics } from "./plugin/system-prompt.ts";
import { registerAgentTools } from "./plugin/tools.ts";

export default Plugin.define({
  id: "opencode-durmemo",
  effect: (ctx) =>
    Effect.gen(function* () {
      const storage: StorageLike = ctx.storage;
      yield* storage.set("installed", true);

      const agentDeps: AgentDeps = {
        storage,
        taggedTopics: (sessionID) => taggedFor(ctx, storage, sessionID),
        scopeFor: (sessionID) => scopeFor(ctx, sessionID),
      };

      yield* ctx.session.hook("prompt", (event) =>
        Effect.gen(function* () {
          yield* tagTopic(storage, event.sessionID, event.sessionID, "plugin").pipe(
            Effect.catchTag("InvalidName", () => Effect.void),
          );
          const text = event.prompt.text ?? "";
          if (text.trim() === "") return;
          const tagged = extractTopics(text);
          for (const t of tagged) {
            yield* tagTopic(storage, event.sessionID, t.topic, "user", t.inputs).pipe(
              Effect.catchTag("InvalidName", () => Effect.void),
            );
          }
        }),
      );

      yield* registerAgentTools(ctx, agentDeps);
      yield* registerSystemTopics(ctx, storage);
      yield* registerRpc(ctx, storage);
    }),
});
