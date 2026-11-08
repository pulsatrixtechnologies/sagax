import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KONAMI_SEQUENCE,
  RETRO_COMMAND,
  consumeRetroCommand,
  createKonamiDetector,
  isRetroCommand,
  loadRetroAssistant,
  readRetroEnabled,
  readRetroUnlocked,
  retroEnabled,
  retroSignal,
  setRetroEnabled,
  toggleRetro,
  type RetroSkinSwap,
  type RetroStorage,
} from "./retro98";
import type { SkinId } from "./skins";

const here = dirname(fileURLToPath(import.meta.url));

function memoryStorage(): RetroStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function fakeSkin(start: SkinId): RetroSkinSwap & { worn: () => SkinId } {
  let worn = start;
  return { current: () => worn, apply: (id) => void (worn = id), worn: () => worn };
}

const feed = (keys: readonly string[], detect = createKonamiDetector()) => keys.map((key) => detect(key));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Konami trigger", () => {
  it("fires on the key that completes up up down down left right left right b a", () => {
    const results = feed(KONAMI_SEQUENCE);
    expect(results.at(-1)).toBe(KONAMI_SEQUENCE.length);
    expect(results.slice(0, -1).every((matched) => matched < KONAMI_SEQUENCE.length)).toBe(true);
  });

  it("forgives capital letters and whatever was typed before", () => {
    const detect = createKonamiDetector();
    feed(["x", "ArrowUp", "ArrowUp"], detect);
    // an extra "up" before the real sequence still lands
    const results = feed(KONAMI_SEQUENCE.map((key) => (key === "b" ? "B" : key)), detect);
    expect(results.at(-1)).toBe(KONAMI_SEQUENCE.length);
  });

  it("does not fire on a broken or incomplete sequence, and starts over after firing", () => {
    expect(feed([...KONAMI_SEQUENCE.slice(0, 8), "a", "b"]).includes(KONAMI_SEQUENCE.length)).toBe(false);
    expect(feed(KONAMI_SEQUENCE.slice(0, 9)).includes(KONAMI_SEQUENCE.length)).toBe(false);
    const detect = createKonamiDetector();
    feed(KONAMI_SEQUENCE, detect);
    expect(detect("a")).toBeLessThan(KONAMI_SEQUENCE.length);
    expect(feed(KONAMI_SEQUENCE, detect).at(-1)).toBe(KONAMI_SEQUENCE.length);
  });

  it("reports how far the arrows got, so the host can keep b and a out of a text field", () => {
    const results = feed(KONAMI_SEQUENCE);
    expect(results[8]).toBe(9); // "b" after the eight arrows
  });
});

describe("/hibou98 in the composer", () => {
  it("recognises only the bare command", () => {
    expect(isRetroCommand(RETRO_COMMAND)).toBe(true);
    expect(isRetroCommand("  /HIBOU98 \n")).toBe(true);
    expect(isRetroCommand("/hibou98 please")).toBe(false);
    expect(isRetroCommand("look: /hibou98")).toBe(false);
    expect(isRetroCommand("/hibou")).toBe(false);
  });

  it("is consumed (toggled, never sent) only without attachments", () => {
    const toggle = vi.fn();
    expect(consumeRetroCommand("/hibou98", 0, toggle)).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(consumeRetroCommand("/hibou98", 1, toggle)).toBe(false);
    expect(consumeRetroCommand("hello", 0, toggle)).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("is intercepted before the composer dispatches a send", () => {
    const composer = readFileSync(join(here, "../components/Composer.tsx-parts/useComposerSend.ts"), "utf8");
    const send = composer.slice(composer.indexOf("const send = ("));
    const consume = send.indexOf("consumeRetroCommand(text, attachments.length)");
    expect(consume).toBeGreaterThan(-1);
    expect(consume).toBeLessThan(send.indexOf('type: "send"'));
    expect(consume).toBeLessThan(send.indexOf('type: "sendGroup"'));
    // the consumed branch clears the draft and returns before anything else
    expect(send.slice(consume, send.indexOf("}", consume) + 40)).toMatch(/setText\(""\);\s*(?:refocusInput\(\);\s*)?return;/);
  });
});

describe("toggle persistence and the skin swap", () => {
  it("remembers the switch per device and wears retro98 while on", () => {
    const storage = memoryStorage();
    const skin = fakeSkin("lagoon");
    expect(readRetroEnabled(storage)).toBe(false);
    expect(readRetroUnlocked(storage)).toBe(false);

    setRetroEnabled(true, { storage, skin, notify: false });
    expect(readRetroEnabled(storage)).toBe(true);
    expect(readRetroUnlocked(storage)).toBe(true);
    expect(skin.worn()).toBe("retro98");

    setRetroEnabled(false, { storage, skin, notify: false });
    expect(readRetroEnabled(storage)).toBe(false);
    // off restores exactly the skin the person had, and the unlock stays
    expect(skin.worn()).toBe("lagoon");
    expect(readRetroUnlocked(storage)).toBe(true);
  });

  it("toggles through the same path, both ways", () => {
    const storage = memoryStorage();
    const skin = fakeSkin("daylight");
    expect(toggleRetro({ storage, skin, notify: false })).toBe(true);
    expect(skin.worn()).toBe("retro98");
    expect(toggleRetro({ storage, skin, notify: false })).toBe(false);
    expect(skin.worn()).toBe("daylight");
  });

  it("never records retro98 as the skin to go back to", () => {
    const storage = memoryStorage();
    const skin = fakeSkin("midnight");
    setRetroEnabled(true, { storage, skin, notify: false });
    setRetroEnabled(true, { storage, skin, notify: false }); // a second switch-on while already retro
    setRetroEnabled(false, { storage, skin, notify: false });
    expect(skin.worn()).toBe("midnight");
  });

  it("leaves a skin picked while on alone when switching off", () => {
    const storage = memoryStorage();
    const skin = fakeSkin("midnight");
    setRetroEnabled(true, { storage, skin, notify: false });
    skin.apply("atelier");
    setRetroEnabled(false, { storage, skin, notify: false });
    expect(skin.worn()).toBe("atelier");
  });

  it("survives storage that throws", () => {
    const broken: RetroStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const skin = fakeSkin("linen");
    expect(readRetroEnabled(broken)).toBe(false);
    expect(() => setRetroEnabled(true, { storage: broken, skin, notify: false })).not.toThrow();
    expect(skin.worn()).toBe("retro98");
    expect(() => setRetroEnabled(false, { storage: broken, skin, notify: false })).not.toThrow();
  });

  it("announces the switch so the host can mount or retire the owl", () => {
    const events: Array<{ type: string; on: unknown }> = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: CustomEvent) => {
        events.push({ type: event.type, on: event.detail?.on });
        return true;
      },
    });
    const storage = memoryStorage();
    const skin = fakeSkin("graphite");
    setRetroEnabled(true, { storage, skin });
    setRetroEnabled(false, { storage, skin });
    expect(events).toEqual([
      { type: "omb:retro98-toggle", on: true },
      { type: "omb:retro98-toggle", on: false },
    ]);
  });
});

