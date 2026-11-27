import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAllBakedStills } from "../shape-stills";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { resetAchievementsForTests } from "@/lib/achievements";
import { forgetLegacyBotLooks, readLegacyBotLooks, type FloatingStorage } from "@/lib/floating-bots";
import { setGrokAccountLinked } from "@/lib/grok-account";
import { NOTHING_LOCKED, type AchievementSnapshot } from "../../../shared/achievements";
import { BotAvatar } from "@/components/Avatar";
import { shapeSkinPaint } from "@/components/ShapeMascot";
import { SHAPE_ART } from "@/components/shape-art";
import { SHAPE_MOVES } from "@/components/shape-engine";
import { botMascotLook, CHARACTER_PAINT, completeMascotLook, MASCOT_SHAPES, SHAPE_SKINS, TROMBI_SKINS } from "../../../shared/mascot-look";
import { MASCOTS, mascotFor, motion25dTransform, SHAPE_CHOICES, trombiPoseFor } from "./mascots";
import MascotPicker from "./MascotPicker";
import { PICKER_TABS } from "./mascot-picker";
import { CHARACTER_LABEL, SHAPE_LABEL, SHAPE_SKIN_LABEL, TROMBI_SKIN_LABEL } from "./mascot-look-labels";
import { REST } from "./clips";

// the shapes' baked stills, as a page loads them the first time a shape shows (#4145)
beforeAll(() => loadAllBakedStills());

const here = dirname(fileURLToPath(import.meta.url));

function memoryStorage(): FloatingStorage & { removeItem(key: string): void } {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: (key) => void data.delete(key) };
}

/** A shape's eyes as the engine draws them (#4145): the marks of its still, each a rounded bar at rest. */
/** The eyes on a shape's body: in the shared still image, or in the SVG's body when a skin paints its face (#4145). */
const eyeMarks = (html: string) => {
  const url = /<img src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(html)?.[1];
  const svg = url ? decodeURIComponent(url.replace(/&amp;/g, "&")) : html.slice(html.indexOf('data-shape-body=""'), html.includes("data-shape-skin-face") ? html.indexOf("data-shape-skin-face") : undefined);
  return [...svg.matchAll(/<rect x="[^"]*" y="[^"]*" width="([^"]+)" height="([^"]+)"/g)].map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
};

describe("the shapes (stored ids bean, pill, pick and drop kept)", () => {
  const coords = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  it("stands the triangle on its base and points the droplet up", () => {
    const tri = coords(SHAPE_ART.pick.d);
    const top = tri.reduce((best, p) => (p[1] < best[1] ? p : best));
    expect(Math.abs(top[0] - 50)).toBeLessThan(2);
    const drop = coords(SHAPE_ART.drop.d);
    const tip = drop.reduce((best, p) => (p[1] < best[1] ? p : best));
    expect(Math.abs(tip[0] - 50)).toBeLessThan(2);
    expect(tip[1]).toBeLessThan(12);
  });
  it("lays the capsule down: wider than tall", () => {
    const pts = coords(SHAPE_ART.pill.d);
    const width = Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x));
    const height = Math.max(...pts.map(([, y]) => y)) - Math.min(...pts.map(([, y]) => y));
    expect(width / height).toBeGreaterThan(1.5);
  });
});

