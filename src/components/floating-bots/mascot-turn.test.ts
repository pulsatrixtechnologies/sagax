// Turning a shape mascot by hand (#5384): the figures of the open-bot-avatar
// site's stage (its Stage.tsx, 0.5.1), kept as they are there.
import { describe, expect, it } from "vitest";
import { CLICK_SLOP, FRONT, PITCH_LIMIT, RESET_MS, dragView, isDrag, isTurned, keyAction, resetView, wrapYaw } from "./mascot-turn";

describe("dragging the mascot", () => {
  it("turns 0.011 rad a pixel across and 0.009 rad a pixel up, from where the drag began", () => {
    const view = dragView({ yaw: 0.2, pitch: 0.1 }, 100, -50);
    expect(view.yaw).toBeCloseTo(0.2 + 1.1, 6);
    expect(view.pitch).toBeCloseTo(0.1 + 0.45, 6);
  });

  it("never tips past the pitch limit, either way", () => {
    expect(dragView(FRONT, 0, -1000).pitch).toBe(PITCH_LIMIT);
    expect(dragView(FRONT, 0, 1000).pitch).toBe(-PITCH_LIMIT);
    expect(PITCH_LIMIT).toBe(0.9);
  });

  it("lets the yaw go all the way round while dragging, and wraps it on release", () => {
    const view = dragView(FRONT, 400, 0);
    expect(view.yaw).toBeCloseTo(4.4, 6);
    expect(wrapYaw(view.yaw)).toBeCloseTo(4.4 - 2 * Math.PI, 6);
    expect(Math.abs(wrapYaw(100))).toBeLessThanOrEqual(Math.PI);
  });

  it("tells a click from a drag: a press that moved less than the slop is a click", () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(CLICK_SLOP - 1, 0)).toBe(false);
    expect(isDrag(0, -(CLICK_SLOP - 1))).toBe(false);
    expect(isDrag(CLICK_SLOP + 1, 0)).toBe(true);
    expect(isDrag(3, 3)).toBe(true);
  });
});

describe("the keys on the mascot", () => {
  const at = { yaw: 0, pitch: 0 };

  it("turns 0.2 rad with an arrow, 0.6 with Shift", () => {
    const turn = (key: string, shiftKey = false) => {
      const action = keyAction({ key, shiftKey }, at);
      if (action?.kind !== "view") throw new Error(`${key} does not turn`);
      return [Math.round(action.view.yaw * 1e6) / 1e6, Math.round(action.view.pitch * 1e6) / 1e6];
    };
    expect(turn("ArrowLeft")).toEqual([-0.2, 0]);
    expect(turn("ArrowRight")).toEqual([0.2, 0]);
    expect(turn("ArrowUp")).toEqual([0, 0.2]);
    expect(turn("ArrowDown")).toEqual([0, -0.2]);
    expect(turn("ArrowRight", true)).toEqual([0.6, 0]);
  });

  it("clamps the pitch and wraps the yaw", () => {
    expect(keyAction({ key: "ArrowUp", shiftKey: true }, { yaw: 0, pitch: 0.8 })).toEqual({ kind: "view", view: { yaw: 0, pitch: PITCH_LIMIT } });
    const round = keyAction({ key: "ArrowRight" }, { yaw: Math.PI - 0.05, pitch: 0 });
    expect(round?.kind === "view" && round.view.yaw).toBeCloseTo(-Math.PI + 0.15, 6);
  });

  it("brings a turned mascot back with Home, 0 or Escape, and leaves those keys alone when it faces front", () => {
    for (const key of ["Home", "0", "Escape"]) {
      expect(keyAction({ key }, { yaw: 0.4, pitch: 0 })).toEqual({ kind: "reset" });
      expect(keyAction({ key }, at)).toBeNull();
    }
  });

  it("previews one of the six states with 1 to 6, in the engine's order", () => {
    const states = ["idle", "thinking", "working", "waiting", "blocked", "done"];
    states.forEach((state, i) => expect(keyAction({ key: String(i + 1) }, at)).toEqual({ kind: "state", state }));
    expect(keyAction({ key: "7" }, at)).toBeNull();
  });

  it("changes the mood with M, back with Shift+M", () => {
    expect(keyAction({ key: "m" }, at)).toEqual({ kind: "mood", step: 1 });
    expect(keyAction({ key: "M", shiftKey: true }, at)).toEqual({ kind: "mood", step: -1 });
  });

  it("leaves a shortcut of the app alone: no state or mood with Ctrl, Cmd or Alt", () => {
    expect(keyAction({ key: "1", metaKey: true }, at)).toBeNull();
    expect(keyAction({ key: "m", ctrlKey: true }, at)).toBeNull();
    expect(keyAction({ key: "2", altKey: true }, at)).toBeNull();
    expect(keyAction({ key: "Enter" }, at)).toBeNull();
    expect(keyAction({ key: " " }, at)).toBeNull();
  });
});

describe("the way back to the front", () => {
  it("eases out over 420 ms, by the short way round", () => {
    const from = { yaw: 1, pitch: -0.5 };
    expect(RESET_MS).toBe(420);
    expect(resetView(from, 0)).toEqual(from);
    expect(resetView(from, RESET_MS)).toEqual(FRONT);
    expect(resetView(from, 2 * RESET_MS)).toEqual(FRONT);
    const half = resetView(from, RESET_MS / 2);
    // 1 - (1 - 0.5)^3 = 0.875 of the way
    expect(half.yaw).toBeCloseTo(0.125, 6);
    expect(half.pitch).toBeCloseTo(-0.0625, 6);
    // 4.4 rad is the same view as 4.4 - 2π: the way back starts there
    expect(resetView({ yaw: 4.4, pitch: 0 }, 0).yaw).toBeCloseTo(4.4 - 2 * Math.PI, 6);
  });

  it("calls a mascot turned once it is more than 0.01 rad off the front", () => {
    expect(isTurned(FRONT)).toBe(false);
    expect(isTurned({ yaw: 0.005, pitch: -0.005 })).toBe(false);
    expect(isTurned({ yaw: 0.02, pitch: 0 })).toBe(true);
    expect(isTurned({ yaw: 0, pitch: -0.02 })).toBe(true);
  });
});
