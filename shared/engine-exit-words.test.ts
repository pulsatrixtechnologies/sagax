import { describe, expect, it } from "vitest";
import { engineExitedLine, isEngineExitedBeforeReply } from "./engine-exit-words.ts";

describe("engine exit words (#3008)", () => {
  it("writes the engine and the stderr tail, and recognizes its own line", () => {
    const line = engineExitedLine("pi", "\nError: spawn npm ENOENT\n");
    expect(line).toBe("pi process exited before replying: Error: spawn npm ENOENT");
    expect(isEngineExitedBeforeReply(line)).toBe(true);
    expect(engineExitedLine("pi", "  ")).toBe("pi process exited before replying");
    expect(engineExitedLine("pi", "x".repeat(500)).length).toBe("pi process exited before replying: ".length + 300);
  });

  it("leaves other causes alone", () => {
    expect(isEngineExitedBeforeReply("404 Not Found")).toBe(false);
    expect(isEngineExitedBeforeReply("the pi process exited before replying")).toBe(false);
  });
});
