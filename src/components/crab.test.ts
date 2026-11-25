// Crab, the pixel-rect mascot: only axis-aligned rectangles, a coral fill,
// Clawd-Still 24x16, 2x2 square eyes, stub arms, four legs. Free with the owl.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { APP_ICON_CHOICES } from "@/lib/app-icon-choices";
import { BotAvatar } from "@/components/Avatar";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { DEFAULT_CHARACTERS, rewardKey, skinTier } from "../../shared/achievements";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import {
  botMascotLook,
  CHARACTER_PAINT,
  completeMascotLook,
  CRAB_DEFAULT_COLOR,
  CRAB_SKIN_TIER,
  CRAB_SKINS,
  LEGACY_CRAB_SKINS,
  mascotLookSchema,
} from "../../shared/mascot-look";
import { MASCOTS, mascotFor } from "./floating-bots/mascots";
import { CHARACTER_LABEL, CRAB_SKIN_LABEL } from "./floating-bots/mascot-look-labels";
import { colorGroupsFor, skinTierTabs } from "./floating-bots/editor-tabs";
import { CrabMascot, crabExpressionForMood, crabHexOf } from "./CrabMascot";
import { crabSkinId, crabSkinMarks, crabSkinPaint } from "./skin-fx/crab-skins";
import {
  CRAB_BUST_MAX,
  CRAB_CLIP_RECTS,
  CRAB_CORAL,
  CRAB_GRID,
  CRAB_IDLE_RECTS,
  CRAB_INK,
  CRAB_OX,
  CRAB_OY,
  CRAB_PARTS,
  CRAB_PX,
  crabEyeDraw,
  crabFill,
  crabViewBox,
} from "./crab-art";

const draw = (props: Partial<Parameters<typeof CrabMascot>[0]> = {}) =>
  renderToStaticMarkup(createElement(CrabMascot, { color: "orange", ...props }));

describe("Crab's art", () => {
  it("sits on the Clawd-Still 24x16 grid mapped into the 0..100 box", () => {
    expect(CRAB_PX).toBe(4);
    expect(CRAB_GRID).toBe(24);
    expect(CRAB_OX).toBe(2);
    expect(CRAB_OY).toBe(36);
    expect(CRAB_PARTS.body).toEqual({ x: 18, y: 36, w: 64, h: 48 });
    expect(CRAB_PARTS.armL).toEqual({ x: 2, y: 52, w: 16, h: 16 });
    expect(CRAB_PARTS.armR).toEqual({ x: 82, y: 52, w: 16, h: 16 });
    expect(CRAB_PARTS.legs).toHaveLength(4);
    expect(CRAB_PARTS.legs[0]).toEqual({ x: 18, y: 84, w: 8, h: 16 });
    expect(CRAB_PARTS.eyeL).toEqual({ x: 26, y: 44, w: 8, h: 8 });
    expect(CRAB_PARTS.eyeR).toEqual({ x: 66, y: 44, w: 8, h: 8 });
    expect("feet" in CRAB_PARTS).toBe(false);
    expect("shineL" in CRAB_PARTS).toBe(false);
    expect("pincerL" in CRAB_PARTS).toBe(false);
  });

  it("crops to the bust under 48 px", () => {
    expect(crabViewBox(32)).toBe("0 32 100 56");
    expect(crabViewBox(CRAB_BUST_MAX)).toBe("0 32 100 56");
    expect(crabViewBox(49)).toBe("0 0 100 100");
  });

  it("opens 2x2 solid eyes, and squints on happy like the flag waver", () => {
    const open = crabEyeDraw("neutral");
    expect(open.pupils[0]).toEqual(CRAB_PARTS.eyeL);
    expect(open.shines).toBeNull();
    const happy = crabEyeDraw("happy");
    expect(happy.pupils[0].h).toBe(CRAB_PX);
    expect(happy.shines).toBeNull();
    const sleepy = crabEyeDraw("sleepy");
    expect(sleepy.pupils[0].h).toBe(CRAB_PX);
    expect(sleepy.pupils[0].y).not.toBe(happy.pupils[0].y);
    expect(crabEyeDraw("excited").shines).toBeNull();
  });

  it("tints the coral with the bot colour on Plain, and stays a crab", () => {
    expect(crabFill(CRAB_CORAL, 0).toLowerCase()).toBe(CRAB_CORAL.toLowerCase());
    expect(crabFill("#377FE6", 0.45).toLowerCase()).not.toBe(CRAB_CORAL.toLowerCase());
    expect(crabFill("#377FE6", 0.45).toLowerCase()).not.toBe("#377fe6");
    expect(crabHexOf("orange")).toBe(MASCOT_COLOR_HEX.orange);
    expect(crabHexOf("#DD775B")).toBe("#DD775B");
    expect(crabHexOf("not-a-color")).toBe(CRAB_CORAL);
  });
});

