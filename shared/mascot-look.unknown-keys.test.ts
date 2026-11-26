// A look that carries a key this build does not know (a newer build's
// setting) is drawn with what this build knows, never as the owl (#5369).
// And the two settings the mascot picker adds: the free body colour and the
// motion preference.
import { describe, expect, it } from "vitest";

import { botMascotLook, completeMascotLook, engineLookOf, mascotLookSchema, SHAPE_MOTIONS, withEngineLook } from "./mascot-look.ts";

describe("a look with a key this build does not know", () => {
  it("keeps the character, the shape and the skins; only the unknown key drops", () => {
    expect(botMascotLook({ character: "shape", shape: "cup", skins: { shape: "gold" }, sparkle: "high" })).toEqual({ character: "shape", shape: "cup", skins: { shape: "gold" } });
    expect(botMascotLook({ character: "frog", skins: { frog: "leaf" }, hat: { kind: "top" }, material: "glass" })).toEqual({ character: "frog", skins: { frog: "leaf" }, material: "glass" });
  });

  it("keeps the known settings beside an unknown key and an unknown skin", () => {
    expect(botMascotLook({ character: "shape", shape: "star", mood: "happy", later: true, skins: { shape: "from-later" } })).toEqual({ character: "shape", shape: "star", mood: "happy" });
  });

  it("still reads a look without a character, or one that is no object, as the owl", () => {
    expect(botMascotLook({ shape: "cup", later: 1 })).toEqual({ character: "owl" });
    expect(botMascotLook("shape")).toEqual({ character: "owl" });
    expect(botMascotLook(null)).toEqual({ character: "owl" });
  });

  it("a write stays strict: the schema refuses a key nobody defined", () => {
    expect(mascotLookSchema.safeParse({ character: "shape", sparkle: "high" }).success).toBe(false);
  });
});

describe("the picker's own settings: the free body colour and the motion preference", () => {
  it("are absent from a look nobody touched", () => {
    expect(engineLookOf({ character: "shape", shape: "cup" })).toMatchObject({ bodyColor: null, motion: "system" });
    expect(completeMascotLook({ character: "shape", shape: "cup" })).not.toHaveProperty("bodyColor");
    expect(completeMascotLook({ character: "shape", shape: "cup" })).not.toHaveProperty("motion");
  });

  it("save and read back, the colour in lower case", () => {
    const look = mascotLookSchema.parse({ character: "bunbu", bodyColor: "#12ABef", motion: "reduced" });
    expect(look).toEqual({ character: "bunbu", bodyColor: "#12abef", motion: "reduced" });
    expect(engineLookOf(look)).toMatchObject({ bodyColor: "#12abef", motion: "reduced" });
    expect(SHAPE_MOTIONS).toEqual(["system", "reduced", "full"]);
  });

  it("refuse what is no colour and no motion, and never store the default", () => {
    expect(mascotLookSchema.safeParse({ character: "shape", bodyColor: "tomato" }).success).toBe(false);
    expect(mascotLookSchema.safeParse({ character: "shape", motion: "system" }).success).toBe(false);
    expect(mascotLookSchema.safeParse({ character: "shape", motion: "fast" }).success).toBe(false);
    const before = completeMascotLook({ character: "shape", shape: "cup" });
    const set = withEngineLook(before, { bodyColor: "#FF00AA", motion: "full" });
    expect(set).toMatchObject({ bodyColor: "#ff00aa", motion: "full" });
    expect(withEngineLook(set, { bodyColor: null, motion: "system" })).toEqual(before);
  });

  it("drop alone when a newer build wrote a value this one does not take", () => {
    expect(botMascotLook({ character: "shape", shape: "cup", motion: "slow", bodyColor: "#abcdef" })).toEqual({ character: "shape", shape: "cup", bodyColor: "#abcdef" });
  });
});
