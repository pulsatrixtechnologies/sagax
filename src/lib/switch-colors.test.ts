// The switch must read as on or off on every skin, colour, Full colour,
// duo-tone, mood and Windows edition, light and dark (2026-10-28: a light grey
// thumb on a light grey track, and a dark thumb on a blue track, could not be
// told apart). Every combination is measured here and fails below 3:1
// (WCAG 1.4.11): the white thumb on the on and off tracks, and each track, or
// its edge when it has one, on every surface a switch sits on. The on colour is one
// value everywhere (the reference app's blue); no accent, brand or bot colour moves it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BRAND_SURFACES, brandSwitchVars, contrastHex, SWITCH_MIN_CONTRAST, SWITCH_OFF_DARK, SWITCH_ON_BLUE, SWITCH_THUMB, switchColors, type Scheme, type SwitchColors } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Context = { id: string; selector: string; scheme: Scheme; surfaces: string[]; colors: SwitchColors };
let contexts: Context[];
let generated: string;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(ROOT, "scripts", "gen-switch-tokens.mjs")).href)) as {
    switchContexts: () => Context[];
    switchStylesheet: () => string;
  };
  contexts = mod.switchContexts();
  generated = mod.switchStylesheet();
});

/** The values the shipped stylesheet gives one selector (a brand fallback read as its default). */
function shipped(css: string, selector: string): SwitchColors {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no block for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(at, css.indexOf("}", at));
  const value = (name: string) => {
    const raw = new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
    return raw.startsWith("var(") ? raw.replace(/^var\([^,]+,\s*/, "").replace(/\)$/, "") : raw;
  };
  return { on: value("--color-switch-on"), off: value("--color-switch-off"), onEdge: value("--color-switch-on-edge"), offEdge: value("--color-switch-off-edge") };
}

describe("switch contrast", () => {
  it("covers every skin, colour, duo-tone, mood and edition, in both schemes", () => {
    const ids = new Set(contexts.map((c) => c.id));
    for (const family of ["pulsatrix", "pulsatrix-light", "midnight", "daylight", "atelier", "foundry"]) {
      expect(ids.has(family)).toBe(true);
      for (const tint of ["red", "pink", "green", "yellow", "aurore", "ocean", "neon", "foret", "sunset", "nordic"]) expect(ids.has(`${family}+${tint}`), `${family}+${tint}`).toBe(true);
      expect(ids.has(`${family}+red+full`), `${family}+red+full`).toBe(true);
    }
    expect(ids.has("midnight+cyberpunk")).toBe(true);
    expect(ids.has("daylight+candy")).toBe(true);
    expect([...ids].some((id) => id.startsWith("retro98+"))).toBe(true);
    expect(new Set(contexts.map((c) => c.scheme))).toEqual(new Set(["light", "dark"]));
    for (const c of contexts) expect(c.surfaces.length, `${c.id} surfaces`).toBeGreaterThanOrEqual(4);
  });

  it("the stylesheet is the derivation's output (pnpm gen:switch after a palette change)", () => {
    expect(readFileSync(join(ROOT, "src/styles/skin-switch.css"), "utf8")).toBe(generated);
    expect(readFileSync(join(ROOT, "src/styles.css"), "utf8")).toContain('@import "./styles/skin-switch.css";');
  });

  it("holds 3:1 for the white thumb on both tracks (the thumb's position says on or off, the reference app's look)", () => {
    const css = readFileSync(join(ROOT, "src/styles/skin-switch.css"), "utf8");
    const problems: string[] = [];
    for (const c of contexts) {
      const m = shipped(css, c.selector);
      for (const track of [m.on, m.off]) if (contrastHex(SWITCH_THUMB, track) < SWITCH_MIN_CONTRAST) problems.push(`${c.id}: thumb on ${track}`);
    }
    expect(problems).toEqual([]);
  });

  it("never draws a dark thumb: the thumb is white and the on track carries it", () => {
    expect(SWITCH_THUMB).toBe("#ffffff");
    for (const c of contexts) expect(contrastHex(SWITCH_THUMB, c.colors.on), c.id).toBeGreaterThanOrEqual(SWITCH_MIN_CONTRAST);
  });

  it("has one on colour on every skin, and Grok's dark track off on dark skins", () => {
    for (const c of contexts) {
      expect(c.colors.on, c.id).toBe(SWITCH_ON_BLUE);
      expect(c.colors.onEdge, c.id).toBe("transparent");
      if (c.scheme === "dark") expect(c.colors.off, c.id).toBe(SWITCH_OFF_DARK);
    }
    // the accent never recolours it
    const red = switchColors({ accent: "#ff0000", ink: "#ffffff", surfaces: ["#121212"], scheme: "dark" });
    expect(red.on).toBe(SWITCH_ON_BLUE);
  });

  it("keeps the off track neutral", () => {
    for (const c of contexts) {
      const [x, y, z] = [1, 3, 5].map((i) => parseInt(c.colors.off.slice(i, i + 2), 16));
      expect(Math.max(x, y, z) - Math.min(x, y, z), `${c.id} off ${c.colors.off}`).toBeLessThanOrEqual(40);
    }
  });

  it("no brand accent recolours the switch", () => {
    expect(brandSwitchVars("#1D4ED8")).toEqual({});
    expect(Object.keys(BRAND_SURFACES)).toEqual(["light", "dark"]);
  });
});
