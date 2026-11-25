// Shiba, the dog (direction C, "aplat net"): its drawing as data, its sixteen
// faces, the coat for every bot color and the bust crop.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { APP_ICON_CHOICES } from "@/lib/app-icon-choices";
import { BotAvatar, shibaExpressionFor } from "@/components/Avatar";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { rewardKey, skinTier } from "../../shared/achievements";
import { contrastRatio, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { botMascotLook, CHARACTER_PAINT, completeMascotLook, LEGACY_SHIBA_SKINS, mascotLookSchema, SHIBA_DEFAULT_COLOR, SHIBA_SKIN_TIER, SHIBA_SKINS } from "../../shared/mascot-look";
import { MASCOTS, mascotFor } from "./floating-bots/mascots";
import { CHARACTER_LABEL, SHIBA_SKIN_LABEL } from "./floating-bots/mascot-look-labels";
import { colorGroupsFor, skinTierTabs } from "./floating-bots/editor-tabs";
import { ShibaMascot, shibaExpressionForMood } from "./ShibaMascot";
import { shibaSkinId, shibaSkinPaint, vgaColor } from "./skin-fx/shiba-skins";
import { SHAPE_EXPRESSIONS } from "./shape-engine";
import {
  COAT_MIN_CONTRAST,
  ellipsePath,
  mirrorPath,
  mixColor,
  MOUTHS,
  mouthOps,
  SHIBA_ART,
  SHIBA_BUST_MAX,
  SHIBA_EXPRESSIONS,
  SHIBA_FACES,
  SHIBA_MOOD_EXPRESSION,
  shibaCoat,
  shibaOutline,
  shibaPalette,
  shibaParts,
  shibaStillSvg,
  shibaViewBox,
  SHIBA_ROLES,
  type ShibaOp,
} from "./shiba-art";

const draw = (props: Partial<Parameters<typeof ShibaMascot>[0]> = {}) => renderToStaticMarkup(createElement(ShibaMascot, { color: "orange", ...props }));

const ABSOLUTE = /^[MLCQZ0-9.\s-]+$/;
const pathsOf = (ops: readonly ShibaOp[]) => ops.flatMap((op) => [op.d, ...(op.clip ? [op.clip] : [])]);

describe("Shiba's art", () => {
  it("names its sixteen faces like the Shapes, and its five v3 moods among them", () => {
    expect([...SHIBA_EXPRESSIONS]).toEqual([...SHAPE_EXPRESSIONS]);
    expect(SHIBA_MOOD_EXPRESSION).toEqual({ idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" });
    expect(Object.keys(SHIBA_FACES).sort()).toEqual([...SHIBA_EXPRESSIONS].sort());
  });

  it("draws every face with its three layers: two eyes, two brow spots and a mouth", () => {
    for (const expression of SHIBA_EXPRESSIONS) {
      const parts = shibaParts({ expression, size: 120 });
      expect(parts.eyeL.length, expression).toBeGreaterThan(0);
      expect(parts.eyeR.length, expression).toBeGreaterThan(0);
      expect(parts.brows, expression).toHaveLength(2);
      // the line under the nose, then the mouth itself
      expect(parts.mouth.length, expression).toBeGreaterThanOrEqual(2);
      expect(parts.nose.length).toBe(2);
    }
    // the faces differ from one another
    const faces = new Set(SHIBA_EXPRESSIONS.map((expression) => shibaStillSvg({ color: "#E78531", expression, size: 120 })));
    expect(faces.size).toBe(SHIBA_EXPRESSIONS.length);
  });

  it("keeps every path absolute (M L C Q Z only), so it moves, mirrors and parses on the phone", () => {
    for (const stance of ["sit", "stand", "lie"] as const) {
      for (const expression of SHIBA_EXPRESSIONS) {
        const parts = shibaParts({ expression, size: 200, stance });
        for (const d of Object.values(parts).flatMap(pathsOf)) expect(d, `${stance} ${expression}`).toMatch(ABSOLUTE);
      }
    }
    for (const mouth of MOUTHS) for (const d of pathsOf(mouthOps(mouth, 2))) expect(d).toMatch(ABSOLUTE);
  });

  it("mirrors the right ear from the left one", () => {
    expect(SHIBA_ART.earR).toBe(mirrorPath(SHIBA_ART.earL));
    expect(mirrorPath(SHIBA_ART.earR)).toBe(SHIBA_ART.earL);
    expect(ellipsePath(50, 50, 4, 2)).toMatch(/^M54 50C/);
  });

  it("crops to the bust under 48 px and leaves the tail out", () => {
    expect(shibaViewBox(32)).toBe("16 12 68 68");
    expect(shibaViewBox(SHIBA_BUST_MAX)).toBe("16 12 68 68");
    expect(shibaViewBox(49)).toBe("0 0 100 100");
    expect(shibaParts({ expression: "neutral", size: 32 }).tail).toEqual([]);
    expect(shibaParts({ expression: "neutral", size: 96 }).tail.length).toBeGreaterThan(0);
    // the sleeping z stays out of the crop
    expect(shibaParts({ expression: "sleepy", size: 32 }).extras).toEqual([]);
  });

  it("keeps one outline width, never under 1.6 screen px", () => {
    for (const size of [16, 24, 32, 44, 48, 64, 96, 240]) {
      const ow = shibaOutline(size);
      const box = size <= SHIBA_BUST_MAX ? 68 : 100;
      expect((ow * size) / box, String(size)).toBeGreaterThanOrEqual(1.6 - 0.01);
      expect(ow).toBeGreaterThanOrEqual(1.9);
    }
    expect(shibaOutline(240)).toBe(1.9);
  });

  it("wears the bot color, darkening a light one just enough for the cream mask to read", () => {
    expect(shibaCoat("#E78531")).toBe("#E78531");
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const palette = shibaPalette(hex);
      expect(contrastRatio(palette.coat, palette.cream), name).toBeGreaterThanOrEqual(COAT_MIN_CONTRAST);
    }
    // white turns a light grey, never a different hue; a dark color stays itself
    const white = shibaCoat(MASCOT_COLOR_HEX.white);
    expect(white).not.toBe(MASCOT_COLOR_HEX.white);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(white.slice(i, i + 2), 16));
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(shibaCoat(MASCOT_COLOR_HEX.black)).toBe(MASCOT_COLOR_HEX.black);
    expect(shibaCoat(MASCOT_COLOR_HEX.butter)).not.toBe(MASCOT_COLOR_HEX.butter);
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("paints every role a palette defines", () => {
    const palette = shibaPalette("#377FE6");
    for (const stance of ["sit", "stand", "lie"] as const) {
      const parts = shibaParts({ expression: "laughing", size: 200, stance });
      for (const op of (Object.values(parts) as ShibaOp[][]).flat()) {
        if (op.fill) expect(palette[op.fill], op.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
        if (op.stroke) expect(palette[op.stroke], op.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

describe("Shiba's look", () => {
  it("is a character of its own, stored with the bot like the others", () => {
    expect(botMascotLook({ character: "shiba", skins: { shiba: "sesame" } })).toEqual({ character: "shiba", skins: { shiba: "sesame" } });
    expect(completeMascotLook({ character: "shiba" }).skins.shiba).toBe("plain");
    expect(CHARACTER_PAINT.shiba).toEqual({ colors: true, skins: SHIBA_SKINS, wingMoves: false });
    expect(MASCOT_COLOR_HEX[SHIBA_DEFAULT_COLOR as keyof typeof MASCOT_COLOR_HEX]).toBe("#E78531");
    // each character keeps its own skin
    const look = completeMascotLook({ character: "shiba", skins: { shiba: "holo", bunbu: "gold" } });
    expect(completeMascotLook({ ...look, character: "bunbu" }).skins).toMatchObject({ bunbu: "gold", shiba: "holo" });
  });

  it("reads other names a stored skin may carry, and drops one it does not know without losing the character", () => {
    for (const [old, current] of Object.entries(LEGACY_SHIBA_SKINS)) expect(botMascotLook({ character: "shiba", skins: { shiba: old } }).skins?.shiba, old).toBe(current);
    expect(botMascotLook({ character: "shiba", skins: { shiba: "corgi" } })).toEqual({ character: "shiba" });
    expect(mascotLookSchema.safeParse({ character: "shiba", skins: { shiba: "nope" } }).success).toBe(false);
  });

  it("is in the registry, the editor, the palettes (Clay included), the app icons and the achievements", () => {
    expect(mascotFor({ character: "shiba" }).id).toBe("shiba");
    expect(MASCOTS.find((entry) => entry.id === "shiba")?.capabilities.wings).toBe(false);
    expect(CHARACTER_LABEL.shiba).toBe("floatingBots.mascot.shiba");
    expect(colorGroupsFor("shiba", "orange")).toContain("clay");
    expect(APP_ICON_CHOICES.some((choice) => choice.art.kind === "shiba")).toBe(true);
    const rewarded = ACHIEVEMENTS.flatMap((item) => item.rewards.map(rewardKey));
    expect(rewarded).toContain("character:shiba");
    for (const skin of SHIBA_SKINS) if (skinTier("shiba", skin) !== "common") expect(rewarded, skin).toContain(`skin:shiba:${skin}`);
  });

  it("maps the app's states to its faces", () => {
    expect(shibaExpressionFor("sleeping")).toBe("sleepy");
    expect(shibaExpressionFor("searching")).toBe("curious");
    expect(shibaExpressionFor("laughing")).toBe("laughing");
    expect(shibaExpressionFor("celebrate")).toBe("excited");
    expect(shibaExpressionFor(undefined)).toBe("neutral");
    expect(shibaExpressionForMood("thinking")).toBe("curious");
  });
});

describe("Shiba's skins", () => {
  it("has thirteen skins: Plain with the character, the breed's coats on the Mastery rungs, then the premium set", () => {
    expect([...SHIBA_SKINS]).toEqual(["plain", "cream", "blacktan", "red", "sesame", "white", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
    expect(Object.keys(SHIBA_SKIN_TIER)).toEqual([...SHIBA_SKINS]);
    const counts = Object.fromEntries(skinTierTabs(SHIBA_SKINS, SHIBA_SKIN_TIER).map((tab) => [tab.tier, tab.count]));
    expect(counts).toEqual({ common: 1, rare: 7, epic: 3, legendary: 2 });
  });

  it("names every skin in English and French", () => {
    expect(Object.keys(SHIBA_SKIN_LABEL)).toEqual([...SHIBA_SKINS]);
    for (const key of [...Object.values(SHIBA_SKIN_LABEL), CHARACTER_LABEL.shiba]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });

  it("paints every role of every skin, with its rarity and effect family", () => {
    for (const skin of SHIBA_SKINS) {
      const paint = shibaSkinPaint(skin, "#377FE6", "u");
      for (const role of SHIBA_ROLES) expect(paint.palette[role], `${skin} ${role}`).toMatch(/^(#[0-9a-fA-F]{6}|url\(#u-[a-zA-Z]+\))$/);
      expect(paint.tier).toBe(SHIBA_SKIN_TIER[skin]);
      expect(paint.fx).toBeTruthy();
    }
    expect(shibaSkinPaint("retro98", "#E78531", "u").fx).toBe("retro");
    expect(shibaSkinPaint("glitch", "#E78531", "u").bodyClass).toBe("fx-glitch-slice");
    // the coats are the breed's own, whatever the bot's color
    expect(shibaSkinPaint("red", "#377FE6", "u").palette.coat).toBe(shibaSkinPaint("red", "#009957", "u").palette.coat);
    // black and tan keeps its tan points over the eyes
    expect(shibaSkinPaint("blacktan", "#377FE6", "u").palette.brow).not.toBe(shibaSkinPaint("blacktan", "#377FE6", "u").palette.cream);
    expect(vgaColor("#E78531")).toMatch(/^#[0-9a-f]{6}$/);
    expect(shibaSkinId("unknown")).toBe("plain");
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

describe("Shiba's drawing", () => {
  it("renders every skin at every size without broken values", () => {
    for (const skin of SHIBA_SKINS) {
      for (const size of [16, 24, 32, 44, 96, 256]) {
        const html = draw({ skin, size });
        expect(html, `${skin}@${size}`).not.toMatch(/NaN|undefined|url\(#\)/);
        expect(html).toContain(`data-shiba-skin="${skin}"`);
        expect(html).toContain(`width:${size}px`);
      }
    }
    expect(draw({ size: 32 })).toContain('viewBox="16 12 68 68"');
    expect(draw({ size: 96 })).toContain('viewBox="0 0 100 100"');
  });

  it("keeps the defs of two Shibas on one page apart", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(ShibaMascot, { color: "orange", skin: "gold", size: 96 }), createElement(ShibaMascot, { color: "orange", skin: "gold", size: 96 })));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is what a bot wearing it shows everywhere", () => {
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "orange", mascotLook: { character: "shiba", skins: { shiba: "sesame" } } }, size: 40, state: "laughing" }));
    expect(html).toContain('data-character="shiba"');
    expect(html).toContain('data-shiba-skin="sesame"');
    expect(html).toContain('data-expression="laughing"');
  });
});

describe("Shiba's Mastery unlocks", () => {
  it("registers every skin it ships in shared/mascot-unlocks.ts, with the rarity the registry gives", async () => {
    const { masterySkins, masteryUnlockFor, masterySkinTier, MASTERY_UNLOCKS } = await import("../../shared/mascot-unlocks");
    expect([...masterySkins("shiba")].sort()).toEqual([...SHIBA_SKINS].sort());
    expect(masteryUnlockFor("shiba")).toBe("hands-off");
    expect(MASTERY_UNLOCKS.shiba.namedSkins.map((skin) => skin.id)).toEqual(["cream", "blacktan", "red", "sesame", "white"]);
    for (const skin of SHIBA_SKINS) {
      expect(SHIBA_SKIN_TIER[skin], skin).toBe(masterySkinTier(skin));
      if (skin !== "plain") expect(masteryUnlockFor("shiba", skin), skin).toBeTruthy();
    }
    expect(masteryUnlockFor("shiba", "cream")).toBe("second-wind");
    expect(masteryUnlockFor("shiba", "white")).toBe("quiet-nights");
    expect(masteryUnlockFor("shiba", "gold")).toBe("pack-leader");
  });

  it("shows its real art in the achievements, not the placeholder", async () => {
    const { MasteryArt } = await import("./achievements/mastery-art");
    const html = renderToStaticMarkup(createElement(MasteryArt, { character: "shiba", skin: "sesame", size: 40, animated: false }));
    expect(html).toContain('data-character="shiba"');
    expect(html).not.toContain("data-mastery-placeholder");
  });
});
