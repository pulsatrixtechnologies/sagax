// #4145: the shapes are drawn by the open-bot-avatar engine. Every shape id
// (ours and the engine's gallery) is a valid engine definition, a bot keeps
// its shape and its colour, small avatars are one shared still baked ahead
// (no volume inference and no animation loop on the page), the large ones
// live, a skin still paints its face, the fourteen moves still play, and the
// picker offers the gallery once.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getExample, validateAvatar } from "open-bot-avatar";
import { beforeAll, describe, expect, it } from "vitest";
import { BODY_SHAPES, GALLERY_SHAPES, MASCOT_SHAPES, botMascotLook } from "../../shared/mascot-look";
import { OBJECT_SHAPE_BY_ID } from "../../shared/shape-avatar-presets";
import baked from "../../shared/shape-avatars.json";
import { BotAvatar, type BotAvatarProps } from "./Avatar";
import { bakeStill, engineMood, lookDefinition, moodFrame, ownDefinition, readStill, shapeDefinition, stillUrl } from "./shape-avatar";
import { loadBakedStill } from "./shape-stills";
import { LIVE_MIN, moveExtrasMarkup, moveEyeOpen, ShapeMascot, shapeIsLive, skinFace } from "./ShapeMascot";
import { SHAPE_MOVES, ShapeEngine, stillFrame as restFrame } from "./shape-engine";
import { SHAPE_CHOICES } from "./floating-bots/mascots";
import { SHAPE_LABEL } from "./floating-bots/mascot-look-labels";
import { MAUS_COLORS } from "@/lib/mascot";

const svgOf = (url: string) => decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
const stillOf = (html: string) => /<img src="(data:image\/svg\+xml[^"]+)"/.exec(html)?.[1] ?? null;
const avatar = (shape: string, size: number, animated: boolean, color = "blue") =>
  renderToStaticMarkup(
    createElement(BotAvatar, {
      bot: { id: "b", name: "Scout", color, mascotLook: { character: "shape", shape } } as unknown as BotAvatarProps["bot"],
      size,
      animated,
    }),
  );

const here = dirname(fileURLToPath(import.meta.url));

// every shape's baked still, as a page loads it the first time the shape shows
beforeAll(async () => {
  await Promise.all(MASCOT_SHAPES.map(loadBakedStill));
});

/** The engine's own avatar a shape id stands for (the same object, the engine's outline). */
const ENGINE_FOR: Readonly<Record<string, string>> = {
  star: "star", cloud: "cloud", ghost: "ghost", cat: "cat", shield: "shield",
  pad: "controller", cup: "mug", bulb: "lightbulb", say: "chat", sprout: "sprout", tome: "book", ship: "rocket",
};

