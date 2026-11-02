/** Claude turn prepare: MCP mounts, env, spawn contract (#1383). */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AUTO_COMPUTER_MCP_NAME } from "../../auto-computer.ts";
import { cleanCommandVariables } from "../../credential-command-env.ts";
import { adoptLegacyAutoMemory, legacyClaudeAutoMemoryDir } from "../../compact-prompt.ts";
import { writeFileAtomicIfChanged } from "../../atomic.ts";
import { commandVariablesDigest } from "../../credential-command-env.ts";
import { customServerGate, gateQueryTools, gateServer } from "../../mcp-gate-config.ts";
import { canUseMcpServer } from "../../../shared/tool-scope.ts";
import { harnessMcpHttpSpec, loopbackNoProxy } from "../../harness-mcp-http.ts";
import { isPerspicaxBridge, PERSPICAX_FLOW_COMPUTE_TOOLS } from "../acp/grok-read-only-tools.ts";
import { networkProxyEnvironment } from "../network-proxy.ts";
import { permissionLaunchCwd } from "../permission-command.ts";
import {
  PERSPICAX_TOKEN_ENV, turnSwitches, warmCommsEnv, warmPerspicaxEnv, withoutTurnTokens,
} from "../spawn-contract.ts";
import { COMPACT_DIRECTORY_TOOLS } from "./prepare-constants.ts";
import { DWEB_PROXY_PATH, HOOK_HELPER_PATH, NODE_ENV_FLAG, PERM_PROXY_PATH } from "./helpers.ts";
import type { ClaudeTurnCtx, ClaudeTurnEarly } from "./turn-ctx.ts";

