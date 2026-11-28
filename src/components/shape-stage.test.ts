// #5384: a shape mascot on a stage (the bot page's hero, the bot panel's
// avatar) is turned by hand, as on the open-bot-avatar site. Off a stage, and
// on a stage that faces front, a mascot draws exactly what it drew before
// (D-20261119-031).
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { avatarFrame } from "open-bot-avatar";
import { beforeAll, describe, expect, it } from "vitest";
import { MAUS_COLORS } from "@/lib/mascot";
import { shapeDefinition, shapesMarkup } from "./shape-avatar";
import { shapeSkinPaint } from "./shape-look";
import { canvasOptions } from "./shape-material";
import { ShapeStageContext, type ShapeStage } from "./shape-stage";
import { loadAllBakedStills } from "./shape-stills";
import { ShapeMascot, type ShapeMascotProps } from "./ShapeMascot";

const uidless = (html: string) => html.replace(/shape-[A-Za-z0-9_-]+/g, "uid");
const FRONT = { yaw: 0, pitch: 0 };
const stage = (extra: Partial<ShapeStage> = {}): ShapeStage => ({ view: FRONT, holdGaze: false, previewState: null, ...extra });
const mascot = (props: Partial<ShapeMascotProps> = {}): ReactNode => createElement(ShapeMascot, { shape: "cup", color: "blue", size: 160, ...props });
/** The markup as drawn (its attributes read as they are). */
const raw = (props: Partial<ShapeMascotProps> = {}, on?: ShapeStage) => renderToStaticMarkup(on ? createElement(ShapeStageContext.Provider, { value: on }, mascot(props)) : mascot(props));
/** The markup with the per-mount ids taken out, to compare two drawings. */
const draw = (props: Partial<ShapeMascotProps> = {}, on?: ShapeStage) => uidless(raw(props, on));

beforeAll(async () => {
  await loadAllBakedStills();
});

describe("a mascot on a stage that faces front (#5384, D-20261119-031)", () => {
  it("draws the same markup as the mascot off a stage, large or small, live or still", () => {
    expect(draw({}, stage())).toBe(draw());
    expect(draw({ size: 28, animated: false }, stage())).toBe(draw({ size: 28, animated: false }));
    expect(draw({ skin: "neon" }, stage())).toBe(draw({ skin: "neon" }));
    expect(draw({ agentState: "working" }, stage())).toBe(draw({ agentState: "working" }));
    expect(draw({ engineLook: { mood: "happy" } }, stage())).toBe(draw({ engineLook: { mood: "happy" } }));
  });

  it("a mascot turned less than a hundredth of a radian still faces front", () => {
    expect(draw({}, stage({ view: { yaw: 0.005, pitch: -0.005 } }))).toBe(draw());
  });
});

describe("a mascot turned by hand (#5384)", () => {
  const view = { yaw: 0.8, pitch: -0.3 };

  it("draws the engine's frame under that view, and says how it is turned", () => {
    const html = draw({}, stage({ view }));
    expect(raw({}, stage({ view }))).toContain('data-shape-view="0.8 -0.3"');
    const frame = avatarFrame(shapeDefinition("cup"), { state: "idle", mood: "neutral", view, reducedMotion: true });
    const ink = shapeSkinPaint("plain", MAUS_COLORS.blue).eyes.toLowerCase();
    expect(html).toContain(uidless(shapesMarkup(frame.shapes, ink, "shape-x-")));
    expect(html).not.toBe(draw({}, stage()));
    expect(raw()).not.toContain("data-shape-view");
  });

  it("a small thumbnail is never turned, even inside a stage", () => {
    const small = { size: 28, animated: false };
    expect(draw(small, stage({ view }))).toBe(draw(small));
    expect(draw({ detail: "static" }, stage({ view }))).toBe(draw({ detail: "static" }));
  });

  it("a mascot drawn under the live size on its own stage (the bot panel's avatar) is the still image at rest and is turned like the large one", () => {
    const panel = { size: 64 };
    const view = { yaw: 0.8, pitch: -0.3 };
    // at rest: what it drew off a stage [D-20261119-031]
    expect(draw(panel, stage({ small: true }))).toBe(draw(panel));
    expect(draw({ ...panel, agentState: "working" }, stage({ small: true }))).toBe(draw({ ...panel, agentState: "working" }));
    // turned, dragged or previewing: the moving drawing
    const turned = raw(panel, stage({ small: true, view }));
    expect(turned).toContain('data-shape-view="0.8 -0.3"');
    expect(turned).toContain("data-shape-live");
    expect(raw(panel, stage({ small: true, previewState: "blocked" }))).toContain('data-agent-state="blocked"');
    // a thumbnail inside a large mascot's stage is still never turned
    expect(draw(panel, stage({ view }))).toBe(draw(panel));
    expect(draw({ ...panel, detail: "static" }, stage({ small: true, view }))).toBe(draw({ ...panel, detail: "static" }));
  });

  it("under reduced motion the mascot on a stage stays the moving drawing (it turns, its eyes follow), and off a stage it stays the still image", () => {
    const reduced = { engineLook: { motion: "reduced" as const } };
    expect(raw(reduced)).toContain("<img");
    expect(raw(reduced)).not.toContain("data-shape-live");
    const on = raw(reduced, stage({ view }));
    expect(on).toContain("data-shape-live");
    expect(on).toContain('data-shape-view="0.8 -0.3"');
    // facing front, a reduced mascot on a stage is the moving drawing too: its eyes follow the pointer as the engine's do
    expect(raw(reduced, stage())).toContain("data-shape-live");
  });
});

