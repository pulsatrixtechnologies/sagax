// Ogre, the big green ogre (direction C, "aplat net"): its drawing as data,
// its sixteen faces, the colors for every bot color, the bust crop, its look
// and its thirteen skins.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { APP_ICON_CHOICES } from "@/lib/app-icon-choices";
import { BotAvatar, ogreExpressionFor } from "@/components/Avatar";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { rewardKey, skinTier } from "../../shared/achievements";
import { contrastRatio, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { botMascotLook, CHARACTER_PAINT, completeMascotLook, LEGACY_OGRE_SKINS, mascotLookSchema, OGRE_DEFAULT_COLOR, OGRE_SKIN_TIER, OGRE_SKINS } from "../../shared/mascot-look";
import { MASCOTS, mascotFor } from "./floating-bots/mascots";
import { CHARACTER_LABEL, OGRE_SKIN_LABEL } from "./floating-bots/mascot-look-labels";
import { colorGroupsFor, skinTierTabs } from "./floating-bots/editor-tabs";
import { OgreMascot, ogreExpressionForMood } from "./OgreMascot";
import { ogreSkinId, ogreSkinLayers, ogreSkinPaint } from "./skin-fx/ogre-skins";
import { SHAPE_EXPRESSIONS } from "./shape-engine";
import {
  armOps,
  legOps,
  mirrorPath,
  OGRE_ART,
  OGRE_BUST_MAX,
  OGRE_EXPRESSIONS,
  OGRE_FACES,
  OGRE_MOOD_EXPRESSION,
  OGRE_MOUTHS,
  OGRE_ROLES,
  OGRE_SKIN,
  OGRE_STANCES,
  OGRE_TUNIC,
  OGRE_VEST,
  mouthOps,
  ogreOutline,
  ogrePalette,
  ogreParts,
  ogreSkin,
  ogreStillSvg,
  ogreVest,
  ogreViewBox,
  SKIN_TINT,
  tintColor,
  twoBone,
  VEST_MIN_CONTRAST,
  type OgreOp,
  type Point,
} from "./ogre-art";

const ABSOLUTE = /^[MLCQZ0-9.\s-]+$/;
const pathsOf = (ops: readonly OgreOp[]) => ops.flatMap((op) => [op.d, ...(op.clip ? [op.clip] : [])]);
const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const hsl = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? (((g - b) / d + 6) % 6) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
};

