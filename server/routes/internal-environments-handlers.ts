// Path handlers for internal environment routes (#1383).
// createInternalEnvironmentsRoutes keeps the dispatch order and the
// computer-control bot-lookup exception. Each route owns its match.
import {
  autoComputerReason,
  autoComputerToolRefusal,
  COMPUTER_SELECT_TOOL,
  selectAutoComputer,
  type AutoComputerState,
} from "../computer/auto-computer.ts";
import { MY_CHROME_PROFILE, runMyChromeTool, toolName as browserToolName } from "../browser/my-chrome/pilot.ts";
import { browserNavigationRefusal } from "../browser/browser-navigation.ts";
import { pickComputer } from "../computer/computer-selection.ts";
import { withCommandVariables } from "../vault/credential-command-env.ts";
import type { DesktopBridgeOperation } from "../desktop/desktop-bridge.ts";
import { handleDesktopBridgeMcp } from "../desktop/desktop-bridge-tools.ts";
import { handleMessagesMcp } from "../imessage/imessage-mcp.ts";
import { misusePathRefusal, misuseRefusal, misuseToolFrameText } from "../safety/misuse-guardrails.ts";
import { serverPathAnswer, serverPathInCommand } from "../sandbox/sandbox-server-path.ts";
import { deliverableNotification } from "../notify.ts";
import { enginePluginCommandRefusal } from "../people/person-integrations.ts";
import type { PersonalMcpServer } from "../people/person-connections.ts";
import { readPersonalCopy } from "../personal-copy.ts";
import { SANDBOX_CONTROL_REFUSAL } from "../sandbox/sandbox-control.ts";
import { StdioRelayError } from "../sandbox/sandbox-stdio-mcp.ts";
import { sharedComputerOperation } from "../computer/shared-computers.ts";
import { SMALL_TALK_CLOUD_REFUSAL } from "../small-talk.ts";
import { DESKTOP_BRIDGE_MCP_NAME } from "../../shared/bot-workplace.ts";
import { parseSurface, surfaceLabel, type Surface } from "../surface.ts";
import { teamComputerOwner } from "../computer/team-computers.ts";
import { boundToolResult, readOnHint, type BoundToolTextOptions } from "../tools/tool-output-bound.ts";
import { USER_SANDBOX_MCP_NAME } from "../sandbox/user-sandbox-routing.ts";
import { UserSandboxUnavailable } from "../sandbox/user-sandbox-manager.ts";
import { handleUserSandboxMcp } from "../sandbox/user-sandbox-tools.ts";
import { inBotFolder } from "../sandbox/sandbox-bot-folder.ts";
import type { SandboxExecInput } from "../sandbox/sandboxd-core.ts";
import type { InternalCapabilityView, InternalRouteContext } from "./internal-route.ts";
import { PASS } from "./table.ts";
import type { MacAppId, MacAppToolResult } from "../../electron/mac-apps.mjs";

/** One computer select_computer can offer (selectableComputers in index). */
export type SelectableComputer = {
  surface: Surface;
  label: string;
  available: boolean;
  ready: boolean;
  canStart: boolean;
  canCreate: boolean;
  reason?: string;
};

function boundSharedComputerResult(
  operation: { action: string; encoding?: unknown },
  result: unknown,
  hold?: BoundToolTextOptions["hold"],
): unknown {
  const bound = (hint?: string) => boundToolResult(result, { ...(hint ? { hint } : {}), ...(hold ? { hold } : {}) });
  if (operation.action === "run_command" || operation.action === "list_files" || operation.action === "read_copy") {
    return bound();
  }
  if (operation.action === "read_file" && operation.encoding !== "base64") {
    return bound(readOnHint());
  }
  return result;
}

export interface InternalEnvironmentsBot {
  id: string;
  name: string;
  color: string;
  threadId?: string;
  computer?: string;
  browser?: boolean;
  browserProfile?: string | null;
  allowedRecipients?: string[];
  alwaysAllow?: string[];
}

export interface ComputerSelectionSource {
  generation: string;
  mounted?: string;
  selected?: string;
  previousSurface?: unknown;
}

export interface InternalEnvironmentsDeps {
  bot(id: string): InternalEnvironmentsBot | null | undefined;
  projectBotForTask(botId: string, threadId: string): InternalEnvironmentsBot | null | undefined;
  isConfidentialThread(threadId: string): boolean;
  requireActive(capability: InternalCapabilityView): void;
  /** Live-turn check without throwing (desktop/shared-computers active() closures). */
  isActive(capability: InternalCapabilityView): boolean;
  isPerspicax(): boolean;
  lendingEnabled(): boolean;
  identityKind(): string;
  platform(): NodeJS.Platform;
  dataDir(): string;
  localPrincipalId(): string;

  computerSelection(threadId: string): ComputerSelectionSource | undefined;
  selectionStillCurrent(threadId: string, source: ComputerSelectionSource): boolean;
  /** Marks the selection on the turn's source and records the previous task surface. */
  setComputerSelected(threadId: string, botId: string, surface: string): void;
  autoVmClaim(threadId: string): { owner: { generation: string }; startsComputer?: boolean; failed?: boolean } | undefined;
  selectableComputers(bot: InternalEnvironmentsBot): Promise<SelectableComputer[]>;
  computerPreviewSurface(bot: InternalEnvironmentsBot, threadId: string | undefined): Promise<string>;

