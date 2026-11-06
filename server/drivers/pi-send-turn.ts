/** pi sendTurn orchestration across prepare, rpc, events, and session (#1383). */
import type { SendTurnInput } from "../contracts.ts";
import { preparePiTurn } from "./pi-send-prepare.ts";
import { runPiSession } from "./pi-send-session.ts";
import type { PiSendDeps } from "./pi-turn-ctx.ts";

export function createPiSendTurn(deps: PiSendDeps): (turn: SendTurnInput) => Promise<{ turnId: string }> {
  return async function sendTurn(turn: SendTurnInput): Promise<{ turnId: string }> {
    if (deps.startupModelRefresh) await deps.startupModelRefresh;
    const ctx = await preparePiTurn(deps, turn);
    deps.emit({ ...deps.base(ctx.threadId, ctx.turnId), type: "turn.started" });
    await runPiSession(ctx);
    return { turnId: ctx.turnId };
  };
}
