// The level a new bot starts on comes from the server (2026-10-11): Approve
// for me on a solo server, the organization's policy on an organization
// server, and the one-time move of older bots from Ask to Approve for me never
// runs where new bots start on Ask.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
const identity = (selection: ModelSelection) => selection;

describe("the level a new bot starts on", () => {
  // The shared Vitest setup gives this file its own disposable home.
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("is Approve for me by default (a solo server), bot and first thread", () => {
    const created = new Store(selection).createBot({}, { seedMessages: false });
    expect(created).toMatchObject({ approvalMode: "auto", autoApprove: true });
    expect(created.tasks?.[0]).toMatchObject({ approvalMode: "auto", autoApprove: true });
    // The zero-choice default is the safe level, never Full access: making the
    // engine/model Auto must never weaken the approval safeguard.
    expect(created.approvalMode).not.toBe("full");
  });

  it("follows the server's level, read at each creation", () => {
    let policy: "ask" | "auto" = "ask";
    const store = new Store(selection, identity, () => policy);
    const asked = store.createBot({}, { seedMessages: false });
    expect(asked).toMatchObject({ approvalMode: "ask", autoApprove: false });
    expect(asked.tasks?.[0]).toMatchObject({ approvalMode: "ask", autoApprove: false });
    policy = "auto";
    const auto = store.createBot({}, { seedMessages: false });
    expect(auto).toMatchObject({ approvalMode: "auto", autoApprove: true });
    // the earlier bot does not move
    expect(store.bot(asked.id)).toMatchObject({ approvalMode: "ask" });
    const saved = JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8")) as Array<{ id: string; approvalMode: string }>;
    expect(saved.find((bot) => bot.id === asked.id)?.approvalMode).toBe("ask");
  });

  it("leaves Ask bots alone where new bots start on Ask, and marks the move done so a later policy never moves them", () => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(join(DATA_DIR, "bots.json"), JSON.stringify([
      { id: "ask-bot", name: "Ask", threadId: "t1", soul: "", approvalMode: "ask", autoApprove: false,
        tasks: [{ threadId: "t1", title: "One", approvalMode: "ask", autoApprove: false }] },
      { id: "plain-bot", name: "Plain", threadId: "p1", soul: "", tasks: [{ threadId: "p1", title: "Plain" }] },
    ]));
    const org = new Store(selection, identity, () => "ask");
    expect(org.bot("ask-bot")?.approvalMode).toBe("ask");
    expect(org.taskByThread("ask-bot", "t1")?.approvalMode).toBe("ask");
    expect(org.bot("plain-bot")?.approvalMode).toBeUndefined();
    expect(existsSync(join(DATA_DIR, "approval-default-auto.v1"))).toBe(true);
    // the admin later sets the policy to Approve for me: existing bots stay
    const later = new Store(selection, identity, () => "auto");
    expect(later.bot("ask-bot")?.approvalMode).toBe("ask");
    expect(later.taskByThread("ask-bot", "t1")?.approvalMode).toBe("ask");
    expect(later.createBot({}, { seedMessages: false })).toMatchObject({ approvalMode: "auto" });
  });
});
