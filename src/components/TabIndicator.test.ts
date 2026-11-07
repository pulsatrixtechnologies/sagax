import { describe, expect, it } from "vitest";

import { EASE, MOTION_MS } from "@/lib/motion";
import { TAB_INDICATOR_TRANSITION } from "./TabIndicator";

describe("TabIndicator (#2595)", () => {
  it("slides on the app's motion tokens: moderate, out-quint, no spring", () => {
    expect(TAB_INDICATOR_TRANSITION.type).toBe("tween");
    expect(TAB_INDICATOR_TRANSITION.duration).toBe(MOTION_MS.moderate / 1000);
    expect(`cubic-bezier(${TAB_INDICATOR_TRANSITION.ease.join(", ")})`).toBe(EASE.outQuint);
  });
});
