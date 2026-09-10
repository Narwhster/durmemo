import { describe, expect, test } from "vite-plus/test";
import {
  agentDelete,
  agentListKeys,
  agentRead,
  agentWrite,
  type AgentDeps,
} from "../src/agent-tools.ts";
import { tagTopic } from "../src/topics.ts";
import { collectEffectiveTags } from "../src/topics.ts";
import { resolveAncestry, upsertExact, userCaller, type ScopeContext } from "../src/store.ts";
import { makeMemoryStorage, run, runEither } from "./helpers.ts";
import { Effect } from "effect";

const project = "/proj/a";

const makeDeps = (
  storage: ReturnType<typeof makeMemoryStorage>,
  parents: Record<string, string | undefined>,
): AgentDeps => {
  const resolver = (id: string) =>
    Effect.succeed(
      parents[id] === undefined ? { id } : { id, parentID: parents[id] as string | undefined },
    );
  return {
    storage,
    taggedTopics: (sessionID: string) =>
      Effect.gen(function* () {
        const ancestry = yield* resolveAncestry(resolver, sessionID);
        const effective = yield* collectEffectiveTags(storage, ancestry);
        return new Set<string>(effective.map((t) => t.topic));
      }),
    scopeFor: (sessionID: string): Effect.Effect<ScopeContext> =>
      Effect.gen(function* () {
        const ancestry = yield* resolveAncestry(resolver, sessionID);
        return { ancestry, projectCanonical: project };
      }),
  };
};

const tagSet = async (
  storage: ReturnType<typeof makeMemoryStorage>,
  sessionID: string,
  topics: ReadonlyArray<string>,
): Promise<void> => {
  for (const topic of topics) {
    await run(tagTopic(storage, sessionID, topic, "user"));
  }
};

describe("NAR-9 agent tools", () => {
  test("untagged access rejected even on guess; lists and reads agree", async () => {
    const storage = makeMemoryStorage();
    await run(
      upsertExact(
        storage,
        { topic: "secret", key: "k", scope: "global", owner: null, value: 1 as never },
        userCaller,
      ),
    );
    const deps = makeDeps(storage, {});
    const list = await run(agentListKeys(deps, "ses_1", {}));
    expect(list).toEqual([]);

    const read = await runEither(agentRead(deps, "ses_1", { topic: "secret", key: "k" }));
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error._tag).toBe("Untagged");
      expect(read.error.message).toMatch(/not tagged/);
    }

    await tagSet(storage, "ses_1", ["secret"]);
    const list2 = await run(agentListKeys(deps, "ses_1", {}));
    expect(list2).toHaveLength(1);
    expect(list2[0]).toMatchObject({ topic: "secret", key: "k", scope: "global" });
    const read2 = await run(agentRead(deps, "ses_1", { topic: "secret", key: "k" }));
    expect(read2.value).toBe(1);
  });

  test("writes and deletes need exact scope and may shadow", async () => {
    const storage = makeMemoryStorage();
    await tagSet(storage, "ses_1", ["t"]);
    const deps = makeDeps(storage, { ses_child: "ses_1" });
    await tagSet(storage, "ses_1", ["t"]);
    await run(tagTopic(storage, "ses_child", "t", "user"));
    await run(
      upsertExact(
        storage,
        { topic: "t", key: "k", scope: "global", owner: null, value: "g" as never },
        userCaller,
      ),
    );
    const written = await run(
      agentWrite(deps, "ses_child", {
        topic: "t",
        key: "k",
        scope: "session",
        value: "s" as never,
      }),
    );
    expect(written).toMatchObject({ topic: "t", key: "k", scope: "session", owner: "ses_child" });

    const read = await run(agentRead(deps, "ses_child", { topic: "t", key: "k" }));
    expect(read.scope).toBe("session");
    expect(read.value).toBe("s");

    const deleted = await run(
      agentDelete(deps, "ses_child", { topic: "t", key: "k", scope: "session" }),
    );
    expect(deleted).toMatchObject({ scope: "session", removed: true });
    const after = await run(agentRead(deps, "ses_child", { topic: "t", key: "k" }));
    expect(after.scope).toBe("global");
  });

  test("schemas, locks, and private winners", async () => {
    const storage = makeMemoryStorage();
    await tagSet(storage, "ses_owner", ["t"]);
    await tagSet(storage, "ses_outsider", ["t"]);
    const deps = makeDeps(storage, {});

    await run(
      agentWrite(deps, "ses_owner", {
        topic: "t",
        key: "k",
        scope: "global",
        value: 5 as never,
        schema: { type: "integer" } as never,
        locked: true,
      }),
    );
    const badSchema = await runEither(
      agentWrite(deps, "ses_outsider", {
        topic: "t",
        key: "k",
        scope: "global",
        value: "nope" as never,
      }),
    );
    expect(badSchema.ok).toBe(false);
    if (!badSchema.ok) expect(badSchema.error._tag).toBe("ValidationFailed");

    await run(
      agentWrite(deps, "ses_owner", {
        topic: "t",
        key: "priv",
        scope: "global",
        value: "shh" as never,
        isPrivate: true,
      }),
    );
    const list = await run(agentListKeys(deps, "ses_outsider", {}));
    const priv = list.find((r) => r.key === "priv");
    expect(priv?.isPrivate).toBe(true);
    expect(priv?.hasValue).toBe(false);
    expect(priv).not.toHaveProperty("value");
  });

  test("project scope writes resolve the current canonical project", async () => {
    const storage = makeMemoryStorage();
    await tagSet(storage, "ses_1", ["t"]);
    const deps = makeDeps(storage, {});
    const written = await run(
      agentWrite(deps, "ses_1", { topic: "t", key: "k", scope: "project", value: "p" as never }),
    );
    expect(written).toMatchObject({ scope: "project", owner: "/proj/a" });
    const read = await run(agentRead(deps, "ses_1", { topic: "t", key: "k" }));
    expect(read.scope).toBe("project");
    expect(read.value).toBe("p");
  });

  test("no list_topics tool; list_keys carries topic", async () => {
    const tools = await import("../src/agent-tools.ts");
    expect("agentListKeys" in tools).toBe(true);
    expect("agentListTopics" in tools).toBe(false);
    expect("listTopics" in tools).toBe(false);
  });
});
