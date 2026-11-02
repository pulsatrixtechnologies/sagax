/** Non-result Claude stream-json frames (#1383). */
import {
  formatArtifactFence,
  isArtifactTool,
  parseArtifactPublish,
} from "../../../shared/claude-chat-blocks.ts";
import { isPhoneToolCallName, PHONE_TOOL_OUTPUT_NOT_KEPT } from "../../../shared/phone-tools.ts";
import { searchedToolCall } from "../../../shared/searched-tool-call.ts";
import { pushRenewalStep } from "../../context-renewal.ts";
import { filesField, writtenFilesFromToolInput } from "../../thread-files.ts";
import { commandSummary, cwToolResult, toolDetailPreview } from "../../tool-summary.ts";
import { withAbsolutePaths } from "../permission-command.ts";
import { claudeAuthFailure } from "../claude-auth-recovery.ts";
import { claudeSignInExpired as claudeSignInExpiredImport } from "../claude-errors.ts";
import {
  claudeApiErrorMessage,
  claudeContextFull,
  claudeLimitRefusal,
  claudeUsageLimit,
  claudeVersionTooOld,
} from "./limits.ts";
import { COMPACTED_VOLATILE } from "./messages.ts";
import { firstText, readArtifactHtml } from "./helpers.ts";
import {
  STEERED_CONTINUATION_SILENCE_MS,
  steerSilenceScale,
} from "./session-types.ts";
import type { ClaudeTurnCtx } from "./turn-ctx.ts";

export function handleClaudeContent(ctx: ClaudeTurnCtx, o: any): void {
  const {
    session, threadId, emit, base, reachLimit, currentTurnId,
    stopSession, cwd, liveCommands, liveCommandsKey,
    settleResult, retry, retryState, support,
  } = ctx;
  const { GUEST_FORBIDDEN_TOOLS, withWhy, rebuiltSessionNotice, contextRenewedNotice, extractMcpImages } = support;
  const claudeSignInExpired = support.claudeSignInExpired ?? claudeSignInExpiredImport;

  switch (o.type) {
case "system":
  if (o.subtype === "init") {
    // A guest's session proves its tool set before it does anything:
    // a CLI that kept a command-running tool is stopped here.
    const tools: unknown[] = Array.isArray(o.tools) ? o.tools : [];
    if (session.turn?.input.guestConfined && (o.permissionMode !== "default" || tools.some((tool) => typeof tool === "string" && GUEST_FORBIDDEN_TOOLS.has(tool)))) {
      emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: withWhy("This Claude Code kept its shell, so it can't run this turn. Update Claude Code.", session.turn?.input.confinedWhy) });
      session.closing = true;
      stopSession(session);
      break;
    }
    session.sawInit = true;
    // What this bot's live session can run: its MCP prompts and the
    // commands only a terminal can run (listCommands merges them).
    const liveBot = session.turn?.input.botId;
    if (liveBot && Array.isArray(o.slash_commands)) {
      const liveAccess = session.turn?.input.access;
      liveCommands.set(liveCommandsKey(liveBot, liveAccess?.via === "subscription" ? liveAccess.identity : undefined), {
        names: o.slash_commands.filter((name: unknown): name is string => typeof name === "string"),
        terminal: Array.isArray(o.terminal_slash_commands) ? o.terminal_slash_commands.filter((name: unknown): name is string => typeof name === "string") : [],
      });
    }
    if (session.turn) session.turn.awaitingInit = false;
    session.nativePermissionMode = typeof o.permissionMode === "string" ? o.permissionMode : null;
    if (typeof o.session_id === "string") session.sessionId = o.session_id;
    // The turn the CLI starts for a steered message it could not
    // fold (see `result`): the held result now waits for this one's
    // — bounded, so a continuation that announces itself and then
    // never speaks cannot keep the turn's pass open indefinitely.
    const held = session.turn;
    if (held?.continuationGrace) {
      clearTimeout(held.continuationGrace);
      held.continuationGrace = null;
      if (held.continuationSilence) clearTimeout(held.continuationSilence);
      held.continuationSilence = setTimeout(() => {
        if (session.turn !== held || held.settled || !held.deferred) return;
        // A Stop or a close settles the turn in finalizeClose.
        if (held.stopRequested || session.closing) return;
        held.continuationSilence = null;
        emit({
          ...base(threadId, held.turnId),
          type: "runtime.error",
          message: "Claude began a steered message but went silent; the turn was closed.",
        });
        settleResult(held.deferred);
      }, STEERED_CONTINUATION_SILENCE_MS * steerSilenceScale());
      held.continuationSilence.unref?.();
    }
    emit({ ...base(threadId, currentTurnId()), type: "session.started", sessionId: o.session_id, model: o.model, ...(retry.rebuilt ? { rebuilt: true } : {}) });
    // the person reads what did not carry over; announced once: a
    // steered continuation's own init re-reports the same session,
    // which is no new rebuild. A session started because the last
    // one filled up says so instead.
    if (retry.renewed) emit({ ...base(threadId, currentTurnId()), type: "runtime.notice", message: contextRenewedNotice("Claude Code") });
    else if (retry.rebuilt) emit({ ...base(threadId, currentTurnId()), type: "runtime.notice", message: rebuiltSessionNotice("Claude Code") });
    retry.rebuilt = false;
    retry.renewed = false;
  } else if (o.subtype === "compact_boundary") {
    // The CLI compacted its own session. Nothing reaches the chat
    // (the harness hides compactions); what the summary may have
    // dropped is the volatile half of the prompt (memory, roster)
    // that rode an earlier turn, so the next turn delivers it again.
    session.volatile = COMPACTED_VOLATILE;
    session.volatileSections = undefined;
  } else if (o.subtype === "thinking_tokens") {
    emit({ ...base(threadId, currentTurnId()), type: "item.updated", itemType: "reasoning", tokens: o.estimated_tokens });
  }
  break;
