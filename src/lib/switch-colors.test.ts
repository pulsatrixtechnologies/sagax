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
import { BRAND_SURFACES, brandSwitchVars, contrastHex, parseHex, SWITCH_MIN_CONTRAST, SWITCH_OFF_DARK, SWITCH_ON_BLUE, SWITCH_THUMB, switchColors, switchContrasts, toHsl, type Scheme, type SwitchColors } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Context = { id: string; selector: string; scheme: Scheme; surfaces: string[]; colors: SwitchColors; follow: boolean; accent: string };
let contexts: Context[];
let generated: string;
let grounds: string;
let groundsModule: string;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(ROOT, "scripts", "gen-switch-tokens.mjs")).href)) as {
    switchContexts: () => Context[];
    switchStylesheet: () => string;
    skinGroundsModule: () => string;
  };
  contexts = mod.switchContexts();
  generated = mod.switchStylesheet();
  groundsModule = mod.skinGroundsModule();
  grounds = readFileSync(join(ROOT, "src/lib/skin-grounds.ts"), "utf8");
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
    // the grounds the custom colours fit on (custom-colours.ts), from the same blocks
    expect(grounds).toBe(groundsModule);
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

  it("keeps the one blue on a skin's own look, and Grok's dark track off on dark skins", () => {
    for (const c of contexts.filter((x) => !x.follow)) {
      expect(c.colors.on, c.id).toBe(SWITCH_ON_BLUE);
      expect(c.colors.onEdge, c.id).toBe("transparent");
    }
    for (const c of contexts) if (c.scheme === "dark") expect(c.colors.off, c.id).toBe(SWITCH_OFF_DARK);
    // an accent nobody chose never recolours it
    const red = switchColors({ accent: "#ff0000", ink: "#ffffff", surfaces: ["#121212"], scheme: "dark" });
    expect(red.on).toBe(SWITCH_ON_BLUE);
  });

  // M-20261119-073 (the owner, on a switch whose track stayed grey under a
  // duo-tone: « The toggle should follow the accent »): under a colour, a
  // duo-tone or a mood the on track takes that accent's hue, at a lightness
  // that carries the white thumb and clears every surface (or with an edge).
  it("follows the accent of a colour, a duo-tone or a mood, at 3:1", () => {
    const followed = contexts.filter((c) => c.follow);
    expect(followed.map((c) => c.id)).toEqual(expect.arrayContaining(["midnight+ocean", "midnight+red", "daylight+aurore", "pulsatrix+cyberpunk", "daylight+candy", "foundry+red+full"]));
    expect(contexts.filter((c) => c.id.startsWith("retro98+")).every((c) => !c.follow)).toBe(true);
    const problems: string[] = [];
    for (const c of followed) {
      const pairs = switchContrasts(c.colors, c.surfaces);
      if (pairs.thumbOn < SWITCH_MIN_CONTRAST || pairs.onGround < SWITCH_MIN_CONTRAST) problems.push(`${c.id}: ${JSON.stringify(pairs)}`);
      const [hAccent, sAccent] = toHsl(parseHex(c.accent)!);
      const [hTrack] = toHsl(parseHex(c.colors.on)!);
      const gap = Math.min(Math.abs(hAccent - hTrack), 1 - Math.abs(hAccent - hTrack));
      if (sAccent > 0.25 && gap > 0.02) problems.push(`${c.id}: ${c.colors.on} is not the hue of ${c.accent}`);
    }
    expect(problems).toEqual([]);
    expect(contexts.find((c) => c.id === "midnight+ocean")!.colors.on).not.toBe(SWITCH_ON_BLUE);
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
