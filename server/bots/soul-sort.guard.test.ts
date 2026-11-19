// #5019: every soul write reaches the soul sort. A soul is written only by
// the store (its hash is set nowhere else), and every store method that
// sets a soul's hash says how the write is noted (store.noteSoulWrite).
// A new path that writes a soul without the sort fails here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== "testing") sources(path, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

describe("every soul write is sorted (#5019)", () => {
  it("only the store sets a soul's hash", () => {
    const writers = sources(ROOT)
      .filter((path) => !path.endsWith(join("server", "store.ts")) && !path.endsWith(join("bots", "bot-folder.ts")))
      .filter((path) => /\bsoulHash\s*[:=]\s*soulHash\(|\.soulHash\s*=/.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path));
    expect(writers).toEqual([]);
  });

  it("each soul write in the store says how it is noted", () => {
    const lines = readFileSync(join(ROOT, "store.ts"), "utf8").split("\n");
    const unmarked = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /soulHash\(/.test(line) && !/import /.test(line))
      .filter(({ index }) => !lines.slice(Math.max(0, index - 2), index + 1).some((line) => line.includes("// soul write:")))
      .map(({ line, index }) => `${index + 1}: ${line.trim()}`);
    expect(unmarked).toEqual([]);
    const source = lines.join("\n");
    // the hook itself: each noted write reaches it
    expect(source.match(/this\.noteSoulWrite\(/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