describe("a state previewed on the stage (#5384)", () => {
  it("shows that state in place of the bot's own, and only there", () => {
    expect(draw({ agentState: "idle" }, stage({ previewState: "blocked" }))).toContain('data-agent-state="blocked"');
    expect(draw({ agentState: "working" }, stage({ previewState: "idle" }))).toContain('data-agent-state="idle"');
    expect(draw({ agentState: "working" }, stage())).toContain('data-agent-state="working"');
    expect(draw({ agentState: "idle", size: 28, animated: false }, stage({ previewState: "blocked" }))).toContain('data-agent-state="idle"');
  });
});

describe("a body in a material, on the engine's own canvas (#5384)", () => {
  const base = { definition: shapeDefinition("cup"), material: { id: "glass" } as never, color: "#1f7cf2", ink: "#151515", depth: undefined, pose: { state: "idle" as const, mood: "neutral" as const, motion: "idle" as const }, followPointer: true, live: true, reduced: false };

  it("hands the engine the view and the held gaze of the stage", () => {
    const options = canvasOptions({ ...base, view: { yaw: 0.8, pitch: -0.3 }, holdGaze: true });
    expect(options.view).toEqual({ yaw: 0.8, pitch: -0.3 });
    expect(options.holdGaze).toBe(true);
    expect(options.still).toBe(false);
  });

  it("off a stage asks for no view and holds no gaze", () => {
    const options = canvasOptions(base);
    expect(options.view).toBeUndefined();
    expect(options.holdGaze).toBe(false);
  });

  it("tells the engine the motion the person chose, never leaving it to the device alone", () => {
    expect(canvasOptions(base).reducedMotion).toBe(false);
    expect(canvasOptions({ ...base, reduced: true }).reducedMotion).toBe(true);
    // reduced and off a stage: the engine's still, as before
    expect(canvasOptions({ ...base, reduced: true, live: false }).still).toBe(true);
    expect(canvasOptions({ ...base, reduced: true, live: false }).followPointer).toBe(false);
  });

  it("maps activity through mountPose: thinking keeps the body, mood stays apart (#5539, #5540)", () => {
    const thinking = canvasOptions({ ...base, pose: { state: "thinking", mood: "neutral", motion: "thinking" }, live: false, followPointer: false });
    expect(thinking.state).toBe("idle");
    expect(thinking.mood).toBe("neutral");
    expect(thinking.view).toEqual({ yaw: 0.12, pitch: 0.08 });
    expect(thinking.lookAt).toEqual({ x: 0.55, y: -0.8 });
    const happyWork = canvasOptions({ ...base, pose: { state: "working", mood: "happy", motion: null } });
    expect(happyWork.state).toBe("working");
    expect(happyWork.mood).toBe("happy");
    expect(happyWork.lookAt).toBeUndefined();
    const busyHappy = canvasOptions({ ...base, pose: { state: "thinking", mood: "happy", motion: "happy" }, live: false, followPointer: false });
    expect(busyHappy.state).toBe("idle");
    expect(busyHappy.mood).toBe("happy");
    expect(busyHappy.lookAt).toBeUndefined();
  });
});

describe("the ribbons of a state, on the app's own drawing (#5384)", () => {
  it("are shades of the bot's colour, as the engine paints them, never of the engine's default orange", async () => {
    const { liveStateFrame } = await import("./ShapeMascot");
    const definition = shapeDefinition("cup");
    const at = { state: "done" as const, mood: "happy" as const, stateAge: 0.6, time: 0.6, reducedMotion: false };
    const stopsOf = (frame: ReturnType<typeof avatarFrame>) => frame.shapes.flatMap((shape) => (shape.kind === "ribbon" ? shape.gradient.stops : []));
    const teal = stopsOf(liveStateFrame(definition, { ...at, color: "#14b3a5" }));
    expect(teal.length).toBeGreaterThan(0);
    expect(teal).toEqual(stopsOf(avatarFrame(definition, { ...at, color: "#14b3a5" })));
    expect(teal).not.toEqual(stopsOf(avatarFrame(definition, at)));
  });
});
