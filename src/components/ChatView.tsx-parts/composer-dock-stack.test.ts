import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("composer dock stacks above the transcript (#5362)", () => {
  it("keeps the dock above the run overlay and the scrolling messages", () => {
    const src = readFileSync(new URL("./ChatViewShell.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/data-composer-dock="" className="[^"]*z-\[3\]/);
    expect(src).toMatch(/data-run-overlay=""[\s\S]*?z-\[2\]/);
  });
});
