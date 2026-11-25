import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAllBakedStills } from "../shape-stills";
import { NOTHING_LOCKED } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BotAvatar } from "@/components/Avatar";
import { OwlAvatar } from "@/components/OwlAvatar";
import { owlFxPalette } from "@/components/OwlSkinFx";
import { owlPalette } from "@/lib/owl/owl-art";
import { owlSkinPalette } from "@/lib/owl/owl-skins";
import { MAUS_COLORS } from "@/lib/mascot";
import { contrastRatio, eyeInkOn, MASCOT_COLOR_GROUPS, MASCOT_COLOR_HEX, MASCOT_COLOR_NAMES, MASCOT_COLOR_PALETTES, mascotColorGroup, mascotColorsIn } from "../../../shared/mascot-colors";
import { botMascotLook, CRAB_SKIN_TIER, CRAB_SKINS, MASCOT_SHAPES, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS } from "../../../shared/mascot-look";
import { botMascotSkin, LEGACY_OWL_SKINS, MASCOT_SKIN_IDS, mascotSkinSchema, OWL_SKIN_TIER } from "../../../shared/mascot-skins";
import { parseBotProfilePatch } from "../../../server/bots/bot-profile";
import MascotPicker, { QUICK_COLOR_LABEL } from "./MascotPicker";
import { OWL_SKIN_LABEL, SKIN_TIER_LABEL } from "./mascot-look-labels";
import { SKIN_TIERS, skinTierTabs } from "./editor-tabs";

// the shapes' baked stills, as a page loads them the first time a shape shows (#4145)
beforeAll(() => loadAllBakedStills());

beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));

/**
 * The mascot picker (#5369) on a bot, its skins list open: the whole panel.
 * It stands where the editor's seven tabs stood [M-20261125-064]; the
 * expectations below that described those tabs say what the validated
 * mock-up asks instead, each with its id.
 */
const render = (bot: { color?: string; mascotSkin?: string; mascotLook?: unknown }) =>
  renderToStaticMarkup(
    createElement(MascotPicker, {
      bot: { color: (bot.color ?? "blue") as never, mascotSkin: (bot.mascotSkin ?? "none") as never, mascotLook: botMascotLook(bot.mascotLook) },
      onPatch: () => undefined,
      initialLayer: "skins",
    }),
  );
/** The skins list's cards under one rarity. */
const tierGroup = (html: string, tier: string) => {
  const from = html.indexOf(`data-skin-tier-group="${tier}"`);
  if (from < 0) return "";
  const next = html.indexOf("data-skin-tier-group=", from + 1);
  return html.slice(from, next < 0 ? undefined : next);
};

