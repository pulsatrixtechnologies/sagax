// The mascot picker as it is drawn (#5369): two tabs, a grid with the worn
// mascot outlined, the "+" at the end of the shapes, icon pills with a name
// on every icon, the colour row, and nothing greyed for a character that
// does not take a control.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAchievementsForTests } from "@/lib/achievements";
import { loadLocale } from "@/lib/i18n";
import { resetMaterialSupport } from "@/components/shape-material";
import { LOCKED_UNTIL_LOADED, NOTHING_LOCKED } from "../../../shared/achievements";
import { botMascotLook, MASCOT_SHAPES } from "../../../shared/mascot-look";
import MascotPicker, { type MascotPickerProps } from "./MascotPicker";

const render = (mascotLook: unknown, extra: Partial<MascotPickerProps> = {}, color = "green") =>
  renderToStaticMarkup(createElement(MascotPicker, { bot: { name: "Ada", color: color as never, mascotSkin: "none", mascotLook: botMascotLook(mascotLook) }, onPatch: () => undefined, ...extra }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeEach(async () => {
  await loadLocale("en");
  resetAchievementsForTests({ unlocks: NOTHING_LOCKED });
  resetMaterialSupport(true);
});
afterEach(() => resetMaterialSupport(null));

describe("the mascot picker", () => {
  it("has two tabs and opens on the one the bot's character sits under", () => {
    const shapes = render({ character: "shape", shape: "cup" });
    expect(count(shapes, 'role="tab"')).toBe(2);
    expect(shapes).toContain('data-mascot-picker-grid="shapes"');
    expect(shapes).toMatch(/data-mascot-picker-tab="shapes"[^>]*aria-selected="true"/);
    expect(render({ character: "frog" })).toContain('data-mascot-picker-grid="characters"');
  });

  it("draws every shape once, the worn one pressed, and ends with the plus", () => {
    const html = render({ character: "shape", shape: "cup" });
    expect(count(html, "data-character-shape=")).toBe(MASCOT_SHAPES.length);
    expect(html).toMatch(/data-character-shape="cup"[^>]*aria-pressed="true"/);
    expect(count(html, 'aria-pressed="true"')).toBe(2); // the cup, and its colour
    expect(html.lastIndexOf("data-mascot-add-open")).toBeGreaterThan(html.lastIndexOf("data-character-shape="));
    expect(html).toContain('aria-label="New shape"');
  });

  it("draws the eight characters under Characters, never the shapes entry, a locked one with its padlock and what unlocks it", () => {
    resetAchievementsForTests({ unlocks: LOCKED_UNTIL_LOADED });
    const html = render({ character: "frog" });
    expect(html).not.toContain('data-character-option="shape"');
    expect(html).toMatch(/data-character-option="frog"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-character-option="bunbu"[^>]*data-locked=""/);
    expect(html).toContain("unlock-lock");
    // Trombi is out until found
    expect(html).not.toContain('data-character-option="trombi"');
    expect(render({ character: "trombi" })).toContain('data-character-option="trombi"');
  });

  it("gives a shape the material and mood pills as icons with names, and no text label", () => {
    const html = render({ character: "shape", shape: "cup", material: "glass", mood: "happy" });
    for (const name of ["Flat", "Fluffy", "Glass", "Neutral", "Happy", "Skin"]) expect(html).toContain(`aria-label="${name}"`);
    expect(html).toMatch(/aria-checked="true" aria-label="Glass"/);
    expect(html).toMatch(/aria-checked="false" aria-label="Flat"/);
    expect(html).toMatch(/aria-checked="true" aria-label="Happy"/);
    const from = html.indexOf(">", html.indexOf("data-mascot-picker-pills")) + 1;
    const pills = html.slice(from, html.lastIndexOf("<", html.indexOf("data-mascot-picker-colors")));
    expect(pills.replace(/<[^>]*>/g, "").trim()).toBe("");
    expect(html).toContain("data-mascot-picker-gear");
  });

  it("hides what a character does not take, never greys it", () => {
    const frog = render({ character: "frog" });
    expect(frog).not.toContain("data-option=");
    expect(frog).not.toContain("data-mascot-mood");
    expect(frog).not.toContain("data-mascot-picker-gear");
    expect(frog).toContain("data-mascot-skins-open");
    expect(frog).toContain("data-mascot-picker-colors");
    expect(render({ character: "trombi" })).not.toContain("data-mascot-picker-colors");
    // a device that cannot paint a material: no material segment at all
    resetMaterialSupport(false);
    const flatOnly = render({ character: "shape", shape: "cup" });
    expect(flatOnly).not.toContain('data-option="fluffy"');
    expect(flatOnly).toContain("data-mascot-skins-open");
    expect(flatOnly).not.toContain("aria-disabled");
    // the one control at rest: the way back, while the colour has not changed
    expect(count(flatOnly, 'disabled=""')).toBe(1);
  });

  it("offers eleven quick colours, the free colour and the way back, a legacy colour kept on the ring", () => {
    const html = render({ character: "shape", shape: "cup" });
    expect(count(html, "data-mascot-color=")).toBe(11);
    expect(html).toMatch(/data-mascot-color="green"[^>]*aria-pressed="true"/);
    expect(html).toContain('type="color"');
    expect(html).toMatch(/data-mascot-color-reset=""[^>]*disabled/);
    const legacy = render({ character: "shape", shape: "cup" }, {}, "lavender");
    expect(legacy).not.toMatch(/data-mascot-color="[a-z]+"[^>]*aria-pressed="true"/);
    expect(legacy).toMatch(/data-on="" data-mascot-color-custom=""/);
    expect(legacy.toLowerCase()).toContain("#c3aaee");
  });

  it("says it all in French too", async () => {
    await loadLocale("fr");
    const html = render({ character: "shape", shape: "cup" });
    for (const text of ["Formes", "Personnages", 'aria-label="Peluche"', 'aria-label="Verre"', 'aria-label="Joyeuse"', 'aria-label="Sarcelle"', 'aria-label="Couleur libre"', 'aria-label="Nouvelle forme"', 'aria-label="Réglages"']) expect(html).toContain(text);
    expect(html).not.toMatch(/[–—]/);
  });

  it("the gear's panel and the plus panel open on what the upstream picker offers", () => {
    const gear = render({ character: "shape", shape: "cup" }, { initialLayer: "gear" });
    expect(gear).toContain("Eyes follow the pointer");
    expect(gear).toContain("Follows your device");
    for (const option of ["system", "reduced", "full"]) expect(gear).toContain(`data-mascot-motion-option="${option}"`);
    const add = render({ character: "shape", shape: "cup" }, { initialLayer: "add" });
    expect(add).toContain("data-mascot-add-import");
    expect(add).not.toContain("data-mascot-add-generate");
    expect(render({ character: "shape", shape: "cup" }, { initialLayer: "add", onGenerate: async () => "" })).toContain("data-mascot-add-generate");
  });

  it("lists a shape's skins by rarity, a locked one with its padlock and the line that names its achievement", () => {
    resetAchievementsForTests({ unlocks: LOCKED_UNTIL_LOADED });
    const html = render({ character: "shape", shape: "cup" }, { initialLayer: "skins" });
    for (const tier of ["common", "rare", "epic", "legendary"]) expect(html).toContain(`data-skin-tier-group="${tier}"`);
    expect(html).toMatch(/aria-checked="true"[^>]*data-skin-option="plain"/);
    expect(html).toMatch(/data-skin-option="gold"[^>]*data-locked=""/);
    expect(html).toContain("data-skin-unlock-hint");
  });
});
