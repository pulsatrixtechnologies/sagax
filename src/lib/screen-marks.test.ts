import { describe, expect, it } from "vitest";
import { anchorOf, containedBox, feedbackText, framePoint, markFromDrag, pagePoint } from "./screen-marks";

describe("screen marks geometry (#4452)", () => {
  it("leaves the letterboxing out of the picture's box", () => {
    expect(containedBox({ left: 10, top: 20, width: 400, height: 400 }, 1280, 640)).toEqual({ left: 10, top: 120, width: 400, height: 200 });
    expect(containedBox({ left: 0, top: 0, width: 0, height: 10 }, 100, 100).width).toBe(0);
  });

  it("maps a pointer to the frame, clamped, null without a size", () => {
    const frame = { left: 10, top: 120, width: 400, height: 200 };
    expect(framePoint(frame, 210, 220)).toEqual({ x: 0.5, y: 0.5 });
    expect(framePoint(frame, 0, 500)).toEqual({ x: 0, y: 1 });
    expect(framePoint({ ...frame, width: 0 }, 1, 1)).toBeNull();
  });

  it("makes each tool's mark from a drag", () => {
    const a = { x: 0.1, y: 0.2 }, b = { x: 0.5, y: 0.6 };
    expect(markFromDrag(1, "highlight", [a, b])?.points).toEqual([a, b]);
    expect(markFromDrag(2, "arrow", [a, b])?.points).toEqual([a, b]);
    expect(markFromDrag(3, "arrow", [a, a])).toBeNull();
    expect(markFromDrag(4, "pen", [a])).toBeNull();
    expect(markFromDrag(5, "pen", [a, b])?.points).toHaveLength(2);
    // a click without a drag is a small zone around the point
    const zone = markFromDrag(6, "highlight", [a, a])!;
    expect(anchorOf(zone).x).toBeCloseTo(0.1);
    expect(zone.points[1]!.x).toBeGreaterThan(zone.points[0]!.x);
  });

  it("asks the page at a zone's middle and an arrow's tip, in page pixels", () => {
    const zone = { id: 1, tool: "highlight" as const, points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.6 }] };
    expect(pagePoint(zone, 1000, 500)).toEqual({ x: 300, y: 200 });
    expect(pagePoint({ id: 2, tool: "arrow", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }] }, 1000, 500)).toEqual({ x: 500, y: 250 });
  });

  it("words the feedback: the page, each element, the note", () => {
    const marks = [
      { id: 1, tool: "highlight" as const, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: 2, tool: "circle" as const, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: 3, tool: "pen" as const, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ];
    const text = feedbackText(marks, [{ url: "https://example.com/a", role: "button", name: "Pay" }, { url: "https://example.com/a", tag: "div" }, null], "  wrong amount ");
    expect(text).toContain("https://example.com/a");
    expect(text).toContain("button “Pay”");
    expect(text).toContain("div");
    expect(text).toContain("Note: wrong amount");
    expect(text.split("\n")).toHaveLength(4);
    // no marks and no answer: still the intro and the note
    expect(feedbackText([], [], "look").split("\n")).toHaveLength(2);
  });
});