describe("Crab's look", () => {
  it("is a character of its own, stored with the bot like the others", () => {
    expect(botMascotLook({ character: "crab", skins: { crab: "mint" } })).toEqual({ character: "crab", skins: { crab: "mint" } });
    expect(completeMascotLook({ character: "crab" }).skins.crab).toBe("plain");
    expect(CHARACTER_PAINT.crab).toEqual({ colors: true, skins: CRAB_SKINS, wingMoves: false });
    expect(MASCOT_COLOR_HEX[CRAB_DEFAULT_COLOR as keyof typeof MASCOT_COLOR_HEX]).toBeDefined();
    const look = completeMascotLook({ character: "crab", skins: { crab: "sand", frog: "tree" } });
    expect(completeMascotLook({ ...look, character: "frog" }).skins).toMatchObject({ frog: "tree", crab: "sand" });
  });

  it("reads other names a stored skin may carry, and drops one it does not know without losing the character", () => {
    for (const [old, current] of Object.entries(LEGACY_CRAB_SKINS)) expect(botMascotLook({ character: "crab", skins: { crab: old } }).skins?.crab, old).toBe(current);
    expect(botMascotLook({ character: "crab", skins: { crab: "lobster" } })).toEqual({ character: "crab" });
    expect(mascotLookSchema.safeParse({ character: "crab", skins: { crab: "nope" } }).success).toBe(false);
  });

  it("is in the registry, the editor, the palettes (Clay included), the app icons and the free characters", () => {
    expect(mascotFor({ character: "crab" }).id).toBe("crab");
    expect(MASCOTS.find((entry) => entry.id === "crab")?.capabilities.wings).toBe(false);
    expect(CHARACTER_LABEL.crab).toBe("floatingBots.mascot.crab");
    expect(colorGroupsFor("crab", "orange")).toContain("clay");
    expect(APP_ICON_CHOICES.some((choice) => choice.art.kind === "crab")).toBe(true);
    expect(DEFAULT_CHARACTERS).not.toContain("crab");
    for (const skin of CRAB_SKINS) expect(skinTier("crab", skin), skin).toBe(CRAB_SKIN_TIER[skin]);
    const rewarded = ACHIEVEMENTS.flatMap((item) => item.rewards.map(rewardKey));
    for (const skin of CRAB_SKINS) if (skinTier("crab", skin) !== "common") expect(rewarded, skin).toContain(`skin:crab:${skin}`);
  });

  it("maps the app's states to its faces", () => {
    expect(crabExpressionForMood("thinking")).toBe("curious");
    expect(crabExpressionForMood("working")).toBe("attentive");
    expect(crabExpressionForMood("happy")).toBe("happy");
    expect(crabExpressionForMood("sleeping")).toBe("asleep");
    expect(crabExpressionForMood("listening")).toBe("attentive");
    expect(crabExpressionForMood("speaking")).toBe("excited");
    expect(crabExpressionForMood("idle")).toBe("neutral");
  });
});

