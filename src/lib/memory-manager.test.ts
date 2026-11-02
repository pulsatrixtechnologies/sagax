import { describe, expect, it } from "vitest";

import { detectBodyKind, filterNotes, splitJsonFences } from "./memory-manager";

describe("memory-manager helpers", () => {
  it("detects whole-document JSON vs markdown", () => {
    expect(detectBodyKind('{"a":1}')).toBe("json");
    expect(detectBodyKind("[1,2]")).toBe("json");
    expect(detectBodyKind("# Hello\n\n- item")).toBe("markdown");
    expect(detectBodyKind("not json {")).toBe("markdown");
  });

  it("splits ```json fences out of markdown", () => {
    const parts = splitJsonFences("Before\n```json\n{\"x\":1}\n```\nAfter");
    expect(parts).toEqual([
      { kind: "text", value: "Before\n" },
      { kind: "json", value: "{\"x\":1}\n" },
      { kind: "text", value: "\nAfter" },
    ]);
  });

  it("filters notes by title, folder, tags and excerpt", () => {
    const notes = [
      { id: "1", title: "Dining", folder: "topics", tags: ["food"], excerpt: "pasta" },
      { id: "2", title: "Travel", folder: "logs", tags: ["trip"], excerpt: "trains" },
    ];
    expect(filterNotes(notes, "pasta").map((n) => n.id)).toEqual(["1"]);
    expect(filterNotes(notes, "TRIP").map((n) => n.id)).toEqual(["2"]);
    expect(filterNotes(notes, "").map((n) => n.id)).toEqual(["1", "2"]);
  });
});