describe("every shape is an engine definition", () => {
  it.each(MASCOT_SHAPES.map((shape) => [shape]))("%s validates with validateAvatar", (shape) => {
    const result = validateAvatar(shapeDefinition(shape));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it("bakes every body shape: the engine's own avatar for the same object, our own body (same id) for the rest", () => {
    expect(Object.keys(baked.shapes).sort()).toEqual([...BODY_SHAPES].sort());
    for (const shape of BODY_SHAPES) {
      const entry = baked.shapes[shape] as { engine?: string; own?: { id: string } };
      if (ENGINE_FOR[shape]) expect(entry.engine).toBe(ENGINE_FOR[shape]);
      else expect(entry.own?.id).toBe(shape);
      expect(shapeDefinition(shape).id).toBe(ENGINE_FOR[shape] ?? shape);
    }
  });

  it("draws the gallery shapes with the engine's own definitions", () => {
    for (const shape of GALLERY_SHAPES) {
      const def = shapeDefinition(shape);
      expect(def.id).toBe(shape);
      if (getExample(shape)) expect(def).toEqual(getExample(shape));
    }
  });

  it("never falls back to the circle for a known shape (no bot changes shape)", () => {
    const circle = shapeDefinition("circle").body.path;
    for (const shape of MASCOT_SHAPES.filter((id) => id !== "circle")) expect(shapeDefinition(shape).body.path).not.toBe(circle);
  });
});

describe("a person's own drawing", () => {
  it("follows the current shape when it is a saved copy of an object preset", () => {
    expect(ownDefinition(OBJECT_SHAPE_BY_ID.cup, "circle")).toBe(shapeDefinition("cup"));
  });

  it("turns a custom path into a valid engine definition, or keeps the bot's shape", () => {
    const own = lookDefinition("circle", { ...OBJECT_SHAPE_BY_ID.tin, id: "my-own", name: "My own" });
    expect(validateAvatar(own).ok).toBe(true);
    expect(own.body.path).not.toBe(shapeDefinition("circle").body.path);
    const off = lookDefinition("hexagon", { ...OBJECT_SHAPE_BY_ID.tin, id: "far", name: "Far", body: { kind: "path", d: "M0 0L100 0L100 100L0 100Z" } });
    expect(off.body.path === shapeDefinition("hexagon").body.path || validateAvatar(off).ok).toBe(true);
  });
});

describe("where a shape shows", () => {
  it("draws a sidebar avatar as the engine's still, in the bot's colour, with no live canvas", () => {
    const html = avatar("cup", 28, false, "green");
    const still = stillOf(html);
    expect(still).toBeTruthy();
    expect(html).not.toContain("data-shape-live");
    expect(html).toContain('data-fx="static"');
    expect(svgOf(still!)).toContain(`fill="${MAUS_COLORS.green.toLowerCase()}"`);
  });

  it("shares one still between avatars of the same shape, colour and mood", () => {
    const a = stillOf(avatar("star", 28, false));
    const b = stillOf(avatar("star", 36, false));
    expect(a).toBe(b);
    expect(stillOf(avatar("star", 28, false, "red"))).not.toBe(a);
  });

  it("draws the large mascot live from LIVE_MIN up, a still below, under reduced motion or when forced still", () => {
    expect(shapeIsLive(LIVE_MIN, true, undefined, false)).toBe(true);
    expect(shapeIsLive(LIVE_MIN - 1, true, undefined, false)).toBe(false);
    expect(shapeIsLive(144, true, undefined, true)).toBe(false);
    expect(shapeIsLive(144, true, "static", false)).toBe(false);
    expect(shapeIsLive(144, false, undefined, false)).toBe(false);
    for (const size of [92, 112, 144]) {
      const html = avatar("pumpkin", size, true);
      expect(html).toContain("data-shape-live");
      expect(html).toContain('data-fx="full"');
      expect(stillOf(html)).toBeNull();
    }
  });

  it("names the mascot for assistive technology, the drawing itself decorative", () => {
    const named = renderToStaticMarkup(createElement(ShapeMascot, { shape: "ghost", color: "blue", size: 28, animated: false, label: "Scout" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Scout"');
    expect(named).toContain('alt=""');
    expect(svgOf(stillOf(named)!)).not.toContain("<title>");
    const decorative = renderToStaticMarkup(createElement(ShapeMascot, { shape: "ghost", color: "blue", size: 28, animated: false }));
    expect(decorative).toContain('aria-hidden="true"');
  });

  it("takes the mood from the bot's state: at work it thinks, done it is happy, else at rest", () => {
    expect(engineMood("working")).toBe("thinking");
    expect(engineMood("streaming")).toBe("thinking");
    expect(engineMood("thinking")).toBe("thinking");
    expect(engineMood("happy")).toBe("happy");
    expect(engineMood("idle")).toBe("idle");
    expect(engineMood("sleeping")).toBe("idle");
    const html = (mood: "happy" | "idle") => renderToStaticMarkup(createElement(ShapeMascot, { shape: "circle", color: "blue", size: 28, animated: false, mood }));
    expect(stillOf(html("happy"))).not.toBe(stillOf(html("idle")));
  });

  it("paints a skin's colours on the body and the eyes, the Outline skin flat", () => {
    const night = renderToStaticMarkup(createElement(ShapeMascot, { shape: "circle", skin: "night", color: "blue", size: 28, animated: false }));
    const plain = renderToStaticMarkup(createElement(ShapeMascot, { shape: "circle", skin: "plain", color: "blue", size: 28, animated: false }));
    expect(stillOf(night)).not.toBe(stillOf(plain));
    expect(night).toContain('data-shape-skin="night"');
  });
});

describe("the picker", () => {
  it("offers our shapes and then the engine's gallery, each once, each named", () => {
    expect(SHAPE_CHOICES).toEqual([...BODY_SHAPES, ...GALLERY_SHAPES]);
    expect(new Set(SHAPE_CHOICES).size).toBe(SHAPE_CHOICES.length);
    for (const shape of SHAPE_CHOICES) expect(SHAPE_LABEL[shape]).toBe(`mascot.shape.${shape === "bean" ? "pebble" : shape === "pill" ? "capsule" : shape === "pick" ? "triangle" : shape === "drop" ? "droplet" : shape}`);
  });

  it("names each shape so it fits its picker card in French and English, never cut (#4145)", () => {
    // the 78px card fits about 13 characters of the 11px label; longer names
    // such as "Appareil photo" or "Chapeau de sorcière" were cut with an ellipsis
    const here = dirname(fileURLToPath(import.meta.url));
    for (const locale of ["en", "fr"]) {
      const strings = JSON.parse(readFileSync(join(here, `../locales/${locale}.json`), "utf8")) as Record<string, string>;
      for (const shape of GALLERY_SHAPES) expect(strings[SHAPE_LABEL[shape]]?.length, `${locale} ${shape}`).toBeLessThanOrEqual(13);
    }
  });

  it("never offers an engine avatar one of our shapes already stands for", () => {
    for (const engineId of Object.values(ENGINE_FOR)) expect((GALLERY_SHAPES as readonly string[]).includes(engineId)).toBe(false);
  });

  it("keeps a bot that picked a gallery shape on it", () => {
    expect(botMascotLook({ character: "shape", shape: "witch-hat" })).toEqual({ character: "shape", shape: "witch-hat" });
  });
});

describe("the stills are baked, never inferred on the page (fast and light)", () => {
  it("holds every shape's still as the engine draws it (scripts/bake-engine-shapes.mjs is current)", () => {
    for (const shape of MASCOT_SHAPES) {
      const file = JSON.parse(readFileSync(join(here, "shape-stills", `${shape}.json`), "utf8"));
      expect(file, shape).toEqual(bakeStill(shapeDefinition(shape)));
    }
  });

  it("draws a still from its baked frame alone: the same picture as the engine's renderAvatarSvg", () => {
    const still = readStill(bakeStill(shapeDefinition("star")));
    const frame = moodFrame(still, "idle");
    const svg = decodeURIComponent(stillUrl("test-star", frame, "#3b82f6", "#151515").split(",")[1]!);
    expect(svg.match(/<use /g)?.length).toBe(frame.shapes.filter((shape) => shape.kind === "slice").length);
    expect(svg.match(/<rect /g)?.length).toBe(2);
    expect(svg).toContain('fill="#3b82f6"');
  });

  it("loads a still once per shape and shares it", async () => {
    const a = await loadBakedStill("ghost");
    expect(a).not.toBeNull();
    expect(await loadBakedStill("ghost")).toBe(a);
  });

  it("never runs the engine's volume inference while a sidebar draws its stills", () => {
    const source = readFileSync(join(here, "ShapeMascot.tsx"), "utf8");
    // the still is the baked frame (useBakedStill); only a person's own drawing and the flat Outline skin infer theirs
    expect(source).toMatch(/const still = bakedId \? baked : runtimeStill\(definition, depth\)/);
    expect(source).not.toContain("renderAvatarSvg");
    expect(source).not.toContain("mountAvatar");
  });
});

describe("a skin paints the engine's body (#4145 regression: no flat Epic or Legendary skin)", () => {
  const html = (skin: string, size: number, animated = true) => renderToStaticMarkup(createElement(ShapeMascot, { shape: "hexagon", skin: skin as never, color: "blue", size, animated }));

  it("draws each premium skin's own layers on the face, still and live", () => {
    // the galaxy's stars, the circuit's traces, the molten cracks, the holographic foil, the neon tube, the crystal's facets
    const marks: Record<string, RegExp> = { galaxy: /<circle /, circuit: /stroke-linecap|<path d="M/, molten: /url\(#[^)]+-rock\)/, holo: /-foil\)/, neon: /url\(#[^)]+-plate\)/, crystal: /url\(#[^)]+-crystal\)/, chrome: /url\(#[^)]+-chrome\)/, gold: /url\(#[^)]+-gold\)/ };
    for (const [skin, mark] of Object.entries(marks)) {
      for (const size of [28, 112]) {
        const out = html(skin, size);
        expect(out, `${skin} ${size}`).toContain("data-skin-face");
        expect(out, `${skin} ${size}`).toMatch(mark);
        expect(out, `${skin} ${size}`).not.toContain("<img");
      }
    }
  });

  it("keeps the flat skins as the one shared image, and the eyes over every skin", () => {
    expect(html("plain", 28, false)).toContain("<img");
    const holo = html("holo", 28, false);
    // the eyes are drawn again over the skin's face
    const face = holo.indexOf("data-skin-face");
    expect(face).toBeGreaterThan(0);
    expect(holo.slice(face)).toMatch(/<rect /);
  });

  it("paints the skin on the body's full outline, placed with its projection", () => {
    const frame = moodFrame(readStill(bakeStill(shapeDefinition("hexagon"))), "idle");
    const face = skinFace(frame);
    expect(face).not.toBeNull();
    const largest = Math.max(...frame.paths.map((path) => path[3]));
    expect(frame.paths.find((path) => path[1] === face!.d)?.[3]).toBe(largest);
    expect(face!.transform).toMatch(/^matrix\(/);
  });
});

describe("the fourteen moves play over the engine (#4145 regression: no move drawn as a mood)", () => {
  const state = { shape: "circle" as const, expression: "neutral" as const, color: "#3b82f6" };
  const at = (move: (typeof SHAPE_MOVES)[number], share: number) => {
    const engine = new ShapeEngine(state, 0, 7);
    engine.play(move, 0);
    return engine.frame(share);
  };

  it("draws what each move adds beside the body", () => {
    expect(moveExtrasMarkup(at("orbit", 1.5), "t", "#3b82f6").back + moveExtrasMarkup(at("orbit", 1.5), "t", "#3b82f6").front).toMatch(/stroke="url\(#t-ring0\)"/);
    expect(moveExtrasMarkup(at("comet", 1.2), "t", "#3b82f6").front).toMatch(/pathLength="1"/);
    expect(moveExtrasMarkup(at("thinking", 1.2), "t", "#3b82f6").front).toMatch(/<circle /);
    expect(moveExtrasMarkup(at("notify", 1.1), "t", "#3b82f6").front).toContain('fill="#2a8fe8"');
    expect(moveExtrasMarkup(at("exclaim", 1), "t", "#3b82f6").front).toMatch(/<path d=/);
  });

  it("closes one eye for a wink and both for sleep", () => {
    const rest = restFrame(state);
    const wink = moveEyeOpen(at("wink", 0.8), rest);
    expect(Math.min(...wink)).toBeLessThan(0.5);
    expect(Math.max(...wink)).toBeGreaterThan(0.8);
    const sleep = moveEyeOpen(at("sleep", 1.2), rest);
    expect(Math.max(...sleep)).toBeLessThan(0.5);
  });

  it("turns into the egg, the hexagon or the triangle and back", () => {
    for (const move of ["egg", "hexagon", "play", "orbit"] as const) expect(at(move, MOVE_MID[move]).morphed, move).toBeGreaterThan(0.5);
    expect(at("egg", 5).morphed).toBeLessThan(0.5);
  });

  it("makes every size live while a move plays, and tells which", () => {
    const source = readFileSync(join(here, "ShapeMascot.tsx"), "utf8");
    expect(source).toMatch(/const live = !reduced && \(shapeIsLive\(size, animated, detail, reduced\) \|\| playing !== null\)/);
    expect(source).toContain('"data-shape-move": playing.clip');
  });
});

const MOVE_MID = { egg: 0.9, hexagon: 0.8, play: 1, orbit: 1.7 } as const;
