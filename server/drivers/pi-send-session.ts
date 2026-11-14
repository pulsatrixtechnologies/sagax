/** Session handshake, model pin, and the prompt for one pi turn (#1383). */
import { readFileSync } from "node:fs";
import { isLocalModelId } from "./local-inject.ts";
import { promptHalves, readPromptSplitReceipt, splitSessionPrompt, writePromptSplitReceipt } from "./prompt-split.ts";
import type { PiSendCtx } from "./pi-turn-ctx.ts";

export async function runPiSession(ctx: PiSendCtx): Promise<void> {
  const { hooks, emit, base, promptReAnchorTurns } = ctx.deps;
  const { threadId, turnId, turn } = ctx;
  // handshake: resume the remembered session or start a fresh one. The
  // harness persists session.started.sessionId as the resumeCursor and
  // hands it back next turn, so that id IS the resume handle — pi's
  // sessionFile, which switch_session expects as `sessionPath`.
  const sessionPath = ctx.resumeCursor;
  ctx.sessionFile = sessionPath;
  ctx.sessionReady = false;
  if (ctx.standby) {
    ctx.sessionReady = true;
    ctx.standbySession = ctx.sessionFile;
    emit({ ...base(threadId, turnId), type: "session.started", sessionId: ctx.sessionFile, model: turn.model ?? null });
  } else try {
    // #1276: a compact turn's pi keeps its session (no --no-session), so a
    // fresh one already started a new session: a new_session would
    // replace it, and pi reloads every extension (and its MCP servers)
    // for the new one, about half a second per new conversation.
    const fresh = !sessionPath && turn.compactPrompt;
    // the pi started ahead moves to this folder: a new session written
    // for it, then switch_session (pi reloads the extension, which reads
    // this conversation's MCP servers)
    const aheadSession = ctx.ahead && turn.cwd ? hooks.writePiSession(ctx.ahead.sessionsRoot, turn.cwd) : null;
    const command = sessionPath || aheadSession ? "switch_session" : "new_session";
    const hsPromise = fresh && !aheadSession ? Promise.resolve(undefined) : ctx.awaitResponse(command);
    if (aheadSession) ctx.send({ type: "switch_session", sessionPath: aheadSession });
    else if (!fresh) ctx.send(sessionPath ? { type: "switch_session", sessionPath } : { type: "new_session" });
    const hs = (await hsPromise) as { sessionFile?: string; sessionId?: string } | undefined;
    if (aheadSession) ctx.sessionFile = aheadSession;
    if (hs?.sessionFile) ctx.sessionFile = hs.sessionFile;
    // #1276: pi answers new_session without the file; a compact turn
    // asks for it, so the next turn resumes this session (switch_session).
    if (!ctx.sessionFile && turn.compactPrompt) {
      try {
        const statePromise = ctx.awaitResponse("get_state");
        ctx.send({ type: "get_state" });
        const state = (await statePromise) as { sessionFile?: unknown } | undefined;
        if (typeof state?.sessionFile === "string" && state.sessionFile) ctx.sessionFile = state.sessionFile;
      } catch {
        // no file: the next turn replays, as before
      }
    }
    ctx.sessionReady = true;
    ctx.standbySession = ctx.sessionFile;
    emit({
      ...base(threadId, turnId),
      type: "session.started",
      sessionId: ctx.sessionFile ?? hs?.sessionId ?? null,
      model: turn.model ?? null,
    });
  } catch {
    // without a session we can still try a bare prompt; pi --no-session
    // accepts a prompt without an explicit session. Not a pi started
    // ahead: without its switch it has another folder and no MCP servers.
    if (ctx.ahead) {
      const message = "pi could not open this conversation; send the message again";
      // #3063: pi is exiting; its close says why (and may retry the turn)
      if (ctx.stdinClosed) return ctx.failTurn(message);
      emit({ ...base(threadId, turnId), type: "runtime.error", message });
      ctx.settle(false);
      throw new Error(message);
    }
  }

  // pin the chosen model (composite id or host::model inject → provider + modelId)
  const chosen = typeof turn.model === "string" ? hooks.splitPiModel(turn.model) : null;
  if (chosen) {
    try {
      const modelPromise = ctx.awaitResponse("set_model");
      ctx.send({ type: "set_model", provider: chosen.provider, modelId: chosen.modelId });
      await modelPromise;
    } catch (err) {
      // A model pi cannot switch to is never replaced by pi's default
      // model: that one bills a provider the person did not pick (on
      // 2026-10-27 a computer-shared model ran on an xAI key instead, and
      // its spent credits read as a usage limit; #3079: an OpenRouter pick
      // failed with an xAI "Incorrect API key").
      const reason = String((err as Error)?.message ?? err).slice(0, 300);
      const message = isLocalModelId(turn.model)
        ? `pi could not switch to the local model ${chosen.modelId}, so it did not answer on another model. Check that the computer that serves it is online and shares it, then try again. (pi said: "${reason}")`
        : `pi could not switch to the model ${chosen.modelId} on ${chosen.provider}, so it did not answer on another model. Check that a ${chosen.provider} key is set for this bot's provider, then try again. (pi said: "${reason}")`;
      if (ctx.stdinClosed) return ctx.failTurn(message);
      emit({ ...base(threadId, turnId), type: "runtime.error", message });
      ctx.settle(false);
      throw new Error(message);
    }
  }

  // pin reasoning effort after the model (the supported level set is
  // model-dependent); a rejection keeps the engine default
  if (turn.effort) {
    try {
      const levelPromise = ctx.awaitResponse("set_thinking_level");
      ctx.send({ type: "set_thinking_level", level: hooks.piThinkingLevel(turn.effort) });
      await levelPromise;
    } catch {
      /* keep going on the engine default */
    }
  }

  if (ctx.scopeReadyPath) {
    let ready = false;
    try {
      const receipt = JSON.parse(readFileSync(ctx.scopeReadyPath, "utf8")) as { ok?: unknown; toolScope?: unknown };
      ready = receipt.ok === true && JSON.stringify(receipt.toolScope) === JSON.stringify(ctx.toolScope);
    } catch { /* Missing or malformed readiness is never a grant. */ }
    if (!ready) {
      const message = "Pi tool selection enforcement is unavailable. Update Pi and check the Sagax extension before retrying.";
      if (ctx.stdinClosed) return ctx.failTurn(message);
      emit({ ...base(threadId, turnId), type: "runtime.error", message });
      ctx.settle(false);
      throw new Error(message);
    }
  }

  // The stable/volatile split: the full prompt rides only the turn that
  // establishes - or re-instructs, after a soul edit - this pi session,
  // which previously re-sent the whole system prompt on every turn and
  // let it accumulate in the session file once per turn. pi compacts
  // long sessions by summarizing older messages, which can absorb the
  // turn that carried the prompt, so the driver watches pi's
  // compaction events and drops the receipt the moment one arrives,
  // and re-anchors the full prompt every PI_PROMPT_RE_ANCHOR_TURNS
  // bare turns as a backstop for anything the events miss. Receipts
  // are durable because the session file outlives both the per-turn
  // child and this process. Without a session the prompt is the
  // model's only context, so that turn keeps the full block and writes
  // no receipt.
  const halves = promptHalves(turn);
  let message: string;
  let pendingReceipt: { key: string; receipt: ReturnType<typeof splitSessionPrompt>["receipt"] } | null = null;
  if (halves.stable !== null && ctx.sessionReady && ctx.sessionFile) {
    const receiptKey = JSON.stringify([threadId, ctx.sessionFile]);
    const composed = splitSessionPrompt(
      halves.stable,
      halves.volatile,
      readPromptSplitReceipt("pi", receiptKey),
      turn.system,
      turn.text,
      Boolean(turn.mentionTurn),
      // #1276: on a local model the full prompt goes again
      // only after a compaction pi reports, not every few turns: a periodic
      // re-anchor cost a slow turn (12 to 21 s) for a backstop.
      turn.compactPrompt ? 0 : promptReAnchorTurns,
      turn.systemVolatileSections,
      // #4215: a changed stable section rides alone, not the whole block
      turn.systemStableSections,
    );
    message = composed.text;
    pendingReceipt = { key: receiptKey, receipt: composed.receipt };
  } else {
    message = turn.system ? `${turn.system}\n\n${turn.text}` : turn.text;
  }
  // #1276: what every new conversation of the bot shares (the stable half
  // and the volatile sections before the per-conversation ones, which
  // compactVolatileOrder puts last) becomes its own message
  // (pi-mcp-extension.ts), where a local server keeps a cache for them.
  if (turn.compactPrompt) message = hooks.markSharedPrompt(message, halves, turn.systemVolatileSections);
  // events cannot interleave with this synchronous stretch, so any
  // compaction recorded above already invalidated what compose read
  try {
    // pi answers the prompt with an authoritative response only after
    // preflight accepts it - and rejects it outright while a
    // compaction runs - so the receipt commits only after that
    // acceptance: a rejected or compacted-around send redelivers on
    // the next turn. The wait is long enough to survive a compaction
    // queue; a dead child rejects it immediately.
    // sendTurn still resolves once the prompt is written: a child that
    // dies before replying settles the turn through the close handler,
    // whose waiter sweep can precede this registration.
    const accepted = ctx.awaitResponse("prompt", 120_000);
    ctx.send({ type: "prompt", message, ...(ctx.images.length ? { images: ctx.images } : {}) });
    void accepted.then(
      () => {
        if (!pendingReceipt || ctx.compactionObserved) return;
        try {
          writePromptSplitReceipt("pi", pendingReceipt.key, pendingReceipt.receipt);
        } catch {
          /* an unwritten receipt only re-delivers the full prompt next turn */
        }
      },
      (err: Error) => ctx.failTurn(String(err?.message ?? err).slice(0, 2_000)),
    );
  } catch (err) {
    ctx.failTurn(String((err as Error)?.message ?? err).slice(0, 2_000));
  }
}
