/** Claude ProviderInstance create: session maps, sendTurn wiring (#1383). */
import { homedir } from "node:os";
import type { ApprovalMode } from "../../../shared/approval-mode.ts";
import type { HarnessCommand } from "../../../shared/harness-commands.ts";
import { normalizeClaudeCommands } from "../../../shared/harness-commands.ts";
import type {
  DriverCreateInput,
  HarnessCommandScope,
  ProviderInstance,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
  TurnAccessInput,
} from "../../contracts.ts";
import { newEventId } from "../../contracts.ts";
import { openStartupModelCatalog, writeStartupModelCache } from "../../startup-model-catalog.ts";
import { cliVersionReader, execCli, killCliTree } from "../../procs.ts";
import {
  claudeSubscriptionHomeKey,
  ensureClaudeSubscriptionFresh,
  onClaudeSubscriptionRenew,
} from "../../claude-subscription-refresh.ts";
import { sessionIdlePolicy } from "../session-idle.ts";
import { claudeAuthRecovery } from "../claude-auth-recovery.ts";
import { probeClaudeCommands } from "../harness-command-probe.ts";
import type { KeepWarmContract } from "../claude-keepwarm.ts";
import { DRIVER_KIND, STATIC_CLAUDE_MODELS, type ClaudeCliVersion, type ClaudeConfig } from "./config.ts";
import type { ClaudeSession } from "./session-types.ts";
import { createSessionHelpers } from "./sessions.ts";
import { createSendTurn } from "./turn-send.ts";
import { buildClaudeInstanceApi } from "./instance-api.ts";

/** Module-level helpers from claude.ts (avoids leaf → parent import cycle). */
export type ClaudeCreateSupport = Record<string, any>;

