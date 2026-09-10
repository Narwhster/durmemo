import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";
import type { AgentDeps } from "./agent-tools.ts";
import type { StorageLike } from "./store.ts";
import { extractHashtagTopics, tagTopic } from "./topics.ts";
import { registerRpc } from "./plugin/rpc-handlers.ts";
import { scopeFor, taggedFor } from "./plugin/session.ts";
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
          const text = event.prompt.text ?? "";
          if (text.trim() === "") return;
          const topics = extractHashtagTopics(text);
          for (const topic of topics) {
            yield* tagTopic(storage, event.sessionID, topic, "user").pipe(
              Effect.catchTag("InvalidName", () => Effect.void),
            );
          }
        }),
      );

      yield* registerAgentTools(ctx, agentDeps);
      yield* registerRpc(ctx, storage);
    }),
});
