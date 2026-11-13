/** Claude turn prepare: validation and CLI args (#1383). */
import { basename } from "node:path";

import { newId } from "../../contracts.ts";
import { assertToolScopeSupported } from "../../../shared/tool-scope-support.ts";
import { DATA_DIR } from "../../config.ts";
import { claudeDisallowedTools, claudeOrgTools } from "../host-tools.ts";
import { pluginDirsForTurn, pluginTurnCopiesDir } from "./plugin-agent-tools.ts";
import { sandboxPluginPaths } from "../../sandbox/sandbox-plugins.ts";
import { USER_SANDBOX_MCP_NAME } from "../../sandbox/user-sandbox-routing.ts";
import { versionAtLeast } from "../acp/core.ts";
import { killCliTree } from "../../procs.ts";
import { CLAUDE_REPLAY_FLOOR, DRIVER_KIND, NO_ANTHROPIC_KEY } from "./config.ts";
import { claudeUserMessage } from "./messages.ts";
import type { ClaudeTurnCtx, ClaudeTurnEarly } from "./turn-ctx.ts";

export async function prepareClaudeTurnArgs(ctx: ClaudeTurnCtx): Promise<ClaudeTurnEarly | null> {
  let turn = ctx.turn;
  const logicalTurnId = ctx.logicalTurnId;
  const {
    config, input, environment, getStartupModelRefresh, getCliVersion, setCliVersion,
    getCliVersionChecked, setCliVersionChecked, getCliHasAutocompact, getCliHelpVersion, readCliVersion,
    liveApprovalModes, active, sessions, freshNextTurn, refreshSubscriptionHome, retryState,
    support,
  } = ctx;
  const startupModelRefresh = getStartupModelRefresh();
  let cliVersion = getCliVersion();
  let cliVersionChecked = getCliVersionChecked();
  const cliHasAutocompact = getCliHasAutocompact();
  // The CLI version whose --help chose --autocompact: a refusal is scoped to it (#3302).
  const autocompactVersion = getCliHelpVersion();
  const {
    inheritsUserConfig, claudeCliSupports, parseClaudeCliVersion, resolveClaudeTurnModel,
    applyClaudeInject, autoCompactWindow, GUEST_CLAUDE_TOOLS, withWhy,
  } = support;

if (startupModelRefresh) await startupModelRefresh;
// #1373: a relaunch of the same logical turn (transient failure,
// rejected resume, rebuild) runs at the level the person chose during
// the turn, never the one it started with. A new turn carries its own.
const liveLevel = liveApprovalModes.get(turn.threadId);
if (logicalTurnId !== undefined && liveLevel?.turnId === logicalTurnId) turn = { ...turn, approvalMode: liveLevel.mode };
else if (logicalTurnId === undefined && turn.warmOnly !== true) liveApprovalModes.delete(turn.threadId);
turn = { ...turn, toolScope: assertToolScopeSupported(DRIVER_KIND, turn.toolScope) };
if (config.managedModels && (!turn.model || !config.managedModels.includes(turn.model))) throw new Error("This model is not assigned to this workspace.");
if (config.requireApiKey && !input.environment.ANTHROPIC_API_KEY) throw new Error(NO_ANTHROPIC_KEY);
if (config.managed && (!turn.model || turn.model.includes("::") || !config.configDir ||
    !input.environment.ANTHROPIC_API_KEY || !input.environment.ANTHROPIC_BASE_URL)) {
  throw new Error("Company model access is unavailable. Reconnect your organization; personal billing will not be used.");
}
const { threadId, botId } = turn;
// An internal relaunch (transient failure, rejected resume) keeps the
// logical turn's stop handle in `active` while it sets up, so Stop is
// never a silent no-op between two CLI processes of the same turn.
const relaunch = logicalTurnId !== undefined;
// A warm must not steal a process a real turn already owns, and an
// aborted warm must not open files or spawn. Both return before any
// broker or temp file exists.
if (turn.warmOnly === true && (turn.warmSignal?.aborted || (active.has(threadId) && !relaunch))) {
  return { turnId: logicalTurnId ?? newId() };
}
if (!relaunch) {
  // Stop is acknowledged at once and the process tree reaped after it
  // (taskkill is asynchronous on Windows); the stopped turn leaves
  // `active` only when its close is handled. A Stop that lands while
  // a turn is still starting lets the harness send the next message
  // before then. That turn waits for the stopped process to be gone,
  // never overlapping its helpers, instead of being refused.
  const stopped = sessions.get(threadId);
  if (stopped?.turn?.stopRequested && active.get(threadId)?.turnId === stopped.turn.turnId &&
      await killCliTree(stopped.child)) await stopped.closed;
  if (active.has(threadId)) throw new Error("a turn is already running on this thread");
}
// #1768: one shared OAuth refresh at a time for this login home, before
// any Claude process of this person reads or rotates the grant.
if (turn.access?.via === "subscription" && turn.access.claudeConfigDir) {
  await refreshSubscriptionHome(turn, Boolean(retryState.get(threadId)?.authRaced && relaunch));
}
// A bot-level mode is authoritative for this turn. In particular, an
// old provider instance may still be configured with
// `bypassPermissions`; Ask/Auto/Full must restore Claude's interactive
// broker instead of inheriting that silent bypass. Calls without a
// per-turn mode keep the legacy adapter behavior.
// 2026-10-19 (bot quality, cause B): Approve for me never starts the
// CLI's own auto mode. Its classifier refused external writes in
// silence (no card, only "add a permission rule"), even after the
// person said yes in the chat, and the bot concluded it could not.
// Auto is now Auto-accept edits plus a fixed list of tools that never
// need a person (claudeAutoAllowedTools); every other call reaches
// Sagax's broker (mcp__ogb__approve) and becomes a real card.
// #1982: Full also keeps the broker (Codex #1977 pattern). Host tools
// are pre-allowed; custom MCP stays off the allowlist so every write
// reaches request.opened and Sagax Full-approves unless a rule holds.
const requestedMode = turn.approvalMode === undefined
  ? config.permissionMode
  : turn.approvalMode === "full" ? "acceptEdits"
    : turn.approvalMode === "auto" ? "auto"
      : turn.approvalMode === "edits" ? "acceptEdits" : "default";
const autoAllowlist = requestedMode === "auto";
const fullAllowlist = turn.approvalMode === "full";
const permissionMode = autoAllowlist || fullAllowlist ? "acceptEdits" : requestedMode;
const controlsHost = turn.integrations?.localComputer?.scope === "local-computer";
if (controlsHost && permissionMode === "bypassPermissions") {
  throw new Error("local computer control requires the interactive approval broker");
}
// The thread's last session filled up even when fresh: reopening it
// would fill up again at once. This turn starts a fresh session from
// the chat's rebuild instead (a warm only prepares a process, so it
// leaves the mark for the turn that follows it). true: the rebuild
// replays the conversation; false: the turn's text was all there was.
let renewedFromChat: boolean | null = null;
if (!relaunch && turn.warmOnly !== true && freshNextTurn.has(threadId)) {
  freshNextTurn.delete(threadId);
  if (typeof turn.resumeCursor === "string" && !turn.sessionReset) {
    const recovery = turn.recoveryText?.trim() && turn.recoveryText.trim() !== turn.text.trim() ? turn.recoveryText : undefined;
    turn = { ...turn, resumeCursor: undefined, recoveryText: undefined, ...(recovery ? { text: recovery } : {}) };
    renewedFromChat = Boolean(recovery);
  }
}
// Materialize before creating a broker or process. A missing/corrupt
// attachment must fail this call without leaving a live session behind.
const promptMsg = claudeUserMessage(turn.text, turn.images);
// Internal relaunches are still the turn acknowledged to the harness.
// A new user message gets a fresh id, but retry/recovery must not orphan
// its capability, coordination result or queued continuation ownership.
const turnId = logicalTurnId ?? newId();
const retryAbort = new AbortController();
const retry = retryState.get(threadId) ?? { attempt: 0, cancelled: false };
// A fresh user turn starts un-cancelled. A relaunch must keep a Stop
// that landed while it was being scheduled.
if (!relaunch) {
  retry.cancelled = false;
  retry.rebuilt = false;
  retry.renewed = false;
}
if (renewedFromChat !== null) {
  retry.rebuilt = renewedFromChat;
  retry.renewed = true;
}
retryState.set(threadId, retry);
// a retry relaunches the whole CLI; the backoff is scaled down in tests
// so a fake's transient failures don't stall real seconds
const retryScale = Number(process.env.FAKE_CLAUDE_RETRY_SCALE ?? "1");
const sessionId = !turn.sessionReset && typeof turn.resumeCursor === "string" ? turn.resumeCursor : null;
const newSessionId = sessionId ? null : newId();

const args = [
  "-p",
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose", // required by stream-json output
  // token-level streaming: content_block_delta events between the
  // whole-message frames, so the bubble grows as the model writes
  "--include-partial-messages",
  "--permission-mode", permissionMode,
];
// A guest's turn: no command-running tool at all, and no read outside
// its own folder (GUEST_CLAUDE_TOOLS). It only ever runs in Ask.
if (turn.guestConfined && permissionMode !== "default") {
  throw new Error("A guest's turn on this Cloud runs only in Ask.");
}
// Organization server: only the built-ins on the allowlist
// (CLAUDE_ORG_TOOLS), so one a newer CLI adds stays off; null on a
// solo server, where the turn keeps everything it had.
const orgTools = claudeOrgTools(turn.guestConfined ? GUEST_CLAUDE_TOOLS : config.tools, turn.withholdHostTools === true);
if (turn.guestConfined) args.push("--restricted", "--tools", orgTools ?? GUEST_CLAUDE_TOOLS.join(","));
else if (orgTools !== null) args.push("--tools", orgTools);
else if (config.tools !== undefined) args.push("--tools", config.tools.join(","));
// And no shell, file or fetch tool on the Sagax server, as deny rules
// (they hold for subagents and a plugin's agents too).
const disallowedTools = claudeDisallowedTools(config.disallowedTools, turn.withholdHostTools === true, turn.guestConfined === true || config.tools !== undefined || orgTools !== null);
if (disallowedTools.length) {
  args.push("--disallowedTools", disallowedTools.join(","));
}
const turnEnvironment = environment();
if (!cliVersionChecked) {
  const probe = await readCliVersion(turnEnvironment);
  if ("version" in probe) {
    cliVersion = parseClaudeCliVersion(probe.version);
    cliVersionChecked = true;
  }
}
if (turn.guestConfined && !claudeCliSupports(cliVersion, "--restricted")) {
  throw new Error(withWhy("This Claude Code is too old to run this turn without a shell. Update Claude Code.", turn.confinedWhy));
}
// Each stdin message echoed as a model call takes it in: how a turn
// tells a folded steer from one that runs next (CLAUDE_REPLAY_FLOOR).
const replaysUserMessages = cliVersion === null || versionAtLeast(cliVersion, CLAUDE_REPLAY_FLOOR);
if (replaysUserMessages) args.push("--replay-user-messages");
// Never the Claude in Chrome extension (2026-10-28): with it on, a bot
// asked for "the latest video of" someone drove the person's own Chrome
// in front of them, with no banner and no Stop. Web work goes to web
// search, fetch and the built-in browser, out of sight; the person's
// own Chrome is reached through My Chrome or this computer, both
// announced and stoppable (HOST_SCREEN_RULE, server/surface.ts).
if (claudeCliSupports(cliVersion, "--no-chrome")) args.push("--no-chrome");
const isolated = !inheritsUserConfig(turnEnvironment);
// A guest's confined turn never gets anyone's connectors. Standing
// allow rules (SAGAX_CLAUDE_ALLOW) may name mcp__claude_ai_ tools; deny
// rules still win, and nothing here pre-allows them. A turn with an
// owner's tool selection gets only the selected servers, never them.
const keepsClaudeAiConnectors = turn.claudeAiConnectors === true && !turn.guestConfined && turn.toolScope === undefined;
// The person's own Claude MCP servers (claudeUserMcpEnabled, on by
// default on a solo server) ride every turn except one with a tool
// selection: that turn gets only the selected servers (strict config),
// since the harness gates nothing it did not mount.
const mcpFromUserConfig = turn.mcpFromUserConfig === true && turn.toolScope === undefined;
if (turn.toolScope !== undefined && (!isolated || cliVersion === null || !claudeCliSupports(cliVersion, "--strict-mcp-config"))) {
  throw new Error("Claude cannot confirm a restricted MCP configuration for this account. Use a current, identifiable Claude CLI before using tool selection.");
}
if (isolated) {
  // A bot gets the tools and instructions its owner gave it, not
  // whatever this machine's Claude Code happens to be set up with.
  // Without these the CLI silently adds, to EVERY turn of every bot:
  // the desktop's own MCP servers and claude.ai connectors (one
  // measured desktop mounted 407 extra tools, ~10k tokens), its skill
  // and agent listings, its hooks, and its personal CLAUDE.md. Every
  // model call in the session then re-reads all of it.
  // Each flag only on a CLI that accepts it: an unknown flag is an
  // argument error that would fail every turn (CLAUDE_FLAG_FLOORS).
  // The MCP half has a switch (Capabilities > Installed → "Also use my
  // Claude Code MCP servers"): with it on, the CLI loads the servers
  // and connectors from the person's own Claude Code config — the way
  // Codex reads its own config.toml — while skills, hooks and the
  // personal CLAUDE.md stay out.
  // The speaker's own claude.ai connectors (server/harness-connectors.ts)
  // need the same: --strict-mcp-config also drops them (measured on CLI
  // 2.1.287), while --setting-sources project still keeps the machine's
  // user-scope servers, skills and hooks out.
  if (!mcpFromUserConfig && !keepsClaudeAiConnectors && claudeCliSupports(cliVersion, "--strict-mcp-config")) args.push("--strict-mcp-config");
  if (claudeCliSupports(cliVersion, "--setting-sources")) args.push("--setting-sources", "project");
  // Personal skills only: --add-dir loads ~/.claude/skills in place without
  // the person's hooks, MCP servers or CLAUDE.md (features.claudeUserSkills).
  if (turn.userSkillsDir) args.push("--add-dir", turn.userSkillsDir);
}
// The bot's plugins (server/bots/bot-plugins.ts): skills, commands and
// agents only, loaded for this session. A guest's confined turn gets none.
// #3384: a role that names a built-in this turn does not offer loads from a
// copy that starts it with the turn's own tools (plugin-agent-tools.ts).
if (!turn.guestConfined && claudeCliSupports(cliVersion, "--plugin-dir")) {
  const offered = orgTools ?? (config.tools !== undefined ? config.tools.join(",") : null);
  const builtins = { offered: offered === null ? null : offered.split(",").filter(Boolean), denied: disallowedTools };
  // #4082: the turn's commands run in the person's server environment, where
  // each plugin's copy lives under its name (syncPluginFoldersForTurn): the
  // skill text names those paths, never this server's folder.
  const inEnvironment = Boolean(turn.integrations?.custom?.[USER_SANDBOX_MCP_NAME]);
  for (const dir of pluginDirsForTurn(turn.pluginDirs ?? [], builtins, pluginTurnCopiesDir(DATA_DIR), inEnvironment ? (dir) => sandboxPluginPaths(basename(dir)) : undefined)) args.push("--plugin-dir", dir);
}
const compactWindow = autoCompactWindow(turnEnvironment);
// Recorded where the flag is added: only a launch that passed it can
// count as its refusal, so the relaunch without it never loops (#3302).
const passedAutocompact = Boolean(compactWindow) && cliHasAutocompact === true;
if (compactWindow && passedAutocompact) {
  args.push("--autocompact", compactWindow);
}
// A resumed conversation can still carry an earlier assignment, place
// or teammate list in Claude's recorded system prompt, so every turn
// refreshes the recorded prompt, on --resume too. Gated by the version
// floor like every other flag the CLI may predate: an unknown flag is a
// hard argument error, not a graceful degrade.
if (cliVersionChecked && claudeCliSupports(cliVersion, "--system-prompt-snapshot")) {
  args.push("--system-prompt-snapshot", "off");
}
const turnModel = config.managed ? turn.model : await resolveClaudeTurnModel(turn.model, turnEnvironment);
const injected = config.managed ? { model: turnModel ?? null, injected: false } : applyClaudeInject({ ...turnEnvironment }, turnModel);
if (injected.model) args.push("--model", injected.model);
if (turn.effort) args.push("--effort", turn.effort);

// A room prompt can contain section context, skills, memory, playbooks,
// and browser/agent instructions. Passing that text directly on argv
// exceeds Windows' CreateProcess command-line limit and surfaces as
// `spawn ENAMETOOLONG`. Claude accepts the same prompt from a file, so
// keep both the text and its potentially sensitive contents off argv.

  // Persist locals onto ctx for later phases
  Object.assign(ctx, {
    turn, threadId, botId, relaunch, turnId, retryAbort, retry, retryScale,
    renewedFromChat, promptMsg, sessionId, newSessionId, requestedMode, autoAllowlist,
    fullAllowlist, permissionMode, controlsHost, args, replaysUserMessages, isolated, turnModel,
    injected, turnEnvironment, keepsClaudeAiConnectors, mcpFromUserConfig, orgTools,
    disallowedTools, compactWindow, passedAutocompact, autocompactVersion,
  });
  setCliVersion(cliVersion);
  setCliVersionChecked(cliVersionChecked);
  return null;
}
