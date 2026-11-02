/** ACP sendTurn orchestration (prepare, warm, establish, prompt, finish). */
import { TurnNotStartedError } from "../../contracts.ts";
import type { SendTurnInput } from "../../contracts.ts";
import { stripLeakedSystemHarnessMessages } from "../../../shared/system-message-guard.ts";
import { ACP_CANCEL_GRACE_MS } from "./constants.ts";
import { acpVariantOption } from "./helpers.ts";
import type { AcpAskFinish, AcpTurn } from "./types.ts";
import { establishAcpTurn } from "./turn-establish.ts";
import { promptAcpTurn } from "./turn-prompt.ts";
import { finishAcpTurnError } from "./turn-finish.ts";
import { createPrepareTurn } from "./turn-prepare.ts";
import type { AcpTurnCtx } from "./turn-context.ts";
import type { SendTurnDeps } from "./turn-deps.ts";
export type { SendTurnDeps } from "./turn-deps.ts";

export function createSendTurn(deps: SendTurnDeps) {
  const {
    support, DRIVER_KIND,
    sessions, active, freshNextTurn, sessionAllows, threadNotices,
    retiring, retireChild, closeSession, settle, emit, base,
    startQuietWatch,
  } = deps;
  const prepareAcpTurn = createPrepareTurn(deps);

  return async function sendTurn(turn: SendTurnInput) {
    const prepared = await prepareAcpTurn(turn);
    if (prepared.kind === "early") return prepared.result;
    const {
      turn: preparedTurn, turnId, threadId, turnConfig, cwd, controlsHost, cliTurn,
      callAgentsEnv, spawnEnv, mcpServers, sessionKey, cursor, renewedFromChat,
      launchedThisTurn, reused, latency, session, sessionRef, request, initialize, authenticateOnce,
      sessionInputs, launchSession, approvalGated, env,
    } = prepared;
    turn = preparedTurn;
    void env;

        const state: AcpTurn["state"] = { settled: false, promptSent: false, text: "", producedItem: false, startupActivity: false, stopped: false, usagePeak: null, usageLast: null, usageCompacted: false };
        let acknowledge = () => {};
        let rejectStartup = (_error: TurnNotStartedError) => {};
        const started = { turnId, ...(reused ? { reused: true } : {}) };
        const startupAck = turn.startupRecovery ? new Promise<{ turnId: string; reused?: boolean }>((resolve, reject) => {
          acknowledge = () => resolve(started);
          rejectStartup = reject;
        }) : null;
        const asks = new Map<string, AcpAskFinish>();
        // What this turn reports and applies. A model fallback (below)
        // replaces both: a saved variant belongs to the model it replaced.
        let reportedModel = turn.model;
        let variant = turn.variant;
        // set below when this process lists fewer models than the catalog
        let staleProcess = false;
        // Set while a sessionScopedApproval support applies this turn's mode.
        // Still set if that throws: the pooled session may be left on an
        // earlier turn's looser mode, so its process must not be reused.
        let approvalUnconfirmed = false;
        const modelOf = (result: any): string | null => {
          const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find(
            (entry: any) => entry?.id === (support.selectModel?.configId ?? "model"),
          );
          return typeof option?.currentValue === "string" ? option.currentValue : null;
        };
        const receiveModelVariants = (result: any) => {
          session.sessionConfigResult = result;
          if (!support.modelVariants) return;
          const nativeModel = modelOf(result) ?? cliTurn.model;
          if (!nativeModel) return;
          const option = acpVariantOption(result);
          emit({
            ...base(threadId, turnId),
            type: "session.model-variants",
            model: nativeModel === cliTurn.model ? (reportedModel ?? nativeModel) : nativeModel,
            variants: {
              options: option?.options ?? [],
              ...(option?.currentValue !== undefined ? { currentValue: option.currentValue } : {}),
            },
          });
        };
        const requestedVariantOption = () => {
          if (!support.modelVariants) throw new Error(`${support.displayName} does not support model variants`);
          const option = acpVariantOption(session.sessionConfigResult);
          if (!option || !option.options.some((entry) => entry.id === variant)) {
            throw new Error(`${support.displayName} does not advertise variant ${variant} for this model`);
          }
          return option;
        };

        /** Emit buffered assistant text as its own item, then clear it. */
        const flushAssistantText = () => {
          const raw = state.text;
          state.text = "";
          const text = stripLeakedSystemHarnessMessages(raw);
          if (!text.trim()) return;
          state.producedItem = true;
          emit({ ...base(threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
        };
        const current: AcpTurn = {
          turnId,
          turn: cliTurn,
          turnConfig,
          controlsHost,
          ...(approvalGated ? { gatedServers: new Set(mcpServers.map((server: { name: string }) => server.name)) } : {}),
          mountedServers: new Set(mcpServers.map((server: { name: string }) => server.name)),
          state,
          latency,
          acknowledge,
          asks,
          runningTools: new Set(),
          unkeyedToolIds: [],
          endedToolIds: new Set(),
          interruptTimer: null,
          stopQuietWatch: null,
          flushAssistantText,
          receiveModelVariants,
        };

        const interrupt = () => {
          state.stopped = true;
          if (session.sessionId) {
            session.acp.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: session.sessionId } });
            if (current.interruptTimer) clearTimeout(current.interruptTimer);
            current.interruptTimer = setTimeout(() => {
              // an agent that ignores session/cancel must not stay pooled
              closeSession(threadId, "cancel-timeout");
              settle(threadId, session, true, "cancelled");
            }, ACP_CANCEL_GRACE_MS);
            current.interruptTimer.unref?.();
          } else {
            // no native session to cancel — the close handler settles
            closeSession(threadId, "stop");
          }
        };
        active.set(threadId, { stop: () => { state.stopped = true; closeSession(threadId, "stop"); }, interrupt, turnId, asks });
        emit({ ...base(threadId, turnId), type: "turn.started" });
        session.current = current;

        const ctx: AcpTurnCtx = {
          support, DRIVER_KIND, turn, turnId, threadId, turnConfig, cwd, spawnEnv, mcpServers,
          sessionKey, cursor, renewedFromChat, launchedThisTurn, reused, latency, controlsHost,
          callAgentsEnv, session, sessionRef, current, state, asks, cliTurn, promptTurn: turn,
          reportedModel, variant, staleProcess: false, approvalUnconfirmed: false,
          accountModels: deps.getAccountModels(), models: deps.getModels(), pendingSplitReceipt: null, runtimeAcceptsImages: false,
          init: null, selectedModel: null, sessionId: "", rebuiltFromReplay: renewedFromChat,
          acknowledge, rejectStartup, startupAck, started,
          sessions, active, freshNextTurn, sessionAllows, threadNotices, retiring, retireChild,
          closeSession, settle, emit, base, startQuietWatch, request, initialize, authenticateOnce,
          sessionInputs, launchSession, setAccountModels: deps.setAccountModels,
        };
        ctx.cliTurn = cliTurn;
        ctx.promptTurn = turn;
        void staleProcess; void approvalUnconfirmed; void requestedVariantOption;

        (async () => {
          try {
            await establishAcpTurn(ctx);
            await promptAcpTurn(ctx);
          } catch (e) {
            await finishAcpTurnError(ctx, e);
          }
        })();

        return startupAck ?? started;
  }
}
