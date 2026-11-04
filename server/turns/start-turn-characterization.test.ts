// Characterization (#1388 wave 4 step 3): behaviors at risk when splitting
// createStartTurn. Errors in each phase must reach finally; stream post-dispatch
// follows sendTurn; cancellation, steer/handoff and held runs stay wired.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const startTurnSrc = readFileSync(join(here, "start-turn.ts"), "utf8");
const finishSrc = readFileSync(join(here, "start-turn-finish.ts"), "utf8");

/** Body of `const startTurn = async function startTurn` through its closing. */
function startTurnBody(source: string): string {
  const start = source.indexOf("const startTurn = async function startTurn");
  expect(start).toBeGreaterThan(-1);
  const end = source.lastIndexOf("return startTurn;");
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("startTurn characterization (#1388 w4 step 3)", () => {
  it("keeps one try/catch/finally owned by the turn lifetime (async IIFE)", () => {
    const body = startTurnBody(startTurnSrc);
    const iife = body.indexOf("void (async () => {");
    expect(iife).toBeGreaterThan(-1);
    const region = body.slice(iife);
    const tryAt = region.indexOf("\n    try {");
    const catchAt = region.indexOf("} catch (cause");
    const finallyAt = region.indexOf("} finally {");
    expect(tryAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(tryAt);
    expect(finallyAt).toBeGreaterThan(catchAt);
    // One lifetime try: no second top-level try/catch/finally pair in the IIFE.
    expect(region.match(/\n    try \{/g)?.length ?? 0).toBe(1);
    expect(region.match(/\n    \} catch \(cause/g)?.length ?? 0).toBe(1);
    expect(region.match(/\n    \} finally \{/g)?.length ?? 0).toBe(1);
    // Catch/finally bodies live in the finish leaf, reached through TurnState.
    expect(region).toMatch(/await finishCatch\(state,/);
    expect(region).toMatch(/await finishFinally\(state\)/);
  });

  it("runs stream post-dispatch after sendTurn (bindTurn, markTaskDispatched, drains)", () => {
    const body = startTurnBody(startTurnSrc);
    const stream = readFileSync(join(here, "start-turn-stream.ts"), "utf8");
    const dispatch = readFileSync(join(here, "start-turn-dispatch.ts"), "utf8");
    expect(dispatch).toMatch(/savedSteps\.dispatch\.sendTurn/);
    expect(body).toMatch(/await dispatchStartTurn\(state\)/);
    expect(body).toMatch(/await streamStartTurn\(state\)/);
    const dispatchAt = body.indexOf("await dispatchStartTurn(state)");
    const streamAt = body.indexOf("await streamStartTurn(state)");
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(streamAt).toBeGreaterThan(dispatchAt);
    expect(stream).toMatch(/handoffs\.bindTurn\(/);
    expect(stream).toMatch(/store\.markTaskDispatched\(/);
    expect(stream).toMatch(/drainQueuedSends\(\)/);
    expect(stream).toMatch(/startScreenPoller\(/);
  });

  it("cancellation during setup becomes DirectTurnSetupCancelled and abandons handoffs", () => {
    const body = startTurnBody(startTurnSrc);
    const stream = readFileSync(join(here, "start-turn-stream.ts"), "utf8");
    const setup = readFileSync(join(here, "start-turn-setup.ts"), "utf8");
    expect(stream).toMatch(/DirectTurnSetupCancelled\("turn stopped during provider setup"\)/);
    expect(setup).toMatch(/DirectTurnSetupCancelled\("turn stopped during context setup"\)/);
    expect(setup).toMatch(/await settlePerspicaxPrepare\(\)/);
    expect(setup).toMatch(/DirectTurnSetupCancelled\("turn stopped during Perspicax setup"\)/);
    expect(body).toMatch(/await setupStartTurn\(state\)/);
    expect(finishSrc).toMatch(/handoffs\.abandon\(state\.threadId, state\.dispatchClaimId\)/);
    expect(finishSrc).toMatch(/e instanceof DirectTurnSetupCancelled/);
  });

  it("steer-aware recovery refuses to climb while steered messages are queued", () => {
    const body = startTurnBody(startTurnSrc);
    const dispatch = readFileSync(join(here, "start-turn-dispatch.ts"), "utf8");
    const setup = readFileSync(join(here, "start-turn-setup.ts"), "utf8");
    expect(finishSrc).toMatch(/hasQueuedSteeredMessages\(state\.bot\.id, state\.threadId\)/);
    expect(setup).toMatch(/handoffs\.begin\(/);
    expect(body).toMatch(/await setupStartTurn\(state\)/);
    expect(dispatch).toMatch(/handoffs\.dispatching\(/);
    expect(readFileSync(join(here, "start-turn-stream.ts"), "utf8")).toMatch(/handoffs\.bindTurn\(/);
  });

  it("held direct-machine turns return through holdDirectMachineTurn before admission", () => {
    const body = startTurnBody(startTurnSrc);
    const prepareValidate = readFileSync(join(here, "start-turn-prepare-validate.ts"), "utf8");
    expect(body).toMatch(/await prepareValidateStartTurn\(state\)/);
    expect(startTurnSrc).toMatch(/createPrepareValidateStartTurn\(host, prepareAdmitStartTurn\)/);
    expect(startTurnSrc).toMatch(/createPrepareAdmitStartTurn\(host, prepareClaimStartTurn\)/);
    expect(prepareValidate).toMatch(/return admit\(state\)/);
    const holdAt = prepareValidate.indexOf("holdDirectMachineTurn(");
    const claimAt = prepareValidate.indexOf("assertTurnAdmission(");
    expect(holdAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(holdAt);
    expect(prepareValidate).toMatch(/directMachinePlan\(\{ host: state\.bot\.host/);
    const prepareClaim = readFileSync(join(here, "start-turn-prepare-claim.ts"), "utf8");
    const prepareAdmit = readFileSync(join(here, "start-turn-prepare-admit.ts"), "utf8");
    expect(prepareAdmit).toMatch(/return claim\(state\)/);
    expect(prepareClaim).toMatch(/return function\(state: TurnState\): PrepareResult/);
    expect(prepareClaim).toMatch(/state\.dispatchClaimId = randomUUID\(\)/);
    expect(prepareClaim).toMatch(/watchdog\.watch\(/);
  });

  it("warm finally always settles onWarmSettled and clears the warm dispatch claim", () => {
    expect(finishSrc).toMatch(/if \(state\.warmOnly\)/);
    expect(finishSrc).toMatch(/state\.opts\?\.onWarmSettled\?\.\(state\.warmOk\)/);
    expect(finishSrc).toMatch(/clearDirectTurnDispatch\(state\.threadId, state\.dispatchClaimId\)/);
    expect(finishSrc).toMatch(/handoffs\.abandon\(state\.threadId, state\.dispatchClaimId\)/);
    expect(finishSrc).toMatch(/drainQueuedSends\(\)/);
  });

  it("declares TurnState with warmOk and dispatch up front (no TDZ across try/finally)", async () => {
    const { createTurnState } = await import("./start-turn-state.ts");
    const state = createTurnState({
      botId: "b1",
      text: "hi",
      startTurn: async () => undefined,
    });
    expect(state.warmOk).toBe(false);
    expect(state.dispatch).toBeUndefined();
    expect(state.userMessage).toBeUndefined();
    expect(state.botId).toBe("b1");
    // Mutate only through the object (leaf contract).
    state.warmOk = true;
    state.dispatchClaimId = "gen-1";
    expect(state.warmOk).toBe(true);
    expect(state.dispatchClaimId).toBe("gen-1");
  });
});
