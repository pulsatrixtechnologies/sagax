// Composer modes (#4900): the choice is stored with the bot or the thread like
// a model choice, checked at the API, and read back after a restart.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { createCheckedModelSelection } from "../index-leaves/checkedModelSelection.ts";
import { Store } from "../store.ts";
import { isAutoOptimize } from "../../shared/model-auto-optimize.ts";
import { modeOfSelection, selectionForMode } from "../../shared/model-mode.ts";
import { sameModelSelection } from "../../shared/thread-model.ts";

const base = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("a mode rides the selection", () => {
  it("selectionForMode keeps the bot's engine and model, turns Auto on and stores the mode", () => {
    expect(selectionForMode({ ...base(), effort: "high", variant: "x", autoOptimize: "cost" }, "expert"))
      .toEqual({ instanceId: "claude", model: "claude-sonnet-5", effort: "high", auto: true, mode: "expert" });
    // Auto itself stores no mode and carries its Optimize choice
    expect(selectionForMode({ ...base(), auto: true, mode: "heavy" }, "auto"))
      .toEqual({ instanceId: "claude", model: "claude-sonnet-5", auto: true, autoOptimize: "balance" });
  });

  it("modeOfSelection reads pinned, Auto and the three modes", () => {
    expect(modeOfSelection(base())).toBeNull();
    expect(modeOfSelection({ auto: true })).toBe("auto");
    expect(modeOfSelection({ auto: true, mode: "heavy" })).toBe("heavy");
    // D-20261126-005: Build is no mode any more; a selection still carrying it reads as plain Auto
    expect(modeOfSelection({ auto: true, mode: "build" } as never)).toBe("auto");
    // a stored mode Sagax does not know reads as plain Auto
    expect(modeOfSelection({ auto: true, mode: "turbo" } as never)).toBe("auto");
    // a mode without Auto is not a mode: the model is pinned
    expect(modeOfSelection({ mode: "fast" })).toBeNull();
  });

  it("a thread on the model an Auto bot falls back on is not following the bot", () => {
    // red before #4900: they compared equal, so the pin followed the bot into Auto (and a Heavy team's agents ran Heavy)
    const bot = selectionForMode(base(), "heavy");
    expect(sameModelSelection(base(), bot)).toBe(false);
    expect(sameModelSelection(bot, { ...bot })).toBe(true);
    expect(sameModelSelection(selectionForMode(base(), "fast"), selectionForMode(base(), "expert"))).toBe(false);
  });
});

describe("checkedModelSelection and modes", () => {
  const host = {
    hostedModels: null,
    IDENTITY: { kind: "solo" },
    personalProviderInstances: { ownerOf: () => undefined },
    orgEngineAllowRefusal: () => null,
    orgEngineHiddenRefusal: () => undefined,
    modelSwitchRefusal: () => null,
    isAutoOptimize,
    providerInstancesChanging: new Set<string>(),
    registry: { get: () => undefined },
    effortAcceptedByEngine: () => true,
    effortAcceptedByModel: () => true,
  };
  const check = createCheckedModelSelection(() => host);
  const raw = { instanceId: "claude", model: "claude-sonnet-5" };

  it("stores a mode with Auto", () => {
    expect(check({ ...raw, auto: true, mode: "expert" })).toEqual({ ok: true, selection: { ...raw, auto: true, mode: "expert" } });
  });

  it("plain auto stores no mode, and a mode without Auto is dropped (a pinned model has none)", () => {
    expect(check({ ...raw, auto: true, mode: "auto" })).toEqual({ ok: true, selection: { ...raw, auto: true } });
    expect(check({ ...raw, mode: "heavy" })).toEqual({ ok: true, selection: raw });
  });

  it("refuses a mode that does not exist", () => {
    expect(check({ ...raw, auto: true, mode: "turbo" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the choice survives a restart", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("the bot's mode, and a thread's own mode, are read back by a new Store", () => {
    const store = new Store(base);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const main = bot.tasks![0]!;
    const other = store.createTask(bot.id, "Other", false)!;
    // a mode for the bot: every thread follows it
    store.switchTaskModel(bot.id, main.threadId, selectionForMode(base(), "expert"), true);
    // a thread that picked its own mode
    store.switchTaskModel(bot.id, other.threadId, selectionForMode(base(), "heavy"), false);

    const reloaded = new Store(base);
    expect(reloaded.bot(bot.id)?.modelSelection).toMatchObject({ auto: true, mode: "expert" });
    expect(reloaded.projectBotForTask(bot.id, main.threadId)?.modelSelection).toMatchObject({ auto: true, mode: "expert" });
    expect(reloaded.projectBotForTask(bot.id, other.threadId)?.modelSelection).toMatchObject({ auto: true, mode: "heavy" });
    expect(reloaded.taskByThread(bot.id, other.threadId)?.modelSelection).toMatchObject({ mode: "heavy" });
  });

  it("going back to a pinned model clears the mode for good", () => {
    const store = new Store(base);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    store.switchTaskModel(bot.id, bot.tasks![0]!.threadId, selectionForMode(base(), "fast"), true);
    store.switchTaskModel(bot.id, bot.tasks![0]!.threadId, base(), true);
    const reloaded = new Store(base);
    expect(reloaded.bot(bot.id)?.modelSelection).toEqual(base());
  });
});
