/** Stream notifications and child IO for a Codex app-server session. */
import { describeSpawnFailure } from "../../procs.ts";
import { appendNative } from "../native.ts";
import { classifyError, RETRY_MAX_ATTEMPTS } from "../retry.ts";
import { commandSummary, cwToolResult, toolDetailPreview } from "../../tool-summary.ts";
import { isPhoneToolCallName, PHONE_TOOL_OUTPUT_NOT_KEPT } from "../../../shared/phone-tools.ts";
import { filesField, writtenFilesFromToolInput } from "../../thread-files.ts";
import { extractMcpImages } from "../../mcp-tool-images.ts";
import { CALL_TOOL, directoryCallTarget } from "../../mcp-directory.ts";
import { pushRenewalStep } from "../../context-renewal.ts";
import { codexNativeIncomingLogMessage } from "./native-log.ts";
import type { CodexSession } from "./session-types.ts";
import { homedir } from "node:os";
import { forgetCodexVolatile } from "../codex-instructions.ts";
import { CodexRpcError } from "./rpc.ts";

export function attachCodexStream(s: CodexSession): void {
  const turn = s.input;
s.handleNotification = (msg: any) => {
  const p = msg.params ?? {};
  // An app-server also emits notifications for native helper threads.
  // Only this request's parent may write its transcript/usage or settle
  // its run. Requests still use the approval broker above, including
  // helper requests; ignoring child *notifications* must not grant tools.
  const connectionError = msg.method === "error" &&
    !("threadId" in p) && !("turnId" in p);
  if (!connectionError) {
    if (!s.codexThreadId || p.threadId !== s.codexThreadId) return;
    if (!s.codexTurnId && msg.method === "thread/tokenUsage/updated" && p.tokenUsage?.total) {
      // A total reported before this turn exists is what the process
      // carried in — a resumed thread restoring earlier usage. It is the
      // baseline this turn's figure is measured from, never a reading to
      // buffer and replay as if this turn produced it. (Codex names the
      // turn before any model call, so a genuine first reading cannot
      // land here.)
      const t = p.tokenUsage.total;
      s.state.usageBaseline = { input: t.inputTokens ?? 0, output: t.outputTokens ?? 0, cachedInput: t.cachedInputTokens ?? 0 };
      return;
    }
    if (!s.codexTurnId) {
      // Some servers stream before acknowledging turn/start. Retain a
      // bounded prefix, then filter against the authoritative response.
      if (s.startingNativeTurn) {
        if (s.earlyNotifications.length >= 1024) {
          void s.settle(false, "too_many_events_before_turn_start");
        } else {
          s.earlyNotifications.push(msg);
        }
      }
      return;
    }
    const eventTurnId = msg.method === "turn/started" || msg.method === "turn/completed"
      ? p.turn?.id : p.turnId;
    // guardianWarning is thread-scoped in Codex 0.147; this child
    // process belongs to one app turn. Never admit a mismatched turnId.
    if (eventTurnId !== s.codexTurnId && !(msg.method === "guardianWarning" && eventTurnId === undefined)) return;
  }
  if (msg.method.startsWith("item/") && p.item?.type !== "userMessage") s.state.streamed = true;
  switch (msg.method) {
    case "guardianWarning":
      if (typeof p.message === "string" && /automatic approval review.*timed out/i.test(p.message)) s.reviewWarning = true;
      break;
    case "item/autoApprovalReview/completed": {
      const status = p.review?.status;
      if (status !== "timedOut" && status !== "denied") break;
      // Completed reviews carry a reviewId. Without it distinct
      // failures cannot be separated from duplicate notifications.
      if (typeof p.reviewId !== "string" || !p.reviewId) break;
      if (!s.seenReviews.has(p.reviewId)) {
        s.seenReviews.add(p.reviewId);
        if (status === "timedOut") s.timedOutReview = true;
        s.reviewNotice(status, p.action);
      }
      break;
    }
    // token-level chat text; the item/completed frame follows with the
    // whole message, so its delta is only a fallback when none streamed
    case "item/agentMessage/delta": {
      const delta = typeof p.delta === "string" ? p.delta : "";
      if (delta) {
        s.state.sawStreamDelta = true;
        s.emit({ ...s.base(s.threadId, s.turnId), type: "content.delta", streamKind: "assistant_text", delta });
      }
      break;
    }
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta": {
      const delta = typeof p.delta === "string" ? p.delta : "";
      if (delta) s.emit({ ...s.base(s.threadId, s.turnId), type: "content.delta", streamKind: "reasoning_text", delta });
      break;
    }
    case "item/started": {
      const item = p.item ?? {};
      // call_tool on a searched server reads as the tool it runs.
      const runs = item.type === "mcpToolCall" && item.tool === CALL_TOOL && typeof item.server === "string" && s.directoryMounts.has(item.server)
        ? directoryCallTarget(CALL_TOOL, item.arguments) : undefined;
      const title =
        item.type === "commandExecution"
          ? String(item.command ?? "shell")
          : item.type === "fileChange"
            ? "edit"
            : item.type === "mcpToolCall"
              ? (runs ?? item.tool ?? item.name ?? "mcp")
              : item.type === "webSearch"
                ? "web_search"
                : null;
      if (title) {
        if (typeof item.id === "string") {
          pushRenewalStep(s.renewalSteps, {
            id: item.id,
            name: title,
            summary: item.type === "commandExecution"
              ? commandSummary({ command: item.command }) ?? String(item.command ?? "").slice(0, 200)
              : toolDetailPreview(item.type === "mcpToolCall" ? (runs ? item.arguments?.arguments ?? {} : item.arguments) : item.type === "fileChange" ? item.changes : item.query)?.slice(0, 200),
          });
        }
        s.emit({
          ...s.base(s.threadId, s.turnId),
          type: "item.started",
          itemType: "tool",
          itemId: item.id,
          title,
          summary: item.type === "commandExecution" ? commandSummary({ command: item.command }) : undefined,
          input: toolDetailPreview(item.type === "commandExecution" ? { command: item.command, cwd: item.cwd } : item.type === "mcpToolCall" ? (runs ? item.arguments?.arguments ?? {} : item.arguments) : item.type === "fileChange" ? item.changes : item.query),
          ...filesField(item.type === "fileChange"
            ? writtenFilesFromToolInput("edit", item.changes)
            : item.type === "mcpToolCall" ? writtenFilesFromToolInput(title, runs ? item.arguments?.arguments ?? {} : item.arguments) : []),
        });
      }
      break;
    }
    case "item/completed": {
      const item = p.item ?? {};
      // Codex compacted its thread: the volatile half rides whole next turn.
      if (item.type === "contextCompaction" && s.codexThreadId) {
        try { forgetCodexVolatile(s.threadId, s.codexThreadId); } catch { /* the 5-note bound still holds */ }
      }
      if (item.type === "agentMessage") {
        if (item.text?.trim()) {
          s.state.lastText = item.text;
          s.renewalLastText = item.text.slice(-2_000);
          if (!s.state.sawStreamDelta) {
            s.emit({ ...s.base(s.threadId, s.turnId), type: "content.delta", streamKind: "assistant_text", delta: item.text });
          }
          s.state.sawStreamDelta = false;
          s.emit({ ...s.base(s.threadId, s.turnId), type: "item.completed", itemType: "assistant_text", text: item.text });
        }
      } else if (item.type === "imageGeneration" && item.status !== "failed") {
        // Current Codex app-server (the same schema consumed by T3
        // Code) returns the generated raster as base64 `result` and
        // may also expose a local `savedPath`. Use bytes, never the
        // provider-owned path: the harness will validate and copy
        // them into its private attachment store.
        if (typeof item.result === "string" && item.result.trim()) {
          s.emit({
            ...s.base(s.threadId, s.turnId),
            type: "item.completed",
            itemType: "assistant_image",
            itemId: item.id,
            data: item.result,
            alt: typeof item.revisedPrompt === "string" ? item.revisedPrompt : undefined,
          });
        }
      } else if (["commandExecution", "fileChange", "mcpToolCall", "webSearch"].includes(item.type)) {
        const ok = item.status !== "failed" && item.status !== "declined";
        const output = item.type === "mcpToolCall" && isPhoneToolCallName(typeof item.tool === "string" ? item.tool : undefined)
          ? PHONE_TOOL_OUTPUT_NOT_KEPT
          : toolDetailPreview(item.type === "commandExecution" ? { output: item.aggregatedOutput, exitCode: item.exitCode } : item.type === "mcpToolCall" ? item.error ?? item.result : item.type === "fileChange" ? item.changes : item.action);
        if (typeof item.id === "string") {
          const step = s.renewalSteps.find((entry) => entry.id === item.id);
          if (step) {
            step.ok = ok;
            if (output) step.output = output.slice(0, 240);
          }
        }
        s.emit({
          ...s.base(s.threadId, s.turnId),
          type: "item.completed",
          itemType: "tool",
          itemId: item.id,
          ok,
          // a phone's answer reaches the model, never the event log or the chat (phone_tool)
          output,
          ...(item.type === "mcpToolCall" && !item.error && typeof item.tool === "string"
            ? cwToolResult(typeof item.server === "string" ? `${item.server}__${item.tool}` : item.tool, item.result)
            : {}),
        });
        // photos a phone sent go to the model only, never into the chat (phone_tool)
        if (item.type === "mcpToolCall" && !isPhoneToolCallName(typeof item.tool === "string" ? item.tool : undefined)) {
          for (const img of extractMcpImages(item.result)) {
            s.emit({ ...s.base(s.threadId, s.turnId), type: "item.completed", itemType: "assistant_image", data: img.data });
          }
        }
      } else if (item.type === "reasoning") {
        s.emit({ ...s.base(s.threadId, s.turnId), type: "item.updated", itemType: "reasoning", tokens: null });
      }
      break;
    }
    case "thread/tokenUsage/updated": {
      // `total` is everything this app-server process has used; `last`
      // is the most recent model call. This turn's figure is the total
      // minus what the process carried before turn/start went out (a
      // resumed thread can restore earlier usage), so it never grows by
      // the whole thread per message and never counts only the final
      // call of a multi-step turn. codex's inputTokens already includes
      // cachedInputTokens; the cached share rides alongside so the UI
      // can say how much was context re-read rather than new text.
      const t = p.tokenUsage?.total;
      const last = p.tokenUsage?.last;
      const shape = (u: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }) => ({
        input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cachedInput: u.cachedInputTokens ?? 0,
      });
      // (A total that arrived before this turn was named became the
      // baseline upstream and never reaches this switch.)
      if (t) {
        const b = s.state.usageBaseline ?? { input: 0, output: 0, cachedInput: 0 };
        const now = shape(t);
        s.state.usage = {
          input: Math.max(0, now.input - b.input),
          output: Math.max(0, now.output - b.output),
          ...(typeof t.cachedInputTokens === "number" ? { cachedInput: Math.max(0, now.cachedInput - b.cachedInput) } : {}),
        };
      } else if (last) {
        s.state.usage = { input: last.inputTokens ?? 0, output: last.outputTokens ?? 0, ...(typeof last.cachedInputTokens === "number" ? { cachedInput: last.cachedInputTokens } : {}) };
      }
      if (t) {
        const window = p.tokenUsage?.modelContextWindow;
        s.emit({
          ...s.base(s.threadId, s.turnId),
          type: "thread.token-usage.updated",
          input: t.inputTokens ?? 0,
          output: t.outputTokens ?? 0,
          ...(typeof t.cachedInputTokens === "number" ? { cachedInput: t.cachedInputTokens } : {}),
          // the last call's prompt is what fills the window
          ...(last && typeof last.inputTokens === "number" ? { contextTokens: last.inputTokens } : {}),
          ...(typeof window === "number" && window > 0 ? { contextWindow: window } : {}),
        });
      }
      break;
    }
    case "turn/completed": {
      if (s.reviewWarning && !s.timedOutReview) s.reviewNotice("warning");
      const t = p.turn ?? {};
      if (t.status === "completed") {
        if (s.chatgptTurn) s.loginAccepted();
        s.renewedTurns.delete(s.turnId);
      } else if (typeof t.error?.message === "string") {
        s.turnError(t.error);
      } else if (t.status === "failed" && !s.state.lastError && s.state.retryError) {
        // Codex gave up retrying without a final word: its last one
        s.turnError({ message: s.state.retryError });
      }
      if (s.abandoned) break;
      void s.settle(t.status === "completed", t.status === "completed" ? null :
        (s.state.contextFullStop ? "context_full"
          : classifyError({ text: s.state.lastError }).reason === "provider_safety" ? "provider_safety"
            : (s.state.lastError || t.status || "failed")));
      break;
    }
    case "error": {
      // shape drift: 0.144 sends {message}, 0.139 and 0.160 nest it
      // under {error:{message, codexErrorInfo}} — surface either
      // (agentcal armor)
      const error = p.error && typeof p.error === "object" ? p.error : { message: p.message };
      if (!error.message) break;
      // 0.160 reports each of its own reconnects ("Reconnecting...
      // 1/5") with willRetry: true. Those are not the turn's failure;
      // the final error, or turn/completed, says how it ended.
      if (p.willRetry === true) {
        s.state.retryError = String(error.message);
        break;
      }
      s.turnError(error);
      break;
    }
    case "modelProvider/authRecoveryStarted":
      s.state.authRecovery = true;
      break;
    case "modelProvider/authRecoveryCompleted":
      s.state.authRecovery = false;
      break;
  }
};