describe("Crab's skins", () => {
  it("has fourteen skins: five common, Gold and Pearl rare, four epic, three legendary", () => {
    expect([...CRAB_SKINS]).toEqual(["plain", "coral", "sand", "ink", "mint", "gold", "pearl", "neon", "chrome", "crystal", "circuit", "holo", "molten", "galaxy"]);
    expect(Object.keys(CRAB_SKIN_TIER)).toEqual([...CRAB_SKINS]);
    const counts = Object.fromEntries(skinTierTabs(CRAB_SKINS, CRAB_SKIN_TIER).map((tab) => [tab.tier, tab.count]));
    expect(counts).toEqual({ common: 5, rare: 2, epic: 4, legendary: 3 });
  });

  it("names every skin in English and French", () => {
    expect(Object.keys(CRAB_SKIN_LABEL)).toEqual([...CRAB_SKINS]);
    for (const key of [...Object.values(CRAB_SKIN_LABEL), CHARACTER_LABEL.crab, "floatingBots.move.scuttle"]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });

  it("paints a fill and eyes for every skin, Ink with cream eyes, premium with their own finish", () => {
    for (const skin of CRAB_SKINS) {
      const paint = crabSkinPaint(skin, "#377FE6");
      expect(paint.fill, skin).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(paint.eyes, skin).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(paint.accent, skin).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(paint.tier, skin).toBe(CRAB_SKIN_TIER[skin]);
    }
    expect(crabSkinPaint("coral", "#377FE6").fill.toUpperCase()).toBe(CRAB_CORAL.toUpperCase());
    expect(crabSkinPaint("ink", "#377FE6").eyes.toUpperCase()).toBe("#F4EFE8");
    expect(crabSkinPaint("plain", "#377FE6").eyes.toUpperCase()).toBe(CRAB_INK.toUpperCase());
    expect(crabSkinPaint("plain", "#377FE6").shine.toUpperCase()).toBe("#F8F4EE");
    expect(crabSkinPaint("ink", "#377FE6").shine.toUpperCase()).toBe("#1A1816");
    expect(crabSkinPaint("plain", "#377FE6").fill).not.toBe(crabSkinPaint("plain", "#E78531").fill);
    expect(crabSkinPaint("sand", "#377FE6").fill).toBe(crabSkinPaint("sand", "#E78531").fill);
    expect(crabSkinPaint("gold", "#377FE6").fill.toUpperCase()).toBe("#E2AE34");
    expect(crabSkinPaint("gold", "#377FE6").fx).toBe("gold");
    expect(crabSkinPaint("pearl", "#377FE6").fill.toUpperCase()).toBe("#F3EBE3");
    expect(crabSkinPaint("neon", "#377FE6").fill.toUpperCase()).toBe("#0D0F15");
    expect(crabSkinPaint("neon", "#377FE6").eyes).not.toBe(crabSkinPaint("neon", "#E78531").eyes);
    expect(crabSkinPaint("galaxy", "#377FE6").fx).toBe("galaxy");
    expect(crabSkinId("unknown")).toBe("plain");
  });

  it("gives every premium skin extra pixels, and the commons none", () => {
    for (const skin of CRAB_SKINS) {
      const marks = crabSkinMarks(skin, "#377FE6");
      const extra = marks.under.length + marks.inner.length + marks.around.length;
      if (CRAB_SKIN_TIER[skin] === "common") expect(extra, skin).toBe(0);
      else expect(extra, skin).toBeGreaterThan(0);
    }
  });
});

describe("Crab's drawing", () => {
  it("renders every skin at every size as crisp rectangles, no paths in the body", () => {
    const hex = crabHexOf("orange");
    for (const skin of CRAB_SKINS) {
      const marks = crabSkinMarks(skin, hex);
      const extra = marks.under.length + marks.inner.length + marks.around.length;
      for (const size of [16, 24, 32, 44, 96, 256]) {
        const html = draw({ skin, size, animated: false });
        expect(html, `${skin}@${size}`).not.toMatch(/NaN|undefined/);
        expect(html).toContain(`data-crab-skin="${skin}"`);
        expect(html).toContain(`data-character="crab"`);
        expect(html).toContain(`width:${size}px`);
        expect(html).toContain("crispEdges");
        expect(html).toContain(`data-skin-tier="${CRAB_SKIN_TIER[skin]}"`);
        expect(html).not.toMatch(/<path[\s>]/);
        expect(html.match(/<rect /g)?.length, `${skin}@${size}`).toBe(CRAB_IDLE_RECTS + CRAB_CLIP_RECTS + extra);
        expect(html, `${skin}@${size}`).not.toMatch(/crab-pincer|crab-foot|crab-shine/);
      }
    }
    expect(draw({ size: 32 })).toContain('viewBox="0 32 100 56"');
    expect(draw({ size: 96 })).toContain('viewBox="0 0 100 100"');
    expect(draw({ skin: "gold", size: 96 })).toContain("skin-fx-live");
    expect(draw({ skin: "plain", size: 96 })).not.toContain("skin-fx-live");
    expect(draw({ skin: "gold", size: 24 })).not.toContain("skin-fx-live");
  });

  it("is what a bot wearing it shows everywhere", () => {
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "orange", mascotLook: { character: "crab", skins: { crab: "coral" } } }, size: 40, state: "laughing" }));
    expect(html).toContain('data-character="crab"');
    expect(html).toContain('data-crab-skin="coral"');
  });
});
