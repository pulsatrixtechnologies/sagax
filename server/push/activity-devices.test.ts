import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { activityRegistrationSchema, createLiveActivityTokenStore, MAX_ACTIVITY_TOKENS_PER_PERSON } from "./activity-devices.ts";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_C = "c".repeat(64);

describe("Live Activity token store", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  function store(now = 1_000) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-la-"));
    dirs.push(dir);
    let clock = now;
    return {
      dir,
      tick: (ms: number) => { clock += ms; },
      store: createLiveActivityTokenStore(dir, () => clock),
    };
  }

  it("registers an update token for a person and bot", () => {
    const { store: s } = store();
    const parsed = activityRegistrationSchema.parse({
      token: TOKEN_A,
      kind: "update",
      botId: "scout",
      activityId: "act-1",
      environment: "production",
      frequentUpdates: true,
    });
    const entry = s.register("pr_bob", { ...parsed, environment: "production" });
    expect(entry.botId).toBe("scout");
    expect(entry.kind).toBe("update");
    expect(s.listForBot("pr_bob", "scout")).toHaveLength(1);
    expect(s.listForBot("PR_BOB", "scout")).toHaveLength(1);
  });

  it("requires botId for update tokens and allows start without botId", () => {
    expect(activityRegistrationSchema.safeParse({ token: TOKEN_A, kind: "update" }).success).toBe(false);
    expect(activityRegistrationSchema.safeParse({ token: TOKEN_A, kind: "start" }).success).toBe(true);
  });

  it("isolates people: Alice never sees Bob's tokens", () => {
    const { store: s } = store();
    s.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    s.register("pr_alice", { token: TOKEN_B, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    expect(s.list("pr_bob").map((t) => t.token)).toEqual([TOKEN_A]);
    expect(s.list("pr_alice").map((t) => t.token)).toEqual([TOKEN_B]);
    expect(s.listForBot("pr_bob", "scout")).toHaveLength(1);
    expect(s.listForBot("pr_alice", "mira")).toHaveLength(0);
  });

  it("moves a token to the person who registers it last", () => {
    const { store: s } = store();
    s.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "sandbox", appVersion: "", deviceName: "" });
    s.register("pr_alice", { token: TOKEN_A, kind: "update", botId: "mira", environment: "sandbox", appVersion: "", deviceName: "" });
    expect(s.list("pr_bob")).toHaveLength(0);
    expect(s.listForBot("pr_alice", "mira")[0]?.token).toBe(TOKEN_A);
  });

  it("removes tokens for a bot on end and prunes a dead token", () => {
    const { store: s } = store();
    s.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    s.register("pr_bob", { token: TOKEN_B, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    s.register("pr_bob", { token: TOKEN_C, kind: "start", environment: "production", appVersion: "", deviceName: "" });
    expect(s.removeForBot("pr_bob", "scout")).toBe(2);
    expect(s.list("pr_bob")).toHaveLength(1);
    expect(s.list("pr_bob")[0]?.kind).toBe("start");
    expect(s.prune(TOKEN_C)).toBe(true);
    expect(s.list("pr_bob")).toHaveLength(0);
  });

  it("caps update tokens per person", () => {
    const { store: s, tick } = store();
    for (let i = 0; i < MAX_ACTIVITY_TOKENS_PER_PERSON + 3; i++) {
      const token = i.toString(16).padStart(64, "0");
      s.register("pr_bob", { token, kind: "update", botId: `bot-${i}`, environment: "production", appVersion: "", deviceName: "" });
      tick(1);
    }
    expect(s.list("pr_bob").filter((t) => t.kind === "update").length).toBe(MAX_ACTIVITY_TOKENS_PER_PERSON);
  });

  it("removePerson clears every token", () => {
    const { store: s } = store();
    s.register("pr_bob", { token: TOKEN_A, kind: "update", botId: "scout", environment: "production", appVersion: "", deviceName: "" });
    s.removePerson("PR_BOB");
    expect(s.list("pr_bob")).toHaveLength(0);
  });
});
