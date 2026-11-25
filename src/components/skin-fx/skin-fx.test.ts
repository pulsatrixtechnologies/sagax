import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOCKED_UNTIL_LOADED, NOTHING_LOCKED } from "../../../shared/achievements";
import { resetAchievementsForTests } from "@/lib/achievements";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BotAvatar } from "@/components/Avatar";
import { ShapeMascot } from "@/components/ShapeMascot";
import { loadBakedStill } from "@/components/shape-stills";
import { botMascotLook, completeMascotLook, LEGACY_SHAPE_SKINS, LEGACY_TROMBI_SKINS, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS } from "../../../shared/mascot-look";
import MascotHero from "../floating-bots/MascotHero";
import MascotPicker from "../floating-bots/MascotPicker";
import { SKIN_TIER_LABEL } from "../floating-bots/mascot-look-labels";
import { SkinnedTrombi } from "./SkinnedTrombi";
import { fxDetail, fxMoveFor, FX_FULL_MIN } from "./skin-fx";
import { MoveFx } from "./SkinFx";
import { fxPalette } from "./skin-fx";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "skin-fx.css"), "utf8").replace(/\r\n/g, "\n");
/**
 * A shape's eyes as the engine draws them on its body (#4145): each mark's
 * place and size, from the shared still image or the body of the SVG (a
 * skin draws the same eyes again over its face).
 */
const eyeCuts = (html: string) => {
  const url = /<img src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(html)?.[1];
  const body = url ? decodeURIComponent(url) : html.slice(html.indexOf('data-shape-body=""'), html.includes("data-shape-skin-face") ? html.indexOf("data-shape-skin-face") : undefined);
  return [...body.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map((m) => m.slice(1).join(" "));
};
// the shapes' baked stills, as a page loads them the first time a shape shows
beforeAll(async () => {
  await Promise.all((["hexagon", "circle"] as const).map(loadBakedStill));
});
const shape = (skin: string, size: number, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "blue", mascotLook: { character: "shape", shape: "hexagon", skins: { shape: skin } } } as never, size, ...extra }));
const trombi = (skin: string, size: number, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "blue", mascotLook: { character: "trombi", skins: { trombi: skin } } } as never, size, ...extra }));

