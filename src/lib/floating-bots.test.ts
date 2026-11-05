import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  floatBot,
  floatingBotPrefs,
  floatingBots,
  floatingShown,
  isBotFloating,
  nextFloatingReturn,
  SNOOZE_MS,
  snoozeFloatingBot,
  switchFloatingBot,
  MAX_FLOATING_BOTS,
  nextLiveliness,
  readFloatingBotPrefs,
  setFloatingHotkey,
  hotkeyLabel,
  HOTKEY_CHOICES,
  DEFAULT_HOTKEY,
  readFloatingBots,
  resetFloatingBotsForTests,
  setFloatingFlyAway,
  setFloatingLiveliness,
  setFloatingBotOnTop,
  setFloatingBotPosition,
  subscribeFloatingBots,
  unfloatBot,
  type FloatingStorage,
} from "./floating-bots";

const here = dirname(fileURLToPath(import.meta.url));

function memoryStorage(): FloatingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

beforeEach(() => resetFloatingBotsForTests());

describe("floating bots: the per-device list", () => {
  it("floats a bot once, remembers it, and takes it back", () => {
    const storage = memoryStorage();
    let changes = 0;
    subscribeFloatingBots(() => (changes += 1));
    expect(floatBot("bot_a", storage)).toBe(true);
    expect(floatBot("bot_a", storage)).toBe(true);
    expect(floatingBots()).toEqual([{ id: "bot_a", top: true }]);
    expect(isBotFloating("bot_a")).toBe(true);
    expect(readFloatingBots(storage)).toEqual([{ id: "bot_a", top: true }]);
    unfloatBot("bot_a", storage);
    expect(isBotFloating("bot_a")).toBe(false);
    expect(readFloatingBots(storage)).toEqual([]);
    expect(changes).toBe(2);
  });

  it("hides a mascot for an hour and brings it back by itself (the right-click menu)", () => {
    const storage = memoryStorage();
    floatBot("bot_a", storage);
    floatBot("bot_b", storage);
    const now = 1_000_000;
    snoozeFloatingBot("bot_a", now + SNOOZE_MS, storage);
    expect(SNOOZE_MS).toBe(3_600_000);
    // still on the list (its place and settings kept), just not shown until then
    const saved = readFloatingBots(storage);
    expect(saved[0]).toEqual({ id: "bot_a", top: true, hiddenUntil: now + SNOOZE_MS });
    expect(floatingShown(saved[0], now)).toBe(false);
    expect(floatingShown(saved[0], now + SNOOZE_MS)).toBe(true);
    expect(floatingShown(saved[1], now)).toBe(true);
    expect(nextFloatingReturn(saved, now)).toBe(now + SNOOZE_MS);
    expect(nextFloatingReturn(saved, now + SNOOZE_MS)).toBeNull();
    // a bot not on the desktop, or a time that is not one, changes nothing
    snoozeFloatingBot("bot_z", now, storage);
    snoozeFloatingBot("bot_b", Number.NaN, storage);
    expect(readFloatingBots(storage)[1]).toEqual({ id: "bot_b", top: true });
  });

  it("switches a mascot to another bot in place (the right-click menu's Switch bot)", () => {
    const storage = memoryStorage();
    floatBot("bot_a", storage);
    floatBot("bot_b", storage);
    setFloatingBotOnTop("bot_a", false, storage);
    snoozeFloatingBot("bot_a", 5, storage);
    expect(switchFloatingBot("bot_a", "bot_c", storage)).toBe(true);
    // same place in the list, same always-on-top choice, shown
    expect(readFloatingBots(storage)).toEqual([{ id: "bot_c", top: false }, { id: "bot_b", top: true }]);
    // not onto a bot that already floats, nor from one that does not, nor to a bad id
    expect(switchFloatingBot("bot_c", "bot_b", storage)).toBe(false);
    expect(switchFloatingBot("bot_x", "bot_d", storage)).toBe(false);
    expect(switchFloatingBot("bot_c", "bad id", storage)).toBe(false);
  });

  it("keeps several bots, their always-on-top choice and their in-app spot", () => {
    const storage = memoryStorage();
    floatBot("bot_a", storage);
    floatBot("bot_b", storage);
    setFloatingBotOnTop("bot_b", false, storage);
    setFloatingBotPosition("bot_a", { right: 40, bottom: 120 }, storage);
    setFloatingBotPosition("bot_a", { right: Number.NaN, bottom: 1 }, storage);
    expect(readFloatingBots(storage)).toEqual([
      { id: "bot_a", top: true, pos: { right: 40, bottom: 120 } },
      { id: "bot_b", top: false },
    ]);
  });

  it("refuses a bad id and caps how many bots float", () => {
    const storage = memoryStorage();
    expect(floatBot("../evil", storage)).toBe(false);
    for (let i = 0; i < MAX_FLOATING_BOTS; i += 1) expect(floatBot(`bot_${i}`, storage)).toBe(true);
    expect(floatBot("bot_extra", storage)).toBe(false);
    expect(floatingBots()).toHaveLength(MAX_FLOATING_BOTS);
  });

  it("reads back only well-formed entries, once each", () => {
    const storage = memoryStorage();
    storage.setItem("omb.floatingBots.v1", JSON.stringify({
      bots: [
        { id: "bot_a", top: false, pos: { right: 10, bottom: "x" } },
        { id: "bot_a" },
        { id: "no spaces allowed" },
        null,
        { id: "bot_b", pos: { right: 5, bottom: 6 } },
      ],
    }));
    expect(readFloatingBots(storage)).toEqual([
      { id: "bot_a", top: false },
      { id: "bot_b", top: true, pos: { right: 5, bottom: 6 } },
    ]);
    storage.setItem("omb.floatingBots.v1", "{not json");
    expect(readFloatingBots(storage)).toEqual([]);
    expect(readFloatingBots(undefined)).toEqual([]);
  });

  it("keeps the brain and the drawings out of the eager bundle", () => {
    const eager = [
      readFileSync(join(here, "floating-bots.ts"), "utf8"),
      readFileSync(join(here, "../components/FloatingBotsHost.tsx"), "utf8"),
      readFileSync(join(here, "../components/Sidebar.tsx"), "utf8"),
      readFileSync(join(here, "../App.tsx"), "utf8"),
      readFileSync(join(here, "../App.tsx-parts/ShellLayout.tsx"), "utf8"),
    ].join("\n");
    const staticImports = [...eager.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map(([, from]) => from);
    expect(staticImports.some((from) => from.includes("floating-bots/"))).toBe(false);
    expect(eager).toContain('import("@/components/floating-bots/FloatingBots")');
  });
});

describe("floating bots: the fly-away setting", () => {
  it("is on by default and survives a reload once switched off", () => {
    const storage = memoryStorage();
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal", hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
    let changes = 0;
    subscribeFloatingBots(() => (changes += 1));
    setFloatingFlyAway(false, storage);
    setFloatingFlyAway(false, storage);
    expect(floatingBotPrefs().flyAway).toBe(false);
    expect(changes).toBe(1);
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: false, liveliness: "normal", hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
    setFloatingFlyAway(true, storage);
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal", hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
  });

  it("reads a broken or missing record as the default", () => {
    const storage = memoryStorage();
    storage.setItem("omb.floatingBots.prefs.v1", "{nope");
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal", hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
    storage.setItem("omb.floatingBots.prefs.v1", JSON.stringify({ flyAway: "no" }));
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal", hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
    expect(readFloatingBotPrefs(undefined)).toEqual({ flyAway: true, liveliness: "normal", hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
  });

  it("keeps an activity level, cycled by the menu, and ignores an unknown one", () => {
    const storage = memoryStorage();
    setFloatingLiveliness("lively", storage);
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "lively", hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
    setFloatingLiveliness("wild" as never, storage);
    expect(readFloatingBotPrefs(storage).liveliness).toBe("lively");
    expect(nextLiveliness("calm")).toBe("normal");
    expect(nextLiveliness("lively")).toBe("calm");
  });

  it("keeps the call hotkey on by default, its keys among the choices", () => {
    const storage = memoryStorage();
    setFloatingHotkey({ on: false }, storage);
    expect(readFloatingBotPrefs(storage)).toMatchObject({ hotkey: false, hotkeyKeys: "Control+Alt+Space", barkSound: false });
    setFloatingHotkey({ on: true, keys: "Alt+Shift+Space" }, storage);
    expect(readFloatingBotPrefs(storage)).toMatchObject({ hotkey: true, hotkeyKeys: "Alt+Shift+Space" });
    setFloatingHotkey({ keys: "Command+Q" as never }, storage);
    expect(readFloatingBotPrefs(storage).hotkeyKeys).toBe("Alt+Shift+Space");
    storage.setItem("omb.floatingBots.prefs.v1", JSON.stringify({ hotkeyKeys: "F1" }));
    expect(readFloatingBotPrefs(storage)).toMatchObject({ hotkey: true, hotkeyKeys: "Control+Alt+Space", barkSound: false });
    expect(HOTKEY_CHOICES).toContain(DEFAULT_HOTKEY);
  });

  it("names the hotkey as each system does", () => {
    expect(hotkeyLabel("Control+Alt+Space", true)).toBe("Control+Option+Space");
    expect(hotkeyLabel("Control+Alt+Space", false)).toBe("Ctrl+Alt+Space");
  });

  it("draws the desktop owl flat, with no 3D renderer and no three.js", () => {
    const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("three");
    expect(existsSync(join(here, "../components/floating-bots/owl3d"))).toBe(false);
    const settings = readFileSync(join(here, "../components/SettingsModal.tsx"), "utf8");
    expect(settings).not.toMatch(/from\s+"@\/components\/floating-bots\//);
    const view = readFileSync(join(here, "../components/floating-bots/FloatingBotView.tsx"), "utf8");
    expect(view).not.toMatch(/style === "3d"/);
    const editor = readFileSync(join(here, "../components/floating-bots/MascotLookEditor.tsx"), "utf8");
    expect(editor).not.toMatch(/data-character-style/);
  });
});
