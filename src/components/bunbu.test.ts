// Bunbu, our own collectible-vinyl character: its look, its skins by rarity,
// its drawing at every size, its moves, the popover and the app icon.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTHING_LOCKED } from "../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { APP_ICON_CHOICES } from "@/lib/app-icon-choices";
import { BotAvatar } from "@/components/Avatar";
import { BUNBU_DEFAULT_COLOR, BUNBU_SKIN_TIER, BUNBU_SKINS, botMascotLook, CHARACTER_PAINT, completeMascotLook, LEGACY_BUNBU_SKINS, mascotLookSchema } from "../../shared/mascot-look";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { BUNBU_ART, BUNBU_SILHOUETTE, bunbuLipY } from "./bunbu-art";
import { BUNBU_EARFLOP_CLIP, BunbuMascot, bunbuSkinId, bunbuSkinPaint } from "./BunbuMascot";
import { bunbuActionFor, bunbuMoodFor, MASCOTS, mascotFor } from "./floating-bots/mascots";
import MascotLookEditor, { BUNBU_SKIN_LABEL, CHARACTER_LABEL } from "./floating-bots/MascotLookEditor";
import { skinTierTabs } from "./floating-bots/editor-tabs";
import { characterMoves } from "./floating-bots/moves";

const draw = (props: Partial<Parameters<typeof BunbuMascot>[0]> = {}) => renderToStaticMarkup(createElement(BunbuMascot, { color: "mint", ...props }));

afterEach(() => vi.unstubAllGlobals());

describe("Bunbu's look", () => {
  it("is a character of its own, stored with the bot like the others", () => {
    expect(botMascotLook({ character: "bunbu", skins: { bunbu: "velvet" } })).toEqual({ character: "bunbu", skins: { bunbu: "velvet" } });
    expect(completeMascotLook({ character: "bunbu" }).skins.bunbu).toBe("plain");
    expect(CHARACTER_PAINT.bunbu).toEqual({ colors: true, skins: BUNBU_SKINS, wingMoves: false });
    expect(MASCOT_COLOR_HEX[BUNBU_DEFAULT_COLOR as keyof typeof MASCOT_COLOR_HEX]).toMatch(/^#/);
  });

  it("keeps each character's own skin when switching and back", () => {
    const look = completeMascotLook({ character: "bunbu", skins: { bunbu: "galaxy", shape: "gold" } });
    expect(completeMascotLook({ ...look, character: "shape" }).skins).toEqual({ shape: "gold", trombi: "classic", bunbu: "galaxy", shiba: "plain", grump: "plain", ogre: "plain", frog: "plain", crab: "plain" });
  });

  it("reads other names a stored skin may carry, and drops one it does not know without losing the character", () => {
    for (const [old, current] of Object.entries(LEGACY_BUNBU_SKINS)) expect(botMascotLook({ character: "bunbu", skins: { bunbu: old } }).skins?.bunbu).toBe(current);
    expect(botMascotLook({ character: "bunbu", skins: { bunbu: "rainbow-unicorn" } })).toEqual({ character: "bunbu" });
    expect(mascotLookSchema.safeParse({ character: "bunbu", skins: { bunbu: "nope" } }).success).toBe(false);
  });
});

describe("Bunbu's skins", () => {
  it("has twelve skins over the four rarities, from Plain to the legendary finishes", () => {
    expect([...BUNBU_SKINS]).toEqual(["plain", "pastel", "night", "plush", "velvet", "gold", "neon", "chrome", "crystal", "holo", "galaxy", "molten"]);
    expect(Object.keys(BUNBU_SKIN_TIER)).toEqual([...BUNBU_SKINS]);
    const counts = Object.fromEntries(skinTierTabs(BUNBU_SKINS, BUNBU_SKIN_TIER).map((tab) => [tab.tier, tab.count]));
    expect(counts).toEqual({ common: 4, rare: 2, epic: 3, legendary: 3 });
  });

  it("names every skin in English and French", () => {
    expect(Object.keys(BUNBU_SKIN_LABEL)).toEqual([...BUNBU_SKINS]);
    for (const key of [...Object.values(BUNBU_SKIN_LABEL), CHARACTER_LABEL.bunbu, "floatingBots.move.earFlop"]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });

  it("paints every skin with readable eyes, an effect family and its rarity", () => {
    for (const skin of BUNBU_SKINS) {
      const paint = bunbuSkinPaint(skin, "#98DDB9");
      expect(paint.tier).toBe(BUNBU_SKIN_TIER[skin]);
      expect(paint.eyes).toMatch(/^#[0-9a-f]{6}$/i);
      expect(paint.fx).toBeTruthy();
    }
    expect(bunbuSkinPaint("velvet", "#98DDB9").fx).toBe("velvet");
    expect(bunbuSkinId("unknown")).toBe("plain");
  });

  it("uses the seamless back-and-forth holographic foil (#94), and only the full drawing moves", () => {
    const full = draw({ skin: "holo", size: 96 });
    expect(full).toContain("fx-foil-diag");
    expect(full).toContain('data-fx="full"');
    const still = draw({ skin: "holo", size: 24 });
    expect(still).toContain('data-fx="static"');
    expect(still).not.toMatch(/fx-foil|fx-sweep|fx-twinkle|<filter/);
  });
});

describe("Bunbu's drawing", () => {
  it("draws its own parts: two ears, a body, arms, a tummy heart, big eyes and five teeth", () => {
    const html = draw({ size: 96 });
    expect(html).toContain(BUNBU_ART.earLeft);
    expect(html).toContain(BUNBU_ART.earRight);
    expect(html).toContain(BUNBU_ART.body);
    expect(html).toContain(BUNBU_ART.heart);
    expect((html.match(/class="bunbu-arm /g) ?? []).length).toBe(2);
    expect((html.match(/class="bunbu-eye"/g) ?? []).length).toBe(2);
    expect(BUNBU_ART.teeth).toHaveLength(5);
    expect(BUNBU_SILHOUETTE).toContain(BUNBU_ART.body);
    // the teeth hang from the lip: the curve's ends and its lowest point
    expect(bunbuLipY(39.5)).toBeCloseTo(61.2, 5);
    expect(bunbuLipY(50)).toBeGreaterThan(62.5);
  });

  it("renders every skin at every size without broken values", () => {
    for (const skin of BUNBU_SKINS) {
      for (const size of [16, 24, 32, 44, 96, 256]) {
        const html = draw({ skin, size });
        expect(html, `${skin}@${size}`).not.toMatch(/NaN|undefined|url\(#\)/);
        expect(html).toContain(`data-bunbu-skin="${skin}"`);
        expect(html).toContain(`width="${size}"`);
      }
    }
  });

  it("keeps defs of two Bunbus on one page apart", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(BunbuMascot, { color: "mint", skin: "gold", size: 96 }), createElement(BunbuMascot, { color: "mint", skin: "gold", size: 96 })));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows each mood's face", () => {
    expect(draw({ mood: "sleeping" })).not.toContain('class="bunbu-eye"');
    expect(draw({ mood: "happy" })).toContain(BUNBU_ART.mouthWide);
    expect(draw({ mood: "speaking" })).toContain("bunbu-mood-speaking");
    expect(draw({ mood: "listening" })).toContain("bunbu-mood-listening");
  });

  it("holds still under reduced motion: no live effects, no action", () => {
    vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }) });
    const html = draw({ skin: "galaxy", size: 96, action: "earflop" });
    expect(html).not.toContain("skin-fx-live");
    expect(html).not.toContain("bunbu-act-earflop");
    expect(html).toContain('data-fx="full"');
  });

  it("stops every part's motion in the CSS too", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("./bunbu-mascot.css", import.meta.url), "utf8");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const part of ["bunbu-body", "bunbu-ear", "bunbu-arm", "bunbu-eye", "bunbu-mouth"]) expect(block).toContain(`.${part}`);
    expect(block).toContain("animation: none");
  });

  it("is drawn by BotAvatar for a bot wearing it", () => {
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { name: "Bun", color: "mint", mascotLook: { character: "bunbu", skins: { bunbu: "neon" } } }, size: 44 }));
    expect(html).toContain('data-bunbu-skin="neon"');
  });
});