  builtInBrowserEnabled(): boolean;
  effectiveBrowserProfile(botId: string, profile: string | undefined | null): string | undefined;
  myChromeUnavailable(): string | null;
  myChromeNavigationRefusal(params: unknown): string | null;
  browserNavigationRefusal(params: unknown): string | null;
  browserIntegration(
    botId: string,
    profile: string | undefined | null,
    threadId: string,
  ): Promise<{ session: string; spec: unknown } | null | undefined>;
  currentBrowserSession(botId: string, profile: string | undefined | null, threadId: string): string;
  vaultPrincipalForThread(threadId: string): string | null;
  fillBrowserCredentials(input: {
    principalId: string;
    botId: string;
    threadId: string;
    approvalMode(): string;
  }): unknown;
  claimTurnResource(capability: InternalCapabilityView, resource: string): boolean;
  browserAgentRpc(
    session: string,
    spec: unknown,
    method: string,
    params: unknown,
    beforeDispatch: () => void,
    credentials: unknown,
  ): Promise<unknown>;
  myChromeMemory(): unknown;
  myChromeTakeNotes(session: string): unknown;
  myChromeToolAllowed(tool: { name?: unknown; arguments?: unknown }): boolean;
  runMyChromeTool: typeof runMyChromeTool;
  confirmHeldCard(input: {
    threadId: string;
    botId: string;
    tool: string;
    summary: string;
    allowKey?: string;
  }): Promise<"allow" | "deny" | "timeout">;
  sourceApprovalMode(botId: string, threadId: string): string;

  userSandboxAvailable(): boolean;
  smallTalkTurn(threadId: string): { generation: string; messageId: string } | undefined;
  activePathLastUserId(threadId: string): string | undefined;
  stagePendingAttachments(threadId: string, generation: string): Promise<void>;
  syncGithubForTurn(principalId: string, generation: string, botId: string): Promise<void>;
  syncPluginsForTurn(principalId: string, generation: string, botId: string): Promise<void>;
  sandboxControlHeld(ownerId: string): boolean;
  autoComputerSelectionFor(capability: InternalCapabilityView): AutoComputerState | null;
  autoComputerToolRefusal(selected: unknown, mcpName: string, toolName: string): string | null;
  handleUserSandboxMcp: typeof handleUserSandboxMcp;
  /** Hold a cut machine-tool answer for tool_result_read (TST-02). */
  saveToolResult(capability: InternalCapabilityView, text: string, truncated?: boolean): { id: string };
  commandVariablesFor(botId: string, threadId: string, principalId?: string): Record<string, string>;
  withCommandVariables: typeof withCommandVariables;
  userSandboxExec(ownerId: string, input: unknown, botId: string): Promise<unknown>;
  userSandboxOverQuota(ownerId: string, botId: string): boolean | Promise<boolean>;
  /** The bot's own folder in the environment (server/sandbox/sandbox-bot-folder.ts),
   * or null: its commands then start at /workspace as before. */
  sandboxBotFolder?(botId: string): string | null;
  /** This bot's own folders on the Sagax server (its workspace and task
   * workspaces, every spelling): a sandbox tool given one gets a short line
   * naming its folder in the environment (server/sandbox/sandbox-server-path.ts). */
  serverBotRoots?(botId: string): string[];
  /** The start-of-environment tidy (once per start) and disk check. */
  sandboxTidy?(ownerId: string, botId: string): Promise<void>;
  /** A disk-full warning for this person's environment, or null. */
  sandboxDiskWarning?(ownerId: string, folder: string | null): string | null;
  enginePluginCommandRefusal(command: string): string | null;
  misuseTextRefusal(
    text: string,
    speakerId: string | undefined,
    surface: "flow" | "mcp" | "shell" | "terminal" | "file",
    meta?: { botId: string; threadId: string; tool?: string },
  ): string | null;
  misusePathRefusal(path: string, meta: { triage: boolean; principalId?: string; botId: string; threadId: string; tool: string; cwd?: string }): { message: string } | null;
  misuseToolFrameText(frame: unknown): string | null;
  misuseRefusal(
    text: string,
    meta: { triage: boolean; principalId?: string; surface: string; botId: string; threadId: string; tool: string },
  ): { status: number; message: string; code?: string } | null;
  safetyPrincipal(threadId: string): { triage: boolean; principalId?: string };
  misuseActor(principalId: string | null | undefined): { triage: boolean; principalId?: string };
  safetyReviewer(botId: string): ((prompt: string, signal?: AbortSignal) => Promise<string>) | undefined;
  safetyToolHold(input: {
    text: string;
    surface: string;
    tool: string;
    known: boolean;
    triage: boolean;
    principalId?: string;
    threadId: string;
    botId: string;
    review?: (prompt: string, signal?: AbortSignal) => Promise<string>;
    ownEnvironment?: boolean;
  }): Promise<string | null>;
  // index casts SafetySurface; keep surface as string here to avoid coupling.
  samePerson(a: string | null | undefined, b: string | null | undefined): boolean;

  personalMcpServer(person: string, name: string): PersonalMcpServer | undefined;
  scopedPluginMcp(bot: InternalEnvironmentsBot, person: string): Array<{
    scope: string;
    key: string;
    name: string;
    spec: { command: string; args: string[]; env?: Record<string, string> } | { url: string };
  }>;
  stdioRelay(input: {
    principalId: string;
    botId: string;
    threadId: string;
    server: string;
    spec: { argv: string[]; env?: Record<string, string> };
    frame: unknown;
  }): Promise<unknown>;

  desktopConnected(person: string): boolean;
  handleDesktopBridgeMcp: typeof handleDesktopBridgeMcp;
  /** Solo Mac: an Apple app's On/Off switch (Plugins > This Mac). */
  macAppEnabled?(app: MacAppId): boolean;
  /** Solo Mac: run one Apple app tool here (electron/mac-apps.mjs). */
  runMacApp?(tool: string, args: Record<string, unknown>): Promise<MacAppToolResult>;
  /** The person's signed-in desktop is a Mac that offers its Apple apps. */
  desktopBridgeMacApps?(person: string): boolean;
  /** The Apple apps On in the person's Plugins > This Mac, as their Mac last
   * reported them (kept while it is offline). */
  desktopBridgeMacAppsOn?(person: string): readonly string[];
  desktopBridgesRequest(
    person: string,
    operation: DesktopBridgeOperation,
    active: () => boolean,
    onProgress?: () => void,
    /** The bot turn asking, so a device set to Ask every time raises its card. */
    context?: { botId: string; threadId: string },
  ): Promise<unknown>;
  bridgeAuditRecord(row: Record<string, unknown>): void;
  broadcast(event: Record<string, unknown>): void;