export async function createClaudeInstance(
  input: DriverCreateInput<ClaudeConfig>,
  supportModule: ClaudeCreateSupport,
): Promise<ProviderInstance> {
  const {
    claudeEnvironment,
    inheritsUserConfig,
    mergeLocalInject,
    readClaudeModelCatalog,
    CLAUDE_UNUSED_COMMANDS,
    createPermissionBroker,
    claudeCliSupports,
    parseClaudeCliVersion,
    resolveClaudeTurnModel,
    applyClaudeInject,
    autoCompactWindow,
    GUEST_CLAUDE_TOOLS,
    GUEST_CLAUDE_PERMISSIONS,
    GUEST_FORBIDDEN_TOOLS,
    withWhy,
    permissionSocketPath,
    brokerSocketCandidates,
    claudeHookSettings,
    hookTokenFile,
    readClaudeAuthSettings,
    instanceClaudeAllowRules,
    remoteSupportDenyRules,
    projectMcpServers,
    agentsAllowedTools,
    CLAUDE_ACCOUNT_ENV_KEYS,
    claudeAutoAllowedTools,
    askQuestions,
    askSummary,
    parseChoices,
    questionChoices,
    permissionCommand,
    permissionPaths,
    withAbsolutePaths,
    askInputDetail,
    rebuiltSessionNotice,
    contextRenewedNotice,
    extractMcpImages,
    claudeSignInExpired,
  } = supportModule;

  const { instanceId, config } = input;
  const environment = (model?: string | null, access?: TurnAccessInput) => {
    // Slice 4: an owner's key rides as instance environment for this one
    // turn (so claudeEnvironment keeps it); a person's own subscription
    // runs from their login directory with no key at all.
    const instanceEnvironment = access?.environment ? { ...input.environment, ...access.environment } : input.environment;
    const configDir = access?.via === "subscription" && access.claudeConfigDir ? access.claudeConfigDir : config.configDir;
    const env = claudeEnvironment(config.managed ? undefined : model, { ...process.env, ...instanceEnvironment }, configDir, instanceEnvironment);
    if (access?.via === "subscription") {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
    return env;
  };
  const catalogEnv = environment();
  // Say it once where a headless or source run reads its logs; the Engines
  // page carries the same warning for the desktop (claudeInheritWarning).
  if (inheritsUserConfig(catalogEnv)) {
    console.error(`claude (${instanceId}): SAGAX_CLAUDE_INHERIT_USER_CONFIG=1 — bots inherit this machine's Claude Code MCP servers, skills, hooks and CLAUDE.md on every turn; remove it unless a bot needs a user-scope server`);
  }
  let models = config.managedModels ? { default: config.managedModels[0], options: config.managedModels.map(id => ({ id, label: id })) } : STATIC_CLAUDE_MODELS;
  const refreshModels = async () => {
    if (config.managed) return;
    try {
      const resolved = await mergeLocalInject(readClaudeModelCatalog(catalogEnv), catalogEnv);
      if (resolved.options.length) models = resolved;
    } catch {
      // Keep the last usable catalog when settings.json is unreadable.
    }
    try { writeStartupModelCache(instanceId, models); } catch { /* derived cache */ }
  };
  // A later start serves the saved list and refreshes behind listen.
  // The first run still waits so the seeded default model does not change.
  const startupModelRefresh = config.managed ? null : (await openStartupModelCatalog({
    instanceId,
    use: (catalog) => { models = catalog; },
    current: () => models,
    refresh: refreshModels,
  }))?.pending ?? null;

  // The installed CLI's version as snapshot() last read it, so a flag the
  // CLI does not know is never passed to it (CLAUDE_FLAG_FLOORS). The
  // harness snapshots every instance whenever it describes them — app
  // load, the Engines page, and right after `claude update`, which is
  // exactly when the answer changes — so a turn normally finds it filled.
  // A turn that finds it empty reads the version itself first: the
  // snapshot-refresh flag every turn passes is newer than the other context
  // controls, and an unknown flag would reject the turn. If that read
  // fails, most flags assume a current CLI; the snapshot flag needs a
  // confirmed version and autocompact a confirmed help listing.
  let cliVersion: ClaudeCliVersion | null = null;
  let cliVersionChecked = false;
  // Whether `claude --help` lists --autocompact, read once per CLI version
  // by snapshot(). The flag is not in every build above its version floor
  // (2.1.129 rejects it), so the listing wins over the floor; null until
  // probed, or when the probe fails.
  let cliHasAutocompact: boolean | null = null;
  let cliHelpVersion: string | null = null;
  const versionOf = cliVersionReader(config.cli);
  const readCliVersion = (env: NodeJS.ProcessEnv) => new Promise<ReturnType<typeof versionOf>>((resolve) => {
    execCli(config.cli, ["--version"], { timeout: 8000, env }, (err, stdout) => resolve(versionOf(err, stdout)));
  });
  // The --help read while it runs: snapshots that overlap (the server's
  // read at start and the app's first one) share it.
  let helpRead: { version: string; done: Promise<void> } | null = null;
  const readCliHelp = (version: string, env: NodeJS.ProcessEnv): Promise<void> => {
    if (helpRead?.version === version) return helpRead.done;
    const read = {
      version,
      done: new Promise<string | null>((resolve) => {
        execCli(config.cli, ["--help"], { timeout: 8000, env }, (err, stdout) => resolve(err ? null : stdout));
      }).then((help) => {
        cliHasAutocompact = help === null ? null : /^\s*--autocompact\b/m.test(help);
        cliHelpVersion = version;
        if (helpRead === read) helpRead = null;
      }),
    };
    helpRead = read;
    return read.done;
  };
  const listeners = new Set<RuntimeEventListener>();
  // The slash commands each bot's latest live session reported in `init`,
  // per bot and account (a person's subscription may add their own
  // claude.ai connectors' prompts, never shown to anyone else).
  const liveCommands = new Map<string, { names: string[]; terminal: string[] }>();
  const liveCommandsKey = (botId: string, identity: string | undefined) => `${botId}\u0000${identity ?? ""}`;
  /** The engine's slash commands for a bot's turns: a short process with
   * the turn's folder, isolation and account (the speaker's own
   * subscription on an organization server) answers `initialize` (no
   * model call), then what the bot's live session reported is layered in. */
  const listCommands = async (scope: HarnessCommandScope): Promise<HarnessCommand[]> => {
    const access = scope.access?.via === "subscription" ? scope.access : undefined;
    const env = environment(undefined, access);
    const args: string[] = [];
    if (!inheritsUserConfig(env)) {
      // a turn keeping its claude.ai connectors drops --strict-mcp-config too
      const strict = !scope.mcpFromUserConfig && !scope.claudeAiConnectors;
      if (strict && claudeCliSupports(cliVersion, "--strict-mcp-config")) args.push("--strict-mcp-config");
      if (claudeCliSupports(cliVersion, "--setting-sources")) args.push("--setting-sources", "project");
      if (!scope.mcpFromUserConfig && !scope.claudeAiConnectors) env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
    }
    if (claudeCliSupports(cliVersion, "--plugin-dir")) for (const dir of scope.pluginDirs ?? []) args.push("--plugin-dir", dir);
    const listed = (await probeClaudeCommands({ cli: config.cli, args, env, cwd: scope.cwd ?? homedir() }))
      .filter((command) => !CLAUDE_UNUSED_COMMANDS.has(command.name));
    const live = scope.botId ? liveCommands.get(liveCommandsKey(scope.botId, access?.identity)) : undefined;
    if (!live) return listed;
    const known = new Set(listed.map((command) => command.name));
    const merged = [...listed, ...normalizeClaudeCommands(live.names.filter((name) => !known.has(name) && !CLAUDE_UNUSED_COMMANDS.has(name)))];
    const terminal = new Set(live.terminal);
    return merged.map((command) => terminal.has(command.name) ? { ...command, unavailable: "interactive" as const } : command);
  };
  // one active turn per thread; a second send while busy is a caller bug
  const active = new Map<string, { stop: () => void; turnId: string; broker?: Awaited<ReturnType<typeof createPermissionBroker>> }>();

  // One live CLI process per thread, kept across turns. Under
  // --input-format stream-json the CLI settles a turn with `result` while
  // stdin stays open, takes the next user message on the same stdin as a
  // new turn, and folds a message that arrives MID-turn into the running
  // one before its next model call (verified against 2.1.221 — that fold
  // is what "steer" is). So a session is spawned once, reused while its
  // spawn contract (args, MCP config, cwd, model) is unchanged, closed
  // after SESSION_IDLE_MS of quiet, and resumed by --resume when needed.
  type Session = ClaudeSession;
  const sessions = new Map<string, Session>();
  // Prompt-cache keep-warm (claude-keepwarm.ts): what each live process
  // was launched with, so a ping can replay the exact request prefix, and
  // how long a keep-warm window wants that process kept past its idle
  // close (the next real turn must reuse it: a relaunch recomputes the
  // volatile system prompt and would miss the cache anyway).
  const warmContracts = new Map<string, KeepWarmContract>();
  const warmHolds = new Map<string, number>();

  /** What a closed process's conversation holds of the volatile half, by
   * thread: a relaunch that resumes that same session sends only what
   * changed since, like a live one (port of OpenMausBot #3164). Absent
   * (server restart, crash, unsettled turn, evicted entry): the whole
   * half rides. Bounded like the neighboring session caches. */
  const heldVolatile = new Map<string, { sessionId: string; volatile: string; sections?: Record<string, string> }>();
  /** Where each session's file was written (the config dir of its launch),
   * for sessionBytes. After a restart the default config dir is searched. */
  const sessionConfigDirs = new Map<string, string>();
  const sessionFiles = new Map<string, string>();
  /** A session whose file was not found, and when to look again: a miss
   * scans every projects/ folder, so it is not repeated on every turn. */
  const sessionMisses = new Map<string, number>();
  const { idleMs: SESSION_IDLE_MS } = sessionIdlePolicy("CLAUDE");
  /** #1373: the level a person chose while a turn was running, by thread,
   * for that logical turn's relaunches (see sendTurn). */
  const liveApprovalModes = new Map<string, { turnId: string; mode: ApprovalMode }>();
  const {
    sessionFileBytes,
    stopSession,
    closeSession,
    armIdle,
    holdWarm,
    writeUser,
    controlRequest,
    applyApprovalMode,
  } = createSessionHelpers({
    environment,
    sessions,
    active,
    warmContracts,
    warmHolds,
    heldVolatile,
    sessionConfigDirs,
    sessionFiles,
    sessionMisses,
    liveApprovalModes,
    SESSION_IDLE_MS,
  });

  // A signed-out refusal is held until the first model activity, so a turn
  // that could not start rejects once its process has stopped (the harness
  // then recovers it on a backup engine), instead of reading as an answer.
  const authRecovery = claudeAuthRecovery((event: RuntimeEvent) => {
    for (const l of Array.from(listeners)) l(event);
  }, async (threadId) => {
    const session = sessions.get(threadId);
    if (!session || !(await killCliTree(session.child))) return false;
    await session.closed;
    return sessions.get(threadId) !== session;
  }, (threadId) => active.has(threadId));
  const emit = (event: RuntimeEvent) => authRecovery.emit(event);
  const base = (threadId: string, turnId: string) => ({
    eventId: newEventId(),
    provider: DRIVER_KIND,
    threadId,
    turnId,
    createdAt: new Date().toISOString(),
  });
  // retry bookkeeping lives PER THREAD, not per sendTurn call: a relaunch
  // is a fresh sendTurn, and the attempt cap must survive across launches
  const retryState = new Map<string, { attempt: number; cancelled: boolean; rebuilt?: boolean; renewed?: boolean; authRaced?: boolean }>();
  /** Logical turns already moved to a fresh session once because the
   * context filled up: a second overflow is reported, never looped. */
  const renewedTurns = new Set<string>();
  /** Threads whose last session filled up even when fresh: the next turn
   * (Retry, or any new message) starts a fresh session from the chat
   * instead of reopening that full one. */
  const freshNextTurn = new Set<string>();
  /** Cost of the full sessions a renewed turn left behind, by turn. */
  const carriedCosts = new Map<string, number>();
  // #1768: when this person's Claude login home is renewed, retire idle
  // processes that still hold the previous token so they cannot race the
  // rotated refresh grant.
  const stopRenewWatch = onClaudeSubscriptionRenew((loginHome) => {
    for (const [threadId, live] of sessions) {
      if (live.turn || live.closing || live.child.exitCode !== null) continue;
      const dir = live.contract && typeof live.contract === "object" && live.contract !== null && "configDir" in live.contract
        ? (live.contract as { configDir?: string | null }).configDir
        : null;
      if (!dir || claudeSubscriptionHomeKey(dir) !== loginHome) continue;
      closeSession(threadId, "subscription renewed");
    }
  });

  /** #1768: keep the shared OAuth grant fresh before a subscription turn
   * uses the person's login home (and after a concurrent refresh race). */
  const refreshSubscriptionHome = async (turn: SendTurnInput, force = false) => {
    const loginDir = turn.access?.via === "subscription" ? turn.access.claudeConfigDir?.trim() : "";
    if (!loginDir) return { ok: true as const, renewed: false, expiresAt: null };
    return ensureClaudeSubscriptionFresh({
      loginDir,
      cli: config.cli,
      environment: environment(turn.model, turn.access),
      ...(force ? { force: true } : {}),
    });
  };

  const support = {
    inheritsUserConfig,
    claudeCliSupports,
    parseClaudeCliVersion,
    resolveClaudeTurnModel,
    applyClaudeInject,
    autoCompactWindow,
    GUEST_CLAUDE_TOOLS,
    GUEST_CLAUDE_PERMISSIONS,
    GUEST_FORBIDDEN_TOOLS,
    withWhy,
    createPermissionBroker,
    permissionSocketPath,
    brokerSocketCandidates,
    claudeHookSettings,
    hookTokenFile,
    readClaudeAuthSettings,
    instanceClaudeAllowRules,
    remoteSupportDenyRules,
    projectMcpServers,
    agentsAllowedTools,
    CLAUDE_ACCOUNT_ENV_KEYS,
    claudeAutoAllowedTools,
    askQuestions,
    askSummary,
    parseChoices,
    questionChoices,
    permissionCommand,
    permissionPaths,
    withAbsolutePaths,
    askInputDetail,
    rebuiltSessionNotice,
    contextRenewedNotice,
    extractMcpImages,
    claudeSignInExpired,
  };

  const sendTurn = createSendTurn({
    instanceId,
    input,
    config,
    environment,
    getStartupModelRefresh: () => startupModelRefresh,
    getCliVersion: () => cliVersion,
    setCliVersion: (v) => { cliVersion = v; },
    getCliVersionChecked: () => cliVersionChecked,
    setCliVersionChecked: (v) => { cliVersionChecked = v; },
    getCliHasAutocompact: () => cliHasAutocompact,
    readCliVersion,
    sessions,
    active,
    warmContracts,
    warmHolds,
    heldVolatile,
    sessionConfigDirs,
    sessionFiles,
    sessionMisses,
    liveApprovalModes,
    retryState,
    renewedTurns,
    freshNextTurn,
    carriedCosts,
    liveCommands,
    liveCommandsKey,
    listeners,
    emit,
    base,
    stopSession,
    closeSession,
    armIdle,
    holdWarm,
    writeUser,
    controlRequest,
    applyApprovalMode,
    sessionFileBytes,
    refreshSubscriptionHome,
    SESSION_IDLE_MS,
    support,
    authRecovery,
  });


  return buildClaudeInstanceApi({
    instanceId,
    input,
    config,
    environment,
    getModels: () => models,
    setModels: (m: typeof models) => { models = m; },
    refreshModels,
    startupModelRefresh,
    getCliVersion: () => cliVersion,
    setCliVersion: (v: ClaudeCliVersion | null) => { cliVersion = v; },
    getCliVersionChecked: () => cliVersionChecked,
    setCliVersionChecked: (v: boolean) => { cliVersionChecked = v; },
    getCliHasAutocompact: () => cliHasAutocompact,
    getCliHelpVersion: () => cliHelpVersion,
    readCliVersion,
    readCliHelp,
    listeners,
    liveCommands,
    liveCommandsKey,
    listCommands,
    active,
    sessions,
    warmContracts,
    warmHolds,
    heldVolatile,
    sessionFileBytes,
    stopSession,
    closeSession,
    armIdle,
    holdWarm,
    writeUser,
    controlRequest,
    applyApprovalMode,
    authRecovery,
    emit,
    base,
    stopRenewWatch,
    sendTurn,
    supportModule,
  });
}
