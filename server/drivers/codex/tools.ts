/** Server-request (tools / approvals) handler for a Codex app-server session. */
import { codexHostToolRequest } from "../host-tools.ts";
import { CALL_TOOL, DESCRIBE_TOOL, SEARCH_TOOL, directoryCallTarget } from "../../mcp-directory.ts";
import { parseProtocolAskQuestions, questionAnswersById, questionChoices } from "../../../shared/ask-question.ts";
import { permissionCommand } from "../permission-command.ts";
import {
  additionalPermissionSummary,
  grantedPermissions,
  mcpAppApprovalForm,
} from "./approvals.ts";
import type { CodexSession } from "./session-types.ts";
import { newId } from "../../contracts.ts";
import { commandSummary } from "../../tool-summary.ts";
import { CODEX_MISSING_CREDENTIALS, codexContextFull, codexSignInExpired, codexSignInRefused, codexUserError } from "../codex-errors.ts";
import { classifyError, RETRY_MAX_ATTEMPTS } from "../retry.ts";
import { renewalPrompt } from "../../context-renewal.ts";

export const DENY_TIMEOUT_NOTE =
  "Sagax: nobody answered this permission request in time. Skip this action and finish what you can without it.";

export function attachCodexTools(s: CodexSession): void {
  const turn = s.input;
s.handleServerRequest = (msg: any) => {
  const method = msg.method as string;
  const params = msg.params ?? {};
  const legacy = method === "execCommandApproval" || method === "applyPatchApproval";
  const isMcpElicitation = method === "mcpServer/elicitation/request";
  const isLegacyMcpPermission =
    method === "mcpServer/elicitation/request" &&
    params?._meta?.codex_approval_kind === "mcp_tool_call";
  const mcpAppApproval = isMcpElicitation ? mcpAppApprovalForm(params) : null;
  const isMcpPermission = isLegacyMcpPermission || mcpAppApproval !== null;
  const isQuestion = method === "item/tool/requestUserInput";
  const isAdditionalPermission = method === "item/permissions/requestApproval";
  const isPermission = legacy || isMcpPermission || isAdditionalPermission ||
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval";
  // Organization server: nothing runs or writes on the Sagax server.
  if (s.withholdHostTools && codexHostToolRequest(method)) {
    const declined = method === "item/permissions/requestApproval"
      ? { permissions: {}, scope: "turn" }
      : { decision: legacy ? "denied" : "decline" };
    s.send({ jsonrpc: "2.0", id: msg.id, result: declined });
    return;
  }
  // A normal MCP elicitation is a form or URL asking for real user input,
  // not a permission. We cannot safely synthesize its structured answer.
  // Unknown future server requests also fail closed instead of being
  // mistaken for commands and accepted by Full Access.
  if (!isQuestion && !isPermission) {
    if (isMcpElicitation) {
      s.send({ jsonrpc: "2.0", id: msg.id, result: { action: "decline" } });
    } else {
      s.send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Unsupported server request: ${method}` },
      });
    }
    return;
  }
  // The whole set rides one card, answered per id: the protocol pairs
  // each question with its own id, and the card's single reply is
  // mapped back block by block (or as the flat single-question
  // fallback). The only refusal left is an ask with nothing answerable
  // — #1237 is closed: a bundle no longer copies one answer into
  // every id.
  const protocolQuestions = isQuestion ? parseProtocolAskQuestions(params.questions) : null;
  if (isQuestion && !protocolQuestions) {
    s.send({
      jsonrpc: "2.0",
      id: msg.id,
      error: {
        code: -32602,
        message: Array.isArray(params.questions)
          ? "ask needs at least one answerable question — a string id and question text each; this request sent none."
          : "ask needs params.questions to be an array of questions, each with a string id and question text.",
      },
    });
    return;
  }
  // Codex asks 'Allow the <server> MCP server to run tool "<tool>"?'.
  // The tool is everything from the first quote to the closing `"?`,
  // so a tool named `web_search" …` cannot pass for web_search.
  const mcpMessage = typeof params.message === "string" ? params.message : "";
  const mcpTool = isLegacyMcpPermission ? / to run tool "(.*)"\?$/.exec(mcpMessage)?.[1] : undefined;
  // A searched server (mcp-directory.ts): its catalog reads run no
  // tool and pass without a card, as the tools/list they replace did,
  // but only when Codex asks about exactly them; call_tool is shown as
  // the tool it runs.
  const searchedServer = isLegacyMcpPermission && typeof params.serverName === "string" && s.directoryMounts.has(params.serverName);
  const asksAbout = (tool: string) => mcpMessage === `Allow the ${params.serverName} MCP server to run tool "${tool}"?`;
  if (searchedServer && (asksAbout(SEARCH_TOOL) || asksAbout(DESCRIBE_TOOL))) {
    s.send({ jsonrpc: "2.0", id: msg.id, result: { action: "accept", content: {} } });
    return;
  }
  const runs = searchedServer && asksAbout(CALL_TOOL) ? directoryCallTarget(CALL_TOOL, params._meta?.tool_params) : undefined;
  const tool =
    mcpAppApproval
      ? mcpAppApproval.tool
      : isLegacyMcpPermission
      ? (runs ?? mcpTool ?? "mcp")
      : isAdditionalPermission
        ? "permissions"
      : method === "item/fileChange/requestApproval" || method === "applyPatchApproval"
      ? "edit"
      : isQuestion
        ? "ask_user"
        : "shell";
  const permissionResult = (allow: boolean) =>
    isMcpPermission
      ? allow
        ? (mcpAppApproval?.allowResult ?? { action: "accept", content: {} })
        : { action: "decline" }
      : isAdditionalPermission
        ? { permissions: allow ? grantedPermissions(params.permissions) : {}, scope: "turn" }
        : { decision: allow ? (legacy ? "approved" : "accept") : legacy ? "denied" : "decline" };
  if (s.autoAcceptPermissions && isPermission) {
    return s.send({
      jsonrpc: "2.0",
      id: msg.id,
      result: permissionResult(true),
    });
  }
  const requestId = newId();
  const summary =
    isAdditionalPermission
      ? additionalPermissionSummary(params.permissions, params.reason)
      : isMcpPermission
      ? (mcpAppApproval?.summary ?? (runs ? `Allow the ${params.serverName} MCP server to run tool ${JSON.stringify(runs)}?`
        : typeof params.message === "string" ? params.message : "MCP access requested"))
      : typeof params.command === "string"
      ? params.command
      : protocolQuestions
        ? protocolQuestions.map(({ question }) => question.question).join(" · ")
      : Array.isArray(params.questions)
        ? params.questions.map((q: any) => q.question ?? q.header).filter(Boolean).join(" · ")
        : typeof params.reason === "string"
          ? params.reason
          : tool;
  // Flat choices only when one non-multiselect question can actually
  // be answered by a bare reply; a bundle's first-question buttons
  // would be an unusable lie for flat clients.
  const choices =
    isQuestion && protocolQuestions ? questionChoices(protocolQuestions.map(({ question }) => question)) : undefined;
  const finish = (behavior: "allow" | "deny" | "answer", message?: string, source: "user" | "timeout" | "system" = "user") => {
    if (!s.asks.delete(requestId)) return;
    clearTimeout(timer);
    if (isQuestion) {
      // Only the person's reply is filed: Q:/A: blocks mapped to the
      // id that asked them, or the flat fallback for a single
      // question. Timeout and turn teardown send empty answers so
      // every id reads unanswered — system notes never occupy the
      // slot the model reads as the person's words (the rule
      // permission-proxy already follows).
      const mapped =
        behavior === "answer" && source === "user" && typeof message === "string"
          ? questionAnswersById(message, protocolQuestions ?? [])
          : {};
      // Null prototype so an opaque id like __proto__ becomes a real
      // answer key instead of hitting the inherited setter.
      const answers: Record<string, { answers: string[] }> = Object.create(null);
      for (const [id, answer] of Object.entries(mapped)) answers[id] = { answers: [answer] };
      s.send({ jsonrpc: "2.0", id: msg.id, result: { answers } });
    } else {
      s.send({
        jsonrpc: "2.0",
        id: msg.id,
        result: permissionResult(behavior === "allow"),
      });
    }
    s.emit({ ...s.base(s.threadId, s.turnId), type: "request.resolved", requestId, behavior, source });
  };
  const timer = setTimeout(
    // A timed-out question resolves as denied, not answered: the card
    // closes with no reply (answers stay empty either way), and the
    // resolve event must not claim an answer that never happened.
    () => finish("deny", isQuestion ? undefined : DENY_TIMEOUT_NOTE, "timeout"),
    15 * 60_000,
  );
  timer.unref?.();
  s.asks.set(requestId, finish);
  s.emit({
    ...s.base(s.threadId, s.turnId),
    type: "request.opened",
    requestId,
    requestType: isQuestion ? "question" : "permission",
    tool,
    summary,
    // the server Codex named in its own ask, with the tool it parsed
    ...(isLegacyMcpPermission && mcpTool && typeof params.serverName === "string" && /^[\w-]{1,64}$/.test(params.serverName)
      ? { mcpTool: `${params.serverName}__${mcpTool}` } : {}),
    command: method === "execCommandApproval" || method === "item/commandExecution/requestApproval"
      ? permissionCommand(params.command, params.cwd ?? (
        // Helpers may have a different workspace from their parent.
        !params.threadId || params.threadId === s.codexThreadId ? s.commandCwd : undefined
      )) : undefined,
    choices,
    ...(protocolQuestions ? { questions: protocolQuestions.map((pair) => pair.question) } : {}),
    approvalScope: s.controlsHost ? "local-computer" : undefined,
    requiresExplicitApproval: isAdditionalPermission || (
      (method === "execCommandApproval" || method === "item/commandExecution/requestApproval") &&
      (params.additionalPermissions != null || params.networkApprovalContext != null)
    ) || undefined,
  });
};

s.seenReviews = new Set<string>();
s.reviewWarning = false;
s.timedOutReview = false;
const retryMode = s.approvalMode[0].toUpperCase() + s.approvalMode.slice(1);
s.reviewNotice = (status: "warning" | "timedOut" | "denied", action?: any) => {
  if (status === "warning") {
    s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error",
      message: `Codex automatic review reported a timeout. Check what ran before retrying. Retry stays ${retryMode}. Select Ask for human approval in approval settings.`,
    });
    return;
  }
  const command = action?.type === "command" ? commandSummary({ command: action.command }) : undefined;
  const target = command ? `: "${command.slice(0, 30)}"` : " for the requested action";
  const outcome = status === "timedOut" ? "timed out" : "denied";
  s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error",
    message: `Codex automatic review ${outcome}${target}. Action did not run. Retry stays ${retryMode}. Select Ask for human approval in approval settings.`,
  });
};
// Each bot's Codex reads auth.json when it starts, possibly while another one rewrites it.
s.retryLoginRace = (raw: string, refused: boolean): boolean => {
  const missing = CODEX_MISSING_CREDENTIALS.test(raw);
  // The race is read on the instance's own auth.json: a per-turn Codex home is not retried.
  if (!s.chatgptTurn || turn.access?.codexHome || s.loginRaceRetried || s.state.streamed || s.attempt >= RETRY_MAX_ATTEMPTS - 1 || !(refused || missing)) return false;
  const mark = s.loginMark();
  if (!mark || (!missing && mark[1] === s.launchedLogin)) return false;
  s.loginRaceRetried = true;
  void s.relaunch("auth", raw, "auth_required").catch(() => {});
  return true;
};
// The turn's failure, said once. An error notification and the
// turn/completed after it usually carry the same words; the second
// only speaks again to deliver a sign-in flag the first lacked.
// Codex's own refused sign-in reads as one plain sentence and marks
// the login, so Settings asks for a new sign-in too.
s.turnError = (error: { message?: unknown; codexErrorInfo?: unknown }) => {
  const raw = String(error.message);
  const refused = s.chatgptTurn && s.loginMark() !== null && (codexSignInRefused(error) ||
    (s.state.authRecovery && !/\b403\b|forbidden/i.test(raw) && /\b401\b|unauthorized/i.test(raw)));
  if (s.retryLoginRace(raw, refused)) return;
  if (refused) s.loginRefused();
  // Out of context room: continue this turn once in a fresh Codex thread
  // (Claude's path). A second overflow fails in plain words and marks
  // the next send (Retry) to start fresh instead of resuming the full one.
  if (!refused && codexContextFull(raw, error.codexErrorInfo)) {
    if (!s.stopRequested && !s.renewedTurns.has(s.turnId) && s.inTurnRenewal === null) {
      s.renewedTurns.add(s.turnId);
      const conversation = turn.recoveryText?.trim() ? turn.recoveryText : turn.text;
      s.inTurnRenewal = renewalPrompt({ base: conversation,
        steps: s.renewalSteps,
        lastText: s.renewalLastText || s.state.lastText,
      });
      void s.renewContext().catch(() => {});
      return;
    }
    s.freshNextTurn.add(s.threadId);
    s.state.contextFullStop = true;
  }
  const message = refused ? codexSignInExpired(raw) : codexUserError(raw, s.route, error.codexErrorInfo);
  const setup = refused || classifyError({ text: raw }).reason === "auth";
  if (message === s.state.lastError && (s.state.lastErrorSetup || !setup)) return;
  s.state.lastError = message;
  s.state.lastErrorSetup ||= setup;
  s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.error", message, ...(setup ? { setup: true } : {}) });
};

}