  turnWorkplace(threadId: string): {
    generation: string;
    auto?: AutoComputerState;
    decision: { principal?: string };
  } | undefined;
  setTurnWorkplaceAuto(threadId: string, auto: AutoComputerState): void;
  appendAdminAction(row: Record<string, unknown>): void;
  auditBotTarget(botId: string): { kind: string; id: string; name?: string };

  claimedBoatId(capability: InternalCapabilityView): string | undefined;
  computerCallGate(capability: InternalCapabilityView, signal?: AbortSignal): Promise<{ held: boolean; helpReason?: string | null; reason?: string | null; blockedReason?: string | null }>;
  cloudComputerRpc(body: unknown, opts: {
    cfg: unknown;
    signal: AbortSignal;
    boxId: () => string | null | undefined;
    gate: () => Promise<unknown>;
    assertActive: () => void;
  }): Promise<unknown>;
  cloudComputerCfg(): unknown;

  messagesUseMessages(): boolean;
  standingGrantsAllowed(): boolean;
  autoAnswerStepUp(bot: InternalEnvironmentsBot, threadId: string, input: { tool: string; input: string; summary: string }): unknown[];
  imessageSender: unknown;
  handleMessagesMcp: typeof handleMessagesMcp;
  appendMessage(threadId: string, message: unknown): { id: string };
  bindImessageMessage(requestId: string, messageId: string): void;
  /** The allow rule the card's answerer kept for this exact candidate (index.ts keptCardRule). */
  keptCardRule?(bot: InternalEnvironmentsBot, threadId: string, candidate: { tool: string; scope: Record<string, string> }): unknown;
  workspaceDir(botId: string): string;
  taskWorkspacesDir(): string;

  sharedComputerPrincipal(capability: InternalCapabilityView): string | null;
  userComputerSpeaking(principal: string | null, capability: InternalCapabilityView): {
    speaker: unknown;
    context: unknown;
  };
  userComputersList(speaker: unknown, context: unknown): Array<{ computer: unknown; target: unknown }>;
  userComputersRequest(speaker: unknown, operation: unknown, active: () => boolean, context: unknown): Promise<unknown>;
  sharedComputersList(principal: string | null): unknown[];
  sharedComputersRequest(operation: unknown, principal: string | null, active: () => boolean): Promise<unknown>;
  readPersonalCopy(principal: string, kind: "chrome" | "folder", name: string): {
    at: number;
    kind: string;
    name: string;
    files: unknown;
  } | null;
  computerOff(botId: string): boolean;

  gateChecked(capability: InternalCapabilityView): void;
  requestHelpLease(controlKey: string, reason: unknown): {
    snapshot: { held: boolean; helpReason: string | null };
    requestId: string;
  };
  expireHelp(controlKey: string, requestId: unknown): { held: boolean; helpReason: string | null };
  activeGroupTurnForBot(botId: string): { group: { id?: string; name?: string; threadId?: string }; threadId: string } | null;
  blockedTarget(
    bot: InternalEnvironmentsBot & { threadId: string },
    room?: { threadId: string; group?: unknown } | null,
  ): { threadId: string; group?: unknown };
  computerSelectionMove(threadId: string): string | undefined;
  taskSurfacePin(botId: string, threadId: string): string | undefined | null;
  notify(notification: unknown): void;
}

type EnvironmentAnswer = typeof PASS | Promise<void>;

export function routeComputerSelect(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(path === "/api/internal/computer/select" && (method === "GET" || method === "POST"))) return PASS;
  return handleComputerSelect(deps, ctx);
}

async function handleComputerSelect(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, method, json, capability, readBody } = ctx;
  const source = deps.computerSelection(capability.threadId);
  const bot = deps.projectBotForTask(capability.botId, capability.threadId);
  const canSelect = Boolean(source && source.generation === capability.generation && bot && bot.computer !== "off");
  if (!bot) return json(res, 403, { error: "Computer selection belongs to a direct bot conversation." });
  const requested = method === "POST" ? (await readBody()).surface : undefined;
  if (method === "POST" && !canSelect) {
    return json(res, 403, { error: "Computer selection is only available once per direct user request, with computer access enabled." });
  }
  if (method === "POST" && requested !== "auto" && !parseSurface(requested)) {
    return json(res, 400, { error: "surface must be auto, cloud, vm, local, or browser" });
  }
  const options = await deps.selectableComputers(bot);
  const current = source ? source.mounted ?? "off" : await deps.computerPreviewSurface(bot, bot.threadId);
  deps.requireActive(capability);
  if (method === "GET") return json(res, 200, { current, canSelect, options });
  if (!deps.selectionStillCurrent(capability.threadId, source!)) {
    return json(res, 409, { error: "The user request ended before its computer was selected." });
  }
  const claim = deps.autoVmClaim(capability.threadId);
  const startsOnFirstCall = claim?.owner.generation === capability.generation && claim.startsComputer === true && !claim.failed;
  const picked = pickComputer(options, requested as Surface | "auto", current, startsOnFirstCall);
  const option = picked.option;
  if (!option?.available) {
    return json(res, 409, {
      error: option?.reason ?? "No configured computer or browser is available. Open the Computer panel to set one up.",
      options,
    });
  }
  if (source!.selected) {
    if (source!.selected !== option.surface) {
      return json(res, 409, { error: "A computer switch is already pending. End this turn to continue there." });
    }
  } else {
    if (picked.current) {
      return json(res, 200, {
        status: "ready",
        surface: current,
        message: option.ready
          ? "This computer is already selected. Use its mounted tools."
          : "This computer is already selected. It starts on its first call; use its mounted tools.",
      });
    }
    deps.setComputerSelected(capability.threadId, bot.id, option.surface);
  }
  return json(res, 200, {
    status: "pending",
    surface: option.surface,
    message: `End this turn now without using the previous computer tools. Sagax will continue the original request on ${option.label} with a fresh tool connection.`,
  });
}

