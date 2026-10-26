import { describe, expect, it } from "vitest";
import { nextArtifactProblem } from "./artifact-frame";

describe("artifact frame notices", () => {
  it("warns after a slow start and clears that warning once a size arrives", () => {
    expect(nextArtifactProblem(null, "slow")).toBe("slow");
    expect(nextArtifactProblem("slow", "ready")).toBeNull();
  });

  it("keeps a script error in front of a late size", () => {
    expect(nextArtifactProblem(null, "script")).toBe("script");
    expect(nextArtifactProblem("script", "ready")).toBe("script");
    expect(nextArtifactProblem("script", "slow")).toBe("script");
  });
});
