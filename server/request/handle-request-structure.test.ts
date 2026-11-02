// Characterization (#1388 wave 4 step 2): handleRequest is a thin orchestrator
// of named steps. Pins call order and the under-600-line budget.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/** Brace-span line count of `const handleRequest = async ...`. */
function handleRequestLineCount(source: string): number {
  const start = source.indexOf("const handleRequest = async");
  expect(start).toBeGreaterThan(-1);
  // Prefer the earlyListener sentinel: handleRequest has no type-param braces.
  const end = source.indexOf("\nconst earlyListener", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end).split("\n").length;
}

describe("handleRequest structure (#1388 wave 4 step 2)", () => {
  it("stays under 600 lines", () => {
    const lines = handleRequestLineCount(INDEX);
    expect(lines).toBeLessThan(600);
  });

  it("calls the named pipeline steps in order", () => {
    const start = INDEX.indexOf("const handleRequest = async");
    const end = INDEX.indexOf("\nconst earlyListener", start);
    const body = INDEX.slice(start, end);
    const steps = [
      "parseRequest",
      "originGates",
      "runPreAuth",
      "authenticate",
      "runRoutes",
      "runInternal",
      "fallback",
    ];
    let cursor = 0;
    for (const step of steps) {
      const at = body.indexOf(step, cursor);
      expect(at, `expected ${step} after previous step`).toBeGreaterThan(-1);
      cursor = at + step.length;
    }
  });
});
