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
    const sendAt = body.indexOf("savedSteps.dispatch.sendTurn");
    const bindAt = body.indexOf("handoffs.bindTurn(");
    const markAt = body.indexOf("store.markTaskDispatched(");
    expect(sendAt).toBeGreaterThan(-1);
    expect(bindAt).toBeGreaterThan(sendAt);
    expect(markAt).toBeGreaterThan(bindAt);
    // Post-dispatch drain of a generation that finished before ACK.
    const post = body.slice(markAt);
    expect(post.indexOf("drainQueuedSends()")).toBeGreaterThan(-1);
    expect(post.indexOf("startScreenPoller(")).toBeGreaterThan(-1);
  });

  it("cancellation during setup becomes DirectTurnSetupCancelled and abandons handoffs", () => {
    const body = startTurnBody(startTurnSrc);
    expect(body).toMatch(/DirectTurnSetupCancelled\("turn stopped during provider setup"\)/);
    expect(body).toMatch(/DirectTurnSetupCancelled\("turn stopped during context setup"\)/);
    expect(finishSrc).toMatch(/handoffs\.abandon\(state\.threadId, state\.dispatchClaimId\)/);
    expect(finishSrc).toMatch(/e instanceof DirectTurnSetupCancelled/);
  });

  it("steer-aware recovery refuses to climb while steered messages are queued", () => {
    const body = startTurnBody(startTurnSrc);
    expect(finishSrc).toMatch(/hasQueuedSteeredMessages\(state\.bot\.id, state\.threadId\)/);
    expect(body).toMatch(/handoffs\.begin\(/);
    expect(body).toMatch(/handoffs\.dispatching\(/);
    expect(body).toMatch(/handoffs\.bindTurn\(/);
  });

  it("held direct-machine turns return through holdDirectMachineTurn before admission", () => {
    const body = startTurnBody(startTurnSrc);
    const holdAt = body.indexOf("holdDirectMachineTurn(");
    const claimAt = body.indexOf("assertTurnAdmission(");
    expect(holdAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(holdAt);
    expect(body).toMatch(/directMachinePlan\(\{ host: state\.bot\.host/);
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
