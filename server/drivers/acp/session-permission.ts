/** ACP session/request_permission and related server→client asks. */
import { MAX_QUESTION_TEXT, parseAskQuestions, parseChoices, questionAnswersByQuestion } from "../../../shared/ask-question.ts";
import type { RequestOutcome } from "../../contracts.ts";
import { newId } from "../../contracts.ts";
import { acpPermissionCommand } from "../permission-command.ts";
import { acpHostToolRequest } from "../host-tools.ts";
import { connectorAsk } from "./connector-ask.ts";
import { gatedMcpAsk } from "./gated-mcp-ask.ts";
import { sessionOperationKey } from "./helpers.ts";
import type { AcpSession, AcpSupport, AcpTurn } from "./types.ts";

export type PermissionHandlerDeps = {
  support: AcpSupport;
  DRIVER_KIND: string;
  DENY_TIMEOUT_NOTE: string;
  QUESTION_NO_MATCH_NOTE: string;
  threadId: string;
  commandCwd: string | undefined;
  send: (obj: unknown) => void;
  emit: (event: any) => void;
  base: (threadId: string, turnId: string) => Record<string, unknown>;
  sessionAllows: Map<string, Set<string>>;
  handleClientFileRequest: (msg: any) => Promise<void>;
  getSession: () => AcpSession;
  active: Map<string, { interrupt: () => void }>;
};

