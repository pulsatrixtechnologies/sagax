// Carries out one agents tool: checks the arguments, calls the harness, and
// turns the answer into the text the model reads. One core for every front
// end, so a tool validates, refuses and teaches the same way however it was
// reached; the stdio MCP proxy (agents-proxy.ts) is the only front end today.
//
// Nothing here reads the environment or holds state of its own. The caller
// passes a ToolCallContext. Per-turn limits (bots created, threads opened,
// room posts, checking a delegation made this turn) are the harness's: one
// proxy can serve many turns of a warm engine, and only the harness knows
// where a turn begins.
//
// Tool definitions and per-family handlers live under ./agents-tools/.
import { readFileSync } from "node:fs";
import { isOpenApiTool } from "../mcp/openapi-tools.ts";
import { callCardTool, CARD_TOOL_NAMES } from "./agents-call-cards.ts";
import { callPhoneTool, PHONE_TOOL_NAME } from "./agents-phone-tools.ts";
import { callVideoTool, VIDEO_TOOL_NAME } from "./agents-video.ts";
import { callVaultHttpTool, VAULT_HTTP_TOOL_NAME } from "./agents-vault-http-tools.ts";
import { callConnectorSetupTool, CONNECTOR_SETUP_TOOL_NAME } from "./agents-connector-setup.ts";
import { ARTIFACT_TOOL_NAMES, callArtifactTool } from "./agents-call-artifacts.ts";
import { callTaskListTool, TASK_LIST_TOOL_NAMES } from "./agents-call-tasks.ts";
import { HELP_TOOL_NAMES } from "./agents-help-tools.ts";
import { WEB_SEARCH_TOOL_NAMES } from "./agents-web-search-tools.ts";
import { SETTINGS_TOOL_NAMES } from "./agents-settings-tools.ts";
import { APPROVALS_TOOL_NAMES } from "./agents-approvals-tools.ts";
import { callWaitTool, WAIT_TOOL_NAMES } from "./agents-wait-tools.ts";
import { catalogProfileFromEnv } from "./agents-catalog.ts";
import { harnessClientFromEnv } from "./agents-client.ts";
import type { Json } from "./agents-client.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call-types.ts";
import { remoteSupportFromEnv } from "../remote-support/remote-support-local.ts";
import { callCoreTool } from "./agents-tools/core.ts";
import { callRoomsTool } from "./agents-tools/rooms.ts";
import { callTeamTool } from "./agents-tools/team.ts";
import { callRoutinesTool } from "./agents-tools/routines.ts";
import { callCloudAgentsTool } from "./agents-tools/cloud-agents.ts";
import { callSettingsTool } from "./agents-tools/settings.ts";
import { callTranscriptsTool } from "./agents-tools/transcripts.ts";
import { callComputersTool } from "./agents-tools/computers.ts";
import { callAgentApiTool } from "./agents-tools/agent-api.ts";
import { callPhoneFamilyTool } from "./agents-tools/phone.ts";
import { callExtrasTool } from "./agents-tools/extras.ts";
import { callPerspicaxTool } from "./agents-tools/perspicax.ts";
import { callGrokBridgeTool } from "./agents-tools/grok-bridge.ts";
import { wrapperAct } from "./agents-tools/shared.ts";

export type { ToolCallContext, ToolCallResult } from "./agents-call-types.ts";
export {
  capResult,
  completedProposalResult,
  sendTeammateRequest,
  wrapperAct,
  githubConnectText,
} from "./agents-tools/shared.ts";

export function toolCallContextFromEnv(env: NodeJS.ProcessEnv): ToolCallContext {
  const profile = catalogProfileFromEnv(env);
  const launchedDepth = Number(env.SAGAX_TURN_DEPTH ?? "0") || 0;
  const depthFile = env.SAGAX_TURN_DEPTH_FILE;
  return {
    botId: profile.botId,
    threadId: env.SAGAX_THREAD_ID ?? "",
    // A process kept across turns reads the current turn's depth each call.
    get depth() {
      if (!depthFile) return launchedDepth;
      try {
        const value = Number(readFileSync(depthFile, "utf8").trim());
        return Number.isInteger(value) && value >= 0 ? value : launchedDepth;
      } catch {
        return launchedDepth;
      }
    },
    externalRuntime: profile.externalRuntime === true,
    coordinating: profile.coordinating === true,
    sharedComputers: profile.sharedComputers,
    client: harnessClientFromEnv(env),
    remoteSupport: remoteSupportFromEnv(env),
  };
}


