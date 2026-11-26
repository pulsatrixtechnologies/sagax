// The mascot picker's rules (#5369): the eleven quick colours and the free
// one, which pills and segments a character gets, what a pick saves, and
// that a bot nobody touches keeps exactly its look.
import { describe, expect, it } from "vitest";

import { MAUS_COLORS } from "@/lib/mascot";
import { completeMascotLook, type MascotLook } from "../../../shared/mascot-look";
import { bodyColorOf, characterPatch, colorPatch, definitionJson, materialPatch, nearestColorName, pickerColor, pickerControls, PICKER_TABS, QUICK_COLORS, shapePatch, skinPatch, tabOf } from "./mascot-picker";

const shape = (extra: Partial<MascotLook> = {}) => completeMascotLook({ character: "shape", shape: "cup", skins: { shape: "gold" }, ...extra });

describe("the picker's tabs", () => {
  it("are two: Shapes and Characters, opening on what the bot wears", () => {
    expect(PICKER_TABS).toEqual(["shapes", "characters"]);
    expect(tabOf("shape")).toBe("shapes");
    for (const id of ["owl", "trombi", "bunbu", "shiba", "grump", "ogre", "frog", "crab"] as const) expect(tabOf(id)).toBe("characters");
  });
});

describe("the colour row", () => {
  it("offers the upstream picker's eleven colours, as bot colour names", () => {
    expect(QUICK_COLORS).toEqual(["white", "brown", "red", "orange", "amber", "green", "teal", "blue", "purple", "pink", "grey"]);
    for (const name of QUICK_COLORS) expect(MAUS_COLORS[name]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("shows a quick colour as chosen, and any other colour a bot wears on the free colour ring", () => {
    expect(pickerColor({ color: "green", mascotLook: null })).toEqual({ hex: MAUS_COLORS.green.toLowerCase(), quick: "green", custom: false });
    // one of the older palettes: kept and shown, on the ring
    expect(pickerColor({ color: "lavender", mascotLook: null })).toEqual({ hex: MAUS_COLORS.lavender.toLowerCase(), quick: null, custom: true });
    expect(pickerColor({ color: "blue", mascotLook: { character: "shape", bodyColor: "#123456" } })).toEqual({ hex: "#123456", quick: null, custom: true });
  });

  it("a free colour is drawn as it is, and the bot's named colour becomes the nearest name", () => {
    const patch = colorPatch(shape(), "#3a80e5");
    expect(patch.color).toBe("blue");
    expect(patch.mascotLook).toMatchObject({ character: "shape", shape: "cup", bodyColor: "#3a80e5", skins: { shape: "gold" } });
    expect(bodyColorOf({ color: "blue", mascotLook: patch.mascotLook })).toBe("#3a80e5");
    expect(nearestColorName("#0a0a0c")).toBe("ink");
    // a free colour that is exactly a named one is that name, nothing more
    expect(colorPatch(shape(), MAUS_COLORS.teal)).toEqual({ color: "teal" });
  });

  it("a quick colour removes the free one and leaves an untouched look alone", () => {
    expect(colorPatch(shape(), "red")).toEqual({ color: "red" });
    const free = completeMascotLook({ character: "shape", shape: "cup", bodyColor: "#123456", mood: "happy" });
    const patch = colorPatch(free, "red");
    expect(patch.color).toBe("red");
    expect(patch.mascotLook).not.toHaveProperty("bodyColor");
    expect(patch.mascotLook).toMatchObject({ character: "shape", shape: "cup", mood: "happy" });
    expect(bodyColorOf({ color: "red", mascotLook: patch.mascotLook })).toBe("red");
  });

  it("the back arrow's colour (the one the panel opened on) comes back whole, free or named", () => {
    expect(colorPatch(shape(), { color: "lavender", bodyColor: null })).toEqual({ color: "lavender" });
    const back = colorPatch(shape(), { color: "blue", bodyColor: "#123456" });
    expect(back.color).toBe("blue");
    expect(back.mascotLook).toMatchObject({ bodyColor: "#123456" });
  });
});

describe("what a character gets under the grid", () => {
  it("a shape: the three materials, the skins segment, the mood and the gear", () => {
    expect(pickerControls("shape", { materials: true })).toEqual({ materials: ["flat", "fluffy", "glass"], skins: true, mood: true, gear: true, colors: true });
  });

  it("a shape where this device cannot paint a material: no material segment at all, never a greyed one", () => {
    expect(pickerControls("shape", { materials: false })).toMatchObject({ materials: [], skins: true, mood: true });
  });

  it("another character: its skins only; Trombi takes no colour", () => {
    expect(pickerControls("frog", { materials: true })).toEqual({ materials: [], skins: true, mood: false, gear: false, colors: true });
    expect(pickerControls("owl", { materials: true })).toMatchObject({ materials: [], skins: true, mood: false, colors: true });
    expect(pickerControls("trombi", { materials: true })).toMatchObject({ skins: true, colors: false });
  });
});

describe("what a pick saves", () => {
  it("a shape: the shape, on the shape character, a person's own drawing dropped", () => {
    const frog = completeMascotLook({ character: "frog", skins: { frog: "leaf", shape: "gold" }, material: "glass" });
    expect(shapePatch(frog, "star", "green").mascotLook).toMatchObject({ character: "shape", shape: "star", material: "glass", skins: { frog: "leaf", shape: "gold" } });
    const own = shape({ avatarDef: { version: 1, id: "mine", name: "Mine", body: { path: "M10 10H90V90H10Z" }, eyes: { x: 50, y: 46, spacing: 20, scale: 1 } } as never });
    expect(shapePatch(own, "cup", "green").mascotLook).not.toHaveProperty("avatarDef");
  });

  it("a pumpkin takes orange where the skin wears the bot's colour, as before", () => {
    expect(shapePatch(completeMascotLook({ character: "shape", shape: "cup" }), "pumpkin", "green").color).toBe("orange");
    expect(shapePatch(shape(), "pumpkin", "green").color).toBeUndefined();
  });

  it("a character: only the character changes, every skin stays", () => {
    expect(characterPatch(shape({ mood: "happy" }), "frog").mascotLook).toEqual({ ...shape({ mood: "happy" }), character: "frog" });
  });

  it("a material stands in place of the skin; a skin brings Flat back", () => {
    expect(materialPatch(shape(), "glass").mascotLook).toMatchObject({ material: "glass", skins: { shape: "gold" } });
    expect(materialPatch(shape({ material: "glass" }), "flat").mascotLook).toEqual(shape());
    const picked = skinPatch(shape({ material: "fluffy" }), "shape", "neon");
    expect(picked.mascotLook).toMatchObject({ skins: { shape: "neon" } });
    expect(picked.mascotLook).not.toHaveProperty("material");
    expect(skinPatch(completeMascotLook({ character: "frog" }), "frog", "leaf").mascotLook).toMatchObject({ character: "frog", skins: { frog: "leaf" } });
    expect(skinPatch(completeMascotLook({ character: "owl" }), "owl", "gold")).toEqual({ mascotSkin: "gold" });
  });

  it("the settings that left the screen stay on the look through every pick", () => {
    const kept = shape({ eyeColor: "#ff0000", depth: 3 });
    for (const patch of [shapePatch(kept, "star", "green"), characterPatch(kept, "frog"), materialPatch(kept, "fluffy"), skinPatch(kept, "shape", "neon"), colorPatch(kept, "#123456")]) {
      expect(patch.mascotLook).toMatchObject({ eyeColor: "#ff0000", depth: 3 });
    }
  });
});

describe("a definition out of a pasted text or a model's reply", () => {
  it("reads the inside of a code fence, or the object inside the words around it", () => {
    expect(definitionJson('Here it is:\n```json\n{ "version": 1 }\n```\nEnjoy.')).toBe('{ "version": 1 }');
    expect(definitionJson('Sure! { "version": 1, "body": { "path": "M0 0Z" } } Let me know.')).toBe('{ "version": 1, "body": { "path": "M0 0Z" } }');
    expect(definitionJson('  { "version": 1 }  ')).toBe('{ "version": 1 }');
    expect(definitionJson("not json")).toBe("not json");
  });
});
