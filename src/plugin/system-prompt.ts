import { Effect } from "effect";
import type { Plugin } from "@opencode-ai/plugin/effect";
import type { StorageLike } from "../store.ts";
import { taggedFor } from "./session.ts";

type Context = Parameters<Parameters<typeof Plugin.define>[0]["effect"]>[0];

export const formatTopicsLine = (tagged: ReadonlySet<string>): string | null => {
  if (tagged.size === 0) return null;
  return `Durmemo Topics: ${[...tagged].join(", ")}`;
};

export const registerSystemTopics = (ctx: Context, storage: StorageLike) =>
  ctx.session.hook("context", (event) =>
    Effect.gen(function* () {
      const tagged = yield* taggedFor(ctx, storage, event.sessionID);
      const line = formatTopicsLine(tagged);
      if (line !== null) {
        event.system.push({ type: "text" as const, text: line });
      }
    }),
  );
