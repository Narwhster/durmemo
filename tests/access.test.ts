import { describe, expect, test } from "vite-plus/test";
import {
  getEffective,
  listEffective,
  pluginCaller,
  removeExact,
  sessionCaller,
  upsertExact,
  userCaller,
} from "../src/store.ts";
import { makeMemoryStorage, run, runEither } from "./helpers.ts";

describe("NAR-6 validate and protect", () => {
  test("writes validate against schema; adding schema does not lock", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        {
          topic: "t",
          key: "k",
          scope: "global",
          owner: null,
          value: { age: 3 } as never,
          schema: {
            type: "object",
            required: ["age"],
            properties: { age: { type: "integer", minimum: 0 } },
          } as never,
        },
        userCaller,
      ),
    );
    const entry = await run(
      getEffective(storage, "t", "k", { ancestry: ["s"], projectCanonical: null }, userCaller),
    );
    expect(entry?.entry.locked).toBe(false);
    expect(entry?.entry.allowlist).toEqual([]);

    const bad = await runEither(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: { age: -1 } as never },
        sessionCaller("s"),
      ),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error._tag).toBe("ValidationFailed");
  });

  test("locked public: outsider may update value only", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: "v1" as never, locked: true },
        sessionCaller("ses_owner"),
      ),
    );
    const locked = await run(
      getEffective(storage, "t", "k", { ancestry: ["x"], projectCanonical: null }, userCaller),
    );
    expect(locked?.entry.allowlist).toContain("ses_owner");

    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: "v2" as never },
        sessionCaller("ses_outsider"),
      ),
    );
    const after = await run(
      getEffective(storage, "t", "k", { ancestry: ["x"], projectCanonical: null }, userCaller),
    );
    expect(after?.entry.value).toBe("v2");

    const denied = await runEither(
      upsertExact(
        storage,
        {
          topic: "t",
          key: "k",
          scope: "global",
          owner: null,
          value: "v3" as never,
          locked: false,
        },
        sessionCaller("ses_outsider"),
      ),
    );
    expect(denied.ok).toBe(false);

    const deleteDenied = await runEither(
      removeExact(
        storage,
        "t",
        "k",
        { scope: "global", owner: null },
        sessionCaller("ses_outsider"),
      ),
    );
    expect(deleteDenied.ok).toBe(false);
  });

  test("plugin lock uses empty allowlist; session lock adds itself", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 1 as never, locked: true },
        pluginCaller("acme"),
      ),
    );
    const entry = await run(
      getEffective(storage, "t", "k", { ancestry: ["s"], projectCanonical: null }, userCaller),
    );
    expect(entry?.entry.allowlist).toEqual([]);
  });

  test("private implies locked; outsiders list metadata only", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        {
          topic: "t",
          key: "k",
          scope: "global",
          owner: null,
          value: "secret" as never,
          isPrivate: true,
        },
        sessionCaller("owner"),
      ),
    );
    const scope = { ancestry: ["outsider"], projectCanonical: null };
    const winners = await run(listEffective(storage, scope, sessionCaller("outsider")));
    expect(winners).toHaveLength(1);
    const read = await runEither(getEffective(storage, "t", "k", scope, sessionCaller("outsider")));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error._tag).toBe("AccessDenied");

    const allowed = await run(
      getEffective(
        storage,
        "t",
        "k",
        { ancestry: ["owner"], projectCanonical: null },
        sessionCaller("owner"),
      ),
    );
    expect(allowed?.entry.value).toBe("secret");
  });

  test("user and plugin bypass locks and privacy", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 1 as never, isPrivate: true },
        sessionCaller("owner"),
      ),
    );
    const asUser = await run(
      getEffective(
        storage,
        "t",
        "k",
        { ancestry: ["stranger"], projectCanonical: null },
        userCaller,
      ),
    );
    expect(asUser?.entry.value).toBe(1);
    const asPlugin = await run(
      getEffective(
        storage,
        "t",
        "k",
        { ancestry: ["stranger"], projectCanonical: null },
        pluginCaller("other"),
      ),
    );
    expect(asPlugin?.entry.value).toBe(1);

    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 2 as never },
        pluginCaller("other"),
      ),
    );
    const changed = await run(
      getEffective(storage, "t", "k", { ancestry: ["owner"], projectCanonical: null }, userCaller),
    );
    expect(changed?.entry.value).toBe(2);
  });

  test("allowlisted sessions manage metadata; descendants are not automatic", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 1 as never, locked: true },
        sessionCaller("parent"),
      ),
    );
    const childDenied = await runEither(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 1 as never, locked: false },
        sessionCaller("child-of-parent"),
      ),
    );
    expect(childDenied.ok).toBe(false);

    await run(
      upsertExact(
        storage,
        {
          topic: "t",
          key: "k",
          scope: "global",
          owner: null,
          value: 1 as never,
          allowlist: ["parent", "child-of-parent"],
        },
        sessionCaller("parent"),
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 1 as never, locked: false },
        sessionCaller("child-of-parent"),
      ),
    );
    const unlocked = await run(
      getEffective(storage, "t", "k", { ancestry: ["x"], projectCanonical: null }, userCaller),
    );
    expect(unlocked?.entry.locked).toBe(false);
  });
});