describe("skin tabs", () => {
  it("groups each character's skins by rarity, with a count per tab", () => {
    const counts = (tabs: { tier: string; count: number }[]) => Object.fromEntries(tabs.map((tab) => [tab.tier, tab.count]));
    expect(counts(skinTierTabs(SHAPE_SKINS, SHAPE_SKIN_TIER))).toEqual({ common: 4, rare: 2, epic: 4, legendary: 3 });
    expect(counts(skinTierTabs(TROMBI_SKINS, TROMBI_SKIN_TIER))).toEqual({ common: 2, rare: 1, epic: 3, legendary: 2 });
    expect(counts(skinTierTabs(MASCOT_SKIN_IDS, OWL_SKIN_TIER))).toEqual({ common: 4, rare: 2, epic: 3, legendary: 4 });
    expect(counts(skinTierTabs(CRAB_SKINS, CRAB_SKIN_TIER))).toEqual({ common: 5, rare: 2, epic: 4, legendary: 3 });
    // every skin sits in exactly one tab, in the picker's order
    expect(skinTierTabs(SHAPE_SKINS, SHAPE_SKIN_TIER).flatMap((tab) => tab.skins)).toEqual([...SHAPE_SKINS]);
  });

  it("shows the current skin as worn under its rarity, and the first skin for an unknown one", () => {
    // [D-20261125-029] no rarity tab to open on: the list shows every rarity at once, the worn skin checked under its own
    const worn = (html: string, tier: string) => /aria-checked="true"[^>]*data-skin-option="([a-z-]+)"/.exec(tierGroup(html, tier))?.[1];
    expect(worn(render({ mascotLook: { character: "shape", skins: { shape: "galaxy" } } }), "legendary")).toBe("galaxy");
    expect(worn(render({ mascotLook: { character: "trombi", skins: { trombi: "gold" } } }), "rare")).toBe("gold");
    expect(worn(render({ mascotSkin: "spirit" }), "legendary")).toBe("spirit");
    expect(worn(render({ mascotLook: { character: "shape", skins: { shape: "plasma" } } }), "common")).toBe(SHAPE_SKINS[0]);
    expect(worn(render({ mascotLook: { character: "shape" } }), "common")).toBe(SHAPE_SKINS[0]);
    // one skin worn, never two
    expect(render({ mascotLook: { character: "shape", skins: { shape: "galaxy" } } }).match(/aria-checked="true"[^>]*data-skin-option=/g)).toHaveLength(1);
  });

  it("hides a rarity with no skin", () => {
    const tabs = skinTierTabs(["a", "b"] as const, { a: "common", b: "epic" });
    expect(tabs.map((tab) => tab.tier)).toEqual(["common", "epic"]);
    expect(SKIN_TIERS).toEqual(["common", "rare", "epic", "legendary"]);
  });

  // [D-20261125-029] "moves between tabs with the arrow keys, Home and End" is not ported: the rarity
  // tabs it moved across (and the palette tabs) left the screen, the skins are one list. The picker's own
  // two tabs move with the arrow keys (MascotPicker.dom.test.ts, "switches tabs with the arrow keys").

  it("renders every rarity at once, each headed by its name and count, every skin under its own", () => {
    // [D-20261125-029] one list in place of one rarity tab at a time
    const html = render({ mascotLook: { character: "shape", skins: { shape: "neon" } } });
    expect([...html.matchAll(/data-skin-tier-group="([a-z]+)"/g)].map((match) => match[1])).toEqual([...SKIN_TIERS]);
    expect(tierGroup(html, "epic")).toMatch(/<span>Epic<\/span><span[^>]*>4<\/span>/);
    expect(tierGroup(html, "epic")).toMatch(/aria-checked="true"[^>]*data-skin-option="neon"/);
    for (const skin of SHAPE_SKINS) {
      for (const tier of SKIN_TIERS) {
        if (SHAPE_SKIN_TIER[skin] === tier) expect(tierGroup(html, tier), skin).toContain(`data-skin-option="${skin}"`);
        else expect(tierGroup(html, tier), skin).not.toContain(`data-skin-option="${skin}"`);
      }
    }
    expect(tierGroup(render({ mascotSkin: "galaxy" }), "legendary")).toMatch(/aria-checked="true"[^>]*data-skin-option="galaxy"/);
    expect(tierGroup(render({ mascotLook: { character: "trombi", skins: { trombi: "glitch" } } }), "epic")).toMatch(/aria-checked="true"[^>]*data-skin-option="glitch"/);
  });

  it("has English and French names for the rarities, the owl skins and the picker's colours", () => {
    // [D-20261125-028] the palettes' names and the rarity tabs' labels left with their tabs; the colour row's eleven names took their place
    for (const key of [...Object.values(SKIN_TIER_LABEL), ...Object.values(OWL_SKIN_LABEL), ...Object.values(QUICK_COLOR_LABEL), "mascotPicker.color.custom", "mascotPicker.color.reset", "mascot.skin.title"]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
    expect(fr["mascot.tier.epic"]).toBe("Épique");
    expect(fr["mascot.tier.legendary"]).toBe("Légendaire");
    expect(fr["mascotPicker.color.teal"]).toBe("Sarcelle");
  });
});

describe("color palettes", () => {
  it("keeps every stored color id, each in exactly one palette", () => {
    const original = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "white", "black", "brown", "amber", "grey"];
    expect(MASCOT_COLOR_NAMES.slice(0, 15)).toEqual(original);
    for (const name of original) expect(MASCOT_COLOR_HEX[name as never], name).toBe(MAUS_COLORS[name as never]);
    for (const name of ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "amber"]) expect(mascotColorGroup(name)).toBe("vivid");
    for (const name of ["white", "black", "brown", "grey"]) expect(mascotColorGroup(name)).toBe("neutral");
    const all = MASCOT_COLOR_GROUPS.flatMap((group) => mascotColorsIn(group));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...MASCOT_COLOR_NAMES].sort());
  });

  it("offers ten to twelve distinct colors per palette", () => {
    for (const group of MASCOT_COLOR_GROUPS) {
      const count = Object.keys(MASCOT_COLOR_PALETTES[group]).length;
      expect(count, group).toBeGreaterThanOrEqual(10);
      expect(count, group).toBeLessThanOrEqual(12);
    }
    const values = Object.values(MASCOT_COLOR_HEX).map((hex) => hex.toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });

  it("keeps a color of any palette on the bot and shows it on the free colour ring; a quick colour is pressed", () => {
    // [D-20261125-028] [M-20261125-061] no palette tab to open on: the 63 colours left the screen for the row of
    // eleven, the free colour and the way back; a bot wearing one of the older colours keeps it and sees it
    expect(mascotColorGroup("mint")).toBe("pastel");
    expect(mascotColorGroup("navy")).toBe("deep");
    expect(mascotColorGroup("volt")).toBe("neon");
    expect(mascotColorGroup("black")).toBe("neutral");
    expect(mascotColorGroup("chartreuse")).toBe("vivid");
    expect(mascotColorGroup(undefined)).toBe("vivid");
    for (const color of ["lavender", "mint", "navy", "volt", "black"] as const) {
      const html = render({ color });
      expect(html, color).toMatch(/data-on="" data-mascot-color-custom=""/);
      expect(html.toLowerCase(), color).toContain(`value="${MASCOT_COLOR_HEX[color].toLowerCase()}"`);
      expect(html, color).not.toMatch(/data-mascot-color="[a-z]+"[^>]*aria-pressed="true"/);
      expect(html.match(/data-mascot-color="/g), color).toHaveLength(11);
    }
    const quick = render({ color: "teal" });
    expect(quick).toMatch(/data-mascot-color="teal"[^>]*aria-label="Teal"[^>]*aria-pressed="true"/);
    expect(quick).not.toMatch(/data-on="" data-mascot-color-custom=""/);
    expect(quick).not.toContain("data-color-panel");
  });

  it("keeps a shape's eyes readable on every color (3:1 at least)", () => {
    for (const name of MASCOT_COLOR_NAMES) {
      const hex = MASCOT_COLOR_HEX[name];
      expect(contrastRatio(hex, eyeInkOn(hex)), name).toBeGreaterThanOrEqual(3);
    }
    // a shape's eyes are two opaque bars in their own ink (light on a dark body), on any body color (the engine's still, #4145)
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "midnight", mascotLook: { character: "shape" } } as never, size: 40 }));
    const still = decodeURIComponent(/<img src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(html)?.[1] ?? "");
    expect(still.match(new RegExp(`<rect [^>]*fill="${eyeInkOn(MASCOT_COLOR_HEX.midnight)}"`, "gi"))).toHaveLength(2);
  });

  it("keeps the owl's eye readable in its socket on every color and skin", () => {
    for (const name of MASCOT_COLOR_NAMES) {
      const hex = MASCOT_COLOR_HEX[name];
      for (const skin of MASCOT_SKIN_IDS) {
        const palette = owlSkinPalette(skin, owlPalette(hex), hex);
        expect(contrastRatio(palette.iris, palette.socket), `${name} ${skin}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(palette.iris, palette.pupil), `${name} ${skin}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("owl skins by rarity", () => {
  it("has a rarity for every owl skin, and keeps every old id", () => {
    expect(Object.keys(OWL_SKIN_TIER).sort()).toEqual([...MASCOT_SKIN_IDS].sort());
    for (const id of ["none", "lightning", "gold", "neon", "inferno", "frost", "carbon"]) expect(botMascotSkin(id)).toBe(id);
    expect(MASCOT_SKIN_IDS[0]).toBe("none");
  });

  it("migrates other names to the current id, on read and through the server", () => {
    expect(botMascotSkin("molten")).toBe("inferno");
    expect(botMascotSkin("holographic")).toBe("holo");
    expect(botMascotSkin("ice")).toBe("frost");
    expect(botMascotSkin("ghost")).toBe("spirit");
    expect(botMascotSkin("plasma")).toBe("none");
    for (const [alias, id] of Object.entries(LEGACY_OWL_SKINS)) {
      expect(mascotSkinSchema.parse(alias)).toBe(id);
      expect(parseBotProfilePatch({ mascotSkin: alias } as never, true)).toEqual({ ok: true, patch: { mascotSkin: id } });
    }
    expect(parseBotProfilePatch({ mascotSkin: "plasma" } as never, true).ok).toBe(false);
  });

  it("draws every owl skin with the same eye, live when large, still when small", () => {
    const eye = (html: string) => html.match(/<circle data-part="iris" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/)?.slice(1).join(",");
    const plain = eye(renderToStaticMarkup(createElement(OwlAvatar, { color: "blue", size: 112, animated: false })));
    for (const skin of MASCOT_SKIN_IDS) {
      const big = renderToStaticMarkup(createElement(OwlAvatar, { color: "blue", skin, size: 112, skinAnimated: true, animated: false }));
      expect(eye(big), skin).toBe(plain);
      if (skin === "none") continue;
      expect(big).toContain(`data-owl-skin="${skin}" data-owl-fx="live"`);
      const small = renderToStaticMarkup(createElement(OwlAvatar, { color: "blue", skin, size: 24, animated: false }));
      expect(small).toContain('data-owl-fx="still"');
      expect(small).not.toContain('data-part="skinFront"');
    }
  });

  it("gives every premium owl skin its own idle layers and its own effect palette", () => {
    for (const skin of MASCOT_SKIN_IDS.filter((id) => OWL_SKIN_TIER[id] !== "common")) {
      const html = renderToStaticMarkup(createElement(OwlAvatar, { color: "green", skin, size: 112, skinAnimated: true, animated: false }));
      expect(html, skin).toMatch(/data-part="skin(Plumage|Front|Back)"/);
      expect(html).toMatch(/class="owl-fx-/);
    }
    const palettes = new Set(MASCOT_SKIN_IDS.filter((id) => OWL_SKIN_TIER[id] !== "common").map((id) => JSON.stringify(owlFxPalette(id, MAUS_COLORS.green))));
    expect(palettes.size).toBe(MASCOT_SKIN_IDS.filter((id) => OWL_SKIN_TIER[id] !== "common").length);
  });

  it("shows the owl's skins as rarity cards with their animated preview", () => {
    const html = render({ mascotSkin: "holo" });
    // [D-20261125-029] the cards are the rows of the pill's skins list
    expect(html).toMatch(/data-skin-option="holo" data-tier="legendary"/);
    expect(html).toContain('aria-checked="true" aria-label="Holographic, Legendary"');
    expect(html).toMatch(/data-owl-skin="spirit" data-owl-fx="live"/);
  });
});

describe("Shape grid thumbnails", () => {
  it("preview the current color and skin, still and cheap, on every shape", () => {
    for (const [color, skin] of [["coral", "galaxy"], ["mint", "plain"], ["navy", "neon"]] as const) {
      const html = render({ color, mascotLook: { character: "shape", shape: "cloud", skins: { shape: skin } } });
      const thumbs = [...html.matchAll(/data-character-shape="([a-z-]+)"[^>]*>(<span[^>]*>)/g)];
      expect(thumbs.map((match) => match[1])).toEqual([...MASCOT_SHAPES]);
      for (const [, shape, span] of thumbs) {
        expect(span, shape).toContain(`data-shape="${shape}"`);
        expect(span).toContain(`data-shape-skin="${skin}"`);
        expect(span).toContain('data-fx="static"');
        expect(span).not.toContain("skin-fx-live");
      }
    }
    // the body is the bot's own colour, one flat fill: each tile is the engine's still in it (#4145)
    const plain = render({ color: "mint", mascotLook: { character: "shape", skins: { shape: "plain" } } });
    const grid = plain.slice(plain.indexOf("data-character-shape"), plain.indexOf("data-mascot-picker-pills"));
    const stills = [...grid.matchAll(/<img src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g)].map((m) => decodeURIComponent(m[1]!));
    expect(stills).toHaveLength(MASCOT_SHAPES.length);
    for (const still of stills) expect(still.toLowerCase()).toContain(`fill="${MASCOT_COLOR_HEX.mint.toLowerCase()}"`);
  });
});