describe("Bunbu on the desktop and in the popover", () => {
  it("is in the registry with its moves, the signature ear flop among them", () => {
    const entry = mascotFor({ character: "bunbu" });
    expect(entry.id).toBe("bunbu");
    expect(entry.capabilities.wings).toBe(false);
    expect(entry.moves).toEqual(["wave", "dance", "jump", "hop", "love", BUNBU_EARFLOP_CLIP]);
    expect(entry.moveLabels?.[BUNBU_EARFLOP_CLIP]).toBe("floatingBots.move.earFlop");
    expect(MASCOTS.filter((item) => item.id === "bunbu")).toHaveLength(1);
  });

  it("maps the desktop clips to its face and its ears and arms", () => {
    expect(bunbuMoodFor("sleep", "idle")).toBe("sleeping");
    expect(bunbuMoodFor("idle", "speak")).toBe("speaking");
    expect(bunbuMoodFor("idle", "alert")).toBe("listening");
    expect(bunbuMoodFor("think", "idle")).toBe("thinking");
    expect(bunbuActionFor("ruffle")).toBe("earflop");
    expect(bunbuActionFor("preen")).toBe("earflop");
    expect(bunbuActionFor("wave")).toBe("wave");
    expect(bunbuActionFor("drag")).toBe("drag");
    expect(bunbuActionFor("fly")).toBe("hop");
    expect(bunbuActionFor("walk")).toBe("walk");
    expect(bunbuActionFor("idle")).toBeNull();
  });

  it("offers its colors, skins by rarity and moves in the Appearance gallery", () => {
    resetAchievementsForTests({ unlocks: NOTHING_LOCKED });
    const render = (look: unknown, initialTab: "mascot" | "color" | "skin" = "skin") => renderToStaticMarkup(createElement(MascotLookEditor, { bot: { color: "mint", mascotSkin: "none", mascotLook: botMascotLook(look) }, onPatch: () => undefined, initialTab }));
    const html = render({ character: "bunbu" });
    expect(render({ character: "bunbu" }, "mascot")).toContain('data-character-option="bunbu"');
    expect(html).toContain('data-character-options="bunbu"');
    expect(render({ character: "bunbu" }, "color")).toContain("data-color-tabs");
    for (const skin of ["plain", "pastel", "night", "plush"]) expect(html).toContain(`data-bunbu-skin-option="${skin}"`);
    for (const skin of BUNBU_SKINS) expect(render({ character: "bunbu", skins: { bunbu: skin } })).toContain(`data-bunbu-skin-option="${skin}"`);
    // no moves menu on the page (#4076): the stage plays Bunbu's own moves
    expect(html).not.toContain("data-character-move");
    const moves = characterMoves(botMascotLook({ character: "bunbu" }));
    expect(moves.map((move) => move.clip)).toContain(BUNBU_EARFLOP_CLIP);
    expect(moves.map((move) => move.id)).not.toContain("spread-wings");
    expect(en["floatingBots.move.earFlop"]).toBeTruthy();
  });

  it("is offered as an app icon", () => {
    const bunbu = APP_ICON_CHOICES.filter((choice) => choice.art.kind === "bunbu");
    expect(bunbu.map((choice) => choice.id)).toEqual(["bunbu:plain", "bunbu:holo"]);
  });
});
