// The look settings the open-bot-avatar engine takes per mascot (#5349):
// material, mood, eye colour, depth and whether the eyes follow the pointer.
// Stored on the bot's look; absent means today's drawing.
import { describe, expect, it } from "vitest";

import { botMascotLook, completeMascotLook, engineLookOf, mascotLookSchema, SHAPE_MATERIALS, SHAPE_MOODS, withEngineLook } from "./mascot-look.ts";

describe("the engine's look settings on a bot's look", () => {
  it("offers the engine's three materials and two moods, the defaults first", () => {
    expect(SHAPE_MATERIALS).toEqual(["flat", "fluffy", "glass"]);
    expect(SHAPE_MOODS).toEqual(["neutral", "happy"]);
  });

  it("a look stored before the settings reads as today's drawing, and stays the same object when completed", () => {
    const stored = { character: "shape", shape: "cup", skins: { shape: "gold" } } as const;
    expect(engineLookOf(stored)).toEqual({ material: "flat", mood: "neutral", eyeColor: null, depth: null, followPointer: true, bodyColor: null, motion: "system" });
    // nothing is added to the look itself: an older build reads it as before
    expect(completeMascotLook(stored)).toEqual({ character: "shape", style: "2d", shape: "cup", skins: { shape: "gold", trombi: "classic", bunbu: "plain", shiba: "plain", grump: "plain", ogre: "plain", frog: "plain", crab: "plain" } });
    expect(engineLookOf(undefined)).toEqual({ material: "flat", mood: "neutral", eyeColor: null, depth: null, followPointer: true, bodyColor: null, motion: "system" });
  });

  it("keeps every setting through the schema and the complete look", () => {
    const stored = { character: "shape", shape: "star", material: "fluffy", mood: "happy", eyeColor: "#2A8FE8", depth: 10, followPointer: false };
    const parsed = mascotLookSchema.parse(stored);
    expect(parsed).toEqual({ ...stored, eyeColor: "#2a8fe8" });
    expect(engineLookOf(parsed)).toEqual({ material: "fluffy", mood: "happy", eyeColor: "#2a8fe8", depth: 10, followPointer: false, bodyColor: null, motion: "system" });
    const complete = completeMascotLook(parsed);
    expect(complete.material).toBe("fluffy");
    expect(complete.mood).toBe("happy");
    expect(complete.eyeColor).toBe("#2a8fe8");
    expect(complete.depth).toBe(10);
    expect(complete.followPointer).toBe(false);
    expect(engineLookOf({ ...parsed, material: "glass" }).material).toBe("glass");
  });

  it("refuses a value the engine does not take", () => {
    const base = { character: "shape" };
    expect(mascotLookSchema.safeParse({ ...base, material: "velvet" }).success).toBe(false);
    expect(mascotLookSchema.safeParse({ ...base, mood: "thinking" }).success).toBe(false);
    expect(mascotLookSchema.safeParse({ ...base, eyeColor: "red" }).success).toBe(false);
    expect(mascotLookSchema.safeParse({ ...base, depth: 15 }).success).toBe(false);
    expect(mascotLookSchema.safeParse({ ...base, depth: -1 }).success).toBe(false);
    expect(mascotLookSchema.safeParse({ ...base, followPointer: "yes" }).success).toBe(false);
    // no state is ever stored: the mascot takes it from what the bot does
    expect(mascotLookSchema.safeParse({ ...base, state: "working" }).success).toBe(false);
  });

  it("drops a setting a newer build wrote, never the bot's character", () => {
    expect(botMascotLook({ character: "shape", shape: "cup", material: "velvet", mood: "happy" })).toEqual({ character: "shape", shape: "cup", mood: "happy" });
    expect(botMascotLook({ character: "shape", shape: "cup", depth: 99, skins: { shape: "gold" } })).toEqual({ character: "shape", shape: "cup", skins: { shape: "gold" } });
  });

  it("a setting put back to its default leaves the look as it was stored before", () => {
    const before = completeMascotLook({ character: "shape", shape: "cup" });
    const fluffy = withEngineLook(before, { material: "fluffy", depth: 3, mood: "happy", eyeColor: "#ffffff", followPointer: false });
    expect(fluffy).toMatchObject({ material: "fluffy", depth: 3, mood: "happy", eyeColor: "#ffffff", followPointer: false });
    const back = withEngineLook(fluffy, { material: "flat", depth: null, mood: "neutral", eyeColor: null, followPointer: true });
    expect(back).toEqual(before);
    expect(Object.keys(back)).toEqual(Object.keys(before));
  });
});