s.buf = "";
// decode as UTF-8 across chunk boundaries — a raw `buf += chunk` splits
// multibyte characters that straddle two reads and corrupts the text
s.child.stdout!.setEncoding("utf8");
s.child.stdout!.on("data", (chunk) => {
  if (s.abandoned || s.state.settled) return;
  s.buf += chunk;
  let nl;
  while (!s.state.settled && !s.abandoned && (nl = s.buf.indexOf("\n")) !== -1) {
    const line = s.buf.slice(0, nl);
    s.buf = s.buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    s.stderrSinceOutput = "";
    const loggedMessage = codexNativeIncomingLogMessage(msg, s.sensitiveResponseIds);
    appendNative(s.threadId, { dir: "in", source: "codex.app-server", msg: loggedMessage });
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pend = s.rpcPending.get(msg.id);
      if (pend) {
        s.rpcPending.delete(msg.id);
        if (msg.error) pend.reject(new CodexRpcError(msg.error));
        else pend.resolve(msg.result);
      }
    } else if (msg.id !== undefined && msg.method) {
      s.handleServerRequest(msg);
    } else if (msg.method) {
      s.handleNotification(msg);
    }
  }
});

s.stderr = "";
// Stderr that arrived after the last parsed protocol message. The
// full buffer accumulates for the whole process lifetime, so its
// tail can name a long-past event (a websocket 426 logged at turn
// start, echoed half an hour later when something else kills the
// process). Only this slice can explain an exit; older bytes are
// context, not cause.
s.stderrSinceOutput = "";
s.child.stderr!.on("data", (c) => {
  s.stderr += c;
  s.stderrSinceOutput += c;
  if (s.stderr.length > 8192) s.stderr = s.stderr.slice(-8192);
  if (s.stderrSinceOutput.length > 2048) s.stderrSinceOutput = s.stderrSinceOutput.slice(-2048);
});
s.child.on("error", (e) => {
  if (s.abandoned) return;
  s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error", ...describeSpawnFailure(e, s.config.cli, turn.cwd ?? homedir()) });
  void s.settle(false, "spawn_error");
});
s.child.on("close", (code, signal) => {
  if (s.abandoned) return;
  if (s.state.settled) {
    // Root exit alone cannot release a turn after an uncertain stop.
    // Recheck its group; an explicit later Stop can also retry this.
    void s.stop();
    return;
  }
  // An intentional stop killed (or outlived) the child before the
  // turn acknowledged its own end. That is the stop doing its job, not
  // a crash: settle quietly so Stop never reports the raw signal.
  if (s.stopRequested) {
    void s.settle(false, "interrupted");
    return;
  }
  // The child died before the turn completed. Attribute the exit
  // honestly: name the signal when it was killed, and only quote
  // stderr that arrived after the last protocol message. A stale
  // tail here once misattributed a whole day of killed turns to a
  // websocket 426 logged at turn start.
  const recentStderr = s.stderrSinceOutput.trim();
  const hadStreamedOutput = s.codexTurnId !== null || s.state.sawStreamDelta;
  // A signal exit is terminal no matter what the stderr says:
  // something killed the process (OOM, kill -9), and classifyError
  // cannot see the signal — with code null, transient-looking recent
  // stderr could still mark a killed attempt retryable.
  // Classification also reads only stderr received after the last
  // protocol output; the lifetime buffer's tail can name a
  // long-past event (the websocket-426 misattribution).
  const verdict =
    signal !== null
      ? { transient: false, reason: "interrupted" }
      : classifyError({ exitCode: code, stderr: recentStderr });
  const exitMessage = `codex exited ${code}${signal ? ` (signal ${signal})` : ""} before turn/completed${
    recentStderr ? `: ${recentStderr.slice(-300)}` : hadStreamedOutput && s.stderr.trim() ? "; no stderr after the last app-server output" : ""
  }`;
  // Relaunch only when turn/start was never acknowledged: a replay could re-run tools the user saw.
  if (!s.stopRequested && s.codexTurnId === null && s.earlyNotifications.length === 0 && verdict.transient && s.attempt < RETRY_MAX_ATTEMPTS - 1) {
    void s.relaunch(verdict.reason, exitMessage, "exit_before_result").catch(() => {});
    return;
  }
  s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error", message: exitMessage });
  void s.settle(false, "exit_before_result");
});


}
