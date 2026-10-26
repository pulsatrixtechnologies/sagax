import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
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
import { parseBotProfilePatch } from "../../../server/bot-profile";
import MascotLookEditor, { COLOR_GROUP_LABEL, OWL_SKIN_LABEL } from "./MascotLookEditor";
import { colorTabFor, colorTabs, nextTab, SKIN_TIERS, skinTabFor, skinTierTabs } from "./editor-tabs";

beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));

const render = (bot: { color?: string; mascotSkin?: string; mascotLook?: unknown }) =>
  renderToStaticMarkup(
    createElement(MascotLookEditor, {
      bot: { color: (bot.color ?? "blue") as never, mascotSkin: (bot.mascotSkin ?? "none") as never, mascotLook: botMascotLook(bot.mascotLook) },
      onPatch: () => undefined,
    }),
  );

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

  it("opens on the current skin's rarity, and on the first tab for an unknown one", () => {
    expect(skinTabFor("galaxy", SHAPE_SKINS, SHAPE_SKIN_TIER)).toBe("legendary");
    expect(skinTabFor("gold", TROMBI_SKINS, TROMBI_SKIN_TIER)).toBe("rare");
    expect(skinTabFor("spirit", MASCOT_SKIN_IDS, OWL_SKIN_TIER)).toBe("legendary");
    expect(skinTabFor("plasma" as never, SHAPE_SKINS, SHAPE_SKIN_TIER)).toBe("common");
    expect(skinTabFor(null, SHAPE_SKINS, SHAPE_SKIN_TIER)).toBe("common");
  });

  it("hides a rarity with no skin", () => {
    const tabs = skinTierTabs(["a", "b"] as const, { a: "common", b: "epic" });
    expect(tabs.map((tab) => tab.tier)).toEqual(["common", "epic"]);
    expect(skinTabFor("b", ["a", "b"] as const, { a: "common", b: "epic" })).toBe("epic");
  });

  it("moves between tabs with the arrow keys, Home and End", () => {
    expect(nextTab(SKIN_TIERS, "common", "ArrowRight")).toBe("rare");
    expect(nextTab(SKIN_TIERS, "common", "ArrowLeft")).toBe("legendary");
    expect(nextTab(SKIN_TIERS, "legendary", "ArrowRight")).toBe("common");
    expect(nextTab(SKIN_TIERS, "epic", "Home")).toBe("common");
    expect(nextTab(SKIN_TIERS, "rare", "End")).toBe("legendary");
    expect(nextTab(SKIN_TIERS, "rare", "Enter")).toBeNull();
  });

  it("renders the open tab only, selected and labelled with its count", () => {
    const html = render({ mascotLook: { character: "shape", skins: { shape: "neon" } } });
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*aria-label="Epic, 4 skins"[^>]*data-tab="epic"/);
    expect(html).toContain('data-skin-panel="epic"');
    for (const skin of SHAPE_SKINS) {
      if (SHAPE_SKIN_TIER[skin] === "epic") expect(html).toContain(`data-shape-skin-option="${skin}"`);
      else expect(html).not.toContain(`data-shape-skin-option="${skin}"`);
    }
    expect(render({ mascotSkin: "galaxy" })).toContain('data-skin-panel="legendary"');
    expect(render({ mascotLook: { character: "trombi", skins: { trombi: "glitch" } } })).toContain('data-skin-panel="epic"');
  });

  it("has English and French names for the rarities, palettes and owl skins", () => {
    for (const key of [...Object.values(COLOR_GROUP_LABEL), ...Object.values(OWL_SKIN_LABEL), "mascot.tier.tabs", "mascot.tier.tab", "mascot.color.groups", "mascot.color.use"]) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
    expect(fr["mascot.tier.epic"]).toBe("Épique");
    expect(fr["mascot.tier.legendary"]).toBe("Légendaire");
    expect(fr["mascot.color.group.vivid"]).toBe("Vives");
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

  it("opens on the current color's palette; an unknown color opens Vivid", () => {
    expect(colorTabFor("mint")).toBe("pastel");
    expect(colorTabFor("navy")).toBe("deep");
    expect(colorTabFor("volt")).toBe("neon");
    expect(colorTabFor("black")).toBe("neutral");
    expect(colorTabFor("chartreuse")).toBe("vivid");
    expect(colorTabFor(undefined)).toBe("vivid");
    expect(colorTabs().map((tab) => tab.group)).toEqual([...MASCOT_COLOR_GROUPS]);
    const html = render({ color: "lavender" });
    expect(html).toContain('data-color-panel="pastel"');
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Use lavender mascot color"/);
    expect(html).not.toContain('data-mascot-color="green"');
  });

  it("keeps a shape's eyes readable on every color (3:1 at least)", () => {
    for (const name of MASCOT_COLOR_NAMES) {
      const hex = MASCOT_COLOR_HEX[name];
      expect(contrastRatio(hex, eyeInkOn(hex)), name).toBeGreaterThanOrEqual(3);
    }
    // a shape's eyes are two opaque capsules in their own ink (light on a dark body), on any body color
    const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "midnight", mascotLook: { character: "shape" } } as never, size: 40 }));
    expect(html).toMatch(/<path d="M[^"M]+M[^"M]+" fill="#f4f1ea"[^>]*data-shape-eyes=""/);
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
    expect(html).toMatch(/data-tier="legendary"[^>]*data-mascot-skin-option="holo"/);
    expect(html).toContain('aria-checked="true" aria-label="Holographic, Legendary"');
    expect(html).toMatch(/data-owl-skin="spirit" data-owl-fx="live"/);
  });
});

describe("Shape grid thumbnails", () => {
  it("preview the current color and skin, still and cheap, on every shape", () => {
    for (const [color, skin] of [["coral", "galaxy"], ["mint", "plain"], ["navy", "neon"]] as const) {
      const html = render({ color, mascotLook: { character: "shape", shape: "cloud", skins: { shape: skin } } });
      const thumbs = [...html.matchAll(/data-character-shape="([a-z]+)"[^>]*>(<span[^>]*>)/g)];
      expect(thumbs.map((match) => match[1])).toEqual([...MASCOT_SHAPES]);
      for (const [, shape, span] of thumbs) {
        expect(span, shape).toContain(`data-shape="${shape}"`);
        expect(span).toContain(`data-shape-skin="${skin}"`);
        expect(span).toContain('data-fx="static"');
        expect(span).not.toContain("skin-fx-live");
      }
    }
    // the body is the bot's own colour, one flat fill (2026-10-18: no clay gradient any more)
    const plain = render({ color: "mint", mascotLook: { character: "shape", skins: { shape: "plain" } } });
    const grid = plain.slice(plain.indexOf("data-character-shape"), plain.indexOf("data-color-tabs"));
    expect(grid.match(new RegExp(`class="shape-fill" d="[^"]+" fill-rule="evenodd" data-shape-outline="" fill="${MASCOT_COLOR_HEX.mint}"`, "gi"))?.length).toBe(MASCOT_SHAPES.length);
  });
});