export function routeBrowserMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/browser/mcp")) return PASS;
  return handleBrowserMcp(deps, ctx);
}

async function handleBrowserMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  const body = await readBody();
  const bot = deps.bot(capability.botId);
  if (!bot || bot.browser === false || bot.computer === "off" || !deps.builtInBrowserEnabled()) {
    return json(res, 403, { error: "browser tools are not enabled for this bot" });
  }
  const ownChrome = deps.effectiveBrowserProfile(bot.id, bot.browserProfile) === MY_CHROME_PROFILE
    && !deps.isConfidentialThread(capability.threadId);
  const ownChromeOff = ownChrome ? deps.myChromeUnavailable() : null;
  if (ownChromeOff) return json(res, 403, { error: ownChromeOff });
  const browser = await deps.browserIntegration(bot.id, bot.browserProfile, capability.threadId);
  if (!browser || browser.session !== capability.browserSession) {
    return json(res, 409, { error: "this browser profile changed; start a new turn" });
  }
  if (body?.method !== "tools/list" && body?.method !== "tools/call") {
    return json(res, 400, { error: "unsupported browser method" });
  }
  if (body.method === "tools/call") {
    const refusal = ownChrome
      ? deps.myChromeNavigationRefusal(body.params)
      : deps.browserNavigationRefusal(body.params) ?? browserNavigationRefusal(body.params);
    if (refusal) return json(res, 400, { error: refusal });
  }
  const vaultPrincipal = deps.vaultPrincipalForThread(capability.threadId);
  const credentials = vaultPrincipal
    ? deps.fillBrowserCredentials({
      principalId: vaultPrincipal,
      botId: bot.id,
      threadId: capability.threadId,
      approvalMode: () => deps.sourceApprovalMode(bot.id, capability.threadId),
    })
    : undefined;
  const beforeDispatch = () => {
    deps.requireActive(capability);
    const current = deps.bot(bot.id);
    if (!current || current.browser === false || current.computer === "off" || !deps.builtInBrowserEnabled()
      || deps.currentBrowserSession(current.id, current.browserProfile, capability.threadId) !== browser.session) {
      throw Object.assign(new Error("Browser access changed while connecting."), { status: 409 });
    }
    if (ownChrome && deps.myChromeUnavailable()) {
      throw Object.assign(new Error(deps.myChromeUnavailable()!), { status: 403 });
    }
    if (body.method === "tools/call" && !deps.claimTurnResource(capability, `browser:${browser.session}`)) {
      throw Object.assign(new Error("another thread is using this browser — pause browser work until that thread finishes"), { status: 409 });
    }
  };
  const run = (params: unknown) => deps.browserAgentRpc(
    browser.session,
    browser.spec,
    String(body.method),
    params,
    beforeDispatch,
    credentials,
  );
  let result: unknown;
  if (!ownChrome) {
    result = await run(body.params);
  } else if (body.method === "tools/list") {
    const listed = await run(body.params) as { tools?: Array<{ name?: unknown }> } | null;
    result = listed && Array.isArray(listed.tools)
      ? { ...listed, tools: listed.tools.filter((tool) => deps.myChromeToolAllowed({ name: tool?.name, arguments: {} })) }
      : listed;
  } else {
    result = await deps.runMyChromeTool({
      session: browser.session,
      params: body.params,
      memory: deps.myChromeMemory() as never,
      run,
      pageUrl: async () => {
        const answer = await deps.browserAgentRpc(
          browser.session,
          browser.spec,
          "tools/call",
          { name: "agent_browser_get_url", arguments: {} },
          beforeDispatch,
          credentials,
        ) as { content?: Array<{ text?: unknown }> };
        const text = String(answer?.content?.[0]?.text ?? "");
        try {
          return String((JSON.parse(text) as { data?: { url?: unknown } }).data?.url ?? "");
        } catch {
          return text;
        }
      },
      confirm: (summary, allowKey) => {
        const grants = (deps.projectBotForTask(bot.id, capability.threadId) ?? deps.bot(bot.id))?.alwaysAllow ?? [];
        if (allowKey && grants.includes(allowKey)) return Promise.resolve("allow" as const);
        return deps.confirmHeldCard({
          threadId: capability.threadId,
          botId: bot.id,
          tool: `my_chrome:${browserToolName(body.params)}`,
          summary,
          ...(allowKey ? { allowKey } : {}),
        });
      },
      notes: () => deps.myChromeTakeNotes(browser.session) as never,
      stepsUnasked: ["auto", "full"].includes(deps.sourceApprovalMode(bot.id, capability.threadId)),
    });
  }
  deps.requireActive(capability);
  return json(res, 200, { result });
}

export function routeSandboxMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/sandbox/mcp")) return PASS;
  return handleSandboxMcp(deps, ctx);
}

