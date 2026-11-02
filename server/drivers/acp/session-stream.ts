/** ACP session/update stream: assistant text, tools, usage. */
import { isCwTool } from "../../../shared/cw-widgets/tool-call.ts";
import { readUseToolCall } from "../../../shared/mcp-gateway-call.ts";
import { cwToolResult, commandSummary, toolDetailPreview } from "../../tool-summary.ts";
import { acpWrittenFiles, filesField } from "../../thread-files.ts";
import { acpToolEndEvents } from "./tool-items.ts";
import { allocUnkeyedToolSeq, nextUnkeyedToolId, trackRunningTool } from "./helpers.ts";
import { noteTurnActivity } from "./turn-latency.ts";
import type { AcpSession, AcpSupport, AcpTurn } from "./types.ts";

export type StreamHandlerDeps = {
  support: AcpSupport;
  threadId: string;
  /** Live session record; set once the AcpSession object exists. */
  getSession: () => AcpSession;
  emit: (event: any) => void;
  base: (threadId: string, turnId: string) => Record<string, unknown>;
  ACP_COMPACTION_COLLAPSE_RATIO: number;
};

export function createStreamHandlers(deps: StreamHandlerDeps) {
  const { support, threadId, getSession, emit, base, ACP_COMPACTION_COLLAPSE_RATIO } = deps;

        const noteContextUsage = (current: AcpTurn, used: unknown, size?: unknown) => {
          if (typeof used !== "number" || !(used > 0)) return;
          if (current.state.usagePeak !== null && used < current.state.usagePeak * ACP_COMPACTION_COLLAPSE_RATIO) {
            current.state.usageCompacted = true;
          }
          if (current.state.usagePeak === null || used > current.state.usagePeak) current.state.usagePeak = used;
          current.state.usageLast = used;
          if (typeof size === "number" && size > 0) current.state.usageSize = size;
        };
        const handleNotification = (msg: any) => {
          // A support whose agent reports no usage_update gives the context
          // size another way: Grok's per-round usage (the whole prompt of the
          // round, cached part included) is what fills its window now. Sagax
          // folds the thread on it (server/context-budget.ts).
          const roundUsed = support.roundContextUsage?.(msg);
          if (roundUsed !== undefined) {
            const current = getSession().current;
            if (current && current.state.promptSent && !current.state.settled && msg.params?._meta?.isReplay !== true) {
              noteContextUsage(current, roundUsed);
            }
            return;
          }
          // Vendor side-channels (e.g. grok's `_x.ai/*`) are teed to the
          // native log but never normalized: the prompt result is the settle.
          if (msg.method !== "session/update") return;
          const p = msg.params ?? {};
          if (p._meta?.isReplay === true) return;
          const current = getSession().current;
          if (support.modelVariants && p.update?.sessionUpdate === "config_option_update") {
            if (current && !current.state.settled && getSession().sessionId && p.sessionId === getSession().sessionId) current.receiveModelVariants(p.update);
            return;
          }
          if (current && ["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update"].includes(p.update?.sessionUpdate)) {
            current.state.startupActivity = true;
            if (current.state.promptSent) current.state.promptActivity = true;
            noteTurnActivity(current.latency, p.update.sessionUpdate, Date.now());
          }
          if (!current || !current.state.promptSent) return;
          const u = p.update ?? {};
          const finished = u.status === "completed" || u.status === "failed";
          // Ends one tool item once: its bookkeeping, its completion and the images its result carries.
          const toolEnded = (itemId: string | undefined) => {
            current.state.producedItem = true;
            const keyed = typeof u.toolCallId === "string" && u.toolCallId ? u.toolCallId : undefined;
            if (itemId !== undefined && current.endedToolIds.has(itemId)) return;
            if (support.onToolCompleted && keyed) {
              const rawInput = u.rawInput ?? current.toolInputs?.get(keyed);
              current.toolInputs?.delete(keyed);
              if (u.status === "completed" && rawInput !== undefined) {
                try { support.onToolCompleted({ botId: current.turn.botId, rawInput }); } catch { /* bookkeeping only */ }
              }
            }
            const fields = u.status === "completed" && keyed ? cwToolResult(current.cwToolNames?.get(keyed), u.rawOutput ?? u.content) : {};
            if (keyed) current.cwToolNames?.delete(keyed);
            for (const event of acpToolEndEvents(u, itemId, current.endedToolIds, fields)) emit({ ...base(threadId, current.turnId), ...event });
          };
          switch (u.sessionUpdate) {
            case "agent_message_chunk": {
              const content = u.content;
              const delta = content?.text;
              if (content?.type === "image" && typeof content.data === "string" && content.data) {
                current.flushAssistantText();
                current.state.producedItem = true;
                emit({
                  ...base(threadId, current.turnId),
                  type: "item.completed",
                  itemType: "assistant_image",
                  data: content.data,
                  alt: "Generated image",
                });
              } else if (typeof delta === "string" && delta) {
                current.state.text += delta;
                const trimmed = current.state.text.trimStart();
                if (!trimmed.startsWith("<SYSTEM_MESSAGE") &&
                    !trimmed.startsWith("The following is a <SYSTEM_MESSAGE") &&
                    !trimmed.startsWith("<SYSTEM_NOTIFICATION")) {
                  emit({ ...base(threadId, current.turnId), type: "content.delta", streamKind: "assistant_text", delta });
                }
              }
              break;
            }
            case "agent_thought_chunk": {
              const delta = u.content?.text;
              if (typeof delta === "string" && delta) {
                emit({ ...base(threadId, current.turnId), type: "content.delta", streamKind: "reasoning_text", delta });
              }
              break;
            }
            case "tool_call": {
              current.flushAssistantText();
              trackRunningTool(current, u, "pending");
              if (support.onToolCompleted && typeof u.toolCallId === "string" && u.rawInput !== undefined) {
                (current.toolInputs ??= new Map()).set(u.toolCallId, u.rawInput);
              }
              // Grok's use_tool reads as the MCP tool it runs, not "Use Tool"
              const useTool = readUseToolCall(u.rawInput, { title: u.title, meta: u._meta });
              const toolTitle = useTool?.id ?? (typeof u.title === "string" ? u.title : undefined);
              if (typeof u.toolCallId === "string" && toolTitle && isCwTool(toolTitle)) {
                (current.cwToolNames ??= new Map()).set(u.toolCallId, toolTitle);
              }
              // ACP can send a tool_call already marked completed or failed (a denied permission, say) with no
              // tool_call_update after it: end it here, and keep an unkeyed one out of the queue running calls pair by.
              const itemId = (typeof u.toolCallId === "string" && u.toolCallId) ? u.toolCallId
                : finished ? `acp-tool-unkeyed-${allocUnkeyedToolSeq()}` : nextUnkeyedToolId(current);
              emit({
                ...base(threadId, current.turnId),
                type: "item.started",
                itemType: "tool",
                itemId,
                title: String(useTool?.id ?? u.rawInput?.command ?? u.title ?? "tool").slice(0, 80),
                summary: commandSummary(useTool ? useTool.args : u.rawInput),
                input: toolDetailPreview(useTool ? useTool.args : u.rawInput),
                ...filesField(acpWrittenFiles(u)),
              });
              if (finished) toolEnded(itemId);
              break;
            }
            case "tool_call_update": {
              trackRunningTool(current, u);
              if (finished) toolEnded((typeof u.toolCallId === "string" && u.toolCallId) ? u.toolCallId : current.unkeyedToolIds.shift());
              break;
            }
            case "usage_update": {
              // opencode 1.18 sends `used` flat; ignore non-positive reports
              noteContextUsage(current, u.used ?? u.usage?.used, u.size ?? u.usage?.size);
              break;
            }
          }
        };


  return { noteContextUsage, handleNotification };
}
