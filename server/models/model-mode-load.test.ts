// Composer modes (#5088): Fast, Expert and Heavy are kept on load; Build left
// the modes and a saved one is dropped; a thread pinned to the model an Auto
// bot falls back on does not follow the bot into Auto.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { Store } from "../store.ts";
import { sameModelSelection } from "../../shared/thread-model.ts";

const BOTS_FILE = (): string => join(DATA_DIR, "bots.json");
const base = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("sameModelSelection and Auto", () => {
  it("a thread on the model an Auto bot falls back on is not following the bot", () => {
    expect(sameModelSelection(base(), { ...base(), auto: true })).toBe(false);
    expect(sameModelSelection({ ...base(), auto: true }, { ...base(), auto: true })).toBe(true);
    expect(sameModelSelection(base(), base())).toBe(true);
  });
});

describe("stored data that carries a mode", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("keeps Heavy on the bot, and drops Build (D-20261126-005) and a mode it does not know: the thread keeps its model and Auto", () => {
    const store = new Store(base);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const other = store.createTask(bot.id, "Other", false)!;
    store.switchTaskModel(bot.id, bot.tasks![0]!.threadId, { ...base(), auto: true }, true);
    store.switchTaskModel(bot.id, other.threadId, { instanceId: "codex", model: "gpt-6-astra", auto: true }, false);
    const saved = JSON.parse(JSON.stringify(store.bots));
    saved[0].modelSelection.mode = "heavy";
    const task = saved[0].tasks.find((t: { threadId: string }) => t.threadId === other.threadId);
    task.modelSelection.mode = "build";
    const third = store.createTask(bot.id, "Third", false)!;
    const unknown = JSON.parse(JSON.stringify(store.bots))[0].tasks.find((t: { threadId: string }) => t.threadId === third.threadId);
    unknown.modelSelection = { instanceId: "codex", model: "gpt-6-astra", auto: true, mode: "turbo" };
    saved[0].tasks.push(unknown);
    mkdirSync(dirname(BOTS_FILE()), { recursive: true });
    writeFileSync(BOTS_FILE(), JSON.stringify(saved));

    const reloaded = new Store(base);
    const loaded = reloaded.bot(bot.id)!;
    expect(loaded.modelSelection).toMatchObject({ auto: true, mode: "heavy" });
    const loadedTask = reloaded.taskByThread(bot.id, other.threadId)!;
    expect(loadedTask.modelSelection).toMatchObject({ model: "gpt-6-astra", auto: true });
    expect("mode" in loadedTask.modelSelection!).toBe(false);
    const unknownTask = reloaded.taskByThread(bot.id, third.threadId)!;
    expect(unknownTask.modelSelection).toMatchObject({ model: "gpt-6-astra", auto: true });
    expect("mode" in unknownTask.modelSelection!).toBe(false);
  });
});
