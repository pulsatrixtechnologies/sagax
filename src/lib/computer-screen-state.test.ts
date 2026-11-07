// The Computer card's look follows the real state (JC 2026-11-07).
import { describe, expect, it } from "vitest";

import { cloudStatusAsleep, computerCardView, localScreenProblem } from "./computer-screen-state";

describe("localScreenProblem", () => {
  it("names each reason a screen has no picture", () => {
    expect(localScreenProblem({ inApp: false, mac: true, screenPermission: "granted" })).toBe("desktop-app-only");
    expect(localScreenProblem({ inApp: true, mac: true, screenPermission: "granted", failed: true })).toBe("capture-failed");
    expect(localScreenProblem({ inApp: true, mac: true, screenPermission: "denied" })).toBe("permission");
    expect(localScreenProblem({ inApp: true, mac: true, screenPermission: undefined })).toBe("permission");
    expect(localScreenProblem({ inApp: true, mac: true, screenPermission: "granted" })).toBe("empty");
    expect(localScreenProblem({ inApp: true, mac: false })).toBe("empty");
  });
});

describe("computerCardView", () => {
  it("off or offline: asleep thumbnail and Asleep line", () => {
    expect(computerCardView({ busy: false, off: true, source: "none", hasCapture: true })).toEqual({ thumb: "asleep", status: "asleep", problem: null });
    expect(computerCardView({ busy: false, source: "local", online: false, hasCapture: true })).toEqual({ thumb: "asleep", status: "asleep", problem: null });
    expect(computerCardView({ busy: false, source: "cloud", cloudAsleep: true, hasCapture: true })).toEqual({ thumb: "asleep", status: "asleep", problem: null });
  });

  it("a busy cloud computer is never shown asleep", () => {
    expect(computerCardView({ busy: true, source: "cloud", cloudAsleep: true, hasCapture: true }).status).toBe("working");
  });

  it("awake with a capture: the real screen", () => {
    expect(computerCardView({ busy: false, source: "cloud", hasCapture: true })).toEqual({ thumb: "screen", status: "awake", problem: null });
    expect(computerCardView({ busy: true, source: "local", hasCapture: true, localProblem: "permission" }).thumb).toBe("screen");
  });

  it("awake without a capture: unavailable with the real reason, never a wallpaper", () => {
    expect(computerCardView({ busy: false, source: "local", hasCapture: false, localProblem: "permission" })).toEqual({ thumb: "unavailable", status: "awake", problem: "permission" });
    expect(computerCardView({ busy: false, source: "local", hasCapture: false, localProblem: "empty" }).problem).toBe("no-capture");
    expect(computerCardView({ busy: false, source: "cloud", hasCapture: false, localProblem: "permission" }).problem).toBe("no-capture");
    expect(computerCardView({ busy: false, source: "none", hasCapture: false })).toEqual({ thumb: "unavailable", status: "awake", problem: "no-computer" });
  });
});

describe("cloudStatusAsleep", () => {
  it("reads stopped, archived and missing as asleep, ready and unknown as awake", () => {
    expect(cloudStatusAsleep({ configured: true, box: { state: "stopped" } })).toBe(true);
    expect(cloudStatusAsleep({ configured: true, box: { state: "archived" } })).toBe(true);
    expect(cloudStatusAsleep({ configured: true, box: null })).toBe(true);
    expect(cloudStatusAsleep({ configured: true, box: { state: "running" } })).toBe(false);
    expect(cloudStatusAsleep({ configured: false })).toBe(false);
    expect(cloudStatusAsleep(null)).toBe(false);
  });
});
