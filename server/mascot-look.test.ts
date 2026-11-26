import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { parseBotProfilePatch } from "./bots/bot-profile.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "fake-model" });

describe("a bot's character is stored with the bot", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("round-trips through a profile patch, to disk and back", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const parsed = parseBotProfilePatch({ mascotLook: { character: "trombi", skins: { trombi: "retro98" } } } as never);
    if (!parsed.ok) throw new Error(parsed.error);
    store.patchBotProfile(bot.id, parsed.patch);
    expect(store.bot(bot.id)?.mascotLook).toEqual({ character: "trombi", skins: { trombi: "retro98" } });
    const reloaded = new Store(selection);
    expect(reloaded.bot(bot.id)?.mascotLook).toEqual({ character: "trombi", skins: { trombi: "retro98" } });
  });

  it("stores a premium skin, and an older skin name under its current id", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    // house is a shape of an earlier set (LEGACY_SHAPES): stored on the nearest shape, the hexagon
    const parsed = parseBotProfilePatch({ mascotLook: { character: "shape", shape: "house", skins: { shape: "nebula", trombi: "molten" } } } as never);
    if (!parsed.ok) throw new Error(parsed.error);
    store.patchBotProfile(bot.id, parsed.patch);
    expect(new Store(selection).bot(bot.id)?.mascotLook).toEqual({ character: "shape", shape: "hexagon", skins: { shape: "galaxy", trombi: "molten" } });
    expect(parseBotProfilePatch({ mascotLook: { character: "shape", skins: { shape: "plasma" } } } as never).ok).toBe(false);
  });
  // #5349: the engine's look settings are stored with the bot's look, by the same path as its shape and skin
  it("round-trips the engine's look settings, each one alone and all together", () => {
    const store = new Store(selection);
    const settings = { material: "fluffy", mood: "happy", eyeColor: "#ffffff", depth: 10, followPointer: false } as const;
    const looks = [
      ...Object.entries(settings).map(([key, value]) => ({ character: "shape", shape: "cup", [key]: value })),
      { character: "shape", shape: "star", skins: { shape: "gold" }, ...settings },
      { character: "shape", shape: "star", material: "glass" },
    ];
    for (const look of looks) {
      const bot = store.createBot();
      const parsed = parseBotProfilePatch({ mascotLook: look } as never);
      if (!parsed.ok) throw new Error(parsed.error);
      store.patchBotProfile(bot.id, parsed.patch);
      expect(store.bot(bot.id)?.mascotLook).toEqual(look);
      expect(new Store(selection).bot(bot.id)?.mascotLook).toEqual(look);
    }
  });

  it("refuses a setting the engine does not take, and never stores a state", () => {
    for (const bad of [{ material: "velvet" }, { mood: "sleepy" }, { eyeColor: "blue" }, { depth: 20 }, { followPointer: 1 }, { state: "working" }]) {
      expect(parseBotProfilePatch({ mascotLook: { character: "shape", ...bad } } as never).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("leaves a look stored before the settings exactly as it was", () => {
    const store = new Store(selection);
    const bot = store.createBot();
    const before = { character: "shape", shape: "cup", skins: { shape: "gold" } };
    const parsed = parseBotProfilePatch({ mascotLook: before } as never);
    if (!parsed.ok) throw new Error(parsed.error);
    store.patchBotProfile(bot.id, parsed.patch);
    expect(new Store(selection).bot(bot.id)?.mascotLook).toEqual(before);
  });
});