async function handleSandboxMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  if (!deps.userSandboxAvailable()) return json(res, 404, { error: "unknown internal endpoint" });
  const frame = await readBody() as { method?: unknown; params?: unknown } | null;
  const rpcMethod = typeof frame?.method === "string" ? frame.method : "";
  const ownerId = capability.sandboxPrincipalId;
  if (!ownerId) return json(res, 403, { error: "this capability has no server environment" });
  const smallTalkTurn = rpcMethod === "tools/call" ? deps.smallTalkTurn(capability.threadId) : undefined;
  if (smallTalkTurn && smallTalkTurn.generation === capability.generation
    && deps.activePathLastUserId(capability.threadId) === smallTalkTurn.messageId) {
    return json(res, 200, { result: { content: [{ type: "text", text: SMALL_TALK_CLOUD_REFUSAL }], isError: true } });
  }
  try {
    if (rpcMethod === "tools/call") await deps.stagePendingAttachments(capability.threadId, capability.generation);
    if (rpcMethod === "tools/call") await deps.syncGithubForTurn(ownerId, capability.generation, capability.botId);
    if (rpcMethod === "tools/call") await deps.syncPluginsForTurn(ownerId, capability.generation, capability.botId);
    const toolName = (frame?.params as { name?: unknown } | undefined)?.name;
    if (rpcMethod === "tools/call" && (toolName === "computer_use" || toolName === "computer_list_tools")
      && deps.computerOff(capability.botId)) {
      return json(res, 200, {
        result: { content: [{ type: "text", text: "This bot has no computer. Change its Computer setting to use the screen." }], isError: true },
      });
    }
    if (rpcMethod === "tools/call" && toolName === "computer_use" && deps.sandboxControlHeld(ownerId)) {
      return json(res, 200, { result: { content: [{ type: "text", text: SANDBOX_CONTROL_REFUSAL }], isError: true } });
    }
    const autoState = rpcMethod === "tools/call" ? deps.autoComputerSelectionFor(capability) : null;
    const autoRefusal = autoState && (
      deps.autoComputerToolRefusal(autoState.selected, USER_SANDBOX_MCP_NAME, String(toolName ?? ""))
      ?? autoComputerToolRefusal(autoState.selected, USER_SANDBOX_MCP_NAME, String(toolName ?? ""))
    );
    if (autoRefusal) return json(res, 200, { result: { content: [{ type: "text", text: autoRefusal }], isError: true } });
    const folder = deps.sandboxBotFolder?.(capability.botId) ?? null;
    if (rpcMethod === "tools/call") await deps.sandboxTidy?.(ownerId, capability.botId);
    const result = await deps.handleUserSandboxMcp(rpcMethod, frame?.params, {
      exec: (input) => {
        const placed = deps.withCommandVariables(input as never, deps.commandVariablesFor(capability.botId, capability.threadId, ownerId)) as SandboxExecInput;
        return deps.userSandboxExec(ownerId, folder ? inBotFolder(placed, folder) : placed, capability.botId) as never;
      },
      overQuota: async () => await deps.userSandboxOverQuota(ownerId, capability.botId),
      commandRefusal: (command) => deps.enginePluginCommandRefusal(command)
        ?? enginePluginCommandRefusal(command)
        ?? deps.misuseTextRefusal(command, ownerId, "shell", { botId: capability.botId, threadId: capability.threadId, tool: "run_command" }),
      serverPathAnswer: (value, kind) => {
        const where = { roots: deps.serverBotRoots?.(capability.botId) ?? [], folder };
        return kind === "path" ? serverPathAnswer(value, where) : serverPathInCommand(value, where);
      },
      // a relative path resolves against the bot's own folder, where
      // the tools run (inBotFolder); /workspace without one
      pathRefusal: (pathValue) => deps.misusePathRefusal(pathValue, {
        ...deps.misuseActor(ownerId),
        botId: capability.botId,
        threadId: capability.threadId,
        tool: "read_file",
        ...(folder ? { cwd: folder } : {}),
      })?.message ?? misusePathRefusal(pathValue, {
        ...deps.misuseActor(ownerId),
        botId: capability.botId,
        threadId: capability.threadId,
        tool: "read_file",
        ...(folder ? { cwd: folder } : {}),
      })?.message ?? null,
      textRefusal: (value) => deps.misuseTextRefusal(value, ownerId, "shell", {
        botId: capability.botId,
        threadId: capability.threadId,
      }),
      beforeCall: (name, detail) => {
        const who = deps.safetyPrincipal(capability.threadId);
        const principalId = who.principalId ?? ownerId;
        // full-access: safety-review
        return deps.safetyToolHold({
          text: detail,
          surface: name.includes("computer") ? "computer" : name === "run_command" ? "shell" : "file",
          tool: name,
          known: true,
          triage: who.triage || deps.misuseActor(ownerId).triage,
          ...(principalId ? { principalId } : {}),
          threadId: capability.threadId,
          botId: capability.botId,
          review: deps.safetyReviewer(capability.botId),
          ownEnvironment: deps.samePerson(principalId, ownerId),
        });
      },
    }, {
      hold: (full) => deps.saveToolResult(capability, full, true),
      folder,
      diskWarning: () => deps.sandboxDiskWarning?.(ownerId, folder) ?? null,
    });
    deps.requireActive(capability);
    return json(res, 200, { result });
  } catch (error) {
    if (error instanceof UserSandboxUnavailable) {
      return json(res, 200, { result: { content: [{ type: "text", text: error.message }], isError: true } });
    }
    const status = (error as { status?: number }).status;
    return json(res, status === 400 || status === 404 ? status : 502, {
      error: error instanceof Error ? error.message : "the server environment failed",
    });
  }
}

export function routePersonalMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/personal-mcp")) return PASS;
  return handlePersonalMcp(deps, ctx);
}

