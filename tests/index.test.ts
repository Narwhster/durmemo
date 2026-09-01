import { expect, test } from "vite-plus/test";
import plugin from "../src/index.ts";

test("exports an Effect plugin", () => {
  expect(plugin.id).toBe("opencode-durmemo");
  expect(plugin.effect).toBeTypeOf("function");
});
