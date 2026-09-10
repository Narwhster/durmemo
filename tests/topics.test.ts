import { describe, expect, test } from "vite-plus/test";
import { upsertExact, userCaller } from "../src/store.ts";
import {
  collectEffectiveTags,
  discoverableTopics,
  extractHashtagTopics,
  listOwnTags,
  resolveEffectiveTags,
  tagTopic,
} from "../src/topics.ts";
import { makeMemoryStorage, run } from "./helpers.ts";

describe("NAR-7 topics per session", () => {
  test("user tags recorded; hashtag grammar lowercases", async () => {
    const storage = makeMemoryStorage();
    const record = await run(tagTopic(storage, "ses_1", "My-Topic_2", "user"));
    expect(record.topic).toBe("my-topic_2");
    expect(record.by).toBe("user");
    const own = await run(listOwnTags(storage, "ses_1"));
    expect(own.map((t) => t.topic)).toContain("my-topic_2");
  });

  test("plugin tag works the same way", async () => {
    const storage = makeMemoryStorage();
    await run(tagTopic(storage, "ses_1", "plug", "plugin"));
    const own = await run(listOwnTags(storage, "ses_1"));
    expect(own[0]?.by).toBe("plugin");
  });

  test("child inherits at next prompt; siblings isolated", async () => {
    const storage = makeMemoryStorage();
    await run(tagTopic(storage, "parent", "alpha", "user"));
    await run(tagTopic(storage, "sibling-a", "solo-a", "user"));
    await run(tagTopic(storage, "sibling-b", "solo-b", "user"));

    const childTags = await run(collectEffectiveTags(storage, ["child", "parent"]));
    expect(childTags.map((t) => t.topic)).toContain("alpha");

    const siblingA = await run(collectEffectiveTags(storage, ["sibling-a"]));
    expect(siblingA.map((t) => t.topic)).not.toContain("solo-b");
    const siblingB = await run(collectEffectiveTags(storage, ["sibling-b"]));
    expect(siblingB.map((t) => t.topic)).not.toContain("solo-a");
  });

  test("tags before and after child creation both resolve", async () => {
    const storage = makeMemoryStorage();
    await run(tagTopic(storage, "parent", "before", "user"));
    const childEarly = await run(collectEffectiveTags(storage, ["child", "parent"]));
    expect(childEarly.map((t) => t.topic)).toContain("before");

    await run(tagTopic(storage, "parent", "after", "user"));
    const childLate = await run(collectEffectiveTags(storage, ["child", "parent"]));
    expect(childLate.map((t) => t.topic)).toContain("after");

    await run(tagTopic(storage, "child", "own", "user"));
    const childOwn = await run(collectEffectiveTags(storage, ["child", "parent"]));
    expect(childOwn.map((t) => t.topic)).toEqual(
      expect.arrayContaining(["before", "after", "own"]),
    );
  });

  test("own tags win over ancestors; no pushing into live children needed", async () => {
    const own = [{ topic: "t", sessionID: "child", by: "user" as const, at: 2 }];
    const ancestors = [[{ topic: "t", sessionID: "parent", by: "plugin" as const, at: 1 }]];
    const resolved = resolveEffectiveTags({ own, ancestors });
    expect(resolved[0]?.sessionID).toBe("child");
  });

  test("discovery needs at least one key; keyless tagged topics stay hidden", async () => {
    const storage = makeMemoryStorage();
    await run(tagTopic(storage, "ses_1", "empty", "user"));
    await run(tagTopic(storage, "ses_1", "full", "user"));
    await run(
      upsertExact(
        storage,
        { topic: "full", key: "k", scope: "global", owner: null, value: 1 as never },
        userCaller,
      ),
    );
    const effective = await run(collectEffectiveTags(storage, ["ses_1"]));
    const discoverable = discoverableTopics({
      effectiveTags: effective,
      topicsWithKeys: new Set(["full"]),
    });
    expect(discoverable.map((t) => t.topic)).toEqual(["full"]);
  });

  test("hashtag extraction matches grammar", async () => {
    expect(extractHashtagTopics("hello #mem-plan today")).toContain("mem-plan");
    expect(extractHashtagTopics("#UPPER becomes lower")).toContain("upper");
    expect(extractHashtagTopics("no hashtags here")).toEqual([]);
  });

  test("agents have no tagging path (only user/plugin tag functions exist)", async () => {
    const agentTools = await import("../src/agent-tools.ts");
    expect("tagTopic" in agentTools).toBe(false);
    expect("agentListKeys" in agentTools).toBe(true);
  });
});