describe("premium skins render at every size", () => {
  it("draws every shape skin full when large and animated, still (no filter, nothing live) when small", () => {
    for (const skin of SHAPE_SKINS) {
      const big = shape(skin, 112);
      expect(big, skin).toContain(`data-shape-skin="${skin}"`);
      expect(big).toContain(`data-skin-tier="${SHAPE_SKIN_TIER[skin]}"`);
      expect(big).toContain('data-fx="full"');
      expect(big).toContain("skin-fx-live");
      expect(eyeCuts(big)).toHaveLength(2);
      const small = shape(skin, 24);
      expect(small).toContain('data-fx="static"');
      expect(small).not.toContain("skin-fx-live");
      expect(small).not.toContain("<filter");
      expect(small).not.toMatch(/class="fx-(boil|current|pulse|ember|heat|twinkle|glint)/);
      expect(eyeCuts(small)).toHaveLength(2);
      // a thumbnail (not animated) is still too
      expect(shape(skin, 112, { animated: false })).toContain('data-fx="static"');
    }
  });

  it("keeps the eyes identical on every skin: same cut-outs, same place", () => {
    const eyes = (skin: string) => eyeCuts(shape(skin, 60, { animated: false }));
    const plain = eyes("plain");
    expect(plain).toHaveLength(2);
    // a skin paints the body and its face, never the eyes' shape or place; the flat Outline skin keeps its own (no turn)
    for (const skin of SHAPE_SKINS) {
      expect(eyes(skin), skin).toHaveLength(2);
      if (skin !== "outline") expect(eyes(skin), skin).toEqual(plain);
    }
  });

  it("draws every Trombi skin, full when large, still when small, with his own eyes", () => {
    for (const skin of TROMBI_SKINS) {
      const big = trombi(skin, 112);
      expect(big, skin).toContain(`trombi-skin-${skin}`);
      expect(big).toContain(`data-skin-tier="${TROMBI_SKIN_TIER[skin]}"`);
      expect(big).toContain('data-fx="full"');
      expect((big.match(/data-part="eye-[LR]"/g) ?? []).length).toBe(2);
      const small = trombi(skin, 24);
      expect(small).toContain('data-fx="static"');
      expect(small).not.toContain("skin-fx-live");
    }
    // the desktop mascot and the skin cards ask for the full version at any size
    expect(renderToStaticMarkup(createElement(SkinnedTrombi, { skin: "molten", pose: "idle", size: 30, width: 24, detail: "full" }))).toContain('data-fx="full"');
    expect(fxDetail(FX_FULL_MIN - 1, true)).toBe("static");
    expect(fxDetail(FX_FULL_MIN, true)).toBe("full");
  });

  it("has a burst for every move, in the skin's colors", () => {
    for (const move of ["wave", "dance", "jump", "hop", "love", "hoot"] as const) {
      expect(fxMoveFor(move)).toBe(move);
      const html = renderToStaticMarkup(createElement(MoveFx, { move, palette: fxPalette("neon", "#377FE6"), uid: "t", path: "M0 0Z" }));
      expect(html).toContain(`fx-move-${move}`);
    }
    expect(fxMoveFor("idle")).toBeNull();
    // light trails only for the skins that leave them
    expect(renderToStaticMarkup(createElement(MoveFx, { move: "jump", palette: fxPalette("neon", "#377FE6"), uid: "t", path: "M0 0Z" }))).toContain("fx-ghost");
    expect(renderToStaticMarkup(createElement(MoveFx, { move: "jump", palette: fxPalette("gold", "#377FE6"), uid: "t", path: "M0 0Z" }))).not.toContain("fx-ghost");
  });
});

describe("reduced motion and flashing", () => {
  const saved = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = saved;
  });

  it("keeps the premium look but plays nothing under prefers-reduced-motion", () => {
    (globalThis as { window?: unknown }).window = { matchMedia: (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }) };
    const big = renderToStaticMarkup(createElement(ShapeMascot, { shape: "circle", skin: "galaxy", color: "blue", size: 112 }));
    expect(big).toContain('data-fx="full"');
    expect(big).not.toContain("skin-fx-live");
    const clip = renderToStaticMarkup(createElement(SkinnedTrombi, { skin: "glitch", pose: "idle", size: 112, width: 90 }));
    expect(clip).not.toContain("skin-fx-live");
  });

  it("stops every effect and the cards' shimmer in the CSS too", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain(".skin-fx-live *");
    expect(block).toContain(".skin-fx-overlay { display: none; }");
    expect(block).toContain(".skin-card::after");
    expect(css).toContain("[data-fx-paused] *");
  });

  it("never flashes more than three times a second", () => {
    const keyframes = (name: string) => css.slice(css.indexOf(`@keyframes ${name} {`), css.indexOf("}\n}", css.indexOf(`@keyframes ${name} {`)));
    // the neon flicker: two soft dips (never below 0.6) per five seconds
    const flicker = keyframes("fx-flicker");
    expect(css).toMatch(/\.fx-neon-flicker \{ animation: fx-flicker 5s/);
    const dips = [...flicker.matchAll(/opacity: ([\d.]+)/g)].map((m) => Number(m[1])).filter((value) => value < 1);
    expect(dips.length).toBeLessThanOrEqual(2);
    expect(Math.min(...dips)).toBeGreaterThanOrEqual(0.6);
    // the glitch moves its ghosts (no brightness change) at most 4 steps in 2.4 s
    expect(keyframes("fx-glitch-r")).not.toContain("opacity");
    expect(css).toMatch(/fx-glitch-r 2\.4s steps/);
  });
});

