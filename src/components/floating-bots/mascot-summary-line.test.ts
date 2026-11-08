// The mascot's summary line never repeats a part ("Shapes · Shapes", 2026-11-08).
import { describe, expect, it } from "vitest";

import { mascotSummaryLine } from "./MascotLookPreview";

describe("mascotSummaryLine", () => {
  it("drops a part already said, whatever its case", () => {
    expect(mascotSummaryLine("Shapes", "Shapes", "Vivid")).toBe("Shapes · Vivid");
    expect(mascotSummaryLine("Shapes", "shapes")).toBe("Shapes");
  });

  it("skips empty parts and keeps the order", () => {
    expect(mascotSummaryLine("", "Animals", " ", "Vivid", "Animals")).toBe("Animals · Vivid");
  });
});
