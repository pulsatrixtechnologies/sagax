import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("startTurn leaf modules (#1388 w4 step 3)", () => {
  it("exposes createStartTurn and does not import server/index.ts", () => {
    const src = readFileSync(join(here, "start-turn.ts"), "utf8");
    expect(src).toMatch(/export function createStartTurn/);
    expect(src).not.toMatch(/from ["'].*\/index\.ts["']/);
    expect(src).not.toMatch(/from ["']\.\.\/index["']/);
  });


  it("wires startTurn through createStartTurn in index", () => {
    const index = readFileSync(join(here, "../index.ts"), "utf8");
    expect(index).toMatch(/import \{ createStartTurn \} from "\.\/turns\/start-turn\.ts"/);
    expect(index).toMatch(/const startTurnRunner = createStartTurn\(/);
    expect(index).toMatch(/async function startTurn\(/);
  });
});