case "stream_event": {
  // subagent narration is dropped — N parallel Tasks would
  // interleave their prose into one bubble (upstream-verified bug)
  if (o.parent_tool_use_id) break;
  const ev = o.event ?? {};
  if (ev.type !== "content_block_delta") break;
  const d = ev.delta ?? {};
  if (d.type === "text_delta" && typeof d.text === "string" && d.text) {
    if (session.turn) session.turn.sawStreamDelta = true;
    emit({ ...base(threadId, currentTurnId()), type: "content.delta", streamKind: "assistant_text", delta: d.text });
  } else if (d.type === "thinking_delta" && typeof d.thinking === "string" && d.thinking) {
    emit({ ...base(threadId, currentTurnId()), type: "content.delta", streamKind: "reasoning_text", delta: d.thinking });
  }
  break;
}
case "assistant": {
  const msg = o.message ?? {};
  const text = firstText(msg.content);
  // An unauthenticated turn comes back as an api-error frame whose
  // only content is the CLI's own "run /login" instruction — a
  // command this app has no terminal to run, so relaying it as a
  // reply strands the user. Every other engine reports this as a
  // setup error; that is what routes them to the sign-in card.
  if (claudeAuthFailure(o, text)) {
    const authMessage = claudeSignInExpired(text);
    if (session.turn) {
      session.turn.authFailed = session.turn.explained = true;
      session.turn.authFailureText = authMessage;
      // #1768: a subscription turn may still recover through the
      // shared refresh flight; emit the setup error only when settle
      // decides the sign-in is truly gone.
      const mayRace = session.turn.input.access?.via === "subscription"
        && Boolean(session.turn.input.access.claudeConfigDir?.trim())
        && !retryState.get(threadId)?.authRaced;
      if (mayRace) session.turn.authFailureDeferred = true;
      else emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: authMessage, setup: true });
    } else {
      emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: authMessage, setup: true });
    }
    break;
  }
  // An account past its usage limit runs nothing until the window
  // reopens, on any model or version: that is what to report, not
  // the update the same refused call may also have asked for.
  if (claudeUsageLimit(o, text, Boolean(session.turn?.limit))) {
    reachLimit(o, text);
    break;
  }
  if (claudeVersionTooOld(o, text)) {
    if (session.turn) session.turn.updateRequired = session.turn.explained = true;
    emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: text, setup: true, claudeUpdate: true });
    break;
  }
  // The context filled up (compaction thrashing, a prompt past the
  // window): never the CLI's "/clear" advice in the chat. The turn
  // goes on in a fresh session once this process closes.
  if (claudeContextFull(o, text) && session.turn && !session.turn.settled && !o.parent_tool_use_id) {
    session.turn.contextFull = session.turn.explained = true;
    break;
  }
  // The CLI's own report of any other API error is one plain error row
  // in the real cause, never a reply: the model never produced it.
  if ((o.is_api_error_message === true || typeof o.error === "string") && text.trim()) {
    if (session.turn) session.turn.explained = true;
    if (!session.turn?.stopRequested) emit({ ...base(threadId, currentTurnId()), type: "runtime.error", message: claudeApiErrorMessage(o, text) });
    break;
  }
  if (text.trim()) {
    if (session.turn && !o.parent_tool_use_id) session.turn.lastText = text.slice(-2_000);
    // fallback delta for CLIs/paths that never streamed the block
    if (!session.turn?.sawStreamDelta) emit({ ...base(threadId, currentTurnId()), type: "content.delta", streamKind: "assistant_text", delta: text });
    if (session.turn) session.turn.sawStreamDelta = false;
    emit({ ...base(threadId, currentTurnId()), type: "item.completed", itemType: "assistant_text", text });
  }
  for (const b of Array.isArray(msg.content) ? msg.content : []) {
    if (b.type === "tool_use") {
      // #1276: a call_tool on a searched server reads as the tool it runs
      const runs = typeof b.name === "string" ? searchedToolCall(b.name, b.input, session.searchedMounts) : { name: b.name, input: b.input };
      if (typeof b.id === "string" && typeof runs.name === "string") session.toolNames.set(b.id, runs.name);
      if (session.turn && typeof b.id === "string" && typeof runs.name === "string" && !o.parent_tool_use_id) {
        pushRenewalStep(session.turn.steps ??= [], { id: b.id, name: runs.name, summary: commandSummary(runs.input) ?? toolDetailPreview(runs.input)?.slice(0, 200) });
      }
      emit({
        ...base(threadId, currentTurnId()),
        type: "item.started",
        itemType: "tool",
        itemId: b.id,
        title: runs.name,
        summary: commandSummary(runs.input),
        input: toolDetailPreview(runs.input),
        ...filesField(writtenFilesFromToolInput(runs.name, withAbsolutePaths(runs.name, runs.input, cwd))),
        // a sub-agent's call: nested under the Agent call that started it
        ...(typeof o.parent_tool_use_id === "string" && o.parent_tool_use_id ? { parentItemId: o.parent_tool_use_id } : {}),
      });
    }
  }
  if (msg.usage) {
    emit({
      ...base(threadId, currentTurnId()),
      type: "thread.token-usage.updated",
      input: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0),
      output: msg.usage.output_tokens || 0,
      ...(typeof msg.usage.cache_read_input_tokens === "number"
        ? { cachedInput: msg.usage.cache_read_input_tokens }
        : {}),
      // one assistant message = one model call, and its prompt is
      // everything in the window: fresh text, cache reads and writes
      contextTokens: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0),
    });
  }
  break;
}
case "user": {
  // --replay-user-messages: a model call took this stdin message in.
  // A steer echoed before its turn's `result` was folded into it.
  if (o.isReplay === true) {
    // a steer's words were taken in: the harness counts them received
    // (the turn's own prompt is echoed too, and is not a steer)
    if (typeof o.uuid === "string" && session.turn?.pendingSteers.delete(o.uuid)) {
      emit({ ...base(threadId, currentTurnId()), type: "steer.received", steerId: o.uuid });
    }
    break;
  }
  for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
    if (b.type === "tool_result") {
      const toolName = typeof b.tool_use_id === "string" ? session.toolNames.get(b.tool_use_id) : undefined;
      const step = session.turn?.steps?.find((entry) => entry.id === b.tool_use_id);
      if (step) {
        step.ok = !b.is_error;
        if (!isPhoneToolCallName(toolName)) step.output = toolDetailPreview(b.content)?.slice(0, 400);
      }
      emit({
        ...base(threadId, currentTurnId()), type: "item.completed", itemType: "tool", itemId: b.tool_use_id, ok: !b.is_error,
        // a phone's answer reaches the model, never the event log or the chat (phone_tool)
        output: isPhoneToolCallName(toolName) ? PHONE_TOOL_OUTPUT_NOT_KEPT : toolDetailPreview(b.content),
        ...(b.is_error ? {} : cwToolResult(toolName, b.content)),
      });
      // photos a phone sent go to the model only, never into the chat (phone_tool)
      for (const img of isPhoneToolCallName(toolName) ? [] : extractMcpImages(b.content)) {
        emit({ ...base(threadId, currentTurnId()), type: "item.completed", itemType: "assistant_image", data: img.data });
      }
      if (!b.is_error && isArtifactTool(toolName)) {
        const page = parseArtifactPublish(b.content);
        if (page) {
          const html = page.path ? readArtifactHtml(page.path) : undefined;
          emit({
            ...base(threadId, currentTurnId()),
            type: "item.completed",
            itemType: "assistant_text",
            text: formatArtifactFence({ ...page, path: undefined, ...(html ? { html } : {}) }),
          });
        }
      }
    }
  }
  break;
}
case "rate_limit_event":
  // the account's usage window as the API's last response left it;
  // read only when the turn fails (claudeUsageLimit, `result`)
  if (session.turn) session.turn.limit = claudeLimitRefusal(o.rate_limit_info);
  break;
case "tool_progress":
  // Claude Code 2.1.306 sends one every 30 s while a tool runs:
  // proof the turn is alive, so the stall watchdog keeps waiting.
  emit({ ...base(threadId, currentTurnId()), type: "item.updated", itemType: "tool" });
  break;

    default:
      break;
  }
}
