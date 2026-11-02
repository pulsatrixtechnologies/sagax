// #1388 wave 4 step 3: runGroupMemberTurn orchestrator (prepare/launch/stream/finish).
// Never imports server/index.ts.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import { createPrepareGroupMemberTurn } from "./group-member-turn-prepare.ts";
import { createLaunchGroupMemberTurn } from "./group-member-turn-launch.ts";
import { createStreamGroupMemberTurn } from "./group-member-turn-stream.ts";
import { createFinishGroupMemberTurn } from "./group-member-turn-finish.ts";

export type { GroupMemberTurnHost };

export function createRunGroupMemberTurn(host: GroupMemberTurnHost) {
  const prepareGroupMemberTurn = createPrepareGroupMemberTurn(host);
  const launchGroupMemberTurn = createLaunchGroupMemberTurn(host);
  const streamGroupMemberTurn = createStreamGroupMemberTurn(host);
  // finish catch/finally run inside launch (same lexical scope as try locals).
  void createFinishGroupMemberTurn(host);

  const runGroupMemberTurn = async function runGroupMemberTurn(
    groupId: string,
    threadId: string,
    botId: string,
    hop: number,
    spoken: Set<string> = new Set(),
    cardContinuation?: string,
    onDispatchError?: (message: string) => void,
    isCancelled?: () => boolean,
    onProviderHandshakeStarted?: () => void,
    onProviderHandshakeSettled?: () => void,
    skillAuthoringClaim: { claimed: boolean } = { claimed: false },
    orchestration?: any,
    operation?: any,
    setupRetry = 0,
    heldTurnId?: string,
  ): Promise<boolean> {
    const ctx: any = {
      groupId, threadId, botId, hop, spoken, cardContinuation, onDispatchError,
      isCancelled, onProviderHandshakeStarted, onProviderHandshakeSettled,
      skillAuthoringClaim, orchestration, operation, setupRetry, heldTurnId,
      runGroupMemberTurn,
    };
    const prepared = await prepareGroupMemberTurn(ctx);
    if (prepared.kind === "return") return prepared.value;
    const ok = await launchGroupMemberTurn(prepared.ctx);
    await streamGroupMemberTurn(prepared.ctx);
    return ok;
  };

  return runGroupMemberTurn;
}
