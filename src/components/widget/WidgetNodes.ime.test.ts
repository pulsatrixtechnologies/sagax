import { describe, expect, it } from "vitest";

import { imeComposing } from "@/lib/send-key";

describe("widget form enter", () => {
  it("treats the confirming enter WebKit sends after composition as still composing", () => {
    expect(imeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(imeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(imeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
