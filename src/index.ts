import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";

export default Plugin.define({
  id: "opencode-durmemo",
  effect: (ctx) =>
    Effect.gen(function* () {
      const storage = ctx.storage;
      yield* storage.set("installed", true);
    }),
});
