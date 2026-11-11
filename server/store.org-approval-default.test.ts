// The level a new bot starts on comes from the server (2026-10-11 / omb #2808):
// Full access on a solo server, the organization's policy on an organization
// server, and the one-time move of older bots from Ask to Approve for me never
// runs where new bots start on Ask (or on Full).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";
import { flushOwnedFilesSync } from "./atomic.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
const identity = (selection: ModelSelection) => selection;

describe("the level a new bot starts on", () => {
  // The shared Vitest setup gives this file its own disposable home.
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("is Full access by default (a solo server), bot and first thread", () => {
    const store = new Store(selection);
    const created = store.createBot({}, { seedMessages: false });
    expect(created).toMatchObject({ approvalMode: "full", autoApprove: false });
    // #1207: the first thread stores no copy of the level; it reads the bot's.
    expect(created.tasks?.[0].approvalMode).toBeUndefined();
    expect(store.projectBotForTask(created.id, created.threadId)).toMatchObject({ approvalMode: "full", autoApprove: false });
    // omb #2808: solo servers start on Full, like t3code. Org New-bot policy
    // still chooses Ask or Approve for me on Perspicax.
    expect(created.approvalMode).toBe("full");
  });

  it("follows the server's level, read at each creation", () => {
    let policy: "ask" | "auto" = "ask";
    const store = new Store(selection, identity, () => policy);
    const asked = store.createBot({}, { seedMessages: false });
    expect(asked).toMatchObject({ approvalMode: "ask", autoApprove: false });
    expect(asked.tasks?.[0].approvalMode).toBeUndefined();
    expect(store.projectBotForTask(asked.id, asked.threadId)).toMatchObject({ approvalMode: "ask", autoApprove: false });
    policy = "auto";
    const auto = store.createBot({}, { seedMessages: false });
    expect(auto).toMatchObject({ approvalMode: "auto", autoApprove: true });
    // the earlier bot does not move
    expect(store.bot(asked.id)).toMatchObject({ approvalMode: "ask" });
    flushOwnedFilesSync();
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
    // #1207: the thread's stored copy goes; it follows its Ask bot
    expect(org.taskByThread("ask-bot", "t1")?.approvalMode).toBeUndefined();
    expect(org.projectBotForTask("ask-bot", "t1")?.approvalMode).toBe("ask");
    expect(org.bot("plain-bot")?.approvalMode).toBeUndefined();
    expect(existsSync(join(DATA_DIR, "approval-default-auto.v1"))).toBe(true);
    // the admin later sets the policy to Approve for me: existing bots stay
    const later = new Store(selection, identity, () => "auto");
    expect(later.bot("ask-bot")?.approvalMode).toBe("ask");
    expect(later.projectBotForTask("ask-bot", "t1")?.approvalMode).toBe("ask");
    expect(later.createBot({}, { seedMessages: false })).toMatchObject({ approvalMode: "auto" });
  });
});
