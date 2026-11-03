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
});
