/** ACP turn establish phase: handshake, session/load|new, model and approval. */
import { recoveryPromptFor } from "../../resume-recovery.ts";
import { contextRenewedNotice } from "../../context-renewal.ts";
import {
  INIT_TIMEOUT, LOAD_SESSION_TIMEOUT, NEW_SESSION_TIMEOUT, SESSION_CONFIG_TIMEOUT,
} from "./constants.ts";
import { acpVariantOption, offeredModels, skipSubscriptionAuthForLocalInject } from "./helpers.ts";
import type { AcpTurnCtx } from "./turn-context.ts";

export async function establishAcpTurn(ctx: AcpTurnCtx): Promise<void> {
  const {
    support, DRIVER_KIND, turn, turnId, threadId, turnConfig, cwd, spawnEnv, mcpServers,
    sessionKey, cursor, renewedFromChat, launchedThisTurn, reused, latency, controlsHost,
    retiring, retireChild, closeSession, sessions, sessionAllows, emit, base,
    request, initialize, authenticateOnce, sessionInputs, launchSession, settle,
    active, freshNextTurn, threadNotices, startQuietWatch, setAccountModels, asks,
    acknowledge, rejectStartup, startupAck, started,
  } = ctx;
  let session = ctx.session;
  const sessionRef = ctx.sessionRef;
  let state = ctx.state;
  let current = ctx.current;
  let cliTurn = ctx.cliTurn;
  let promptTurn = ctx.promptTurn;
  let reportedModel = ctx.reportedModel;
  let variant = ctx.variant;
  let staleProcess = ctx.staleProcess;
  let approvalUnconfirmed = ctx.approvalUnconfirmed;
  let accountModels = ctx.accountModels;
  let models = ctx.models;
  let pendingSplitReceipt = ctx.pendingSplitReceipt;
  let runtimeAcceptsImages = ctx.runtimeAcceptsImages;
  let init = ctx.init;
  let selectedModel = ctx.selectedModel;
  let rebuiltFromReplay = ctx.rebuiltFromReplay;
  void reused; void latency; void controlsHost; void settle; void active; void freshNextTurn;
  void startQuietWatch; void asks; void acknowledge; void rejectStartup; void startupAck; void started;
  void spawnEnv;

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

// The handshake is paid once per process, not once per turn. It
// is a function so the establishment retry below can pay it
// again on a replacement child.
// Returns whether this runtime accepts image prompts, for the
// prompt phase below.
const handshake = async (): Promise<boolean> => {
  // Also covers timeout/reset/re-establishment, not just rotated
  // MCP credentials. Stop remains wired while cleanup is pending.
  for (const child of retiring.get(threadId) ?? []) {
    const stopped = await retireChild(threadId, child);
    if (state.settled || session.closing) throw new Error("session closed");
    if (!stopped) {
      closeSession(threadId, "replace-failed");
      throw new Error(`${support.displayName} could not close its previous tool session. Try again.`);
    }
  }
  if (state.settled || session.closing) throw new Error("session closed");
  if (!session.initResult) session.initResult = await initialize();
  await authenticateOnce();
  const images = turn.images ?? [];
  const accepts = session.initResult?.agentCapabilities?.promptCapabilities?.image === true ||
    support.acceptsUnadvertisedImages?.(session.initResult) === true;
  if (images.length && support.images === true && !accepts) {
    throw new Error(
      `${support.displayName} is configured for image attachments, but this installed runtime does not advertise ACP image input. Update the ${support.displayName} CLI or send the message without an image.`,
    );
  }
  return accepts;
};
runtimeAcceptsImages = await handshake();
init = session.initResult;

promptTurn = turn;
rebuiltFromReplay = renewedFromChat;
for (;;) {
  const liveSessionId = session.sessionId;
  if (liveSessionId !== null && session.sessionKey === sessionKey && (cursor === null || cursor === liveSessionId)) {
    // the pooled session still answers the cursor (or the cursor's
    // absence) and was established with these exact session inputs:
    // prompt it directly — no session/load replay, no session/new,
    // no fresh session bookkeeping
    break;
  }
  const { selectionParams } = sessionInputs(init);
  let loaded = false;
  let replaceLoaded = false;
  if (cursor) {
    try {
      await request(
        support.resumeMethod === "resume" ? "session/resume" : "session/load",
        { sessionId: cursor, cwd, mcpServers, ...selectionParams },
        LOAD_SESSION_TIMEOUT,
        (result: any) => {
          if (!result) return;
          // A restored session that cannot serve this turn as
          // asked (Grok keeps the stored session's model) is not
          // adopted: a fresh session below gets the history.
          if (support.acceptsLoadedSession && !support.acceptsLoadedSession({
            turn: cliTurn, currentModelId: result?.models?.currentModelId,
          })) {
            replaceLoaded = true;
            return;
          }
          loaded = true;
          session.sessionId = cursor;
          session.sessionKey = sessionKey;
          receiveModelVariants(result);
        },
      );
    } catch (error) {
      const classification = support.classifyError?.(error);
      // OpenCode encodes ACPSessionNotFoundError as invalidParams
      // with just the rejected sessionId. Other invalidParams
      // responses (model/config errors) must not erase history.
      const data = (error as any)?.data;
      const missingSession = data && typeof data === "object" && !Array.isArray(data)
        && data.sessionId === cursor && Object.keys(data).length === 1;
      if (classification === "invalid_credentials" || classification === "inactive_subscription"
          || ((error as any)?.code === -32602 && !missingSession)) throw error;
      /* session gone, load unsupported, or too slow — the
       * fallbacks below choose between one fresh process and a
       * genuinely new session */
    }
  }
  if (loaded) break;
  if (cursor && liveSessionId === cursor && !replaceLoaded) {
    // The agent refused (or never answered) re-establishing its
    // own live session on this process. Continuity outranks the
    // saved handshake: close the pooled child and resume the
    // recorded session on a fresh one — the pre-pool path every
    // agent already supports. A load that fails there too means
    // the session is genuinely gone; the loop falls through to
    // session/new on the replacement child.
    session.current = null;
    closeSession(threadId, "reestablish");
    session = launchSession();
    sessionRef.current = session;
    ctx.session = session;
    sessions.set(threadId, session);
    session.current = current;
    runtimeAcceptsImages = await handshake();
    init = session.initResult;
    continue;
  }
  // a genuinely fresh native session forgets what the previous
  // one allowed
  sessionAllows.delete(threadId);
  if (cursor) {
    const recovery = recoveryPromptFor({
      recoveryText: turn.recoveryText,
      currentText: turn.text,
      failure: "before-accept",
    });
    promptTurn = { ...turn, text: recovery.text };
    rebuiltFromReplay = recovery.replayed;
  }
  await request("session/new", { cwd, mcpServers, ...selectionParams }, NEW_SESSION_TIMEOUT, (result: any) => {
    session.sessionId = typeof result?.sessionId === "string" ? result.sessionId : null;
    session.sessionKey = sessionKey;
    receiveModelVariants(result);
  });
  break;
}
// every establishment path leaves a native session id behind
const sessionId = session.sessionId;
if (sessionId === null) throw new Error("session/new returned no sessionId");
  ctx.sessionId = sessionId;
selectedModel = null;
let sessionStarted = false;
const emitSessionStarted = () => {
  if (sessionStarted) return;
  sessionStarted = true;
  emit({
    ...base(threadId, turnId),
    type: "session.started",
    sessionId,
    model: selectedModel ?? init?._meta?.modelState?.currentModelId ?? cliTurn.model ?? null,
    ...(rebuiltFromReplay ? { rebuilt: true } : {}),
  });
  if (renewedFromChat) {
    emit({ ...base(threadId, turnId), type: "runtime.notice", message: contextRenewedNotice(support.displayName) });
  }
};

try {
  if (support.selectModel) {
    const { configId } = support.selectModel;
    selectedModel = modelOf(session.sessionConfigResult);
    const wanted = cliTurn.model;
    const offered = offeredModels(session.sessionConfigResult, configId);
    // A process started without a default model lists exactly
    // what this account offers.
    if (support.sessionModelEnv && !session.launchModel && offered.length) accountModels = new Set(offered);
    setAccountModels(accountModels);
    // The instance catalog lists the model but a pooled process
    // does not: the process is older than the catalog (a provider
    // added since it started). That is no reason to run another
    // model. The switch below fails with the runtime's own words,
    // and the process is closed so the retry starts on a fresh
    // one. A process this turn started is current, so there the
    // catalog is the stale one and the fallback applies.
    staleProcess = Boolean(support.fallbackModel && wanted && !launchedThisTurn && offered.length
      && !offered.includes(wanted) && models.options.some((option) => option.id === wanted));
    // Visible to finishAcpTurnError if set_config_option throws before this phase returns.
    ctx.staleProcess = staleProcess;
    // A local inject writes its provider for this turn, so a
    // process started earlier may not list it yet: never replace it.
    if (support.fallbackModel && offered.length && !skipSubscriptionAuthForLocalInject(turn.model)
        && !staleProcess && (!wanted || !offered.includes(wanted))) {
      const fallback = support.fallbackModel(session.sessionConfigResult, models.default);
      if (fallback && fallback !== wanted && offered.includes(fallback)) {
        const notice = wanted ? `${wanted}\n${fallback}` : null;
        if (notice && session.fallbackNotice !== notice) {
          session.fallbackNotice = notice;
          emit({
            ...base(threadId, turnId),
            type: "runtime.notice",
            message: `${support.displayName} no longer offers ${wanted}, so this conversation uses ${fallback}. ` +
              "Choose another model for this bot to stop seeing this.",
          });
        }
        if (wanted) emit({ ...base(threadId, turnId), type: "session.model-fallback", requested: wanted, actual: fallback });
        cliTurn = { ...cliTurn, model: fallback };
        current.turn = cliTurn;
        reportedModel = fallback;
        variant = undefined;
      }
    }
    if (cliTurn.model && cliTurn.model !== selectedModel) {
      await request(
        "session/set_config_option",
        { sessionId, configId, value: cliTurn.model },
        INIT_TIMEOUT,
        receiveModelVariants,
      );
      selectedModel = modelOf(session.sessionConfigResult);
      // an agent that answers OK but keeps its old model is worse than
      // one that errors: it burns a paid turn on the wrong thing
      if (selectedModel !== cliTurn.model) {
        throw new Error(
          `${DRIVER_KIND} did not switch to ${cliTurn.model} (still ${selectedModel ?? "unknown"})`,
        );
      }
    }
  }

  if (support.configureSession) {
    approvalUnconfirmed = support.sessionScopedApproval === true;
    ctx.approvalUnconfirmed = approvalUnconfirmed;
    const configured = await support.configureSession({
      request: async (method, params, timeoutMs) => {
        const result = await request(method, params, timeoutMs ?? SESSION_CONFIG_TIMEOUT);
        if (method === "session/set_model" && params && typeof params === "object" &&
            "modelId" in params && typeof params.modelId === "string") {
          session.sessionConfigResult = {
            ...session.sessionConfigResult,
            models: { ...session.sessionConfigResult?.models, currentModelId: params.modelId },
          };
        }
        return result;
      },
      sessionId,
      env: spawnEnv,
      config: turnConfig,
      turn: cliTurn,
      sessionModels: Array.isArray(session.sessionConfigResult?.models?.availableModels)
        ? session.sessionConfigResult.models.availableModels
        : [],
      currentModelId: session.sessionConfigResult?.models?.currentModelId,
      configOptions: Array.isArray(session.sessionConfigResult?.configOptions)
        ? session.sessionConfigResult.configOptions
        : [],
      notice: (message) => {
        // once per conversation: a model switch opens a new
        // process (a new session record), so the live session
        // alone would repeat it on every turn
        if (session.fallbackNotice === message || threadNotices.get(threadId) === message) return;
        session.fallbackNotice = message;
        threadNotices.set(threadId, message);
        emit({ ...base(threadId, turnId), type: "runtime.notice", message });
      },
    });
    approvalUnconfirmed = false;
    ctx.approvalUnconfirmed = false;
    if (configured && typeof configured.model === "string" && configured.model !== cliTurn.model) {
      if (cliTurn.model) emit({ ...base(threadId, turnId), type: "session.model-fallback", requested: cliTurn.model, actual: configured.model });
      cliTurn = { ...cliTurn, model: configured.model };
      current.turn = cliTurn;
      reportedModel = configured.model;
      selectedModel = configured.model;
      variant = undefined;
    }
    // initialize's currentModelId is the CLI default,
    // not the model this turn asked for. After a successful pin,
    // report the slug we set so the UI does not claim otherwise.
    if (!selectedModel && cliTurn.model) selectedModel = cliTurn.model;
  }
  if (variant !== undefined) {
    const option = requestedVariantOption();
    await request(
      "session/set_config_option",
      { sessionId, configId: option.configId, value: variant },
      SESSION_CONFIG_TIMEOUT,
      receiveModelVariants,
    );
    if (requestedVariantOption().currentValue !== variant) {
      throw new Error(`${support.displayName} did not apply variant ${variant}`);
    }
  }
} catch (error) {
  // session.started is the only place the resume cursor is recorded,
  // so a rejected setting must not orphan a session we just created.
  emitSessionStarted();
  throw error;
}
emitSessionStarted();
// The stable/volatile split: the full prompt rides only the turn
// that establishes - or re-instructs, after a soul edit - this
// native session. Later turns go through bare unless the volatile
// half changed, so a memory edit neither appends a second copy of
// the prompt to the agent's session history nor re-prices the
// prefix its provider cached. Receipts are durable because the
// native session outlives this process; an un-split turn (a direct
// adapter call) keeps the legacy full-prompt shape.

  ctx.session = session;
  ctx.state = state;
  ctx.current = current;
  ctx.cliTurn = cliTurn;
  ctx.promptTurn = promptTurn;
  ctx.reportedModel = reportedModel;
  ctx.variant = variant;
  ctx.staleProcess = staleProcess;
  ctx.approvalUnconfirmed = approvalUnconfirmed;
  ctx.accountModels = accountModels;
  ctx.models = models;
  ctx.pendingSplitReceipt = pendingSplitReceipt;
  ctx.runtimeAcceptsImages = runtimeAcceptsImages;
  ctx.init = init;
  ctx.selectedModel = selectedModel;
  if (typeof (session.sessionId) === 'string' && session.sessionId) ctx.sessionId = session.sessionId;
  ctx.rebuiltFromReplay = rebuiltFromReplay;
  setAccountModels(accountModels);
}