async function handlePersonalMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  if (!deps.isPerspicax() || !deps.userSandboxAvailable()) {
    return json(res, 404, { error: "unknown internal endpoint" });
  }
  const body = await readBody() as { message?: { id?: unknown; method?: unknown } } | null;
  const person = capability.sandboxPrincipalId;
  const name = capability.personalMcpServer;
  if (!person || !name) return json(res, 403, { error: "this capability names no MCP server" });
  const frame = body?.message;
  const answerError = (message: string) => {
    if (!frame || frame.id === undefined || frame.id === null || typeof frame.method !== "string") return { message: null };
    return frame.method === "tools/call"
      ? { message: { jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text: message }], isError: true } } }
      : { message: { jsonrpc: "2.0", id: frame.id, error: { code: -32603, message } } };
  };
  const personalFrame = deps.misuseToolFrameText(frame) ?? misuseToolFrameText(frame);
  if (personalFrame) {
    const personalMisuse = deps.misuseTextRefusal(
      personalFrame,
      person,
      personalFrame.includes("flow_action") ? "flow" : "mcp",
      { botId: capability.botId, threadId: capability.threadId, tool: "personal-mcp" },
    );
    if (personalMisuse) return json(res, 200, answerError(personalMisuse));
    const who = deps.safetyPrincipal(capability.threadId);
    // full-access: safety-review
    const personalHeld = await deps.safetyToolHold({
      text: personalFrame,
      surface: personalFrame.includes("flow_action") ? "flow" : "mcp",
      tool: "personal-mcp",
      known: true,
      triage: who.triage || deps.misuseActor(person).triage,
      principalId: who.principalId ?? person,
      threadId: capability.threadId,
      botId: capability.botId,
      review: deps.safetyReviewer(capability.botId),
    });
    if (personalHeld) return json(res, 200, answerError(personalHeld));
  }
  let server: PersonalMcpServer | undefined;
  if (capability.pluginMcp) {
    const plugin = capability.pluginMcp;
    const bot = deps.bot(capability.botId);
    const current = bot
      ? deps.scopedPluginMcp(bot, person).find((entry) =>
        entry.scope === plugin.scope && entry.key === plugin.key && entry.name === plugin.name)
      : undefined;
    if (current && !("url" in current.spec)) {
      server = { kind: "stdio", ...current.spec, runsIn: "environment", enabled: true, addedAt: 0 } as PersonalMcpServer;
    }
  } else {
    server = deps.personalMcpServer(person, name);
  }
  if (!server || server.kind !== "stdio" || !server.enabled) {
    return json(res, 200, answerError("This MCP server was removed or turned off in Settings > Mes connexions."));
  }
  try {
    if (capability.pluginMcp) await deps.syncPluginsForTurn(person, capability.generation, capability.botId);
    if (frame?.method === "tools/call") await deps.syncGithubForTurn(person, capability.generation, capability.botId);
    const answer = await deps.stdioRelay({
      principalId: person,
      botId: capability.botId,
      threadId: capability.threadId,
      server: name,
      spec: { argv: [server.command, ...server.args], env: server.env },
      frame,
    });
    deps.requireActive(capability);
    return json(res, 200, { message: answer });
  } catch (error) {
    if (error instanceof StdioRelayError || error instanceof UserSandboxUnavailable) {
      return json(res, 200, answerError(error.message));
    }
    const status = (error as { status?: number }).status;
    if (status === 409 || status === 410) {
      return json(res, status, { error: error instanceof Error ? error.message : "the turn ended" });
    }
    return json(res, 200, answerError("Your MCP server could not be reached in your server environment."));
  }
}

export function routeDesktopMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/desktop/mcp")) return PASS;
  return handleDesktopMcp(deps, ctx);
}

async function handleDesktopMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  if (!deps.isPerspicax()) return json(res, 404, { error: "unknown internal endpoint" });
  const frame = await readBody() as { method?: unknown; params?: unknown } | null;
  const rpcMethod = typeof frame?.method === "string" ? frame.method : "";
  const person = capability.desktopPrincipalId;
  if (!person) return json(res, 403, { error: "this capability has no computer" });
  const active = () => deps.isActive(capability);
  try {
    const autoState = rpcMethod === "tools/call" ? deps.autoComputerSelectionFor(capability) : null;
    const autoRefusal = autoState && (
      deps.autoComputerToolRefusal(autoState.selected, DESKTOP_BRIDGE_MCP_NAME, String((frame?.params as { name?: unknown } | undefined)?.name ?? ""))
      ?? autoComputerToolRefusal(autoState.selected, DESKTOP_BRIDGE_MCP_NAME, String((frame?.params as { name?: unknown } | undefined)?.name ?? ""))
    );
    if (autoRefusal) return json(res, 200, { result: { content: [{ type: "text", text: autoRefusal }], isError: true } });
    if (rpcMethod === "tools/call") {
      const desktopParams = frame?.params as { name?: unknown; arguments?: unknown } | undefined;
      const desktopTool = typeof desktopParams?.name === "string" ? desktopParams.name : "";
      const who = deps.safetyPrincipal(capability.threadId);
      // full-access: safety-review
      const desktopHeld = await deps.safetyToolHold({
        text: `${desktopTool}\n${desktopParams?.arguments === undefined ? "" : JSON.stringify(desktopParams.arguments)}`,
        surface: /computer/i.test(desktopTool) ? "computer" : "shell",
        tool: desktopTool || "desktop",
        known: Boolean(desktopTool),
        triage: who.triage || deps.misuseActor(person).triage,
        principalId: who.principalId ?? person,
        threadId: capability.threadId,
        botId: capability.botId,
        review: deps.safetyReviewer(capability.botId),
        ownEnvironment: deps.samePerson(who.principalId ?? person, person),
      });
      if (desktopHeld) return json(res, 200, { result: { content: [{ type: "text", text: desktopHeld }], isError: true } });
      await deps.stagePendingAttachments(capability.threadId, capability.generation);
    }
    const result = await deps.handleDesktopBridgeMcp(rpcMethod, frame?.params, async (operation: DesktopBridgeOperation) => {
      if ((operation.action === "computer_tools" || operation.action === "computer_call") && deps.computerOff(capability.botId)) {
        throw new Error("This bot has no computer. Change its Computer setting to use the screen.");
      }
      const detail = operation.action === "fetch_url" || operation.action === "browse"
        ? `${operation.action} ${(() => {
          try {
            return new URL(operation.url ?? "").host;
          } catch {
            return "";
          }
        })()}`
        // The Apple app tool (target app + verb), never the message or note.
        : operation.action === "mac_app" ? `mac_app ${operation.tool_name ?? ""}`
        : operation.action;
      let provisioning = false;
      const onProgress = operation.action === "vm_create"
        ? () => {
          if (provisioning || !active()) return;
          provisioning = true;
          deps.broadcast({ kind: "computer", botId: capability.botId, state: "provisioning" });
        }
        : undefined;
      try {
        const answer = await deps.desktopBridgesRequest(person, operation, active, onProgress, { botId: capability.botId, threadId: capability.threadId }).finally(() => {
          if (provisioning) deps.broadcast({ kind: "computer", botId: capability.botId, state: "ready" });
        });
        deps.bridgeAuditRecord({
          person,
          botId: capability.botId,
          threadId: capability.threadId,
          target: "user-desktop",
          kind: "tool",
          detail,
          ok: (answer as { isError?: boolean } | null)?.isError !== true,
        });
        return answer;
      } catch (error) {
        deps.bridgeAuditRecord({
          person,
          botId: capability.botId,
          threadId: capability.threadId,
          target: "user-desktop",
          kind: "tool",
          detail,
          ok: false,
          error: (error as Error).message,
        });
        throw error;
      }
    }, {
      commandRefusal: (command) => deps.enginePluginCommandRefusal(command)
        ?? enginePluginCommandRefusal(command)
        ?? deps.misuseTextRefusal(command, person, "shell", {
          botId: capability.botId,
          threadId: capability.threadId,
          tool: "run_command",
        }),
      payloadRefusal: (value) => deps.misuseTextRefusal(value, person, "shell", {
        botId: capability.botId,
        threadId: capability.threadId,
        tool: "desktop",
      }),
      commandVariables: () => deps.commandVariablesFor(capability.botId, capability.threadId, person),
      hold: (full) => deps.saveToolResult(capability, full, true),
      // A Mac that reports its On apps gets them through the messages
      // server (every engine, every computer): not listed twice here.
      macApps: () => deps.desktopBridgeMacApps?.(person) === true && !deps.desktopBridgeMacAppsOn?.(person)?.length,
    });
    deps.requireActive(capability);
    return json(res, 200, { result });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return json(res, status === 400 || status === 404 ? status : 502, {
      error: error instanceof Error ? error.message : "your computer could not be reached",
    });
  }
}

