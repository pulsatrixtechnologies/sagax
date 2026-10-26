// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { BOT_ACCENT_KEY, botAccentEnabled, botAccentVars, contrast, holdContrast, normalizeHex, setBotAccentEnabled } from "./bot-accent";

const LIGHT = "#ffffff";
const DARK = "#111111";

afterEach(() => {
  setBotAccentEnabled(false);
  localStorage.clear();
});

describe("botAccentVars", () => {
  it("keeps the skin's accent when there is no bot colour or no panel colour", () => {
    expect(botAccentVars(null, LIGHT)).toBeNull();
    expect(botAccentVars("not a colour", LIGHT)).toBeNull();
    expect(botAccentVars("#3b93f0", "var(--x)")).toBeNull();
  });

  it("uses a colour that already reads as it is", () => {
    const vars = botAccentVars("#1d4ed8", LIGHT)!;
    expect(vars["--color-accent"]).toBe("#1d4ed8");
    expect(vars["--color-accent-text"]).toBe("#1d4ed8");
    expect(vars["--color-accent-ink"]).toBe("#ffffff");
  });

  it("darkens a white bot on a light skin until it holds AA", () => {
    const vars = botAccentVars("#ffffff", LIGHT)!;
    expect(contrast(vars["--color-accent"], LIGHT)).toBeGreaterThanOrEqual(3);
    expect(contrast(vars["--color-accent-text"], LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars["--color-accent-ink"], vars["--color-accent"])).toBeGreaterThanOrEqual(4.5);
  });

  it("lifts a black bot on a dark skin until it holds AA", () => {
    const vars = botAccentVars("#000000", DARK)!;
    expect(contrast(vars["--color-accent"], DARK)).toBeGreaterThanOrEqual(3);
    expect(contrast(vars["--color-accent-text"], DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("holds AA for every bot colour on a light and a dark panel", () => {
    for (const hex of Object.values(MASCOT_COLOR_HEX)) {
      for (const panel of [LIGHT, DARK, "#f6f8fb", "#060f20"]) {
        const vars = botAccentVars(hex, panel)!;
        expect(contrast(vars["--color-accent"], panel)).toBeGreaterThanOrEqual(3);
        expect(contrast(vars["--color-accent-text"], panel)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(vars["--color-accent-ink"], vars["--color-accent"])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("helpers", () => {
  it("normalizes hex colours", () => {
    expect(normalizeHex(" #ABC ")).toBe("#aabbcc");
    expect(normalizeHex("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeHex("rgb(0,0,0)")).toBeNull();
  });

  it("leaves a readable colour unchanged", () => {
    expect(holdContrast("#000000", LIGHT, 4.5)).toBe("#000000");
  });
});

describe("the preference", () => {
  it("is off by default and kept in storage when turned on", () => {
    expect(botAccentEnabled()).toBe(false);
    setBotAccentEnabled(true);
    expect(botAccentEnabled()).toBe(true);
    expect(localStorage.getItem(BOT_ACCENT_KEY)).toBe("1");
    setBotAccentEnabled(false);
    expect(localStorage.getItem(BOT_ACCENT_KEY)).toBeNull();
  });
});
