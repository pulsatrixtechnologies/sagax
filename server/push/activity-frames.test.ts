import { describe, expect, it } from "vitest";

import { liveActivityUpdatesForFrame } from "./activity-frames.ts";

const deps = (people: string[] = ["pr_bob"]) => ({
  activityPeople: () => people,
  muted: () => false,
  now: () => 1_000,
});

describe("liveActivityUpdatesForFrame", () => {
  it("maps approval notify to needsYou for the audience person only", () => {
    const updates = liveActivityUpdatesForFrame({
      kind: "notify",
      notification: {
        kind: "approval",
        botId: "scout",
        botName: "Scout",
        threadId: "t1",
        title: "Allow?",
        ask: "Run ls?",
        body: "ls -la",
        requestId: "r1",
        audience: ["pr_bob"],
      },
    }, deps(["pr_other"]));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      personId: "pr_bob",
      botId: "scout",
      phase: "needsYou",
      requestId: "r1",
      options: ["Allow", "Deny"],
      isPermission: true,
      line: "Run ls?",
    });
  });

  it("maps done notify to end phase", () => {
    const updates = liveActivityUpdatesForFrame({
      kind: "notify",
      notification: { kind: "done", botId: "scout", botName: "Scout", threadId: "t1", title: "Scout", body: "Done" },
    }, deps());
    expect(updates).toEqual([expect.objectContaining({ personId: "pr_bob", phase: "done", botId: "scout" })]);
  });

  it("maps bot working / idle frames", () => {
    const working = liveActivityUpdatesForFrame({
      kind: "bot",
      bot: { id: "scout", name: "Scout", activity: "working", threadId: "t1", workingLabel: "Editing" },
      audience: ["pr_bob"],
    }, deps());
    expect(working[0]).toMatchObject({ phase: "working", line: "Editing", personId: "pr_bob" });

    const idle = liveActivityUpdatesForFrame({
      kind: "bot",
      bot: { id: "scout", name: "Scout", activity: "idle", threadId: "t1" },
      audience: ["pr_bob"],
    }, deps());
    expect(idle[0]?.phase).toBe("done");
  });

  it("respects mute and skips quietOnPhones", () => {
    expect(liveActivityUpdatesForFrame({
      kind: "notify",
      notification: { kind: "done", botId: "scout", botName: "Scout", threadId: "t", title: "x", body: "y", quietOnPhones: true },
    }, deps())).toEqual([]);

    const muted = liveActivityUpdatesForFrame({
      kind: "notify",
      notification: { kind: "done", botId: "scout", botName: "Scout", threadId: "t", title: "x", body: "y" },
    }, { ...deps(), muted: () => true });
    expect(muted).toEqual([]);
  });
});