export function routeWorkplaceMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/workplace/mcp")) return PASS;
  return handleWorkplaceMcp(deps, ctx);
}

async function handleWorkplaceMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  if (!deps.isPerspicax()) return json(res, 404, { error: "unknown internal endpoint" });
  const frame = await readBody() as { method?: unknown; params?: unknown } | null;
  const rpcMethod = typeof frame?.method === "string" ? frame.method : "";
  if (rpcMethod === "tools/list") return json(res, 200, { result: { tools: [COMPUTER_SELECT_TOOL] } });
  if (rpcMethod !== "tools/call") return json(res, 404, { error: "method not found" });
  const call = (frame?.params ?? {}) as { name?: unknown; arguments?: unknown };
  if (call.name !== COMPUTER_SELECT_TOOL.name) {
    return json(res, 200, {
      result: { content: [{ type: "text", text: `unknown tool ${String(call.name)}` }], isError: true },
    });
  }
  const args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)
    ? call.arguments as Record<string, unknown>
    : {};
  deps.requireActive(capability);
  const workplace = deps.turnWorkplace(capability.threadId);
  if (!workplace?.auto || workplace.generation !== capability.generation) {
    return json(res, 200, { result: { content: [{ type: "text", text: "This turn has no computer to choose." }], isError: true } });
  }
  const person = workplace.decision.principal;
  const answer = selectAutoComputer(
    workplace.auto,
    { target: args.target, reason: args.reason },
    Boolean(person && deps.desktopConnected(person)),
  );
  if (answer.ok && answer.target && answer.changed) {
    const next = { ...workplace.auto, selected: answer.target };
    deps.setTurnWorkplaceAuto(capability.threadId, next);
    const reason = autoComputerReason(args.reason);
    deps.appendAdminAction({
      category: "computer",
      action: "computer.switch",
      target: deps.auditBotTarget(capability.botId),
      changed: ["computer"],
      before: { computer: answer.from ?? null },
      after: {
        computer: answer.target,
        threadId: capability.threadId,
        by: "bot",
        ...(reason ? { reason } : {}),
        ...((workplace.auto as { routine?: boolean }).routine ? { routine: true } : {}),
      },
      actor: person ? { kind: "person", principalId: person, via: "sagax" } : { kind: "worker" },
    });
  }
  return json(res, 200, { result: { content: [{ type: "text", text: answer.text }], ...(answer.ok ? {} : { isError: true }) } });
}

export function routeComputerMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/computer/mcp")) return PASS;
  return handleComputerMcp(deps, ctx);
}

async function handleComputerMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  const body = await readBody();
  if (capability.boxId === undefined) return json(res, 403, { error: "this turn has no cloud computer" });
  const abort = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  return json(res, 200, {
    result: await deps.cloudComputerRpc(body, {
      cfg: deps.cloudComputerCfg(),
      signal: abort.signal,
      boxId: () => capability.boxId ?? deps.claimedBoatId(capability),
      gate: () => deps.computerCallGate(capability, abort.signal),
      assertActive: () => deps.requireActive(capability),
    }),
  });
}

export { routeMessagesMcp, macAppRule } from "./internal-environments-messages.ts";

export function routePhoneClaim(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/phone/claim")) return PASS;
  return handlePhoneClaim(deps, ctx);
}

async function handlePhoneClaim(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability } = ctx;
  deps.requireActive(capability);
  if (!deps.claimTurnResource(capability, "computer:phone")) {
    return json(res, 409, { error: "another thread is using the phone" });
  }
  return json(res, 200, { claimed: true });
}

export function routeSharedComputersGet(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "GET" && path === "/api/internal/shared-computers" && deps.lendingEnabled())) return PASS;
  return handleSharedComputersGet(deps, ctx);
}

async function handleSharedComputersGet(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability } = ctx;
  const principal = deps.sharedComputerPrincipal(capability);
  const notice = {};
  if (deps.isPerspicax()) {
    try {
      const { speaker: computerSpeaker, context: computerContext } = deps.userComputerSpeaking(principal, capability);
      return json(res, 200, {
        computers: deps.userComputersList(computerSpeaker, computerContext).map((entry) => ({
          ...((entry.computer && typeof entry.computer === "object" ? entry.computer : {}) as object),
          target: entry.target,
        })),
      });
    } catch (error) {
      return json(res, (error as { status?: number }).status ?? 409, {
        error: (error as Error).message,
        code: (error as { code?: string }).code,
      });
    }
  }
  return json(res, 200, { computers: deps.sharedComputersList(principal), ...notice });
}

export function routeSharedComputersPost(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/shared-computers" && deps.lendingEnabled())) return PASS;
  return handleSharedComputersPost(deps, ctx);
}

