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

  it("calls finish, stream and prepare leaves from the orchestrator", () => {
    const src = readFileSync(join(here, "start-turn.ts"), "utf8");
    for (const name of [
      "start-turn-finish.ts",
      "start-turn-stream.ts",
      "start-turn-prepare-validate.ts",
      "start-turn-prepare-admit.ts",
      "start-turn-prepare-claim.ts",
    ]) {
      expect(existsSync(join(here, name)), name).toBe(true);
      const leaf = readFileSync(join(here, name), "utf8");
      expect(leaf.length).toBeGreaterThan(50);
      expect(leaf).not.toMatch(/from ["'].*\/index\.ts["']/);
      expect(leaf).not.toMatch(/let \{[^}]*\} = (?:state|ctx)/);
    }
    expect(src).toMatch(/createFinishStartTurn\(host\)/);
    expect(src).toMatch(/createStreamStartTurn\(host\)/);
    expect(src).toMatch(/createPrepareValidateStartTurn\(host\)/);
    expect(src).toMatch(/createPrepareAdmitStartTurn\(host\)/);
    expect(src).toMatch(/createPrepareClaimStartTurn\(host\)/);
    expect(src).toMatch(/await finishCatch\(state,/);
    expect(src).toMatch(/await finishFinally\(state\)/);
    expect(src).toMatch(/await streamStartTurn\(state\)/);
    expect(src).toMatch(/await prepareValidateStartTurn\(state\)/);
    expect(src).toMatch(/await prepareAdmitStartTurn\(state\)/);
    expect(src).toMatch(/await prepareClaimStartTurn\(state\)/);
  });


  it("wires startTurn through createStartTurn in index", () => {
    const index = readFileSync(join(here, "../index.ts"), "utf8");
    expect(index).toMatch(/import \{ createStartTurn \} from "\.\/turns\/start-turn\.ts"/);
    expect(index).toMatch(/const startTurnRunner = createStartTurn\(/);
    expect(index).toMatch(/async function startTurn\(/);
  });
});