describe("Ogre's art", () => {
  it("names its sixteen faces like the Shapes, and its five approved moods among them", () => {
    expect([...OGRE_EXPRESSIONS]).toEqual([...SHAPE_EXPRESSIONS]);
    expect(OGRE_MOOD_EXPRESSION).toEqual({ idle: "neutral", happy: "happy", thinking: "curious", alert: "surprised", sleepy: "sleepy" });
    expect(Object.keys(OGRE_FACES).sort()).toEqual([...OGRE_EXPRESSIONS].sort());
  });

  it("draws every face with its layers: two eyes, two heavy brows, the nose and a mouth", () => {
    for (const expression of OGRE_EXPRESSIONS) {
      const parts = ogreParts({ expression, size: 120 });
      expect(parts.eyeL.length, expression).toBeGreaterThan(0);
      expect(parts.eyeR.length, expression).toBeGreaterThan(0);
      expect(parts.brows, expression).toHaveLength(2);
      expect(parts.mouth.length, expression).toBeGreaterThanOrEqual(1);
      // the nose: shade, base, outline, two nostrils
      expect(parts.nose).toHaveLength(5);
    }
    const faces = new Set(OGRE_EXPRESSIONS.map((expression) => ogreStillSvg({ color: "#009957", expression, size: 120 })));
    expect(faces.size).toBe(OGRE_EXPRESSIONS.length);
  });

  it("keeps every path absolute (M L C Q Z only), in every stance, so it moves, mirrors and parses on the phone", () => {
    for (const stance of OGRE_STANCES) {
      for (const expression of OGRE_EXPRESSIONS) {
        for (const marks of [null, "cracks", "rivets"] as const) {
          const parts = ogreParts({ expression, size: 200, stance, marks });
          for (const d of Object.values(parts).flatMap(pathsOf)) expect(d, `${stance} ${expression} ${marks}`).toMatch(ABSOLUTE);
        }
      }
    }
    for (const mouth of OGRE_MOUTHS) for (const d of pathsOf(mouthOps(mouth, 2))) expect(d, mouth).toMatch(ABSOLUTE);
    for (const d of pathsOf([...armOps(-1, [20, 30], 2, { open: true, bulge: 1 }), ...legOps(1, [64, 90], 2)])) expect(d).toMatch(ABSOLUTE);
  });

  it("mirrors the right trumpet and the right half of the vest from the left ones", () => {
    expect(OGRE_ART.earR).toBe(mirrorPath(OGRE_ART.earL));
    expect(mirrorPath(OGRE_ART.earR)).toBe(OGRE_ART.earL);
    expect(OGRE_ART.vestR).toBe(mirrorPath(OGRE_ART.vestL));
  });

  it("shows two upper incisors on the idle smile", () => {
    const teeth = mouthOps("smile", 2).filter((op) => op.fill === "teeth");
    expect(teeth).toHaveLength(2);
  });

  it("draws the head and shoulders at rest, the whole ogre standing, and the ogre on its log", () => {
    const rest = ogreParts({ expression: "neutral", size: 120 });
    expect(rest.legL).toEqual([]);
    expect(rest.armL).toEqual([]);
    expect(rest.log).toEqual([]);
    const stand = ogreParts({ expression: "neutral", size: 120, stance: "stand" });
    for (const part of [stand.legL, stand.legR, stand.armL, stand.armR, stand.belly]) expect(part.length).toBeGreaterThan(0);
    expect(stand.log).toEqual([]);
    expect(ogreParts({ expression: "sleepy", size: 120, stance: "log" }).log.length).toBeGreaterThan(0);
  });

  it("places a limb's two bones by its end: the joint bends out, a far target straightens it", () => {
    const root: Point = [0, 0];
    const { joint, end } = twoBone(root, [0, 10], 6, 6, 1);
    expect(Math.hypot(joint[0], joint[1])).toBeCloseTo(6, 5);
    expect(Math.hypot(end[0] - joint[0], end[1] - joint[1])).toBeCloseTo(6, 5);
    expect(end).toEqual([0, 10]);
    const far = twoBone(root, [0, 30], 6, 6, 1);
    expect(far.end[1]).toBeCloseTo(12, 2);
  });

  it("crops to the bust under 48 px and leaves the sleeping z out", () => {
    expect(ogreViewBox(32)).toBe("5 12 90 90");
    expect(ogreViewBox(OGRE_BUST_MAX)).toBe("5 12 90 90");
    expect(ogreViewBox(49)).toBe("0 0 100 100");
    expect(ogreParts({ expression: "sleepy", size: 32 }).extras).toEqual([]);
    expect(ogreParts({ expression: "sleepy", size: 96 }).extras.length).toBeGreaterThan(0);
  });

  it("keeps one outline width, never under 1.6 screen px", () => {
    for (const size of [16, 24, 32, 44, 48, 64, 96, 240]) {
      const ow = ogreOutline(size);
      const box = size <= OGRE_BUST_MAX ? 90 : 100;
      expect((ow * size) / box, String(size)).toBeGreaterThanOrEqual(1.6 - 0.01);
      expect(ow).toBeGreaterThanOrEqual(1.9);
    }
    expect(ogreOutline(240)).toBe(1.9);
  });
});