async function handleSharedComputersPost(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  const parsed = sharedComputerOperation.safeParse(await readBody());
  if (!deps.lendingEnabled()) return json(res, 404, { error: "unknown internal endpoint" });
  if (!parsed.success) return json(res, 400, { error: "Invalid shared computer operation" });
  if (["computer_tools", "computer_call"].includes(parsed.data.action) && deps.computerOff(capability.botId)) {
    return json(res, 403, {
      error: "This bot has no computer. Change its Computer setting to use a shared computer's apps and screen.",
    });
  }
  const principal = deps.sharedComputerPrincipal(capability);
  if (parsed.data.action === "read_copy") {
    if (!principal) return json(res, 403, { error: "Only the person who published the copy can read it." });
    const kind = parsed.data.kind;
    const name = parsed.data.name;
    if ((kind !== "chrome" && kind !== "folder") || !name) {
      return json(res, 400, { error: "read_copy needs kind and name." });
    }
    const copy = deps.readPersonalCopy(principal, kind, name)
      ?? readPersonalCopy(deps.dataDir(), principal, kind, name);
    if (!copy) return json(res, 404, { error: "No copy of that name for this person." });
    return json(res, 200, { result: { at: copy.at, kind: copy.kind, name: copy.name, files: copy.files } });
  }
  const active = () => deps.lendingEnabled() && deps.isActive(capability);
  const terminalText = [parsed.data.command, parsed.data.path, parsed.data.content]
    .filter((part) => typeof part === "string")
    .join("\n");
  if (terminalText) {
    const terminalMisuse = deps.misuseRefusal(terminalText, {
      ...deps.misuseActor(principal),
      surface: parsed.data.action === "run_command" ? "terminal" : "file",
      botId: capability.botId,
      threadId: capability.threadId,
      tool: parsed.data.action,
    }) ?? misuseRefusal(terminalText, {
      ...deps.misuseActor(principal),
      surface: parsed.data.action === "run_command" ? "terminal" : "file",
      botId: capability.botId,
      threadId: capability.threadId,
      tool: parsed.data.action,
    });
    if (terminalMisuse) {
      return json(res, terminalMisuse.status, { error: terminalMisuse.message, code: terminalMisuse.code });
    }
  }
  const who = deps.safetyPrincipal(capability.threadId);
  const terminalPrincipal = who.principalId ?? principal ?? undefined;
  const terminalTool = parsed.data.action === "computer_tools"
    ? "computer_list_tools"
    : parsed.data.action === "computer_call"
    ? "computer_use"
    : parsed.data.action;
  // full-access: safety-review
  const terminalHeld = await deps.safetyToolHold({
    text: terminalText || parsed.data.action,
    surface: parsed.data.action === "run_command"
      ? "terminal"
      : parsed.data.action.startsWith("computer")
      ? "computer"
      : "file",
    tool: terminalTool,
    known: true,
    triage: who.triage || deps.misuseActor(principal).triage,
    ...(terminalPrincipal ? { principalId: terminalPrincipal } : {}),
    threadId: capability.threadId,
    botId: capability.botId,
    review: deps.safetyReviewer(capability.botId),
  });
  if (terminalHeld) return json(res, 403, { error: terminalHeld, code: "safety_blocked" });
  const holdCut: BoundToolTextOptions["hold"] = (full) => deps.saveToolResult(capability, full, true);
  if (deps.isPerspicax()) {
    const { speaker: computerSpeaker, context: computerContext } = deps.userComputerSpeaking(principal, capability);
    return json(res, 200, {
      result: boundSharedComputerResult(
        parsed.data,
        await deps.userComputersRequest(computerSpeaker, parsed.data, active, computerContext),
        holdCut,
      ),
    });
  }
  return json(res, 200, {
    result: boundSharedComputerResult(
      parsed.data,
      await deps.sharedComputersRequest(parsed.data, principal, active),
      holdCut,
    ),
  });
}

export function routeComputerControl(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path } = ctx;
  if (!(path === "/api/internal/computer-control")) return PASS;
  return handleComputerControl(deps, ctx);
}

async function handleComputerControl(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, method, json, capability, readBody, url } = ctx;
  const botId = url?.searchParams.get("botId") ?? "";
  const bot = deps.bot(botId);
  if (!bot) return json(res, 404, { error: "no such bot" });
  if (method === "GET") {
    deps.gateChecked(capability);
    const abort = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    return json(res, 200, await deps.computerCallGate(capability, abort.signal));
  }
  if (method === "POST") {
    const body = await readBody();
    const controlKey = capability.teamComputerId ? teamComputerOwner(capability.teamComputerId) : botId;
    const { snapshot, requestId } = deps.requestHelpLease(controlKey, body.reason);
    const roomTurn = deps.activeGroupTurnForBot(bot.id);
    const target = deps.blockedTarget(
      { ...bot, threadId: capability.threadId },
      roomTurn ? { ...roomTurn.group, threadId: roomTurn.threadId } : null,
    );
    const helpPlace = deps.taskSurfacePin(bot.id, capability.threadId)
      ?? deps.computerSelectionMove(capability.threadId)
      ?? bot.computer;
    const helpWhere = helpPlace && helpPlace !== "off" ? ` on ${surfaceLabel(helpPlace as never)}` : "";
    deps.notify(
      deliverableNotification(
        "takeover",
        bot as never,
        target.threadId,
        `${snapshot.helpReason ?? "asked you to take over"}${helpWhere}`,
        { group: target.group as never },
      ),
    );
    return json(res, 200, { held: snapshot.held, helpOpen: snapshot.helpReason !== null, requestId });
  }
  if (method === "DELETE") {
    const body = await readBody();
    const snapshot = deps.expireHelp(
      capability.teamComputerId ? teamComputerOwner(capability.teamComputerId) : botId,
      body.requestId,
    );
    return json(res, 200, { held: snapshot.held, helpOpen: snapshot.helpReason !== null });
  }
  return json(res, 405, { error: "method not allowed" });
}
