// Frog, the smug sad frog (direction C, "aplat net"): its drawing as data,
// its sixteen faces carried by the lids and the lips, the skin for every bot
// color and the bust crop.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { APP_ICON_CHOICES } from "@/lib/app-icon-choices";
import { BotAvatar, frogExpressionFor } from "@/components/Avatar";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { rewardKey, skinTier } from "../../shared/achievements";
import { masterySkins, masterySkinTier, masteryUnlockFor } from "../../shared/mascot-unlocks";
import { MasteryArt } from "./achievements/mastery-art";
import { contrastRatio, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { botMascotLook, CHARACTER_PAINT, completeMascotLook, FROG_DEFAULT_COLOR, FROG_SKIN_TIER, FROG_SKINS, LEGACY_FROG_SKINS, mascotLookSchema } from "../../shared/mascot-look";
import { MASCOTS, mascotFor } from "./floating-bots/mascots";
import { CHARACTER_LABEL, FROG_SKIN_LABEL } from "./floating-bots/mascot-look-labels";
import { colorGroupsFor, skinTierTabs } from "./floating-bots/editor-tabs";
import { FrogMascot, frogExpressionForMood } from "./FrogMascot";
import { frogSkinId, frogSkinPaint } from "./skin-fx/frog-skins";
import { SHAPE_EXPRESSIONS } from "./shape-engine";
import {
  FROG_ART,
  FROG_BUST_MAX,
  FROG_EXPRESSIONS,
  FROG_FACES,
  FROG_GREEN,
  FROG_MOOD_EXPRESSION,
  FROG_MOUTHS,
  FROG_ROLES,
  frogEyeOps,
  frogFlyOps,
  frogHaunchOps,
  frogLegJoints,
  frogLegOps,
  frogMouthOps,
  frogOpsToSvg,
  frogOutline,
  frogPadOps,
  frogPalette,
  frogParts,
  frogSkin,
  frogStillSvg,
  frogThroatOps,
  frogTongueOps,
  frogViewBox,
  frogWaterOps,
  SKIN_MIN_CONTRAST,
  tintTone,
  toHsl,
  type FrogOp,
} from "./frog-art";

const draw = (props: Partial<Parameters<typeof FrogMascot>[0]> = {}) => renderToStaticMarkup(createElement(FrogMascot, { color: "green", ...props }));

const ABSOLUTE = /^[MLCQZ0-9.\s-]+$/;
const pathsOf = (ops: readonly FrogOp[]) => ops.flatMap((op) => [op.d, ...(op.clip ? [op.clip] : [])]);

describe("Frog's art", () => {
  it("names its sixteen faces like the Shapes, and its five moods among them", () => {
    expect([...FROG_EXPRESSIONS]).toEqual([...SHAPE_EXPRESSIONS]);
    expect(FROG_MOOD_EXPRESSION).toEqual({ idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" });
    expect(Object.keys(FROG_FACES).sort()).toEqual([...FROG_EXPRESSIONS].sort());
  });

  it("carries every face on the lids and the lips: no brows, no nose, two eyes and a mouth", () => {
    for (const expression of FROG_EXPRESSIONS) {
      const parts = frogParts({ expression, size: 120 });
      expect(parts.brows, expression).toEqual([]);
      expect(parts.nose, expression).toEqual([]);
      expect(parts.eyeL.length, expression).toBeGreaterThan(0);
      expect(parts.eyeR.length, expression).toBeGreaterThan(0);
      // the lips, their shade and their outline at least
      expect(parts.mouth.length, expression).toBeGreaterThanOrEqual(3);
    }
    const faces = new Set(FROG_EXPRESSIONS.map((expression) => frogStillSvg({ expression, size: 120 })));
    expect(faces.size).toBe(FROG_EXPRESSIONS.length);
    // the approved idle: heavy lids at half, the gaze aside
    const idle = FROG_FACES.neutral.eyes[0];
    expect(idle.kind === "open" && idle.lid).toBe(0.5);
  });

  it("keeps every path absolute (M L C Q Z only), so it moves, mirrors and parses on the phone", () => {
    for (const expression of FROG_EXPRESSIONS) {
      const parts = frogParts({ expression, size: 200, blink: [0.5, 1] });
      for (const d of Object.values(parts).flatMap(pathsOf)) expect(d, expression).toMatch(ABSOLUTE);
    }
    for (const mouth of FROG_MOUTHS) for (const d of pathsOf(frogMouthOps(mouth, 2))) expect(d, mouth).toMatch(ABSOLUTE);
    const moving = [...frogThroatOps(1.2, 2), ...frogTongueOps([90, 30], 0.7, 2), ...frogFlyOps([90, 30], 0.5, 2), ...frogLegOps(-1, 1, 2), ...frogLegOps(1, 0.5, 2), ...frogPadOps(2), ...frogWaterOps(67, 1.3, 2)];
    for (const d of pathsOf(moving)) expect(d).toMatch(ABSOLUTE);
  });

  it("closes one lid at a time for a blink, and draws nothing for a part at rest", () => {
    const lidLine = (ops: FrogOp[]) => ops.find((op) => op.stroke === "lidLine")?.d;
    const half = frogEyeOps(FROG_FACES.neutral.eyes[0], -1, 2, 0);
    const shut = frogEyeOps(FROG_FACES.neutral.eyes[0], -1, 2, 1);
    expect(lidLine(half)).not.toBe(lidLine(shut));
    // a wide-open eye grows a lid only when it blinks
    expect(lidLine(frogEyeOps(FROG_FACES.surprised.eyes[0], 1, 2, 0))).toBeUndefined();
    expect(lidLine(frogEyeOps(FROG_FACES.surprised.eyes[0], 1, 2, 0.6))).toBeDefined();
    expect(frogThroatOps(0, 2)).toEqual([]);
    expect(frogTongueOps([90, 30], 0, 2)).toEqual([]);
    expect(frogWaterOps(100, 0, 2)).toEqual([]);
  });

  it("draws hind legs as filled palmate limbs, squat at rest and kicked out on a hop", async () => {
    const rest = frogLegOps(-1, 0, 2);
    const kick = frogLegOps(-1, 1, 2);
    expect(rest.length).toBeGreaterThan(0);
    expect(kick.some((op) => op.fill === "toe")).toBe(true);
    expect(kick.some((op) => op.fill === "skin")).toBe(true);
    expect(kick.filter((op) => op.stroke === "line" && op.clip).length).toBeGreaterThanOrEqual(4);
    expect(frogHaunchOps(1, 0, 2).some((op) => op.fill === "skin")).toBe(true);
    for (const op of [...rest, ...kick, ...frogHaunchOps(-1, 1, 2)]) {
      expect(op.d).toMatch(ABSOLUTE);
      if (op.fill) expect(op.d.endsWith("Z")).toBe(true);
    }
    const squat = frogLegJoints(-1, 0);
    const out = frogLegJoints(-1, 1);
    // sitting W: knee outboard of both hip and ankle
    expect(squat.knee[0]).toBeLessThan(squat.hip[0]);
    expect(squat.knee[0]).toBeLessThan(squat.ankle[0]);
    expect(out.ankle[1]).toBeGreaterThan(squat.ankle[1]);
    expect(out.ankle[0]).toBeLessThan(squat.ankle[0]);
    expect(out.ankle[1]).toBeLessThan(114);
    expect(squat.ankle[0]).toBeGreaterThan(10);
    expect(frogLegJoints(1, 1).ankle[0]).toBeGreaterThan(frogLegJoints(1, 0).ankle[0]);
    if (process.env.DUMP_FROG_LEGS === "1") {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync("/tmp/frog-legs", { recursive: true });
      const palette = frogPalette();
      const ow = frogOutline(200);
      const parts = frogParts({ expression: "neutral", size: 200 });
      const layer = (ops: FrogOp[], key: string) => frogOpsToSvg(ops, palette, key);
      for (const [extend, name] of [
        [0, "squat"],
        [0.45, "crouch"],
        [1, "kick"],
      ] as const) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-18 8 136 118" width="800" height="700">${layer(frogPadOps(ow), "pad")}${layer([...frogLegOps(-1, extend, ow), ...frogLegOps(1, extend, ow)], "lg")}${layer(parts.body, "b")}${layer(parts.handL, "hl")}${layer(parts.handR, "hr")}${layer([...frogHaunchOps(-1, extend, ow), ...frogHaunchOps(1, extend, ow)], "hn")}${layer(parts.head, "h")}${layer(parts.eyeL, "el")}${layer(parts.eyeR, "er")}${layer(parts.mouth, "m")}</svg>`;
        writeFileSync(`/tmp/frog-legs/${name}.svg`, svg);
      }
    }
  });

  it("crops to the bust under 48 px and leaves the sleeping z out", () => {
    expect(frogViewBox(32)).toBe("11 14 78 78");
    expect(frogViewBox(FROG_BUST_MAX)).toBe("11 14 78 78");
    expect(frogViewBox(49)).toBe("0 0 100 100");
    expect(frogParts({ expression: "sleepy", size: 32 }).extras).toEqual([]);
    expect(frogParts({ expression: "sleepy", size: 96 }).extras.length).toBeGreaterThan(0);
  });

  it("keeps one outline width, never under 1.6 screen px", () => {
    for (const size of [16, 24, 32, 44, 48, 64, 96, 240]) {
      const ow = frogOutline(size);
      const box = size <= FROG_BUST_MAX ? 78 : 100;
      expect((ow * size) / box, String(size)).toBeGreaterThanOrEqual(1.6 - 0.01);
      expect(ow).toBeGreaterThanOrEqual(1.9);
    }
    expect(frogOutline(240)).toBe(1.9);
  });

  it("takes 24 % of the bot color and stays a frog green-ish, saturated, with a readable belly", () => {
    expect(frogPalette().skin).toBe(FROG_GREEN);
    expect(frogSkin(null)).toBe(FROG_GREEN);
    const baseSat = toHsl(FROG_GREEN)[1];
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const palette = frogPalette(hex);
      expect(contrastRatio(palette.skin, palette.belly), name).toBeGreaterThanOrEqual(SKIN_MIN_CONTRAST);
      // a grey, a white or a black bot never turns the frog grey
      expect(toHsl(palette.skin)[1], name).toBeGreaterThan(baseSat * 0.6);
      // the skin moves toward the bot color, it never becomes it
      expect(palette.skin.toLowerCase(), name).not.toBe(hex.toLowerCase());
    }
    // a blue bot gives a bluer green, an orange one a yellower green
    const hue = (hex: string) => toHsl(tintTone(FROG_GREEN, hex, 0.24))[0];
    const base = toHsl(FROG_GREEN)[0];
    expect(hue("#3F7FD6")).toBeGreaterThan(base);
    expect(hue("#E78531")).toBeLessThan(base);
  });

  it("paints every role a palette defines", () => {
    const palette = frogPalette("#377FE6");
    expect(Object.keys(palette).sort()).toEqual([...FROG_ROLES].sort());
    const parts = frogParts({ expression: "laughing", size: 200 });
    const all = [...(Object.values(parts) as FrogOp[][]).flat(), ...frogThroatOps(1, 2), ...frogTongueOps([80, 20], 1, 2), ...frogFlyOps([80, 20], 0, 2), ...frogLegOps(-1, 1, 2), ...frogPadOps(2), ...frogWaterOps(70, 0, 2)];
    for (const op of all) {
      if (op.fill) expect(palette[op.fill], op.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (op.stroke) expect(palette[op.stroke], op.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(FROG_ART.eye.r).toBe(8.4);
  });
});

describe("Frog's look", () => {
  it("is a character of its own, stored with the bot like the others", () => {
    expect(botMascotLook({ character: "frog", skins: { frog: "poison" } })).toEqual({ character: "frog", skins: { frog: "poison" } });
    expect(completeMascotLook({ character: "frog" }).skins.frog).toBe("plain");
    expect(CHARACTER_PAINT.frog).toEqual({ colors: true, skins: FROG_SKINS, wingMoves: false });
    expect(MASCOT_COLOR_HEX[FROG_DEFAULT_COLOR as keyof typeof MASCOT_COLOR_HEX]).toBeDefined();
    // each character keeps its own skin
    const look = completeMascotLook({ character: "frog", skins: { frog: "tree", shiba: "red" } });
    expect(completeMascotLook({ ...look, character: "shiba" }).skins).toMatchObject({ shiba: "red", frog: "tree" });
  });

  it("reads other names a stored skin may carry, and drops one it does not know without losing the character", () => {
    for (const [old, current] of Object.entries(LEGACY_FROG_SKINS)) expect(botMascotLook({ character: "frog", skins: { frog: old } }).skins?.frog, old).toBe(current);
    expect(botMascotLook({ character: "frog", skins: { frog: "toad" } })).toEqual({ character: "frog" });
    expect(mascotLookSchema.safeParse({ character: "frog", skins: { frog: "nope" } }).success).toBe(false);
  });

  it("is in the registry, the editor, the palettes (Clay included), the app icons and the achievements", () => {
    expect(mascotFor({ character: "frog" }).id).toBe("frog");
    expect(MASCOTS.find((entry) => entry.id === "frog")?.capabilities.wings).toBe(false);
    expect(CHARACTER_LABEL.frog).toBe("floatingBots.mascot.frog");
    expect(colorGroupsFor("frog", "green")).toContain("clay");
    expect(APP_ICON_CHOICES.some((choice) => choice.art.kind === "frog")).toBe(true);
    // the Mastery tier unlocks Frog and its skins (shared/mascot-unlocks.ts): its named skins over its three rungs, easiest first
    const rewarded = ACHIEVEMENTS.flatMap((item) => item.rewards.map(rewardKey));
    expect(rewarded).toContain("character:frog");
    expect(masteryUnlockFor("frog")).toBe("polyglot");
    expect(["leaf", "tree", "poison", "bullfrog", "ghost"].map((skin) => masteryUnlockFor("frog", skin))).toEqual(["thrifty", "thrifty", "translator", "translator", "skill-smith"]);
    expect(masteryUnlockFor("frog", "retro98")).toBe("total-recall");
    expect(masteryUnlockFor("frog", "gold")).toBe("total-recall");
    expect(masteryUnlockFor("frog", "plain")).toBeNull();
    expect(masterySkins("frog")).toEqual([...FROG_SKINS]);
    for (const skin of FROG_SKINS) {
      expect(FROG_SKIN_TIER[skin], skin).toBe(masterySkinTier(skin));
      if (skinTier("frog", skin) !== "common") expect(rewarded, skin).toContain(`skin:frog:${skin}`);
    }
    // its real art in the achievements, not the placeholder
    const html = renderToStaticMarkup(createElement(MasteryArt, { character: "frog", skin: "tree", size: 40, animated: false }));
    expect(html).toContain('data-character="frog"');
    expect(html).not.toContain("data-mastery-placeholder");
  });

  it("maps the app's states to its faces", () => {
    expect(frogExpressionFor("sleeping")).toBe("sleepy");
    expect(frogExpressionFor("searching")).toBe("curious");
    expect(frogExpressionFor("laughing")).toBe("laughing");
    expect(frogExpressionFor("celebrate")).toBe("excited");
    expect(frogExpressionFor(undefined)).toBe("neutral");
    expect(frogExpressionForMood("thinking")).toBe("curious");
  });
});

describe("Frog's skins", () => {
  it("has thirteen skins: Plain with the character, real frogs on the Mastery rungs, then the premium set", () => {
    expect([...FROG_SKINS]).toEqual(["plain", "leaf", "tree", "poison", "bullfrog", "ghost", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
    expect(Object.keys(FROG_SKIN_TIER)).toEqual([...FROG_SKINS]);
    const counts = Object.fromEntries(skinTierTabs(FROG_SKINS, FROG_SKIN_TIER).map((tab) => [tab.tier, tab.count]));
    expect(counts).toEqual({ common: 1, rare: 7, epic: 3, legendary: 2 });
  });

  it("names every skin in English and French", () => {
    expect(Object.keys(FROG_SKIN_LABEL)).toEqual([...FROG_SKINS]);
    for (const key of [...Object.values(FROG_SKIN_LABEL), CHARACTER_LABEL.frog]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });

  it("paints every role of every skin, with its rarity and effect family", () => {
    for (const skin of FROG_SKINS) {
      const paint = frogSkinPaint(skin, "#377FE6", "u");
      for (const role of FROG_ROLES) expect(paint.palette[role], `${skin} ${role}`).toMatch(/^(#[0-9a-fA-F]{6}|url\(#u-[a-zA-Z]+\))$/);
      expect(paint.tier).toBe(FROG_SKIN_TIER[skin]);
      expect(paint.fx).toBeTruthy();
    }
    expect(frogSkinPaint("retro98", "#E78531", "u").fx).toBe("retro");
    expect(frogSkinPaint("glitch", "#E78531", "u").bodyClass).toBe("fx-glitch-slice");
    // the real frogs are their own colors, whatever the bot's
    for (const skin of ["leaf", "tree", "poison", "bullfrog", "ghost"] as const) expect(frogSkinPaint(skin, "#377FE6", "u").palette.skin, skin).toBe(frogSkinPaint(skin, "#009957", "u").palette.skin);
    // the tree frog: red eyes, orange toes; the poison frog: spotted; the glass frog: see-through
    const tree = frogSkinPaint("tree", "#377FE6", "u").palette;
    expect(tree.white).toBe("#E5231B");
    expect(tree.toe).toBe("#FF8A1F");
    expect(frogSkinPaint("poison", "#377FE6", "u").palette.skin).toBe("url(#u-spots)");
    expect(frogSkinPaint("ghost", "#377FE6", "u").palette.skin).toBe("url(#u-glass)");
    // plain follows the bot's color
    expect(frogSkinPaint("plain", "#377FE6", "u").palette.skin).not.toBe(frogSkinPaint("plain", "#E78531", "u").palette.skin);
    expect(frogSkinId("unknown")).toBe("plain");
  });

  it("draws the premium treatments only in the full drawing", () => {
    const full = draw({ skin: "holo", size: 96 });
    expect(full).toContain("fx-foil-diag");
    expect(full).toContain('data-fx="full"');
    const still = draw({ skin: "holo", size: 24 });
    expect(still).toContain('data-fx="static"');
    expect(still).not.toMatch(/fx-foil|fx-sweep|fx-twinkle|<filter/);
    expect(draw({ skin: "molten", size: 96 })).toContain("fx-crack");
    expect(draw({ skin: "glitch", size: 96 })).toContain("fx-glitch-r");
  });
});

describe("Frog's drawing", () => {
  it("renders every skin at every size without broken values", () => {
    for (const skin of FROG_SKINS) {
      for (const size of [16, 24, 32, 44, 96, 256]) {
        const html = draw({ skin, size });
        expect(html, `${skin}@${size}`).not.toMatch(/NaN|undefined|url\(#\)/);
        expect(html).toContain(`data-frog-skin="${skin}"`);
        expect(html).toContain(`width:${size}px`);
      }
    }
    expect(draw({ size: 32 })).toContain('viewBox="11 14 78 78"');
    expect(draw({ size: 96 })).toContain('viewBox="0 0 100 100"');
  });

  it("keeps the defs of two Frogs on one page apart", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(FrogMascot, { color: "green", skin: "poison", size: 96 }), createElement(FrogMascot, { color: "green", skin: "poison", size: 96 })));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is what a bot wearing it shows everywhere", () => {
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "green", mascotLook: { character: "frog", skins: { frog: "tree" } } }, size: 40, state: "laughing" }));
    expect(html).toContain('data-character="frog"');
    expect(html).toContain('data-frog-skin="tree"');
    expect(html).toContain('data-expression="laughing"');
  });
});
