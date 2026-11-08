// The desktop mascot wears the bot's own mascot (JC 2026-11-08: "the mascott
// on the desktop dont match their real mascott"). The look goes from the app
// through Electron main (floating-bot-window.mjs mascotLook) to the window,
// which draws it with the same ShapeMascot as the bots list. Main kept its own
// copy of the shape list without the object silhouettes and dropped a
// person's own shape (avatarDef): Bot designer's sprout came out a plain
// circle. For every built-in mascot and a custom one, the window must end up
// with the very look, and so the very outline, the list avatar draws.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module of the Electron main process, no types for these exports
import { mascotLook as mainMascotLook, SHAPES as MAIN_SHAPES } from "../../../electron/floating-bot-window.mjs";
import { completeMascotLook, MASCOT_CHARACTERS, MASCOT_SHAPES, type MascotLook } from "../../../shared/mascot-look";
import { OBJECT_SHAPE_BY_ID } from "../../../shared/shape-avatar-presets";
import { avatarDefForShape } from "../ShapeMascot";
import { stillFrame } from "../shape-engine";
import { mascotFor } from "./mascots";

const COLOR = "#22c55e";

/** What the desktop window draws from: the look as main passes it, serialized like the snapshot (FloatingBotStage's `look`). */
function desktopLook(look: MascotLook) {
  const sent = mainMascotLook(JSON.parse(JSON.stringify(look))) ?? { character: "owl" };
  return completeMascotLook(JSON.parse(JSON.stringify(sent)));
}

/** The shape's outline and eyes at rest, as ShapeMascot resolves them (preset or the person's own def). */
function outline(look: ReturnType<typeof completeMascotLook>) {
  const def = avatarDefForShape(look.shape, look.avatarDef);
  const frame = stillFrame({ shape: look.shape, expression: "neutral", color: COLOR, ...(def ? { avatarDef: def } : {}) });
  return { body: frame.body, eyes: frame.eyes };
}

const custom: MascotLook = {
  character: "shape",
  shape: "circle",
  avatarDef: { ...OBJECT_SHAPE_BY_ID.cup, id: "my-own-mascot", name: "My own" },
} as MascotLook;

const LOOKS: Array<[string, MascotLook]> = [
  ...MASCOT_CHARACTERS.map((character) => [character, { character }] as [string, MascotLook]),
  ...MASCOT_SHAPES.map((shape) => [`shape:${shape}`, { character: "shape", shape, skins: { shape: "plain" } }] as [string, MascotLook]),
  ["custom avatarDef", custom],
];

describe("the desktop mascot is the bot's own mascot", () => {
  it("main knows every shape of the app, no more, no less", () => {
    expect([...MAIN_SHAPES].sort()).toEqual([...MASCOT_SHAPES].sort());
  });

  it.each(LOOKS)("%s: same character, shape, skins and own definition as the list avatar", (_name, look) => {
    const list = completeMascotLook(look);
    const desktop = desktopLook(look);
    expect(desktop).toEqual(list);
    expect(mascotFor(desktop).id).toBe(mascotFor(list).id);
  });

  it.each(LOOKS.filter(([, look]) => look.character === "shape"))("%s: the desktop draws the list's outline and eyes", (_name, look) => {
    expect(outline(desktopLook(look))).toEqual(outline(completeMascotLook(look)));
  });

  it("a sprout is not a circle (the test would see the old drift)", () => {
    const sprout = completeMascotLook({ character: "shape", shape: "sprout" });
    const circle = completeMascotLook({ character: "shape", shape: "circle" });
    expect(outline(sprout).body).not.toEqual(outline(circle).body);
    expect(outline(completeMascotLook(custom)).body).not.toEqual(outline(circle).body);
  });
});
