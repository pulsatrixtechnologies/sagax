// #1388 wave 4 step 3: startTurn runtime (leaf phase modules re-exported).
// Never imports server/index.ts.
import type { StartTurnHost } from "./start-turn-types.ts";
import { createTurnState } from "./start-turn-state.ts";
import { createFinishStartTurn } from "./start-turn-finish.ts";
import { createStreamStartTurn } from "./start-turn-stream.ts";
import { createPrepareValidateStartTurn } from "./start-turn-prepare-validate.ts";
import { createPrepareAdmitStartTurn } from "./start-turn-prepare-admit.ts";
import { createPrepareClaimStartTurn } from "./start-turn-prepare-claim.ts";
import { createDispatchStartTurn } from "./start-turn-dispatch.ts";
import { createPromptStartTurn } from "./start-turn-prompt.ts";
import { createSetupStartTurn } from "./start-turn-setup.ts";
import { createComputerWorkspaceStartTurn } from "./start-turn-computer-workspace.ts";
import { createComputerHelpersStartTurn } from "./start-turn-computer-helpers.ts";
import { createComputerMountStartTurn } from "./start-turn-computer-mount.ts";

export type { StartTurnHost };

export function createStartTurn(host: StartTurnHost) {

  const { finishCatch, finishFinally } = createFinishStartTurn(host);
  const streamStartTurn = createStreamStartTurn(host);
  const prepareValidateStartTurn = createPrepareValidateStartTurn(host);
  const prepareAdmitStartTurn = createPrepareAdmitStartTurn(host);
  const prepareClaimStartTurn = createPrepareClaimStartTurn(host);
  const dispatchStartTurn = createDispatchStartTurn(host);
  const promptStartTurn = createPromptStartTurn(host);
  const setupStartTurn = createSetupStartTurn(host);
  const computerWorkspaceStartTurn = createComputerWorkspaceStartTurn(host);
  const computerHelpersStartTurn = createComputerHelpersStartTurn(host);
  const computerMountStartTurn = createComputerMountStartTurn(host);

  const startTurn = async function startTurn(
    botId: string,
    text: string,
    opts?: any,
  ) {
    const state = createTurnState({ botId, text, opts, startTurn });
    state.enginesRead = host.enginesRead;
    {
      const validated = await prepareValidateStartTurn(state);
      if (validated.kind === "return") return validated.value;
      const admitted = await prepareAdmitStartTurn(state);
      if (admitted.kind === "return") return admitted.value;
      const claimed = await prepareClaimStartTurn(state);
      if (claimed.kind === "return") return claimed.value;
    }

    void (async () => {
    state.warmOk = false;
    try {
      // Setup can finish maintenance or an aborted warm without dispatch.
      const setup = await setupStartTurn(state);
      if (setup?.kind === "return") return;

      await computerWorkspaceStartTurn(state);
      await computerHelpersStartTurn(state);
      await computerMountStartTurn(state);

      await promptStartTurn(state);

      const dispatchedConfig = state.sessionConfig(state.liveBot?.soul ?? state.bot.soul);
      if (state.strictResume && !state.voiceView && !(state.opts?.cardContinuation && state.continuingRoutine) && dispatchedConfig !== state.plannedConfig) state.dispatchContext = state.decideContext(dispatchedConfig);
      await dispatchStartTurn(state);

      await streamStartTurn(state);
    } catch (cause: any) {
      await finishCatch(state, cause);
    } finally {
      await finishFinally(state);
    }
  })();
  return state.userMessage;
};

  return startTurn;
}
