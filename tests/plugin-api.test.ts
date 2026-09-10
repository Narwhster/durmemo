import { describe, expect, test } from "vite-plus/test";
import { ensureInitializer, hasInitMarker } from "../src/plugin-api.ts";
import { DurmemoRpc } from "../src/rpc.ts";
import { getExact, pluginCaller, upsertExact, userCaller } from "../src/store.ts";
import { makeMemoryStorage, run, runEither } from "./helpers.ts";

describe("NAR-8 plugin API", () => {
  test("RPC contract exported without implementation", async () => {
    expect(DurmemoRpc.id).toBe("durmemo");
    expect(Object.keys(DurmemoRpc.methods)).toEqual(
      expect.arrayContaining([
        "topics.list",
        "topics.tag",
        "keys.readEffective",
        "keys.readExact",
        "keys.listEffective",
        "keys.listAll",
        "keys.upsert",
        "keys.remove",
        "init.ensure",
      ]),
    );
  });

  test("one declaration covers global, project, session scopes", async () => {
    const storage = makeMemoryStorage();
    const global = await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "global", initialValue: 1 as never },
        null,
      ),
    );
    expect(global.status).toBe("initialized");
    const project = await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "project", initialValue: 2 as never },
        "/proj/a",
      ),
    );
    expect(project.status).toBe("initialized");
    const session = await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "session", initialValue: 3 as never },
        "ses_1",
      ),
    );
    expect(session.status).toBe("initialized");

    expect(await run(getExact(storage, "t", "k", { scope: "global", owner: null }))).toBeDefined();
    expect(
      await run(getExact(storage, "t", "k", { scope: "project", owner: "/proj/a" })),
    ).toBeDefined();
    expect(
      await run(getExact(storage, "t", "k", { scope: "session", owner: "ses_1" })),
    ).toBeDefined();
  });

  test("markers prevent redo and preserve user changes across restarts", async () => {
    const storage = makeMemoryStorage();
    await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "global", initialValue: 1 as never },
        null,
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 99 as never },
        userCaller,
      ),
    );
    const second = await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "global", initialValue: 1 as never },
        null,
      ),
    );
    expect(second.status).toBe("skipped");
    const kept = await run(getExact(storage, "t", "k", { scope: "global", owner: null }));
    expect(kept?.value).toBe(99);
    expect(
      await run(
        hasInitMarker(storage, { pluginId: "acme", topic: "t", key: "k", scope: "global" }, null),
      ),
    ).toBe(true);
  });

  test("deleted initialized keys are never restored", async () => {
    const storage = makeMemoryStorage();
    const { removeExact } = await import("../src/store.ts");
    await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "global", initialValue: 1 as never },
        null,
      ),
    );
    await run(removeExact(storage, "t", "k", { scope: "global", owner: null }, userCaller));
    const again = await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "global", initialValue: 1 as never },
        null,
      ),
    );
    expect(again.status).toBe("skipped");
    expect(
      await run(getExact(storage, "t", "k", { scope: "global", owner: null })),
    ).toBeUndefined();
  });

  test("new projects and sessions initialize independently", async () => {
    const storage = makeMemoryStorage();
    await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "project", initialValue: 1 as never },
        "/proj/a",
      ),
    );
    const other = await run(
      ensureInitializer(
        storage,
        { pluginId: "acme", topic: "t", key: "k", scope: "project", initialValue: 1 as never },
        "/proj/b",
      ),
    );
    expect(other.status).toBe("initialized");
    expect(
      await run(getExact(storage, "t", "k", { scope: "project", owner: "/proj/b" })),
    ).toBeDefined();
  });

  test("plugins may change each other's keys; failures do not set markers", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 1 as never },
        pluginCaller("first"),
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 2 as never },
        pluginCaller("second"),
      ),
    );
    const entry = await run(getExact(storage, "t", "k", { scope: "global", owner: null }));
    expect(entry?.value).toBe(2);

    const failed = await runEither(
      ensureInitializer(
        storage,
        {
          pluginId: "bad",
          topic: "t",
          key: "bad",
          scope: "global",
          initialValue: "not-an-int" as never,
          schema: { type: "integer" } as never,
        },
        null,
      ),
    );
    expect(failed.ok).toBe(false);
    expect(
      await run(
        hasInitMarker(storage, { pluginId: "bad", topic: "t", key: "bad", scope: "global" }, null),
      ),
    ).toBe(false);
  });
});