describe("a bot's character and its look", () => {
  it("is one of the owl, the shapes or Trombi, the owl when absent or malformed", () => {
    // the first eight keep the ids every stored look and older build knows
    expect(MASCOT_SHAPES.slice(0, 8)).toEqual(["circle", "bean", "squircle", "pill", "pick", "hexagon", "cloud", "drop"]);
    expect(MASCOT_SHAPES).toHaveLength(50);
    expect(MASCOT_SHAPES).toContain("witch-hat");
    expect(MASCOT_SHAPES).toContain("pumpkin");
    // a look stored with a shape of an earlier set keeps working, on the nearest shape
    expect(botMascotLook({ character: "shape", shape: "blob" })).toEqual({ character: "shape", shape: "bean" });
    expect(botMascotLook({ character: "shape", shape: "triangle" })).toEqual({ character: "shape", shape: "pick" });
    for (const [old, now] of [["sparkle", "squircle"], ["clover", "clover"], ["flower", "flower"], ["house", "hexagon"], ["star", "star"], ["droplet", "drop"], ["capsule", "pill"], ["pebble", "bean"]]) {
      expect(botMascotLook({ character: "shape", shape: old })).toEqual({ character: "shape", shape: now });
    }
    expect(botMascotLook({ character: "shape", shape: "constructor" })).toEqual({ character: "owl" });
    expect(botMascotLook(undefined)).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "shape", shape: "rocket" })).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "trombi", skins: { trombi: "gold" } })).toEqual({ character: "trombi", skins: { trombi: "gold" } });
    expect(completeMascotLook({ character: "shape" })).toEqual({ character: "shape", style: "2d", shape: "circle", skins: { shape: "plain", trombi: "classic", bunbu: "plain", shiba: "plain", grump: "plain", ogre: "plain", frog: "plain", crab: "plain" } });
  });

  it("keeps each character's own skin when switching and back", () => {
    const look = completeMascotLook({ character: "shape", skins: { shape: "neon", trombi: "retro98" } });
    const trombi = { ...look, character: "trombi" as const };
    expect(completeMascotLook({ ...trombi, character: "shape" }).skins).toEqual({ shape: "neon", trombi: "retro98", bunbu: "plain", shiba: "plain", grump: "plain", ogre: "plain", frog: "plain", crab: "plain" });
  });

  it("draws every shape, with every skin, with its two eyes (the engine's still, #4145)", () => {
    for (const shape of MASCOT_SHAPES) {
      for (const skin of SHAPE_SKINS) {
        const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "blue", mascotLook: { character: "shape", shape, skins: { shape: skin } } }, size: 40 }));
        expect(html).toContain(`data-shape="${shape}"`);
        expect(html).toContain(`data-shape-skin="${skin}"`);
        expect(eyeMarks(html), `${shape} ${skin}`).toHaveLength(2);
        expect(shapeSkinPaint(skin, "#377FE6").fill).toMatch(/^#/);
      }
    }
  }, 60_000);

  it("gives every shape the same resting face: rounded bars about twice as tall as wide", () => {
    for (const shape of MASCOT_SHAPES) {
      const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "white", mascotLook: { character: "shape", shape } }, size: 60, animated: false }));
      const eyes = eyeMarks(html);
      expect(eyes, shape).toHaveLength(2);
      for (const eye of eyes) expect(eye.h / eye.w, shape).toBeGreaterThan(1.4);
    }
  });

  it("is what every bot avatar in the app shows: the owl, a shape, or Trombi", () => {
    const owl = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "green" }, size: 40 }));
    expect(owl).toContain("data-owl");
    const trombi = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "green", mascotLook: { character: "trombi", skins: { trombi: "gold" } } }, size: 40 }));
    expect(trombi).toContain("r98-trombi");
    expect(trombi).toContain("trombi-skin-gold");
  });

  it("is drawn through BotAvatar at every bot avatar call site", () => {
    // a bot's mascot is never drawn straight from the owl or the old cursor body outside these files
    const allowed = new Set(["Avatar.tsx", "OwlAvatar.tsx", "OwlSkinFx.tsx", "mascots.tsx",
      // the skins list's previews (#5369; they were drawn in MascotLookEditor.tsx, which the picker replaced)
      "skin-catalog.tsx", "FloatingBotWindow.tsx", "AssistantArt.tsx", "RetroAssistant.tsx", "Owl25D.tsx", "CursorAvatar.tsx",
      // an achievement reward's skin preview (the toast, the achievements page), not a bot
      "RewardPreview.tsx",
      // the retro assistant dialogs preview the owl look being picked, not a bot
      "RetroAssistantDialogs.tsx",
      // a Heavy run's agents (#4901): the owl in a plumage each, never a bot and never its look
      "HeavyTeamRow.tsx", "ThoughtsPanel.tsx"]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "onboarding") walk(path);
        } else if (name.endsWith(".tsx") && !name.includes(".test.") && !allowed.has(name)) {
          if (/<(MausAvatar|OwlAvatar|CursorAvatar)\b/.test(readFileSync(path, "utf8"))) offenders.push(name);
        }
      }
    };
    walk(join(here, ".."));
    expect(offenders).toEqual([]);
  });

  it("moves from the old per-device record onto the bots, once", () => {
    const storage = memoryStorage();
    storage.setItem("omb.botMascots.v1", JSON.stringify({ bot_a: { kind: "body", body: "capsule" }, bot_b: { kind: "owl", style: "3d" }, bot_c: { kind: "trombi" }, "../x": { kind: "owl" } }));
    expect(readLegacyBotLooks(storage)).toEqual({
      bot_a: { character: "shape", shape: "pill" },
      bot_b: { character: "owl", style: "3d" },
      bot_c: { character: "trombi" },
    });
    forgetLegacyBotLooks(storage);
    expect(readLegacyBotLooks(storage)).toEqual({});
  });
});

