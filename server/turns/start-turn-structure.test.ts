import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("startTurn leaf modules (#1388 w4 step 3)", () => {
  it("exposes createStartTurn and does not import server/index.ts", () => {
    const src = readFileSync(join(here, "start-turn.ts"), "utf8");
    expect(src).toMatch(/export function createStartTurn/);
    expect(src).toMatch(/createTurnState\(/);
    expect(src).not.toMatch(/from ["'].*\/index\.ts["']/);
    expect(src).not.toMatch(/from ["']\.\.\/index["']/);
  });

  it("declares TurnState in start-turn-state.ts", () => {
    const src = readFileSync(join(here, "start-turn-state.ts"), "utf8");
    expect(src).toMatch(/export type TurnState/);
    expect(src).toMatch(/export function createTurnState/);
    expect(src).not.toMatch(/from ["'].*\/index\.ts["']/);
  });

  it("calls start-turn-finish handlers from the orchestrator try/catch/finally", () => {
    const src = readFileSync(join(here, "start-turn.ts"), "utf8");
    expect(existsSync(join(here, "start-turn-finish.ts"))).toBe(true);
    expect(src).toMatch(/createFinishStartTurn\(host\)/);
    expect(src).toMatch(/await finishCatch\(state,/);
    expect(src).toMatch(/await finishFinally\(state\)/);
    const finish = readFileSync(join(here, "start-turn-finish.ts"), "utf8");
    expect(finish).toMatch(/export function createFinishStartTurn/);
    expect(finish).not.toMatch(/from ["'].*\/index\.ts["']/);
    // No destructure of TurnState into locals (the failed split's TDZ pattern).
    expect(finish).not.toMatch(/let \{[^}]*\} = (?:state|ctx)/);
  });


  it("wires startTurn through createStartTurn in index", () => {
    const index = readFileSync(join(here, "../index.ts"), "utf8");
    expect(index).toMatch(/import \{ createStartTurn \} from "\.\/turns\/start-turn\.ts"/);
    expect(index).toMatch(/const startTurnRunner = createStartTurn\(/);
    expect(index).toMatch(/async function startTurn\(/);
  });
});