describe("the holographic foil glides without a seam", () => {
  const appCss = readFileSync(join(here, "../../styles.css"), "utf8");
  const owlFx = readFileSync(join(here, "../OwlSkinFx.tsx"), "utf8");
  const rule = (source: string, selector: string) => {
    const start = source.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("}", start));
  };
  const seconds = (text: string) => Number(/(\d+(?:\.\d+)?)s\b/.exec(text)?.[1]);

  it("plays every foil (shapes, Trombi) as a slow eased ping-pong, never a linear loop that snaps back", () => {
    for (const name of ["fx-foil", "fx-foil-diag", "fx-foil-rev"]) {
      const body = rule(css, `.skin-fx-live .${name}`);
      expect(body, name).toContain("ease-in-out");
      expect(body, name).toContain("alternate");
      expect(body, name).not.toContain("linear");
      expect(seconds(body), name).toBeGreaterThanOrEqual(6);
      expect(seconds(body), name).toBeLessThanOrEqual(10);
    }
    const large = rule(css, ".skin-fx-live .fx-foil-diag-lg");
    expect(seconds(large)).toBeGreaterThanOrEqual(6);
    expect(seconds(large)).toBeLessThanOrEqual(10);
  });

  it("glides the owl's foil the same way, over 6 to 10 seconds", () => {
    const body = rule(appCss, '[data-owl-fx="live"] .owl-fx-foil');
    expect(body).toContain("ease-in-out");
    expect(body).toContain("alternate");
    expect(body).not.toContain("linear");
    const duration = Number(/className="owl-fx-foil" style=\{anim\((\d+(?:\.\d+)?)\)/.exec(owlFx)?.[1]);
    expect(duration).toBeGreaterThanOrEqual(6);
    expect(duration).toBeLessThanOrEqual(10);
  });

  it("never animates a filter (hue-rotate repaints every frame and flickers)", () => {
    expect(css).not.toMatch(/hue-rotate/);
    expect(rule(appCss, "@keyframes owl-fx-foil")).not.toContain("filter");
    for (const name of ["fx-foil", "fx-foil-diag", "fx-foil-rev", "fx-foil-diag-lg", "fx-sweep"]) {
      expect(rule(css, `@keyframes ${name}`), name).not.toMatch(/filter|background-position/);
    }
  });

  it("keeps the drawing mounted through a move, so the idle loops never restart", () => {
    const shapeSource = readFileSync(join(here, "../ShapeMascot.tsx"), "utf8");
    const trombiSource = readFileSync(join(here, "SkinnedTrombi.tsx"), "utf8");
    for (const source of [shapeSource, trombiSource]) expect(source).not.toMatch(/key=\{burst && moveBody/);
    expect(trombiSource).toContain("useReplayMove(body");
    // the shape replays a skin move on its box, its drawing mounted through it (#4145)
    expect(shapeSource).toContain("useReplayMove(root");
  });

  it("renders the same markup twice (stable ids and classes, nothing that remounts the foil)", () => {
    const a = renderToStaticMarkup(createElement(ShapeMascot, { shape: "hexagon", skin: "holo", color: "blue", size: 112 }));
    const b = renderToStaticMarkup(createElement(ShapeMascot, { shape: "hexagon", skin: "holo", color: "blue", size: 112 }));
    expect(a).toBe(b);
    expect(a).toContain('class="fx-foil-diag"');
    expect(a).toContain('class="fx-foil-rev"');
  });
});

describe("no layer edges and no flash", () => {
  const appShape = (skin: (typeof SHAPE_SKINS)[number], size = 112) => renderToStaticMarkup(createElement(ShapeMascot, { shape: "hexagon", skin, color: "blue", size }));
  const keyframe = (name: string) => css.slice(css.indexOf(`@keyframes ${name} {`), css.indexOf("}\n}", css.indexOf(`@keyframes ${name} {`)));

  it("never masks a moving rectangle: the iridescent rims are the outline stroked in the foil", () => {
    for (const skin of SHAPE_SKINS) {
      for (const html of [appShape(skin), appShape(skin, 24)]) {
        expect(html, skin).not.toContain("<mask");
        expect(html, skin).not.toContain("mask=");
      }
    }
    expect(appShape("holo")).toMatch(/<path d="[^"]+" fill="none" stroke="url\(#[^)]+-foil\)" stroke-width="3.2"/);
  });

  it("crossfades into a new skin: no pop past full size, no bright frame", () => {
    const pop = keyframe("fx-equip-pop");
    expect(pop).toMatch(/0% \{ transform: scale\(0\.9\d\); opacity: 0\.\d+; \}/);
    expect(pop).not.toMatch(/scale\(1\.\d/);
    expect(keyframe("fx-ring")).toMatch(/0% \{[^}]*opacity: 0\.[0-7]/);
    for (const name of ["fx-ghost-y", "fx-ghost-x"]) {
      const peak = Math.max(...[...keyframe(name).matchAll(/opacity: ([\d.]+)/g)].map((m) => Number(m[1])));
      expect(peak, name).toBeLessThanOrEqual(0.35);
    }
  });

  it("keeps an app avatar's jump inside its own headroom", () => {
    const lift = Math.max(...[...keyframe("fx-body-jump").matchAll(/translateY\(-(\d+)%\)/g)].map((m) => Number(m[1])));
    expect(lift).toBeLessThanOrEqual(12);
  });
});

describe("skin ids persist and migrate", () => {
  it("maps older skin names to the current ids (the desktop window: electron/floating-bot-window.test.mjs)", () => {
    for (const [old, current] of Object.entries(LEGACY_SHAPE_SKINS)) {
      expect(botMascotLook({ character: "shape", skins: { shape: old } }).skins?.shape).toBe(current);
    }
    for (const [old, current] of Object.entries(LEGACY_TROMBI_SKINS)) {
      expect(botMascotLook({ character: "trombi", skins: { trombi: old } }).skins?.trombi).toBe(current);
    }
  });

  it("keeps every skin saved before the premium set", () => {
    for (const skin of ["plain", "glossy", "outline", "neon", "pastel", "night"]) expect(completeMascotLook({ character: "shape", skins: { shape: skin } }).skins.shape).toBe(skin);
    for (const skin of ["classic", "gold", "neon", "retro98"]) expect(completeMascotLook({ character: "trombi", skins: { trombi: skin } }).skins.trombi).toBe(skin);
  });

  it("drops a skin it does not know, never the character", () => {
    expect(botMascotLook({ character: "shape", shape: "cloud", skins: { shape: "plasma-9000", trombi: "gold" } })).toEqual({ character: "shape", shape: "cloud", skins: { trombi: "gold" } });
    expect(completeMascotLook({ character: "trombi", skins: { trombi: "future" } })).toMatchObject({ character: "trombi", skins: { trombi: "classic" } });
  });
});

describe("the mascot picker's layout", () => {
  beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));
  // This block described the layout of the Appearance editor (a preview band over its tabs). The mock-up the
  // owner validated replaced it with the mascot picker (#5369): each expectation about the old layout says what
  // the mock-up asks, with the id beside it.
  const render = (mascotLook: unknown, initialLayer?: "skins") =>
    renderToStaticMarkup(createElement(MascotPicker, { bot: { color: "blue", mascotSkin: "none", mascotLook: botMascotLook(mascotLook) }, onPatch: () => undefined, initialLayer }));

  it("has no preview band: the tabs, one grid under them, the pills, then the colours; the stage is the page's own mascot", () => {
    // [M-20261125-063] "faut pas avoir de visualisateur": the band over the tabs is gone, the bot's mascot above the panel is the preview
    const html = render({ character: "shape" });
    expect(html).not.toContain("data-character-row");
    expect(html).not.toContain("data-mascot-stage");
    expect(html).not.toContain("data-mascot-name");
    expect(html).not.toContain("data-mascot-action");
    // [M-20261125-064] the mock-up's order, top to bottom
    expect(html).toMatch(/data-mascot-picker-character="shape"[\s\S]*data-mascot-picker-tabs=""[\s\S]*data-mascot-picker-gear=""[\s\S]*data-mascot-picker-grid="shapes"[\s\S]*data-mascot-picker-pills=""[\s\S]*data-mascot-picker-colors=""/);
    // a fixed panel that the window's edge narrows (it was a 210px row from a 34rem pane, by a container query)
    expect(html).toContain("w-[440px] max-w-[calc(100vw-16px)]");
    expect(html).not.toContain("@[34rem]");
    // the stage: the page's hero, the mascot bare over the bot's name, nothing else under it (#4076)
    const hero = renderToStaticMarkup(createElement(MascotHero, { bot: { name: "Ada", color: "blue", mascotSkin: "none", mascotLook: botMascotLook({ character: "shape" }) } }));
    expect(hero).toMatch(/data-mascot-detail="shape"[\s\S]*data-mascot-stage=""[\s\S]*data-mascot-heading=""/);
    expect(hero).toMatch(/style="width:100px;height:100px"[^>]*class="relative grid shrink-0 place-items-center/);
    expect(hero).not.toContain("data-mascot-action");
    expect(hero).not.toContain("data-mascot-randomize");
  });

  it("keeps every grid cell the same box, locked or not, with no stray shadow", () => {
    // [M-20261125-064] the mock-up's grid, five to a row: one cell class and one thumbnail box for all (they were 112px tiles)
    resetAchievementsForTests({ unlocks: LOCKED_UNTIL_LOADED });
    const html = render({ character: "crab" });
    const tiles = html.match(/<button[^>]*data-character-option="[^"]+"[^>]*>(<span[^>]*>)/g) ?? [];
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.some((tile) => tile.includes('data-locked=""'))).toBe(true);
    expect(tiles.some((tile) => !tile.includes('data-locked=""'))).toBe(true);
    for (const tile of tiles) {
      expect(tile).toMatch(/class="mp-cell relative"/);
      expect(tile).toContain('style="width:52px;height:52px"');
    }
    expect(html).toContain("grid grid-cols-5");
    expect(html).not.toContain("blur-[3px]");
  });

  it("names the character Shapes (Formes), never Original shapes", () => {
    expect(en["floatingBots.mascot.body"]).toBe("Shapes");
    expect(fr["floatingBots.mascot.body"]).toBe("Formes");
    expect(render({ character: "shape" })).toContain(">Shapes<");
    expect(JSON.stringify(en)).not.toMatch(/Original shapes/i);
    expect(JSON.stringify(fr)).not.toMatch(/Formes originales/i);
  });

  it("shows each skin as a card with its rarity, previewing it animated, every rarity in one list", () => {
    // [D-20261125-029] the skins are the pill's list: all the rarities at once (it was one rarity's tab at a time)
    for (const skin of SHAPE_SKINS) {
      const html = render({ character: "shape", skins: { shape: skin } }, "skins");
      expect(html).toContain(`data-skin-option="${skin}" data-tier="${SHAPE_SKIN_TIER[skin]}"`);
      expect(html).toMatch(new RegExp(`aria-checked="true"[^>]*data-skin-option="${skin}"`));
      const cards = html.match(/data-skin-option="/g) ?? [];
      expect(cards.length).toBe(SHAPE_SKINS.length);
      // the list's cards play their skins (the grid's thumbnails never do)
      const panel = html.slice(html.indexOf("data-mascot-skins="));
      expect((panel.match(/skin-fx-live/g) ?? []).length).toBe(cards.length);
      expect(html.slice(0, html.indexOf("data-mascot-skins="))).not.toContain("skin-fx-live");
    }
    expect(render({ character: "shape", skins: { shape: "galaxy" } }, "skins")).toContain(">Legendary<");
    for (const skin of TROMBI_SKINS) expect(render({ character: "trombi", skins: { trombi: skin } }, "skins")).toMatch(new RegExp(`aria-checked="true"[^>]*data-skin-option="${skin}"`));
    for (const key of Object.values(SKIN_TIER_LABEL)) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });
});