describe("the mascot registry", () => {
  it("lists each character once, with a renderer, a thumbnail and its capabilities", () => {
    expect(MASCOTS.map((entry) => entry.id)).toEqual(["owl", "crab", "shape", "trombi", "bunbu", "shiba", "grump", "ogre", "frog"]);
    for (const entry of MASCOTS) {
      expect(typeof entry.Render).toBe("function");
      expect(typeof entry.Thumb).toBe("function");
      expect(entry.capabilities.wings).toBe(CHARACTER_PAINT[entry.id].wingMoves);
      expect(entry.paint.colors).toBe(CHARACTER_PAINT[entry.id].colors);
    }
    expect(mascotFor(undefined).id).toBe("owl");
    expect(SHAPE_CHOICES).toEqual(MASCOT_SHAPES);
  });

  it("has English and French names for every character, shape and skin", () => {
    const keys = [...Object.values(CHARACTER_LABEL), ...Object.values(SHAPE_LABEL), ...Object.values(SHAPE_SKIN_LABEL), ...Object.values(TROMBI_SKIN_LABEL)];
    for (const key of keys) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
    expect(Object.keys(SHAPE_SKIN_LABEL)).toEqual([...SHAPE_SKINS]);
    expect(Object.keys(TROMBI_SKIN_LABEL)).toEqual([...TROMBI_SKINS]);
  });

  it("maps the clips each renderer can show, and never turns a flat one in depth", () => {
    expect(trombiPoseFor("fly", "idle")).toBe("send");
    expect(motion25dTransform({ ...REST, spin: 2, flip: 3, roll: 1 }, 120)).not.toMatch(/rotate[XYZ]\(/);
  });
});

describe("the mascot picker's grid, skins and colours", () => {
  beforeEach(() => resetAchievementsForTests({ unlocks: NOTHING_LOCKED }));
  // This block described the Appearance gallery of the editor (seven tabs, shelves, palettes). The mock-up
  // the owner validated replaced it with the mascot picker (#5369) [M-20261125-063] [M-20261125-064]: an
  // expectation about the old screen says what the mock-up asks, with the id beside it; the others are kept.
  const draw = (mascotLook: Parameters<typeof botMascotLook>[0], mascotSkin: string, extra: object) =>
    renderToStaticMarkup(createElement(MascotPicker, { bot: { color: "blue", mascotSkin: mascotSkin as never, mascotLook: botMascotLook(mascotLook) }, onPatch: () => undefined, ...extra }));
  /** The picker with each of its two tabs open in turn, then with its skins list open: all it can show. */
  const render = (mascotLook?: Parameters<typeof botMascotLook>[0], mascotSkin = "none") =>
    [...PICKER_TABS.map((initialTab) => draw(mascotLook, mascotSkin, { initialTab })), draw(mascotLook, mascotSkin, { initialLayer: "skins" })].join("");
  /** The tab the picker opens on by itself. */
  const opened = (mascotLook?: Parameters<typeof botMascotLook>[0]) => draw(mascotLook, "none", {});
  const enforce = (rewards: string[]) => resetAchievementsForTests({ status: "ready", snapshot: { rewards, items: [] } as unknown as AchievementSnapshot });

  afterEach(() => {
    resetAchievementsForTests();
    setGrokAccountLinked(false);
  });

  it("offers the owl its colors and skins when nothing is locked, its moves on the stage only", () => {
    const html = render(undefined);
    for (const id of ["owl", "crab", "trombi"]) expect(html).toContain(`data-character-option="${id}"`);
    // [D-20261125-030] Shapes is a tab of its own, no longer a tile among the characters
    expect(html).not.toContain('data-character-option="shape"');
    expect(html).toContain('data-mascot-picker-tab="shapes"');
    expect(html).toContain('data-mascot-picker-character="owl"');
    // [D-20261125-029] the skins are one list, every rarity at once (it opened on the current one's rarity, one tab each)
    for (const skin of ["none", "snowy", "barn", "carbon", "frost"]) expect(html).toContain(`data-skin-option="${skin}"`);
    for (const tier of ["common", "rare", "epic", "legendary"]) expect(html).toContain(`data-skin-tier-group="${tier}"`);
    // [D-20261125-028] the colour row in place of the palette tabs
    expect(html).toContain("data-mascot-picker-colors");
    expect(html).not.toContain("data-color-tabs");
    expect(html).not.toContain("data-character-style");
    // no moves menu (#4076): the stage plays them
    expect(html).not.toContain("data-character-move");
    // the owl's panel opens on Characters: no shape in sight until Shapes is opened
    expect(opened(undefined)).not.toContain("data-character-shape");
  });

  it("lists every character, the locked ones greyed with their padlock, and Trombi only once found", () => {
    const lockedIds = (html: string) => [...new Set([...html.matchAll(/data-character-option="([a-z]+)" data-locked=""/g)].map((match) => match[1]))];
    const options = (html: string) => [...new Set([...html.matchAll(/data-character-option="([a-z]+)"/g)].map((match) => match[1]))];
    // [D-20261125-030] Shapes sits under its own tab: its lock is on every shape of that tab
    const shapesLocked = (html: string) => {
      const locked = new Set([...html.matchAll(/data-character-shape="([a-z-]+)"[^>]*data-locked=""/g)].map((match) => match[1]));
      expect([0, MASCOT_SHAPES.length]).toContain(locked.size);
      return locked.size > 0;
    };
    enforce([]);
    const html = render(undefined);
    expect(options(html)).toEqual(MASCOTS.map((entry) => entry.id).filter((id) => id !== "trombi" && id !== "shape"));
    expect(lockedIds(html).sort()).toEqual(MASCOTS.map((entry) => entry.id).filter((id) => id !== "owl" && id !== "trombi" && id !== "shape").sort());
    expect(shapesLocked(html)).toBe(true);
    // [M-20261125-064] no To unlock shelf and no chip: the padlock is on the tile, and a locked Shapes offers no "+"
    expect(html).not.toContain("data-mascot-shelf");
    expect(html).not.toContain("data-mascot-filter");
    expect(html).toContain("unlock-lock");
    expect(html).not.toContain("data-mascot-add-open");
    // every rarity of the owl's skins is offered, the locked ones too
    for (const tier of ["common", "rare", "epic", "legendary"]) expect(html).toContain(`data-skin-tier-group="${tier}"`);
    expect(html).toContain('data-skin-option="none"');
    expect(render(undefined, "chrome")).toContain('data-skin-option="chrome"');
    expect(render(undefined, "chrome")).toMatch(/data-skin-option="lightning"[^>]*data-locked=""/);
    expect(render(undefined, "chrome")).not.toMatch(/data-skin-option="chrome"[^>]*data-locked=""/);
    // the worn character is never locked, and Trombi shows once worn or found
    expect(lockedIds(render({ character: "crab" }))).not.toContain("crab");
    expect(options(render({ character: "trombi" }))).toContain("trombi");
    expect(shapesLocked(render({ character: "shape" }))).toBe(false);
    enforce(["character:crab"]);
    expect(lockedIds(render(undefined))).not.toContain("crab");
    setGrokAccountLinked(true);
    expect(shapesLocked(render(undefined))).toBe(true);
    setGrokAccountLinked(false);
    enforce(["character:shape"]);
    expect(shapesLocked(render(undefined))).toBe(false);
    expect(render(undefined)).toContain("data-mascot-add-open");
    // an earned skin brings its character: the crab, worn in Pearl
    enforce(["skin:crab:pearl"]);
    expect(lockedIds(render(undefined))).not.toContain("crab");
  });

  it("offers a shape its shapes, colors, skins by rarity and its own moves, and nothing of the owl", async () => {
    const html = render({ character: "shape", shape: "cloud" });
    for (const shape of MASCOT_SHAPES) expect(html).toContain(`data-character-shape="${shape}"`);
    for (const skin of SHAPE_SKINS) {
      const open = render({ character: "shape", shape: "cloud", skins: { shape: skin } });
      expect(open, skin).toContain(`data-skin-option="${skin}"`);
      expect(open, skin).toMatch(new RegExp(`aria-checked="true"[^>]*data-skin-option="${skin}"`));
    }
    // nothing of the owl: the list is the shape's own
    expect(html).toContain('data-mascot-skins="shape"');
    expect([...new Set([...html.matchAll(/data-skin-option="([a-z-]+)"/g)].map((match) => match[1]))]).toEqual([...SHAPE_SKINS]);
    // the fourteen Shapes moves, in order, each named, played by the stage (no moves menu, #4076)
    const { characterMoves } = await import("./moves");
    const moves = characterMoves(botMascotLook({ character: "shape", shape: "cloud" })).map((move) => move.id);
    expect(moves).toEqual([...SHAPE_MOVES]);
    expect(moves).toHaveLength(14);
    for (const move of SHAPE_MOVES) expect((en as Record<string, string>)[`mascot.shapeMove.${move}`]).toBeTruthy();
    // every shape, each named
    expect([...opened({ character: "shape", shape: "cloud" }).matchAll(/data-character-shape="([a-z-]+)"/g)].map((m) => m[1])).toEqual([...MASCOT_SHAPES]);
    expect(html).toContain('aria-label="Pebble"');
    expect(html).toContain('aria-label="Pumpkin"');
    expect(html).toContain('aria-label="Teardrop"');
    // Clay is the first skin; [D-20261125-028] the colour row is offered in place of the Clay palette's tab
    expect(SHAPE_SKINS[0]).toBe("plain");
    expect(html).toMatch(/data-skin-tier-group="common"[\s\S]*?data-skin-option="([a-z-]+)"/);
    expect(/data-skin-option="([a-z-]+)"/.exec(html)?.[1]).toBe("plain");
    expect(html).toContain("data-mascot-picker-colors");
    expect(html.match(/data-mascot-color="/g)).toHaveLength(11 * 3);
  });

  it("offers Trombi his skins only, no colors", () => {
    const html = render({ character: "trombi" });
    for (const skin of TROMBI_SKINS) expect(render({ character: "trombi", skins: { trombi: skin } })).toMatch(new RegExp(`aria-checked="true"[^>]*data-skin-option="${skin}"`));
    expect(html).toContain('data-mascot-skins="trombi"');
    expect(html).not.toContain("mascot color");
    expect(html).not.toContain("data-mascot-picker-colors");
    expect(html).not.toContain("data-mascot-color");
    expect(html).not.toContain("data-character-move");
  });
});

describe("the moves a character plays on request (the popover's Moves, the desktop menu's Moves)", () => {
  it("gives the owl its wing moves and every other character its registry list, each a timed clip with a name", async () => {
    const { characterMoves, isMoveClip } = await import("./moves");
    const { MASCOTS } = await import("./mascots");
    expect(characterMoves(undefined).map((move) => move.clip)).toEqual(["wave", "hop", "jump", "dance", "hoot"]);
    expect(characterMoves({ character: "owl" }).every((move) => move.owl)).toBe(true);
    for (const entry of MASCOTS.filter((candidate) => candidate.id !== "owl")) {
      const moves = characterMoves({ character: entry.id });
      expect(moves.map((move) => move.clip)).toEqual([...entry.moves]);
      for (const move of moves) {
        // the Shapes moves play in the Shapes engine, not as behavior clips (the desktop menu leaves them out)
        if (entry.id === "shape") {
          expect(move.label).toMatch(/^mascot\.shapeMove\./);
          continue;
        }
        expect(isMoveClip(move.clip)).toBe(true);
        expect(move.label).toMatch(/^(floatingBots\.move|mascot\.motion)\./);
      }
    }
    expect(isMoveClip("sleep")).toBe(false);
  });
});

describe("the drawn menu (in-app overlay)", () => {
  it("lists a submenu's items after its title, indented", async () => {
    const { drawnMenuRows } = await import("./FloatingBotView");
    const rows = drawnMenuRows([{ id: "balloon", label: "Talk" }, { id: "sep-1", label: "", type: "separator" }, { id: "moves", label: "Moves", items: [{ id: "move:wave", label: "Wave" }] }]);
    expect(rows.map(({ item, depth }) => `${depth}:${item.id}`)).toEqual(["0:balloon", "0:sep-1", "0:moves", "1:move:wave"]);
  });
});
