// #3416: Pulsatrix watches stay off for every bot until the per-person choice of #3408.
// Reads the source of server/index.ts as text: importing it would start the whole server.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

describe("Pulsatrix watch loop wiring", () => {
  const source = readFileSync(INDEX, "utf8");

  it("keeps the watches off for every bot", () => {
    expect(source).toMatch(/^const PULSATRIX_WATCHES_ENABLED = false;$/m);
  });

  it("schedules the watch tick only behind that constant", () => {
    const ticks = [...source.matchAll(/setInterval\(\(\) => void flowWatchLoop\.tick\(\)/g)];
    expect(ticks).toHaveLength(1);
    const before = source.slice(0, ticks[0].index).split("\n").slice(-2).join("\n");
    expect(before).toMatch(/^if \(PULSATRIX_WATCHES_ENABLED && /m);
  });
});