export async function callTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { externalRuntime: EXTERNAL_RUNTIME } = context;
  const { apiResponse } = context.client;

  // Already-extracted leaf handlers (definitions live beside them).
  if (CARD_TOOL_NAMES.has(name)) return callCardTool(name, args, context);
  if (name === PHONE_TOOL_NAME) return callPhoneTool(args, context);
  if (name === VIDEO_TOOL_NAME) return callVideoTool(args, context.client);
  if (name === VAULT_HTTP_TOOL_NAME) return callVaultHttpTool(args, context);
  if (name === CONNECTOR_SETUP_TOOL_NAME) return callConnectorSetupTool(args, context);
  if (ARTIFACT_TOOL_NAMES.has(name)) return callArtifactTool(name, args, context);
  if (TASK_LIST_TOOL_NAMES.has(name)) return callTaskListTool(name, args, context);
  if (HELP_TOOL_NAMES.has(name)) {
    if (typeof args.question !== "string" || !args.question.trim()) return { text: "question: what the person wants to know about Sagax or Perspicax.", isError: true };
    const { ok, body } = await apiResponse("/api/internal/self-knowledge", { method: "POST", body: JSON.stringify({ question: args.question }) });
    if (!ok) return { text: String(body.error ?? "The knowledge base is unavailable; check your own tool list before you answer."), isError: true };
    return { text: String(body.text ?? "") };
  }
  if (WEB_SEARCH_TOOL_NAMES.has(name)) {
    if (EXTERNAL_RUNTIME) return { text: `Unknown tool: ${name}`, isError: true };
    if (typeof args.query !== "string" || !args.query.trim()) return { text: "query: what to search for.", isError: true };
    const { ok, body } = await apiResponse("/api/internal/web-search", {
      method: "POST",
      body: JSON.stringify({ query: args.query, ...(typeof args.count === "number" ? { count: args.count } : {}) }),
    });
    if (!ok) return { text: String(body.error ?? "The web search failed."), isError: true };
    return { text: String(body.text ?? "") };
  }
  if (SETTINGS_TOOL_NAMES.has(name)) {
    if (EXTERNAL_RUNTIME) return { text: `Unknown tool: ${name}`, isError: true };
    const { status, body } = await apiResponse("/api/internal/settings", { method: "POST", body: JSON.stringify(args ?? {}) });
    const text = String(body.text ?? body.error ?? "").slice(0, 12000);
    if (status >= 400 || body.error) return { text: text || "The change was refused.", isError: true };
    return { text: text || "Done." };
  }
  if (APPROVALS_TOOL_NAMES.has(name)) {
    if (EXTERNAL_RUNTIME) return { text: `Unknown tool: ${name}`, isError: true };
    const { status, body } = await apiResponse("/api/internal/approvals", { method: "POST", body: JSON.stringify(args ?? {}) });
    const text = String(body.text ?? body.error ?? "").slice(0, 8000);
    if (status >= 400 || body.error) return { text: text || "The answer was refused.", isError: true };
    return { text: text || "Done." };
  }
  if (WAIT_TOOL_NAMES.has(name)) return callWaitTool(name, args, context);

  // Wrapper tools that stand for /api/internal/act (answer_approval, nudge_person,
  // manage_pairing, manage_settings). Perspicax and claims are in their family.
  if (name === "answer_approval" || name === "nudge_person" || name === "manage_pairing" || name === "manage_settings") {
    if (EXTERNAL_RUNTIME) return { text: `Unknown tool: ${name}`, isError: true };
    const act = wrapperAct(name, args);
    if ("error" in act) return { text: String(act.error), isError: true };
    const { status, body } = await apiResponse("/api/internal/act", { method: "POST", body: JSON.stringify(act) });
    const text = String(body.text ?? body.error ?? "").slice(0, 8000);
    if (status >= 400 || body.error) return { text: text || "The action was refused.", isError: true };
    return { text: text || "Done." };
  }

  const familyHandlers = [
    callAgentApiTool,
    callPerspicaxTool,
    callGrokBridgeTool,
    callCoreTool,
    callRoomsTool,
    callTeamTool,
    callRoutinesTool,
    callCloudAgentsTool,
    callSettingsTool,
    callTranscriptsTool,
    callComputersTool,
    callPhoneFamilyTool,
    callExtrasTool,
  ];
  for (const handler of familyHandlers) {
    const result = await handler(name, args, context);
    if (result) return result;
  }

  if (isOpenApiTool(name)) {
    if (EXTERNAL_RUNTIME) return { text: `Unknown tool: ${name}`, isError: true };
    const { ok, body } = await apiResponse("/api/internal/openapi", {
      method: "POST",
      body: JSON.stringify({ name, arguments: args ?? {} }),
    });
    if (!ok) return { text: String(body.error ?? "The API call failed."), isError: true };
    return { text: String(body.text ?? "") };
  }
  return { text: `Unknown tool: ${name}`, isError: true };
}