describe("Ogre's colors", () => {
  it("keeps the archetype's green and brown vest where no bot color is given", () => {
    expect(ogreSkin(null)).toBe(OGRE_SKIN);
    expect(ogreVest(null)).toBe(OGRE_VEST);
    expect(ogrePalette(undefined).skin).toBe("#9DBE4A");
  });

  it("tints the skin a quarter toward the bot color, keeping an ogre's saturation", () => {
    expect(SKIN_TINT).toBe(0.24);
    const base = hsl(OGRE_SKIN);
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const skin = ogreSkin(hex);
      expect(skin, name).toMatch(/^#[0-9a-f]{6}$/);
      // never washed out: the green's saturation, give or take the rounding
      expect(hsl(skin).s, name).toBeGreaterThanOrEqual(base.s * 0.92 - 0.02);
    }
    // a red bot pulls the green toward olive, a blue one toward teal
    expect(hsl(ogreSkin(MASCOT_COLOR_HEX.red)).h).toBeLessThan(base.h);
    expect(hsl(ogreSkin(MASCOT_COLOR_HEX.blue)).h).toBeGreaterThan(base.h);
    expect(tintColor(OGRE_SKIN, OGRE_SKIN, 0.24)).toBe(tintColor(OGRE_SKIN, OGRE_SKIN, 0));
  });

  it("wears the bot color as a leather vest, darkening a light one until the tunic reads", () => {
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const palette = ogrePalette(hex);
      expect(contrastRatio(palette.vest, OGRE_TUNIC), name).toBeGreaterThanOrEqual(VEST_MIN_CONTRAST);
    }
    // a light color keeps its hue family: white turns a warm grey-brown, never a different color
    const white = ogreVest(MASCOT_COLOR_HEX.white);
    expect(white).not.toBe(MASCOT_COLOR_HEX.white);
    const [r, g, b] = rgb(white);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(b);
    // a deep color stays close to itself
    expect(ogreVest(MASCOT_COLOR_HEX.navy)).not.toBe(ogreVest(MASCOT_COLOR_HEX.wine));
  });

  it("paints every role a palette defines, in every stance", () => {
    const palette = ogrePalette("#377FE6");
    for (const stance of OGRE_STANCES) {
      const parts = ogreParts({ expression: "laughing", size: 200, stance, marks: "cracks" });
      for (const op of (Object.values(parts) as OgreOp[][]).flat()) {
        if (op.fill) expect(palette[op.fill], op.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
        if (op.stroke) expect(palette[op.stroke], op.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

describe("Ogre's look", () => {
  it("is a character of its own, stored with the bot like the others", () => {
    expect(botMascotLook({ character: "ogre", skins: { ogre: "lava" } })).toEqual({ character: "ogre", skins: { ogre: "lava" } });
    expect(completeMascotLook({ character: "ogre" }).skins.ogre).toBe("plain");
    expect(CHARACTER_PAINT.ogre).toEqual({ colors: true, skins: OGRE_SKINS, wingMoves: false });
    expect(MASCOT_COLOR_HEX[OGRE_DEFAULT_COLOR as keyof typeof MASCOT_COLOR_HEX]).toBe("#009957");
    // each character keeps its own skin
    const look = completeMascotLook({ character: "ogre", skins: { ogre: "armor", shiba: "red" } });
    expect(completeMascotLook({ ...look, character: "shiba" }).skins).toMatchObject({ shiba: "red", ogre: "armor" });
  });

  it("reads other names a stored skin may carry, and drops one it does not know without losing the character", () => {
    for (const [old, current] of Object.entries(LEGACY_OGRE_SKINS)) expect(botMascotLook({ character: "ogre", skins: { ogre: old } }).skins?.ogre, old).toBe(current);
    expect(botMascotLook({ character: "ogre", skins: { ogre: "troll" } })).toEqual({ character: "ogre" });
    expect(mascotLookSchema.safeParse({ character: "ogre", skins: { ogre: "nope" } }).success).toBe(false);
  });

  it("is in the registry, the editor, the palettes (Clay included), the app icons and the achievements", () => {
    expect(mascotFor({ character: "ogre" }).id).toBe("ogre");
    expect(MASCOTS.find((entry) => entry.id === "ogre")?.capabilities).toMatchObject({ walk: true, wings: false });
    expect(CHARACTER_LABEL.ogre).toBe("floatingBots.mascot.ogre");
    expect(colorGroupsFor("ogre", "green")).toContain("clay");
    expect(APP_ICON_CHOICES.some((choice) => choice.art.kind === "ogre")).toBe(true);
    const rewarded = ACHIEVEMENTS.flatMap((item) => item.rewards.map(rewardKey));
    expect(rewarded).toContain("character:ogre");
    for (const skin of OGRE_SKINS) if (skinTier("ogre", skin) !== "common") expect(rewarded, skin).toContain(`skin:ogre:${skin}`);
  });

  it("maps the app's states and moods to its faces", () => {
    expect(ogreExpressionFor("sleeping")).toBe("sleepy");
    expect(ogreExpressionFor("searching")).toBe("curious");
    expect(ogreExpressionFor("angry")).toBe("angry");
    expect(ogreExpressionFor(undefined)).toBe("neutral");
    expect(ogreExpressionForMood("thinking")).toBe("curious");
    expect(ogreExpressionForMood("speaking")).toBe("excited");
  });

  it("draws in every bot avatar, the bust in a small one", () => {
    const small = renderToStaticMarkup(createElement(BotAvatar, { bot: { name: "Shrek-like", color: "blue", mascotLook: { character: "ogre", skins: { ogre: "lava" } } }, size: 32 }));
    expect(small).toContain('data-character="ogre"');
    expect(small).toContain('data-ogre-skin="lava"');
    expect(small).toContain('viewBox="5 12 90 90"');
    const big = renderToStaticMarkup(createElement(OgreMascot, { color: "green", size: 120, skin: "armor", animated: false }));
    expect(big).toContain('viewBox="0 0 100 100"');
  });
});

describe("Ogre's skins", () => {
  it("has thirteen skins over the four rarities: the ogre's hides, the intense ones, then the premium editions", () => {
    expect([...OGRE_SKINS]).toEqual(["plain", "swamp", "moss", "stone", "lava", "armor", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
    expect(Object.keys(OGRE_SKIN_TIER)).toEqual([...OGRE_SKINS]);
    const counts = Object.fromEntries(skinTierTabs(OGRE_SKINS, OGRE_SKIN_TIER).map((tab) => [tab.tier, tab.count]));
    expect(counts).toEqual({ common: 4, rare: 4, epic: 3, legendary: 2 });
  });

  it("names every skin in English and French", () => {
    expect(Object.keys(OGRE_SKIN_LABEL)).toEqual([...OGRE_SKINS]);
    for (const key of [...Object.values(OGRE_SKIN_LABEL), CHARACTER_LABEL.ogre]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });

  it("paints every role of every skin, with its rarity, its effect family and its marks", () => {
    for (const skin of OGRE_SKINS) {
      const paint = ogreSkinPaint(skin, "#377FE6", "u");
      for (const role of OGRE_ROLES) expect(paint.palette[role], `${skin} ${role}`).toMatch(/^(#[0-9a-fA-F]{6}|url\(#u-[a-zA-Z]+\))$/);
      expect(paint.tier).toBe(OGRE_SKIN_TIER[skin]);
      expect(paint.fx).toBeTruthy();
    }
    expect(ogreSkinPaint("lava", "#377FE6", "u").marks).toBe("cracks");
    expect(ogreSkinPaint("armor", "#377FE6", "u").marks).toBe("rivets");
    expect(ogreSkinPaint("plain", "#377FE6", "u").marks).toBeNull();
    expect(ogreSkinPaint("retro98", "#377FE6", "u").fx).toBe("retro");
    // the hides are the ogre's own, whatever the bot's color
    for (const skin of ["swamp", "moss", "stone", "lava"] as const) expect(ogreSkinPaint(skin, "#377FE6", "u").palette.skin, skin).toBe(ogreSkinPaint(skin, "#D94B52", "u").palette.skin);
    // Plain is the bot's color
    expect(ogreSkinPaint("plain", "#377FE6", "u").palette).toEqual(ogrePalette("#377FE6"));
    expect(ogreSkinId("dragon")).toBe("plain");
  });

  it("gives the premium editions a treatment on the head and the body, Armor on its plates only", () => {
    for (const skin of ["gold", "neon", "chrome", "glitch", "holo", "molten", "lava"] as const) {
      expect(ogreSkinLayers(skin, OGRE_ART.head, "#377FE6", "u", true, "head"), skin).not.toBeNull();
      expect(ogreSkinLayers(skin, OGRE_ART.body, "#377FE6", "u", true, "body"), skin).not.toBeNull();
    }
    expect(ogreSkinLayers("armor", OGRE_ART.head, "#377FE6", "u", true, "head")).toBeNull();
    expect(ogreSkinLayers("armor", OGRE_ART.body, "#377FE6", "u", true, "body")).not.toBeNull();
    for (const skin of ["plain", "swamp", "moss", "stone"] as const) expect(ogreSkinLayers(skin, OGRE_ART.body, "#377FE6", "u", true), skin).toBeNull();
  });
});
