// The custom colour, duo-tone and mood (M-20261119-073, custom-tint.ts and
// custom-colours.ts): the stored form, the place of a custom tint among the
// families, and for every skin it is laid over and a spread of colours from
// black to white, light and dark: a label on the accent or on the gradient
// at 4.5:1 on every stop, the accent as text at 4.5:1 on every ground, a
// mood's inks at 4.5:1, and a switch that follows the accent at 3:1.
import { describe, expect, it } from "vitest";
import { CUSTOM_DEFAULTS, customKindOf, parseCustomTint } from "./custom-tint";
import { CUSTOM_SKINS, customSheet, customTintFor, customTokens, fillOn, formatCustomTint } from "./custom-colours";
import { SKIN_GROUNDS } from "./skin-grounds";
import { contrastRatio } from "./color-contrast";
import { parseHex, SWITCH_MIN_CONTRAST, switchContrasts, toHsl } from "./switch-colors";
import { isCustomVariant, isStoredTint, normalizeWorn, placeOfSkin, SKIN_FAMILIES, tintsBySkin } from "./skin-families";

describe("the custom tint's stored form", () => {
  it("reads back, and anything else is no custom tint", () => {
    for (const tint of Object.values(CUSTOM_DEFAULTS)) expect(formatCustomTint(parseCustomTint(tint)!)).toBe(tint);
    for (const bad of ["custom", "custom:#FFFFFF", "custom:ff0000", "custom-duo:#000000,#ffffff,360", "custom-duo:#000000,#ffffff", "custom-mood:#000000,#ffffff", "red", null, 3]) {
      expect(parseCustomTint(bad), String(bad)).toBeNull();
    }
    expect(formatCustomTint({ kind: "custom-duo", from: "#AABBCC", to: "#112233", angle: -90 })).toBe("custom-duo:#aabbcc,#112233,270");
    expect(isStoredTint("custom:#7c5cff") && isStoredTint("red") && !isStoredTint("custom-duo")).toBe(true);
  });
});

describe("the custom swatches among the families", () => {
  it("end each row of Pulsatrix, Studio and Atelier, in light and dark, never Hibou 98", () => {
    for (const family of SKIN_FAMILIES.filter((f) => f.id !== "retro98")) {
      for (const [group, kind] of [["color", "custom"], ["duo", "custom-duo"], ["ambiance", "custom-mood"]] as const) {
        const row = family.variants.filter((v) => v.group === group);
        const last = row[row.length - 1]!;
        expect(last.tint, `${family.id} ${group}`).toBe(kind);
        expect(isCustomVariant(last) && Boolean(last.light && last.dark)).toBe(true);
      }
    }
    expect(SKIN_FAMILIES.find((f) => f.id === "retro98")!.variants.some(isCustomVariant)).toBe(false);
    expect(tintsBySkin().midnight).toEqual(expect.arrayContaining(["custom", "custom-duo", "custom-mood"]));
  });

  it("a worn custom tint keeps its colours and sits at its kind", () => {
    const tint = "custom-duo:#f472b6,#22d3ee,90";
    expect(normalizeWorn("midnight", tint)).toEqual({ skin: "midnight", tint });
    const place = placeOfSkin("midnight", tint);
    expect([place.family.id, place.variant.id]).toEqual(["studio", "custom-duo"]);
    expect(customTintFor("custom-duo", tint)).toBe(tint);
    expect(customTintFor("custom-mood", tint, { "custom-mood": "custom-mood:#1b1206,#f59e0b,#ef4444" })).toBe("custom-mood:#1b1206,#f59e0b,#ef4444");
    expect(customTintFor("custom", tint)).toBe(CUSTOM_DEFAULTS.custom);
  });
});

