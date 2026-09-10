import { describe, expect, test } from "vite-plus/test";
import { Effect } from "effect";
import {
  getEffective,
  getExact,
  listAllVersions,
  listEffective,
  loadAllEntries,
  pickWinners,
  pluginCaller,
  removeExact,
  resolveAncestry,
  sessionCaller,
  upsertExact,
  userCaller,
  type StoredEntry,
} from "../src/store.ts";
import { makeMemoryStorage, run, runEither } from "./helpers.ts";

const projectA = "/proj/a";
const projectB = "/proj/b";

describe("NAR-5 store and resolve", () => {
  test("CRUD plus scan at each scope works", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "mem", key: "k1", scope: "global", owner: null, value: "g" as never },
        userCaller,
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "mem", key: "k1", scope: "project", owner: projectA, value: "p" as never },
        userCaller,
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "mem", key: "k1", scope: "session", owner: "ses_1", value: "s" as never },
        userCaller,
      ),
    );
    const all = await run(loadAllEntries(storage));
    expect(all).toHaveLength(3);

    const global = await run(getExact(storage, "mem", "k1", { scope: "global", owner: null }));
    expect(global?.value).toBe("g");
    const project = await run(
      getExact(storage, "mem", "k1", { scope: "project", owner: projectA }),
    );
    expect(project?.value).toBe("p");
    const session = await run(getExact(storage, "mem", "k1", { scope: "session", owner: "ses_1" }));
    expect(session?.value).toBe("s");

    await run(
      upsertExact(
        storage,
        { topic: "mem", key: "k1", scope: "session", owner: "ses_1", value: "s2" as never },
        userCaller,
      ),
    );
    const updated = await run(getExact(storage, "mem", "k1", { scope: "session", owner: "ses_1" }));
    expect(updated?.value).toBe("s2");

    await run(removeExact(storage, "mem", "k1", { scope: "session", owner: "ses_1" }, userCaller));
    const gone = await run(getExact(storage, "mem", "k1", { scope: "session", owner: "ses_1" }));
    expect(gone).toBeUndefined();
  });

  test("reads choose closest session, then project, then global", async () => {
    const storage = makeMemoryStorage();
    const ancestry = ["ses_child", "ses_parent", "ses_root"];
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: "g" as never },
        userCaller,
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "project", owner: projectA, value: "p" as never },
        userCaller,
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "session", owner: "ses_root", value: "root" as never },
        userCaller,
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "session", owner: "ses_parent", value: "parent" as never },
        userCaller,
      ),
    );
    const scope = { ancestry, projectCanonical: projectA };
    const winner = await run(getEffective(storage, "t", "k", scope, userCaller));
    expect(winner?.entry.value).toBe("parent");
    expect(winner?.reason).toMatch(/ancestor/);

    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "session", owner: "ses_child", value: "child" as never },
        userCaller,
      ),
    );
    const winner2 = await run(getEffective(storage, "t", "k", scope, userCaller));
    expect(winner2?.entry.value).toBe("child");

    await run(removeExact(storage, "t", "k", { scope: "session", owner: "ses_child" }, userCaller));
    await run(
      removeExact(storage, "t", "k", { scope: "session", owner: "ses_parent" }, userCaller),
    );
    await run(removeExact(storage, "t", "k", { scope: "session", owner: "ses_root" }, userCaller));
    const winner3 = await run(getEffective(storage, "t", "k", scope, userCaller));
    expect(winner3?.entry.value).toBe("p");

    await run(removeExact(storage, "t", "k", { scope: "project", owner: projectA }, userCaller));
    const winner4 = await run(getEffective(storage, "t", "k", scope, userCaller));
    expect(winner4?.entry.value).toBe("g");
  });

  test("sibling isolation and descendant access", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "session", owner: "ses_a", value: "a" as never },
        userCaller,
      ),
    );
    const siblingScope = { ancestry: ["ses_b"], projectCanonical: projectA };
    const sibling = await run(getEffective(storage, "t", "k", siblingScope, userCaller));
    expect(sibling).toBeUndefined();

    const childScope = { ancestry: ["ses_child", "ses_a"], projectCanonical: projectA };
    const child = await run(getEffective(storage, "t", "k", childScope, userCaller));
    expect(child?.entry.value).toBe("a");
  });

  test("project isolation and explicit-scope mutations shadow intentionally", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "project", owner: projectA, value: "a" as never },
        userCaller,
      ),
    );
    const otherProject = await run(
      getEffective(
        storage,
        "t",
        "k",
        { ancestry: ["ses_1"], projectCanonical: projectB },
        userCaller,
      ),
    );
    expect(otherProject).toBeUndefined();

    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "session", owner: "ses_1", value: "shadow" as never },
        sessionCaller("ses_1"),
      ),
    );
    const winner = await run(
      getEffective(
        storage,
        "t",
        "k",
        { ancestry: ["ses_1"], projectCanonical: projectA },
        userCaller,
      ),
    );
    expect(winner?.entry.scope).toBe("session");
    expect(winner?.entry.value).toBe("shadow");
  });

  test("winner and all-versions modes exist", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: 1 as never },
        userCaller,
      ),
    );
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "project", owner: projectA, value: 2 as never },
        userCaller,
      ),
    );
    const scope = { ancestry: ["ses_1"], projectCanonical: projectA };
    const winners = await run(listEffective(storage, scope, userCaller));
    expect(winners).toHaveLength(1);
    expect(winners[0]?.entry.value).toBe(2);
    const versions = await run(listAllVersions(storage, scope, "t", "k"));
    expect(versions).toHaveLength(2);
  });

  test("ancestry resolver walks parents and stops on cycles", async () => {
    const storage = makeMemoryStorage();
    void storage;
    const resolver = (id: string) =>
      Effect.succeed(
        id === "c"
          ? { id: "c", parentID: "p" }
          : id === "p"
            ? { id: "p", parentID: "c" }
            : undefined,
      );
    const chain = await run(resolveAncestry(resolver, "c"));
    expect(chain).toEqual(["c", "p"]);
  });

  test("pickWinners is pure and deterministic", async () => {
    const mk = (
      scope: StoredEntry["scope"],
      owner: string | null,
      value: unknown,
    ): StoredEntry => ({
      topic: "t",
      key: "k",
      scope,
      owner,
      value: value as never,
      isPrivate: false,
      locked: false,
      allowlist: [],
      createdBy: "user",
      updatedAt: 1,
    });
    const winners = pickWinners({
      entries: [mk("global", null, "g"), mk("project", projectA, "p")],
      ancestry: ["s"],
      projectCanonical: projectA,
    });
    expect(winners[0]?.entry.value).toBe("p");
    expect(winners[0]?.reason).toMatch(/project/);
    void pluginCaller;
  });

  test("invalid names are rejected", async () => {
    const storage = makeMemoryStorage();
    const bad = await runEither(
      upsertExact(
        storage,
        { topic: "Bad Topic!", key: "k", scope: "global", owner: null, value: 1 as never },
        userCaller,
      ),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error._tag).toBe("InvalidName");
  });
});
