import { describe, expect, it } from "vitest";
import { contextBuckets, measureContextBuckets } from "./context-buckets.ts";

describe("context buckets", () => {
  it("keeps only the sizes that were measured", () => {
    expect(measureContextBuckets({
      sections: [
        { id: "memory", bytes: 120 },
        { id: "team-memory", bytes: 30 },
        { id: "skills", bytes: 80 },
        { id: "skill-instructions", text: "abcd" },
        { id: "persona", bytes: 500 },
      ],
      promptBytes: 900,
      messages: 14,
      toolsBytes: 400,
      agentsBytes: 0,
    })).toEqual({ messages: 14, tools: 400, memory: 150, skills: 84, prompt: 900 });
  });

  it("drops a bucket that was not measured, including an empty catalog", () => {
    expect(measureContextBuckets({ sections: [{ id: "memory", bytes: 0 }], messages: 0 })).toBeUndefined();
    expect(contextBuckets({ messages: -1, tools: 1.5, other: 9, prompt: 4 })).toEqual({ prompt: 4 });
    expect(contextBuckets(null)).toBeUndefined();
  });
});