export function createPermissionHandler(deps: PermissionHandlerDeps) {
  const {
    support, DRIVER_KIND, DENY_TIMEOUT_NOTE, QUESTION_NO_MATCH_NOTE,
    threadId, commandCwd, send, emit, base, sessionAllows, handleClientFileRequest,
    getSession, active,
  } = deps;

        return (msg: any, current: AcpTurn) => {
          current.state.startupActivity = true;
          if (msg.method === "fs/read_text_file" || msg.method === "fs/write_text_file") {
            void handleClientFileRequest(msg);
            return;
          }
          if (msg.method !== "session/request_permission") {
            // never leave an unknown server request hanging — the agent blocks
            return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
          }
          const params = msg.params ?? {};
          current.flushAssistantText();
          const options: Array<{ optionId?: string; kind?: string; name?: string }> = Array.isArray(params.options) ? params.options : [];
          const optionFor = (want: "allow" | "reject") =>
            options.find((o) => o.kind === `${want}_once` && typeof o.optionId === "string")?.optionId
              ?? options.find((o) => String(o.kind ?? "").startsWith(want) && typeof o.optionId === "string")?.optionId
              ?? null;
          const optionAlways = options.find((o) => o.kind === "allow_always" && typeof o.optionId === "string")?.optionId ?? null;
          const cancelled = { outcome: { outcome: "cancelled" } };
          const missing = (want: string) =>
            emit({
              ...base(threadId, current.turnId),
              type: "runtime.error",
              message: `${DRIVER_KIND} offered no "${want}" permission option — cancelling the request instead of guessing`,
            });

          const toolCall = params.toolCall ?? {};
          const isQuestion = String(toolCall.toolCallId ?? "").startsWith("interaction_");
          // Organization server: the engine's own tools are withheld by its
          // profile (server/drivers/host-tools.ts). Should one still ask to
          // run a command or change a file here, it is declined before any
          // card or Full-access auto-accept, as for Codex.
          if (current.turn.withholdHostTools === true && !isQuestion && acpHostToolRequest(toolCall)) {
            const reject = optionFor("reject");
            return send({
              jsonrpc: "2.0",
              id: msg.id,
              result: reject ? { outcome: { outcome: "selected", optionId: reject } } : cancelled,
            });
          }
          if (current.turnConfig.fullAuto && current.turn.approvalMode === undefined && !isQuestion) {
            const allow = optionFor("allow");
            if (!allow) missing("allow");
            return send({
              jsonrpc: "2.0",
              id: msg.id,
              result: allow ? { outcome: { outcome: "selected", optionId: allow } } : cancelled,
            });
          }
          // Sagax approval gate: the agent asks about an MCP call that the gate
          // itself holds unless it is a reviewed read. Allow once (never
          // always), so the gate's decision is the only one, on the person's
          // own computer too: one card per call, never two.
          if (!isQuestion && gatedMcpAsk(toolCall, current.gatedServers)) {
            const allow = optionFor("allow");
            if (allow) return send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "selected", optionId: allow } } });
          }
          const kind = String(toolCall.kind ?? "");
          // an earlier "Always allow this session" on this exact operation.
          // On the person's own computer the key carries that scope, so a
          // grant made in the sandbox never answers a call on the computer
          // (or the reverse); it stays this thread's only.
          const exactOperation = isQuestion ? null : sessionOperationKey(toolCall);
          const operationKey = exactOperation && current.controlsHost ? `local-computer:${exactOperation}` : exactOperation;
          if (operationKey && sessionAllows.get(threadId)?.has(operationKey)) {
            const allow = optionFor("allow");
            if (allow) {
              return send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "selected", optionId: allow } } });
            }
          }
          const tool = kind === "execute" ? "shell" : kind === "edit" ? "edit" : kind || "tool";
          const isShellCommand = !isQuestion && kind === "execute" && !/^mcp(?:__|[.:])/i.test(String(toolCall.title ?? ""));
          // An MCP tool's ask carries the agent's own `<server>__<tool>`
          // title (Grok: "agents__list_bots"), never a command or a file
          // change; the summary below may come from the model's arguments.
          const mcpTitle = typeof toolCall.title === "string" ? toolCall.title.trim() : "";
          // An engine's own connector (Grok's use_tool to the xAI account's
          // cloud connectors): its arguments for the card, and whether it
          // acts outside the app, fail closed (connector-ask.ts).
          const connector = isQuestion || isShellCommand ? { engineConnector: false, outward: false } : connectorAsk(toolCall, current.mountedServers);
          // 2026-10-30: a gateway tool's name may not fit the title pattern
          // (`cursor__user-Outlook-send_5fmail___12`); its use_tool target
          // then names the call, so a rule ("Always allow") and the outbound
          // reading key on the very tool, never on the bare kind "other".
          const mcpTool = !isQuestion && !["execute", "edit", "delete", "move"].includes(kind) && /^(?:mcp__)?[a-z][\w-]{0,63}__[a-z][a-z0-9_]{0,63}$/i.test(mcpTitle)
            ? mcpTitle
            : connector.engineConnector && connector.target && /^[A-Za-z0-9][\w.-]{0,63}__[A-Za-z0-9][\w.-]{0,255}$/.test(connector.target)
              ? connector.target
              : undefined;
          const accountConnector = connector.engineConnector && connector.target !== undefined
            && support.accountConnectorTool?.(getSession().sessionId ?? undefined, connector.target) === true;
          const rawSummary = String(toolCall.rawInput?.command ?? toolCall.title ?? tool);
          const summary = rawSummary.slice(0, isQuestion ? MAX_QUESTION_TEXT : 200);
          // One structured question beside the flat choices: the richer card
          // renders from it while older clients keep answering through
          // `choices`. Built once here so the emit and the answer path can
          // never disagree. parseAskQuestions enforces the shared caps.
          const questionChoices = isQuestion
            ? options.flatMap((option) => typeof option.name === "string" && option.name.trim() ? [option.name.trim()] : [])
            : [];
          const askQuestions = isQuestion && questionChoices.length
            // an ACP question answers with one of its option ids, never text,
            // so the card must not offer a free-text "Other" it cannot send
            ? parseAskQuestions({ questions: [{ question: summary, options: questionChoices, custom: false }] }) ?? undefined
            : undefined;
          // "Always allow this session": never for an outward call (sending
          // to a third party); on the person's own computer only when the
          // exact operation can be remembered
          const canAllowSession = !isQuestion && !connector.outward && (!current.controlsHost || operationKey !== null);
          const requestId = newId();
          const finish = (
            behavior: string,
            source: "user" | "timeout" | "system" = "user",
            message?: string,
            always?: boolean,
          ): RequestOutcome => {
            if (!current.asks.delete(requestId)) return "unavailable";
            clearTimeout(timer);
            const want = behavior === "allow" ? "allow" : "reject";
            const forSession = want === "allow" && always === true && canAllowSession;
            // A structured card replies in the Q:/A: block format; recover the
            // picked label from it so exact-match keeps working. Flat clients
            // send the bare label, which the single-question fallback inside
            // questionAnswersByQuestion already returns unchanged.
            const picked = askQuestions
              ? questionAnswersByQuestion(message ?? "", askQuestions)[askQuestions[0]!.question] ?? message
              : message;
            const named = isQuestion && behavior === "answer"
              ? options.filter((option) => option.optionId === picked || parseChoices([option.name], 1)?.[0] === picked)
              : [];
            const optionId = behavior === "cancel"
              ? null
              : isQuestion
                ? named.length === 1 && typeof named[0].optionId === "string" ? named[0].optionId : null
                : forSession
                  // on the person's computer the engine's allow_always could
                  // cover more than this exact call: allow once, and the
                  // driver keeps the exact operation instead
                  ? (current.controlsHost ? null : optionAlways) ?? optionFor("allow")
                  // an outward call is allowed once, never Grok's allow_always
                  : connector.outward && want === "allow"
                    ? options.find((o) => o.kind === "allow_once" && typeof o.optionId === "string")?.optionId ?? null
                    : optionFor(want);
            // the agent keeps its own allow_always; when it offered none (or on
            // the person's computer), the driver keeps the exact operation
            // for the session instead
            if (forSession && (current.controlsHost || !optionAlways) && optionId && operationKey) {
              const remembered = sessionAllows.get(threadId) ?? new Set<string>();
              remembered.add(operationKey);
              sessionAllows.set(threadId, remembered);
            }
            if (behavior !== "cancel" && !optionId) {
              if (!isQuestion) missing(want);
              // a typed answer (or one an older client sent as text) that is
              // none of the offered options: say so plainly, without the
              // engine's internal name
              else if (behavior === "answer") {
                emit({ ...base(threadId, current.turnId), type: "runtime.error", message: QUESTION_NO_MATCH_NOTE });
              }
            }
            send({
              jsonrpc: "2.0",
              id: msg.id,
              result: optionId ? { outcome: { outcome: "selected", optionId } } : cancelled,
            });
            // ACP only means a "cancelled" outcome as part of cancelling the
            // prompt turn, so an agent may wait for session/cancel after it
            // (Antigravity does, and the turn sat on Thinking). Follow the
            // contract: end the turn instead of leaving it hanging.
            if (!optionId && behavior !== "cancel" && getSession().current === current) active.get(threadId)?.interrupt();
            emit({
              ...base(threadId, current.turnId),
              type: "request.resolved",
              requestId,
              behavior: optionId && isQuestion ? "answer" : optionId && behavior === "allow" ? "allow" : "deny",
              source: optionId ? source : "system",
              approvalScope: current.controlsHost ? "local-computer" : undefined,
            });
            return !optionId ? "rejected" : isQuestion ? "answered" : behavior === "allow" ? "allowed-once" : "rejected";
          };
          const timer = setTimeout(() => {
            emit({ ...base(threadId, current.turnId), type: "runtime.error", message: DENY_TIMEOUT_NOTE });
            finish("deny", "timeout");
          }, 15 * 60_000);
          timer.unref?.();
          current.asks.set(requestId, finish);
          emit({
            ...base(threadId, current.turnId),
            type: "request.opened",
            requestId,
            requestType: isQuestion ? "question" : "permission",
            tool,
            summary,
            ...(mcpTool ? { mcpTool } : {}),
            command: isShellCommand ? acpPermissionCommand(toolCall.rawInput, commandCwd) : undefined,
            requiresExplicitApproval: isShellCommand && (
              toolCall.rawInput?.dangerouslyDisableSandbox === true || toolCall.rawInput?.sandbox_permissions === "require_escalated"
            ) || undefined,
            choices: askQuestions?.[0]?.options.map(option => option.label) ?? (isQuestion ? questionChoices : undefined),
            ...(askQuestions ? { questions: askQuestions } : {}),
            approvalScope: current.controlsHost ? "local-computer" : undefined,
            // the driver can honor a session-wide allow either way, except
            // for an outward call (review of #943): once each time. On the
            // person's computer it needs an exact operation to remember.
            allowSession: canAllowSession ? true : undefined,
            ...(connector.input ? { input: connector.input } : {}),
            ...(connector.engineConnector ? { engineConnector: true } : {}),
            ...(accountConnector ? { accountConnector: true } : {}),
            ...(connector.outward ? { outbound: true } : {}),
          });
        };

}