export async function prepareClaudeTurnMcp(ctx: ClaudeTurnCtx): Promise<ClaudeTurnEarly | null> {
  const {
    turn, threadId, botId, args, permissionMode, controlsHost, isolated, turnModel,
    injected, turnEnvironment, keepsClaudeAiConnectors, mcpFromUserConfig,
    config, sessions, environment, support, autoAllowlist, input,
  } = ctx;
  const {
    permissionSocketPath,
    claudeHookSettings, hookTokenFile, readClaudeAuthSettings, GUEST_CLAUDE_PERMISSIONS,
    instanceClaudeAllowRules, remoteSupportDenyRules, projectMcpServers, agentsAllowedTools,
    CLAUDE_ACCOUNT_ENV_KEYS, claudeAutoAllowedTools,
  } = support;

let systemPromptPath: string | null = null;

// integrations → MCP servers; pre-allow their tools (a headless
// acceptEdits run silently denies anything unlisted)
const mcpServers: Record<string, unknown> = {};
const allowed: string[] = [];
// The harness's browser, cloud computer and Data servers over HTTP
// (server/harness-mcp-http.ts) instead of a Node proxy each. A turn
// with a tool selection keeps the stdio proxy: its gate wraps a stdio
// upstream exactly as before.
const harnessHttp = (spec: Parameters<typeof harnessMcpHttpSpec>[0], kind: Parameters<typeof harnessMcpHttpSpec>[1]) =>
  turn.toolScope === undefined ? harnessMcpHttpSpec(spec, kind) : null;
if (turn.integrations?.localComputer) {
  const local = turn.integrations.localComputer;
  // The cloud computer's harness proxy is reached over HTTP directly
  // (server/harness-mcp-http.ts): no Node process per session.
  mcpServers.computer = harnessHttp(local, "computer") ?? {
    command: local.command,
    args: local.args,
    env: local.env,
  };
  // The isolated Local VM preserves the established pre-allow behavior.
  // Host tools always route through Sagax's permission broker.
  if (!controlsHost) allowed.push("mcp__computer");
}
// peer-agent comms (list_bots/ask_bot) — the harness builds the whole
// spawn contract (command/args/env incl. the boot token) in
// agentsIntegration(); pre-allowing matters doubly here, or the CLI's
// own ListAgents look-alike shadows it and "@Bot" asks go nowhere
if (turn.integrations?.agents) {
  // Coordination is foundational, not an optional deferred lookup.
  // Claude waits for always-loaded tools before building the prompt.
  // Rare agents tools wait for tool search (agents-catalog.ts
  // DEFERRED_AGENT_TOOL_NAMES): about 15,000 fewer prompt tokens a turn.
  // Not when the turn names its built-ins (a guest's turn, an instance
  // tool list) without ToolSearch: a deferred tool would be unreachable.
  const toolSearch = !turn.guestConfined && (config.tools === undefined || config.tools.includes("ToolSearch"));
  // #1276: a compact prompt lists the core and searches the rest
  // itself (agents-proxy.ts); Claude Code's own tool search is off.
  const agentsEnv = turn.compactPrompt
    ? { ...turn.integrations.agents.env, SAGAX_COMPACT_TOOLS: JSON.stringify({ core: turn.compactPrompt.agents.core, pinned: [...new Set(turn.compactPrompt.agents.pinned)].sort() }) }
    // The whole catalog, with each family of tools as one tool
    // (agents-merged.ts): a family call is asked about as the tool it
    // runs (permission broker, searched-tool-call.ts).
    : toolSearch ? { ...turn.integrations.agents.env, SAGAX_DEFER_RARE_TOOLS: "1", SAGAX_MERGED_TOOLS: "1" } : { ...turn.integrations.agents.env, SAGAX_MERGED_TOOLS: "1" };
  mcpServers.agents = { ...turn.integrations.agents, env: agentsEnv, alwaysLoad: true };
  // The process is kept from turn to turn: the turn's comms token and
  // depth (new every turn) ride a file the proxy reads on each call,
  // and leave the spawn contract (withoutTurnTokens below), so a
  // teammate's reply resuming this turn reuses this process.
  // Never rewritten under a turn still running on this thread's process.
  if (turn.integrations.agents.env?.SAGAX_COMMS_TOKEN && !sessions.get(threadId)?.turn) {
    mcpServers.agents = { ...turn.integrations.agents, env: warmCommsEnv(threadId, botId, agentsEnv), alwaysLoad: true };
  }
  allowed.push(...agentsAllowedTools(turn.integrations.agents.env));
  // The finding tools run nothing; call_tool and use_tool ask as the
  // tool they run (permission-proxy.ts, #1374).
  if (turn.compactPrompt && !allowed.includes("mcp__agents")) allowed.push(...COMPACT_DIRECTORY_TOOLS.map((tool) => `mcp__agents__${tool}`));
}
if (turn.integrations?.phone) {
  mcpServers.phone = { ...turn.integrations.phone };
  allowed.push("mcp__phone");
}
// Pre-allowed: the Messages tool itself posts the send card (including
// under Full access) and refuses anything that is not this Mac.
if (turn.integrations?.messages) {
  mcpServers.messages = { ...turn.integrations.messages };
  allowed.push("mcp__messages");
}
if (turn.integrations?.browser) {
  // Mounted, not pre-allowed: file: and loopback navigations stay on
  // the approval path, and the browser route refuses them outright.
  // Behind tool search, the first browser action costs a ToolSearch
  // model step. Load the tools up front when browsing is the point.
  const browser = harnessHttp(turn.integrations.browser, "browser") ?? turn.integrations.browser;
  mcpServers.browser = turn.preloadBrowserTools
    ? { ...browser, alwaysLoad: true }
    : { ...browser };
}
if (turn.integrations?.data) {
  // Mounted, not pre-allowed (2026-10-16 security review): each Data
  // call reaches Sagax's approval path, where the person's rules, the
  // safety review and the security keys apply, and a call that stays
  // in the bot's workspace is answered without a card.
  mcpServers.data = { ...(harnessHttp(turn.integrations.data, "data") ?? turn.integrations.data) };
}
// dweb network daemon (status / repo / opencode model access) via
// server/drivers/dweb-proxy.ts — points at the configured dweb instance
if (turn.integrations?.dweb) {
  mcpServers.dweb = {
    command: process.execPath,
    args: [DWEB_PROXY_PATH],
    env: {
      ...NODE_ENV_FLAG,
      DWEB_URL: turn.integrations.dweb.url,
    },
  };
  allowed.push("mcp__dweb");
}
// user-configured servers mount like any integration but are NOT
// pre-allowed: acceptEdits silently denies unlisted tools, which
// routes every custom tool call through the ogb permission broker
// into an Allow/Deny card. Reserved names were filtered upstream;
// skip any residual collision instead of clobbering a built-in.
// A remote entry ({type, url, headers}) is already in the CLI's own
// shape and the CLI connects to it itself; header values ride in the
// 0600 config file like every other credential here.
// Claude Code is the one engine that keeps its own connection: every
// other engine reaches URL servers through Sagax's remote proxy
// (mcp-remote-proxy.ts), whose minimal handshake strict servers
// accept. Claude Code 2.1.292 sends only fields the MCP spec defines
// (2025-11-25: roots, elicitation.form/url, clientInfo), none of the
// rmcp extensions (schemaValidation) Codex and Grok link, and a strict
// server that knows the current spec accepts it (captured Oct 8 2026
// against testing/fake-http-mcp-server.ts `strictInitialize`). Its
// native transport also keeps Claude Code's own MCP tool search,
// which defers big catalogs instead of loading them up front.
// Bot-owned servers, gated below: they are the ones that answer for a
// machine rather than for a context window.
const botOwned = new Set<string>();
for (const [name, server] of Object.entries(turn.integrations?.custom ?? {})) {
  if (Object.hasOwn(mcpServers, name)) continue;
  // A Perspicax profile bridge: its turn capability rides a file (like
  // the agents comms token above), so a pre-warmed process is kept.
  // Never rewritten under a turn still running on this thread's process.
  const serverEnv = (server as { env?: Record<string, string> }).env;
  mcpServers[name] = serverEnv?.[PERSPICAX_TOKEN_ENV] && !sessions.get(threadId)?.turn
    ? { ...server, env: warmPerspicaxEnv(threadId, botId, serverEnv) }
    : { ...server };
  botOwned.add(name);
}
// computer_select only chooses among the computers this turn may
// already reach (server/auto-computer.ts): no card for the choice
// itself; every tool it routes to still rides the approval mode.
if (mcpServers[AUTO_COMPUTER_MCP_NAME]) allowed.push(`mcp__${AUTO_COMPUTER_MCP_NAME}`);
// Pure Flow compute now lives in the signed Perspicax pack. Keep
// its existing read-only treatment, only on harness-owned bridges.
for (const [name, spec] of Object.entries(turn.integrations?.custom ?? {})) {
  if (mcpServers[name] && isPerspicaxBridge(spec)) {
    allowed.push(...PERSPICAX_FLOW_COMPUTE_TOOLS.map((tool) => `mcp__${name}__${tool}`));
  }
}
// --strict-mcp-config (above) makes this config the CLI's only source
// of MCP servers, so a server the bot's OWN project declares would
// otherwise vanish with the machine's. Merge it last: a project file
// can add servers but never shadow a harness-owned mount.
// Never for a guest's turn: its folder is its own to write, and a
// server declared there would run a command.
if (isolated && turn.cwd && !turn.guestConfined) {
  for (const [name, server] of Object.entries(projectMcpServers(turn.cwd))) {
    if (Object.hasOwn(mcpServers, name)) continue;
    mcpServers[name] = server;
    botOwned.add(name);
  }
}
// One tool call can put more into the conversation than the whole rest
// of the session: a single product search measured 60-140 KB of JSON,
// and the CLI re-reads it on every later model call. The harness never
// sees these calls — the CLI runs the server itself — so the only place
// to stand is between the two processes. Harness-owned mounts (the
// permission broker, computer, browser, agents, dweb) are left alone
// here: the harness answers them itself and cuts a machine's output
// (a command, a file) where it answers (tool-output-bound.ts).
// Each server's own result size limit, else the app's (customServerGate).
// #1276: in a compact prompt every server the bot owns is gated with the
// gate's own tool search (mcp-gate-search.ts): a big catalog lists only
// the bot's most used tools whole.
const searchedMounts = new Set<string>(turn.compactPrompt && turn.integrations?.agents ? ["agents"] : []);
for (const name of turn.toolScope === undefined ? botOwned : Object.keys(mcpServers)) {
  if (!canUseMcpServer(turn.toolScope, name)) { delete mcpServers[name]; continue; }
  // a server may be named like an Object property ("constructor"): own keys only
  const search = turn.compactPrompt && botOwned.has(name) ? { pinned: Object.hasOwn(turn.compactPrompt.pinned, name) ? turn.compactPrompt.pinned[name]! : [] } : undefined;
  if (search) searchedMounts.add(name);
  const gated = gateServer({ name, server: mcpServers[name], threadId, nodeEnv: NODE_ENV_FLAG, toolScope: turn.toolScope, ...(search ? { search } : {}), ...customServerGate(name, botOwned.has(name), turn.integrations?.customResultBudgets, turnEnvironment) });
  if (gated) mcpServers[name] = { ...gated, ...((mcpServers[name] as { alwaysLoad?: unknown })?.alwaysLoad === true ? { alwaysLoad: true } : {}) };
}
// an allowed name is mcp__<server> or mcp__<server>__<tool> (agentsAllowedTools)
allowed.splice(0, allowed.length, ...allowed.filter((name) => Object.hasOwn(mcpServers, name.slice("mcp__".length).split("__")[0])));
// Approve for me: the built-ins that never need a person (read-only
// shell lines, a web search, the task list). Deny rules still win, so
// a withheld host tool stays withheld.
if (autoAllowlist && !turn.guestConfined) allowed.push(...claudeAutoAllowedTools());
// Keep ask_user available even in Full access. Native bypass skips
// permission prompts, not questions requiring a person's answer.
// Broker is created in spawnClaudeSession for a new process only.
const socketPath = permissionSocketPath(threadId, botId);
if (permissionMode !== "bypassPermissions") {
  args.push("--permission-prompt-tool", "mcp__ogb__approve");
}
const permissionEnv: Record<string, string> = {
  ...NODE_ENV_FLAG,
  ...(turn.toolScope !== undefined ? { SAGAX_PERMISSION_TOOL_SCOPE: JSON.stringify(turn.toolScope) } : {}),
  ...(searchedMounts.size ? { SAGAX_PERMISSION_SEARCHED: JSON.stringify([...searchedMounts].sort()) } : {}),
};
// Finding a tool runs nothing: search_tools and describe_tool of a
// searched server never ask (call_tool asks as the tool it runs).
for (const name of searchedMounts) {
  if (name !== "agents" && mcpServers[name]) allowed.push(`mcp__${name}__search_tools`, `mcp__${name}__describe_tool`);
}
mcpServers.ogb = { command: process.execPath, args: [PERM_PROXY_PATH, socketPath], env: permissionEnv, alwaysLoad: true };
allowed.push("mcp__ogb", ...gateQueryTools(mcpServers));
// A guest's turn pre-allows only the harness's own tools: anything
// else (the browser can open a file: address) asks the owner first.
if (turn.guestConfined) allowed.splice(0, allowed.length, ...allowed.filter((name) => name === "mcp__ogb" || name === "mcp__agents" || name.startsWith("mcp__agents__")));
// #1374: what the turn pre-allows by name, so a call_tool or use_tool
// runs unasked exactly when its target would have, and asks otherwise.
const preallowed = allowed.filter((name) => /^mcp__[\w-]+(?:__[\w.:-]+)?$/.test(name) && name !== "mcp__ogb");
if (preallowed.length) permissionEnv.SAGAX_PERMISSION_PREALLOWED = JSON.stringify([...new Set(preallowed)].sort());
// The MCP config carries credentials — the boat token in the computer
// proxy's env, the comms token in
// the agents proxy's env. On argv every one of those is world-readable
// through `ps` for the life of the turn, to any local process. The CLI
// accepts a FILE for this flag, so the secrets go in a 0600 file that
// is removed when the turn settles.
let mcpConfigPath: string | null = null;
if (Object.keys(mcpServers).length) {
  mcpConfigPath = join(mkdtempSync(join(tmpdir(), "omb-mcp-")), "mcp.json");
  args.push("--mcp-config", mcpConfigPath);
  args.push("--allowedTools", allowed.join(","));
}

const env = environment(turnModel, turn.access);
// No claude.ai connector unless the turn asked for them: the docs say
// --strict-mcp-config alone does not exclude them, so say it twice.
if (isolated && !mcpFromUserConfig && !keepsClaudeAiConnectors) env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
const authSettings = isolated && !injected.injected
  ? readClaudeAuthSettings(env, input.environment) : {};
// Harness hooks (item 0.2): one helper command for the events the
// harness observes. The helper reads its bearer from a per-thread file
// the harness refreshes every turn, so a long-lived CLI process never
// presents a stale token. Registered through the same private
// --settings file as the auth override; both are 0600 and per launch.
const hooks = turn.integrations?.hooks;
const hookTokenPath = hooks ? hookTokenFile(threadId, botId) : null;
if (hooks && hookTokenPath) {
  mkdirSync(dirname(hookTokenPath), { recursive: true, mode: 0o700 });
  // The bearer is usually the same as last turn, and it only lives in
  // this process's memory, so a restart invalidates the file anyway:
  // skip identical bytes and the fsync. A rotated bearer differs from
  // what is on disk, so it is always written before the CLI launches.
  writeFileAtomicIfChanged(hookTokenPath, hooks.token, { mode: 0o600, durable: false });
  env.SAGAX_HOOK_URL = hooks.url;
  env.SAGAX_HOOK_TOKEN_FILE = hookTokenPath;
  env.SAGAX_HOOK_NODE = process.execPath;
  env.SAGAX_HOOK_HELPER = HOOK_HELPER_PATH;
  // in the packaged app process.execPath is Electron — run the helper as node
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
}
const settings: Record<string, unknown> = { ...authSettings };
// Project-only settings still discover the personal memory through ancestor
// directories when the bot workspace lives below HOME. Keep project memory.
if (isolated) settings.claudeMdExcludes = [join(homedir(), ".claude", "CLAUDE.md")];
if (hooks) settings.hooks = claudeHookSettings(HOOK_HELPER_PATH);
if (turn.guestConfined) settings.permissions = GUEST_CLAUDE_PERMISSIONS;
else {
  const allow = instanceClaudeAllowRules();
  // Always deny reads of the remote-support folder: on an organization
  // server the engine runs in the Sagax container, so the technician key
  // and the session addresses would otherwise be on its filesystem.
  const deny = remoteSupportDenyRules();
  if (allow.length || deny.length) settings.permissions = { ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) };
}
// #1276: a compact prompt keeps Claude Code's auto memory in one folder
// per bot and person, so its path (in the system prompt) is the same in
// every conversation, and turns Claude Code's own tool search off: the
// tools listed are exactly the ones Sagax lists, the same every time.
if (turn.compactPrompt?.memoryDir) {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  adoptLegacyAutoMemory(turn.compactPrompt.memoryDir, legacyClaudeAutoMemoryDir(configDir, turn.cwd ?? homedir()));
  settings.autoMemoryDirectory = turn.compactPrompt.memoryDir;
}
if (turn.compactPrompt) env.ENABLE_TOOL_SEARCH = "false";
// Otherwise tool search is always on where the turn can search: MCP
// tools Sagax does not load up front (alwaysLoad) wait for ToolSearch.
// The CLI's own default ("auto") sends every schema while they fit in
// the model's window, which on a 1M-token model is always, and flips
// when they stop fitting, so the cached tool list is rewritten.
// A value the person set for the engine stays theirs.
else if (!env.ENABLE_TOOL_SEARCH && !turn.guestConfined && (config.tools === undefined || config.tools.includes("ToolSearch"))) env.ENABLE_TOOL_SEARCH = "true";
const authSettingsPath = mcpConfigPath && Object.keys(settings).length
  ? join(dirname(mcpConfigPath), "auth-settings.json") : null;
