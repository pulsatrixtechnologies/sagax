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

  it("defers the Connectors card bots save past dispatched (#1950 leftover on #1971)", () => {
    const prompt = readFileSync(join(here, "start-turn-prompt.ts"), "utf8");
    const dispatch = readFileSync(join(here, "start-turn-dispatch.ts"), "utf8");
    expect(prompt).not.toMatch(/connectors:\s*turnConnectorsFor/);
    expect(prompt).not.toMatch(/connectors-patched/);
    expect(dispatch).toMatch(/deferConnectorsPatch\(/);
    expect(dispatch).toMatch(/connectors-patched/);
    const dispatchedAt = dispatch.indexOf('turnTrace(state.threadId, "dispatched")');
    const deferAt = dispatch.indexOf("deferConnectorsPatch(");
    expect(dispatchedAt).toBeGreaterThan(-1);
    expect(deferAt).toBeGreaterThan(dispatchedAt);
  });

  it("starts Perspicax prepare beside compact and awaits it before mounts (#1955)", () => {
    const setup = readFileSync(join(here, "start-turn-setup.ts"), "utf8");
    expect(setup).toMatch(/perspicaxTurnPrepare\(/);
    expect(setup).toMatch(/perspicaxPrepared/);
    const prepareAt = setup.indexOf("perspicaxTurnPrepare({");
    const compactAt = setup.indexOf("await compactConversation(");
    const mountAt = setup.indexOf("await perspicaxTurnIntegration(");
    expect(prepareAt).toBeGreaterThan(-1);
    expect(compactAt).toBeGreaterThan(prepareAt);
    expect(mountAt).toBeGreaterThan(compactAt);
    expect(setup).toMatch(/prepared: perspicaxPrepared/);
    expect(setup).toMatch(/settlePerspicaxPrepare/);
  });

  it("calls finish, stream and prepare leaves from the orchestrator", () => {
    const src = readFileSync(join(here, "start-turn.ts"), "utf8");
    for (const name of [
      "start-turn-finish.ts",
      "start-turn-stream.ts",
      "start-turn-prepare-validate.ts",
      "start-turn-prepare-admit.ts",
      "start-turn-prepare-claim.ts",
      "start-turn-dispatch.ts",
      "start-turn-prompt.ts",
      "start-turn-setup.ts",
      "start-turn-computer-mount.ts",
      "start-turn-computer-helpers.ts",
      "start-turn-computer-workspace.ts",
    ]) {
      expect(existsSync(join(here, name)), name).toBe(true);
      const leaf = readFileSync(join(here, name), "utf8");
      expect(leaf.length).toBeGreaterThan(50);
      expect(leaf).not.toMatch(/from ["'].*\/index\.ts["']/);
      expect(leaf).not.toMatch(/let \{[^}]*\} = (?:state|ctx)/);
    }
    expect(src).toMatch(/createFinishStartTurn\(host\)/);
    expect(src).toMatch(/createStreamStartTurn\(host\)/);
    expect(src).toMatch(/createPrepareValidateStartTurn\(host, prepareAdmitStartTurn\)/);
    expect(src).toMatch(/createPrepareAdmitStartTurn\(host, prepareClaimStartTurn\)/);
    expect(src).toMatch(/createPrepareClaimStartTurn\(host\)/);
    expect(src).toMatch(/createDispatchStartTurn\(host\)/);
    expect(src).toMatch(/createPromptStartTurn\(host\)/);
    expect(src).toMatch(/await finishCatch\(state,/);
    expect(src).toMatch(/await finishFinally\(state\)/);
    expect(src).toMatch(/await streamStartTurn\(state\)/);
    expect(src).toMatch(/await prepareValidateStartTurn\(state\)/);
    expect(src).not.toMatch(/await prepareAdmitStartTurn\(state\)/);
    expect(src).not.toMatch(/await prepareClaimStartTurn\(state\)/);
    expect(src).toMatch(/await dispatchStartTurn\(state\)/);
    expect(src).toMatch(/createPromptStartTurn\(host\)/);
    expect(src).toMatch(/await promptStartTurn\(state\)/);
    expect(src).toMatch(/createSetupStartTurn\(host\)/);
    expect(src).toMatch(/await setupStartTurn\(state\)/);
    expect(src).toMatch(/createComputerWorkspaceStartTurn\(host\)/);
    expect(src).toMatch(/createComputerHelpersStartTurn\(host\)/);
    expect(src).toMatch(/createComputerMountStartTurn\(host\)/);
    expect(src).toMatch(/await computerWorkspaceStartTurn\(state\)/);
    expect(src).toMatch(/await computerHelpersStartTurn\(state\)/);
    expect(src).toMatch(/await computerMountStartTurn\(state\)/);
  });


  it("wires startTurn through createStartTurn in index", () => {
    const index = readFileSync(join(here, "../index.ts"), "utf8");
    expect(index).toMatch(/import \{ createStartTurn \} from "\.\/turns\/start-turn\.ts"/);
    expect(index).toMatch(/const startTurnRunner = createStartTurn\(/);
    expect(index).toMatch(/async function startTurn\(/);
  });

  it("hands startTurnRunner every host dep the start-turn leaves call (#3315)", () => {
    const index = readFileSync(join(here, "../index.ts"), "utf8");
    const start = index.indexOf("const startTurnRunner = createStartTurn({");
    expect(start).toBeGreaterThan(-1);
    const block = index.slice(start, index.indexOf("\n});", start));
    for (const dep of ["signedOutTurnSelection", "noteSignedOutTurn"]) {
      expect(block).toMatch(new RegExp(`^\\s+${dep},$`, "m"));
    }
    const validate = readFileSync(join(here, "start-turn-prepare-validate.ts"), "utf8");
    expect(validate).toMatch(/signedOutTurnSelection\(/);
    const finish = readFileSync(join(here, "start-turn-finish.ts"), "utf8");
    expect(finish).toMatch(/host\.noteSignedOutTurn\?\.\(/);
  });
});
