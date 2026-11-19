import { describe, expect, it } from "vitest";

import { EASE, MOTION_MS } from "@/lib/motion";
import { indicatorSlide, TAB_INDICATOR_TRANSITION } from "./TabIndicator";

describe("TabIndicator (#2595)", () => {
  it("slides on the app's motion tokens: moderate, out-quint, no spring", () => {
    expect(TAB_INDICATOR_TRANSITION.type).toBe("tween");
    expect(TAB_INDICATOR_TRANSITION.duration).toBe(MOTION_MS.moderate / 1000);
    expect(`cubic-bezier(${TAB_INDICATOR_TRANSITION.ease.join(", ")})`).toBe(EASE.outQuint);
  });

  it("slides horizontally only: a translateX and a width, never a vertical offset (2026-11-19)", () => {
    const frames = indicatorSlide({ left: 212, width: 52 }, { left: 276, width: 76 });
    expect(frames).not.toBeNull();
    for (const frame of frames!) {
      expect(String(frame.transform)).toMatch(/^translateX\(/);
      expect(Object.keys(frame).sort()).toEqual(["transform", "width"]);
      expect(String(frame.transform)).not.toMatch(/translateY|translate3d|scale|,/);
    }
    expect(frames![0]!.transform).toBe("translateX(-64px)");
    expect(frames![1]!.transform).toBe("translateX(0)");
  });

  it("appears in place, with no slide, when there is no pill to come from or it has not moved", () => {
    expect(indicatorSlide(null, { left: 10, width: 40 })).toBeNull();
    expect(indicatorSlide({ left: 10, width: 40 }, { left: 10, width: 40 })).toBeNull();
  });
});