describe("zero cost while off", () => {
  it("sends no signal while the mode is off", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    setRetroEnabled(false, { storage: memoryStorage(), skin: fakeSkin("dusk"), notify: false });
    expect(retroEnabled()).toBe(false);
    retroSignal("send");
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("keeps the assistant out of the eager bundle: only dynamic imports reach it", () => {
    const eager = [
      readFileSync(join(here, "retro98.ts"), "utf8"),
      readFileSync(join(here, "skins.ts"), "utf8"),
      readFileSync(join(here, "../components/RetroAssistantHost.tsx"), "utf8"),
      readFileSync(join(here, "../components/Composer.tsx"), "utf8"),
      readFileSync(join(here, "../App.tsx"), "utf8"),
      readFileSync(join(here, "../App.tsx-parts/ShellLayout.tsx"), "utf8"),
    ].join("\n");
    const staticImports = [...eager.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map(([, from]) => from);
    expect(staticImports.some((from) => from.includes("retro-assistant/"))).toBe(false);
    expect(staticImports.some((from) => from.includes("retro98.css"))).toBe(false);
    expect(eager).toContain('import("@/components/retro-assistant/RetroAssistant")');
    expect(eager).toContain('import("../styles/retro98.css")');
    const host = readFileSync(join(here, "../components/RetroAssistantHost.tsx"), "utf8");
    expect(host).toMatch(/lazy\(loadRetroAssistant\)/);
  });

  it("lazy-loads a module whose default export is the assistant", async () => {
    const module = await loadRetroAssistant();
    expect(typeof module.default).toBe("function");
  });
});

describe("Hibou 98 as a skin once found", () => {
  it("stays in the skin picker after the retro mode is switched off", async () => {
    const { visibleSkins } = await import("./skins");
    const storage = memoryStorage();
    expect(readRetroUnlocked(storage)).toBe(false);
    expect(visibleSkins(readRetroUnlocked(storage)).map((skin) => skin.id)).not.toContain("retro98");
    setRetroEnabled(true, { storage, skin: fakeSkin("dusk"), notify: false });
    setRetroEnabled(false, { storage, skin: fakeSkin("retro98"), notify: false });
    expect(readRetroEnabled(storage)).toBe(false);
    expect(readRetroUnlocked(storage)).toBe(true);
    expect(visibleSkins(readRetroUnlocked(storage), "dusk").map((skin) => skin.id)).toContain("retro98");
  });

  it("keeps the power-on effect in a lazy chunk", () => {
    const host = readFileSync(join(here, "../components/RetroChromeHost.tsx"), "utf8");
    const staticImports = [...host.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map(([, from]) => from);
    expect(staticImports.some((from) => from.includes("RetroBoot") || from.includes("retro-assistant/"))).toBe(false);
    expect(host).toContain('import("./retro98/RetroBoot")');
  });
});
