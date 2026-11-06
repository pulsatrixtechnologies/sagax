/** pi RPC event frames for one turn (#1383). */
import { newId } from "../contracts.ts";
import { parseAskQuestions, parseChoices, questionAnswersByQuestion } from "../../shared/ask-question.ts";
import { readMcpGatewayCall } from "../../shared/mcp-gateway-call.ts";
import { foreignMailboxAccessDenied } from "../../shared/mailbox-user.ts";
import { commandSummary, cwToolResult, toolDetailPreview, toolFailurePreview } from "../tools/tool-summary.ts";
import { filesField, writtenFilesFromToolInput } from "../threads/thread-files.ts";
import { deletePromptSplitReceipt } from "./prompt-split.ts";
import { appendNative } from "./native.ts";
import type { PiSendCtx } from "./pi-turn-ctx.ts";

/** The parsed pi RPC event we branch on. Only the fields this driver reads. */
interface PiEvent {
  type: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  id?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  message?: { stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number } };
  usage?: { input?: number; output?: number };
  isTerminal?: boolean;
  willRetry?: boolean;
  method?: string;
  options?: unknown[];
  title?: string;
}

export function handlePiEvent(ctx: PiSendCtx, evt: PiEvent): void {
  const { emit, base, hooks, agentEndGraceMs } = ctx.deps;
  const { threadId, turnId, pending, askTimers, toolNames, toolArgs, mcpServerNames, mcpServers, searchedServers, responseWaiters } = ctx;
  appendNative(threadId, { dir: "in", source: "pi.rpc", msg: evt });
  switch (evt.type) {
    case "response": {
      // Resolve the echoed request id first (unique per steer);
      // fall back to the command name for the handshake-style call
      // sites, whose responses carry no id.
      const key = typeof evt.id === "string" && responseWaiters.has(evt.id) ? evt.id : evt.command;
      if (key && responseWaiters.has(key)) {
        const waiter = responseWaiters.get(key)!;
        responseWaiters.delete(key);
        clearTimeout(waiter.timer);
        if (evt.success) waiter.resolve(evt.data);
        else waiter.reject(hooks.refusal(`pi ${evt.command} failed`));
      }
      return;
    }
    case "message_update": {
      const e = evt.assistantMessageEvent;
      if (!e) return;
      if (e.type === "text_delta" && typeof e.delta === "string") {
        ctx.assistantText += e.delta;
        emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "assistant_text", delta: e.delta });
      } else if (e.type === "thinking_delta" && typeof e.delta === "string") {
        emit({ ...base(threadId, turnId), type: "content.delta", streamKind: "reasoning_text", delta: e.delta });
      }
      return;
    }
    case "tool_execution_start": {
      ctx.flushAssistantText();
      // pi-mcp-adapter's single `mcp` tool: the step names the server
      // and tool it ran (shared/mcp-gateway-call.ts), never "mcp".
      const gateway = readMcpGatewayCall(typeof evt.toolName === "string" ? evt.toolName : undefined, evt.args, mcpServerNames);
      const toolName = gateway?.kind === "tool" ? gateway.id : typeof evt.toolName === "string" ? evt.toolName : undefined;
      const args = gateway?.kind === "tool" ? gateway.args : evt.args;
      if (typeof evt.toolCallId === "string" && toolName) toolNames.set(evt.toolCallId, toolName);
      if (typeof evt.toolCallId === "string") toolArgs.set(evt.toolCallId, args);
      emit({
        ...base(threadId, turnId),
        type: "item.started",
        itemType: "tool",
        itemId: evt.toolCallId,
        title: String(toolName ?? "tool").slice(0, 80),
        summary: commandSummary(args),
        input: toolDetailPreview(args),
        ...filesField(writtenFilesFromToolInput(toolName, args)),
      });
      return;
    }
    case "tool_execution_end": {
      const toolName = (typeof evt.toolCallId === "string" ? toolNames.get(evt.toolCallId) : undefined)
        ?? (typeof evt.toolName === "string" ? evt.toolName : undefined);
      const args = typeof evt.toolCallId === "string" ? toolArgs.get(evt.toolCallId) : evt.args;
      if (typeof evt.toolCallId === "string") {
        toolNames.delete(evt.toolCallId);
        toolArgs.delete(evt.toolCallId);
      }
      const vendorDenied = evt.isError ? foreignMailboxAccessDenied(toolName, args, evt.result) : null;
      emit({
        ...base(threadId, turnId),
        type: "item.completed",
        itemType: "tool",
        itemId: evt.toolCallId,
        ok: !evt.isError,
        // a failed call's own words (shared/tool-failure-text.ts).
        // #1943: a 403 on another mailbox is the retry sentence.
        output: vendorDenied ?? (evt.isError ? toolFailurePreview(evt.result) : toolDetailPreview(evt.result)),
        ...(evt.isError ? {} : cwToolResult(toolName, evt.result)),
      });
      return;
    }
    case "extension_ui_request": {
      // pi floods setWidget/setStatus for TUI bookkeeping; only
      // select/confirm/input are questions that wait for an answer.
      if (evt.method === "select" || evt.method === "confirm" || evt.method === "input") {
        ctx.flushAssistantText();
        const reqId = evt.id ?? newId();
        const isSelect = evt.method === "select";
        const isQuestion = isSelect || evt.method === "input";
        const selectOptions: string[] = isSelect && Array.isArray(evt.options)
          ? evt.options.filter((option): option is string => typeof option === "string") : [];
        const summary = String(evt.title ?? (isQuestion ? "pi has a question" : "pi wants confirmation")).slice(0, 200);
        const gatedTool = isQuestion ? undefined : hooks.piGatedMcpTool(evt.title, mcpServers);
        const gatedInput = gatedTool ? hooks.piGatedMcpInput(evt.message, gatedTool) : undefined;
        const searchedCall = gatedTool && gatedInput !== undefined ? hooks.piSearchedCall(gatedTool, gatedInput, searchedServers) : undefined;
        if (searchedCall?.refused) {
          // a wrapper that runs nothing named: refused, never a card
          ctx.send({ type: "extension_ui_response", id: reqId, cancelled: true });
          return;
        }
        const mcpTool = searchedCall?.mcpTool ?? gatedTool;
        const mcpInput = searchedCall?.input ?? gatedInput;
        // A select is a question with named options; the structured
        // card renders from it while the flat choices keep older
        // clients answering. An input has nothing to pick from and
        // stays the free-text question it always was.
        const question = isSelect
          ? (parseAskQuestions({
              questions: [{ question: summary, options: selectOptions }],
            }) ?? [])[0]
          : undefined;
        const choices = question?.options.length ? question.options.map((option) => option.label) : undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Register BEFORE emitting: the harness may auto-approve from
        // inside its synchronous request.opened listener. Emitting first
        // made respondToRequest see no pending ask, return unavailable,
        // then fall back to a human card on every "Always allow" call.
        pending.set(reqId, (decision) => {
          if (timer) {
            clearTimeout(timer);
            askTimers.delete(timer);
          }
          if (decision.behavior === "deny") ctx.send({ type: "extension_ui_response", id: reqId, cancelled: true });
          else if (isQuestion) {
            // Recover the picked label from a structured card's Q:/A:
            // reply; a flat answer or typed text passes through
            // verbatim (questionAnswersByQuestion's single-question
            // fallback does exactly that).
            const value = question
              ? questionAnswersByQuestion(decision.message ?? "", [question])[question.question] ?? decision.message ?? ""
              : decision.message ?? "";
            // Display labels are capped/trimmed; pi expects the
            // original option. Never guess if two normalize alike.
            const matched = selectOptions.filter(option => parseChoices([option], 1)?.[0] === value);
            ctx.send(matched.length > 1
              ? { type: "extension_ui_response", id: reqId, cancelled: true }
              : { type: "extension_ui_response", id: reqId, value: matched[0] ?? value });
          }
          else ctx.send({ type: "extension_ui_response", id: reqId, confirmed: true });
        });
        // The ask must never hold the turn forever: cancel it after 15
        // minutes. The pending.delete guard makes this a no-op once the
        // turn settled (settle clears pending) or a person answered.
        timer = setTimeout(() => {
          if (timer) askTimers.delete(timer);
          if (!pending.delete(reqId)) return;
          ctx.send({ type: "extension_ui_response", id: reqId, cancelled: true });
          emit({
            ...base(threadId, turnId),
            requestId: reqId,
            type: "request.resolved",
            behavior: "deny",
            source: "timeout",
          });
        }, 15 * 60_000);
        askTimers.add(timer);
        timer.unref?.();
        emit({
          ...base(threadId, turnId),
          requestId: reqId,
          type: "request.opened",
          requestType: isQuestion ? "question" : "permission",
          tool: String(evt.title ?? "pi"),
          summary,
          ...(mcpTool ? { mcpTool, input: mcpInput } : {}),
          ...(choices ? { choices } : {}),
          ...(question ? { questions: [question] } : {}),
        });
      }
      return;
    }
    case "compaction_start":
    case "compaction_end":
    case "auto_compaction_start":
    case "auto_compaction_end": {
      // pi compaction (manual or automatic) summarizes older
      // messages, which can absorb the turn that carried this
      // session's standing prompt. Both events ride the RPC surface
      // for every compaction kind, so the moment either arrives the
      // receipt is dropped and the next turn re-establishes the full
      // prompt. The rest of the compacting turn may still answer
      // without its standing instructions; that single turn is the
      // unavoidable cost of summarizing history mid-session.
      if (ctx.sessionReady && ctx.sessionFile) {
        ctx.compactionObserved = true;
        deletePromptSplitReceipt("pi", JSON.stringify([threadId, ctx.sessionFile]));
      }
      return;
    }
    case "turn_end": {
      // a killed child can still flush one buffered frame after the
      // turn settled (the abort path's cancelled turn_end is the
      // common one); arming the grace timer then would leak it past
      // a turn that is already complete.
      if (ctx.settled) return;
      const sr = evt.message?.stopReason;
      // toolUse means pi ran a tool and auto-continues next turn to
      // answer — the run is not over, and the next turn_end carries
      // the real outcome.
      if (sr === "toolUse" || sr === "tool_use" || sr === "tool_calls") return;
      ctx.endStopReason = sr;
      ctx.endUsage = evt.usage ?? evt.message?.usage;
      ctx.endErrorMessage = evt.message?.errorMessage;
      // agent_end, not turn_end, closes the run: pi can schedule
      // post-run maintenance (overflow-recovery compaction) after
      // the final turn_end, and only the terminal agent_end proves
      // the session is done rewriting itself. The grace timer
      // settles a runtime that never sends agent_end at all.
      if (ctx.agentEndTimer) clearTimeout(ctx.agentEndTimer);
      ctx.agentEndTimer = setTimeout(ctx.finishRun, agentEndGraceMs);
      ctx.agentEndTimer.unref?.();
      return;
    }
    case "agent_end": {
      // Two dialects mark a non-terminal agent_end: upstream pi sets
      // willRetry: true when an automatic retry follows (overflow
      // recovery runs compaction and retries as a fresh run), and the
      // omp fork sets isTerminal: false while maintenance or async
      // delivery has more work scheduled. Either marker means the
      // session may still rewrite the turn that carried this
      // session's standing prompt — keep listening so those events
      // can drop the prompt-split receipt.
      if (evt.isTerminal === false || evt.willRetry === true) return;
      if (ctx.agentEndTimer) {
        clearTimeout(ctx.agentEndTimer);
        ctx.agentEndTimer = null;
      }
      ctx.finishRun();
      return;
    }
    case "agent_settled": {
      // upstream pi's explicit fully-settled guarantee: no automatic
      // retry, compaction retry, or queued continuation remains.
      // Usually settles one frame after the final agent_end already
      // did; kept as its own terminal signal so the driver never
      // depends on which dialect the configured cli speaks.
      if (ctx.agentEndTimer) {
        clearTimeout(ctx.agentEndTimer);
        ctx.agentEndTimer = null;
      }
      ctx.finishRun();
      return;
    }
    default:
      return;
  }
}

export function attachPiEvents(ctx: PiSendCtx): void {
  const chunks = ctx.deps.hooks.newChunks();
  ctx.child.stdout.setEncoding("utf8");
  ctx.child.stdout.on("data", ctx.deps.hooks.piLineReader((line) => {
    const frame = ctx.deps.hooks.decodePiFrame(line, chunks);
    if (!frame) return;
    try {
      handlePiEvent(ctx, frame as unknown as PiEvent);
    } catch {
      /* skip a frame the event handler can't consume */
    }
  }));
}