if (authSettingsPath) args.push("--settings", authSettingsPath);
// Our approvals and browser credentials expire at the user-turn
// boundary. Native background workers cannot outlive that boundary;
// parallel bot work must use the harness's durable delegate_bot path.
env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
// Command variables the person exposed to this bot (credential-command-env.ts).
for (const [name, value] of cleanCommandVariables(turn.commandEnvironment)) env[name] = value;
// Desktop bridge: this turn's own network traffic leaves through the
// person's computer (never the model traffic: NO_PROXY).
if (turn.networkProxy) Object.assign(env, networkProxyEnvironment(turn.networkProxy, env));
// The harness's own HTTP servers are on loopback: never through a proxy.
if (["browser", "computer", "data"].some((name) => (mcpServers[name] as { type?: unknown } | undefined)?.type === "http")) {
  Object.assign(env, loopbackNoProxy(env));
}
const cwd = turn.cwd ?? homedir();
const commandCwd = permissionLaunchCwd(cwd);
// Everything that shapes the process, minus session/turn-specific temp
// paths. Their contents are represented directly in the key instead.
const privateFileFlags = new Set(["--mcp-config", "--settings"]);
const keyArgs = args.filter((a, i) => !privateFileFlags.has(a) && !privateFileFlags.has(args[i - 1] ?? ""));
const contract = {
  args: keyArgs,
  // the volatile half is deliberately absent: it must not respawn a
  // healthy session (see Session.volatile)
  system: turn.systemStable ?? turn.system ?? null,
  // a call's turns share one process: their per-turn tokens are not
  // part of what makes a process (they ride a file, see above)
  mcpServers: withoutTurnTokens(mcpServers),
  warm: turn.keepWarm === true,
  cwd,
  model: injected.model ?? null,
  base: env.ANTHROPIC_BASE_URL ?? null,
  configDir: env.CLAUDE_CONFIG_DIR ?? null,
  // another person's computer (or none) never reuses this process
  proxy: turn.networkProxy?.url ?? null,
  // hooks on/off changes the settings file the process was launched with
  hooks: Boolean(hooks),
  // #1276: a compact prompt is another launch (memory folder, tool search)
  compact: turn.compactPrompt ? { memoryDir: turn.compactPrompt.memoryDir ?? null } : null,
  // Slice 4: another person's credentials never reuse this process.
  access: turn.access?.identity ?? null,
  // A changed command variable starts a fresh process (a digest only).
  commandEnv: commandVariablesDigest(turn.commandEnvironment),
  // Rotating an account's key/helper must not reuse the old process.
  auth: createHash("sha256").update(JSON.stringify({
    settings: authSettings,
    env: Object.fromEntries(CLAUDE_ACCOUNT_ENV_KEYS.map((key: string) => [key, env[key]])),
  })).digest("hex"),
};
const argsKey = JSON.stringify(contract);

  Object.assign(ctx, {
    systemPromptPath, mcpServers, allowed, searchedMounts, socketPath,
    permissionEnv, mcpConfigPath, env, authSettingsPath, settings, cwd, commandCwd,
    contract, argsKey, switches: turnSwitches(mcpServers),
  });
  return null;
}