describe("the custom look", () => {
  it("puts a label on the colour or the gradient at 4.5:1 on every stop", () => {
    for (const grounds of [["#121212", "#1f1f1f"], ["#ffffff", "#eef2f8"]]) {
      const { ink, stops } = fillOn(["#000080", "#ffff00"], grounds);
      for (const s of stops) expect(contrastRatio(ink, s), s).toBeGreaterThanOrEqual(4.5);
    }
  });

  // From black to white, the greys, the primaries and the mid-tones that read with neither black nor white text.
  const COLOURS = ["#000000", "#ffffff", "#777777", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#7c5cff", "#f472b6", "#fb923c", "#101827", "#808000"];
  const TINTS: [string, "accent" | "full"][] = [
    ...COLOURS.map((c): [string, "accent"] => [`custom:${c}`, "accent"]),
    ...COLOURS.map((c): [string, "full"] => [`custom:${c}`, "full"]),
    ...COLOURS.map((c, i): [string, "accent"] => [`custom-duo:${c},${COLOURS[(i + 5) % COLOURS.length]},${(i * 37) % 360}`, "accent"]),
    ...COLOURS.map((c, i): [string, "accent"] => [`custom-mood:${c},${COLOURS[(i + 3) % COLOURS.length]},${COLOURS[(i + 8) % COLOURS.length]}`, "accent"]),
  ];

  it("holds the contrast gate on every skin it is laid over, light and dark, and the switch follows the accent", () => {
    expect(new Set(CUSTOM_SKINS.map((s) => SKIN_GROUNDS[s]!.scheme))).toEqual(new Set(["light", "dark"]));
    const fails: string[] = [];
    for (const skin of CUSTOM_SKINS) {
      for (const [tint, depth] of TINTS) {
        const parsed = parseCustomTint(tint)!;
        const t = customTokens(skin, parsed, depth);
        const what = `${skin} ${tint} ${depth}`;
        const palette = parsed.kind === "custom-mood" || depth === "full";
        const grounds = palette ? ["--color-app", "--color-panel", "--color-card", "--color-raised", "--color-inset"].map((k) => t[k]!) : SKIN_GROUNDS[skin]!.surfaces;
        const stops = t["--accent-gradient"] ? [...t["--accent-gradient"].matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]) : [t["--color-accent"]!];
        for (const s of stops) if (contrastRatio(t["--color-accent-ink"]!, s) < 4.5) fails.push(`${what}: label on ${s}`);
        for (const g of grounds) {
          if (contrastRatio(t["--color-accent-text"]!, g) < 4.5) fails.push(`${what}: accent text on ${g}`);
          if (contrastRatio(t["--color-accent"]!, g) < 3) fails.push(`${what}: fill on ${g}`);
          if (palette && contrastRatio(t["--color-ink"]!, g) < 4.5) fails.push(`${what}: ink on ${g}`);
          if (palette && contrastRatio(t["--color-ink-secondary"]!, g) < 4.5) fails.push(`${what}: secondary ink on ${g}`);
        }
        const sw = { on: t["--color-switch-on"]!, off: t["--color-switch-off"]!, onEdge: t["--color-switch-on-edge"]!, offEdge: t["--color-switch-off-edge"]! };
        const pairs = switchContrasts(sw, grounds);
        if (pairs.thumbOn < SWITCH_MIN_CONTRAST || pairs.onGround < SWITCH_MIN_CONTRAST) fails.push(`${what}: switch ${JSON.stringify(pairs)}`);
        const [ha, sa] = toHsl(parseHex(t["--color-accent"]!)!);
        const [ht] = toHsl(parseHex(sw.on)!);
        if (sa > 0.25 && Math.min(Math.abs(ha - ht), 1 - Math.abs(ha - ht)) > 0.02) fails.push(`${what}: switch ${sw.on} off the accent ${t["--color-accent"]}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it("writes one sheet for every skin of the colour families, its kind in every selector", () => {
    const css = customSheet("custom-duo:#f472b6,#22d3ee,90");
    for (const skin of CUSTOM_SKINS) expect(css).toContain(`[data-skin="${skin}"][data-skin="${skin}"][data-skin-tint="custom-duo"] {`);
    expect(css).toMatch(/--accent-gradient: linear-gradient\(90deg, #[0-9a-f]{6}, #[0-9a-f]{6}\);/);
    expect(css).toMatch(/--color-switch-on: #[0-9a-f]{6};/);
    expect(customSheet("red")).toBe("");
    const one = customSheet("custom:#7c5cff");
    expect(one).toContain('[data-skin-tint="custom"][data-skin-depth="full"] {');
    expect(one).not.toContain("--accent-gradient");
    expect(customKindOf("custom-mood:#101827,#38bdf8,#a78bfa")).toBe("custom-mood");
  });
});
