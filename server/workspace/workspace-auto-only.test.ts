// This computer and the cloud computer stay (the dev panel writes them).
// A Local VM, the browser, and every conversation pin still go back to Auto.
// Off is gone from every menu: the start sweep puts a saved
// Off back on Auto.
// Levels are never touched (#1098): the one-time move to Ask is not replayed.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { Store } from "../store.ts";
import { autoOnlyDestination } from "../surface.ts";

describe("a Works on from a request", () => {
  it("keeps this computer, the cloud computer and an API caller's Off, and reads the rest as Auto", () => {
    expect(autoOnlyDestination("local")).toBe("local");
    expect(autoOnlyDestination("cloud")).toBe("cloud");
    expect(autoOnlyDestination("off")).toBe("off");
    for (const place of ["vm", "browser", "auto", null, undefined, 42]) expect(autoOnlyDestination(place)).toBeUndefined();
  });
});

describe("the start sweep", () => {
  beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
  const newBotDefault = () => ({ instanceId: "claude", model: "claude-model" });

  it("keeps this computer and the cloud computer, moves every conversation pin and a saved Off back to Auto, and is idempotent", () => {
    const store = new Store(newBotDefault);
    const cloud = store.createBot({}, { seedMessages: false });
    const local = store.createBot({}, { seedMessages: false });
    const off = store.createBot({}, { seedMessages: false });
    const auto = store.createBot({}, { seedMessages: false });
    store.patchBot(cloud.id, { computer: "cloud", approvalMode: "ask" });
    store.patchTask(cloud.id, cloud.threadId, { approvalMode: "ask" });
    store.patchBot(local.id, { computer: "local" });
    store.patchBot(off.id, { computer: "off" });
    const second = store.createTask(auto.id, "Pinned by a person", false)!;
    store.patchTask(auto.id, second.threadId, { surface: "vm", surfaceSource: "user" });
    store.patchTask(auto.id, auto.threadId, { surface: "browser" });
    store.patchTask(off.id, off.threadId, { surface: "local", surfaceSource: "auto" });

    expect(store.retireFixedWorkspaces()).toEqual({ bots: 1, pins: 3 });

    const reloaded = new Store(newBotDefault);
    expect(reloaded.bot(cloud.id)?.computer).toBe("cloud");
    expect(reloaded.bot(local.id)?.computer).toBe("local");
    expect(reloaded.bot(cloud.id)?.approvalMode).toBe("ask");
    // Off is no longer a choice: the bot is back on Auto, its card shows again.
    expect(reloaded.bot(off.id)?.computer).toBeUndefined();
    for (const [botId, threadId] of [[auto.id, auto.threadId], [auto.id, second.threadId], [off.id, off.threadId]] as const) {
      const task = reloaded.taskByThread(botId, threadId)!;
      expect(task.surface).toBeUndefined();
      expect(task.surfaceSource).toBeUndefined();
    }
    // Nothing left to move: no error, no write.
    expect(reloaded.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0 });
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0 });
  });

  it("drops a stray pin origin without a place", () => {
    const store = new Store(newBotDefault);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchTask(bot.id, bot.threadId, { surfaceSource: "user" });
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0 });
    expect(new Store(newBotDefault).taskByThread(bot.id, bot.threadId)?.surfaceSource).toBeUndefined();
  });

  it("keeps every level, Always allow list and grant a person set: the 2026-10-18 move to Ask is not replayed (#1098)", () => {
    const store = new Store(newBotDefault);
    const browser = store.createBot({}, { seedMessages: false });
    store.patchBot(browser.id, { computer: "browser", approvalMode: "auto", autoApprove: true, alwaysAllow: ["Bash"] });
    // #4200 (one approval level per bot, #4226): a conversation holds no
    // level of its own; it runs at the bot's, with the rules saved in it.
    const thread = store.createTask(browser.id, "Its own rules", false)!;
    store.patchTask(browser.id, thread.threadId, { alwaysAllow: ["Read"] });
    const pinned = store.createTask(browser.id, "Pinned to a VM", false)!;
    store.patchTask(browser.id, pinned.threadId, { surface: "vm", surfaceSource: "user" });

    expect(store.retireFixedWorkspaces()).toEqual({ bots: 1, pins: 1 });

    const reloaded = new Store(newBotDefault);
    expect(reloaded.bot(browser.id)).toMatchObject({ approvalMode: "auto", autoApprove: true, alwaysAllow: ["Bash"] });
    expect(reloaded.bot(browser.id)?.computer).toBeUndefined();
    expect(reloaded.projectBotForTask(browser.id, thread.threadId)).toMatchObject({ approvalMode: "auto", alwaysAllow: ["Bash", "Read"] });
    expect(reloaded.projectBotForTask(browser.id, pinned.threadId)).toMatchObject({ approvalMode: "auto", alwaysAllow: ["Bash"] });
    expect(reloaded.taskByThread(browser.id, pinned.threadId)?.surface).toBeUndefined();
  });
});
