/** Prepare env, MCP mounts and spawn the Codex app-server (issue #1383). */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import type { McpServerSpec, StdioMcpSpec } from "../../contracts.ts";
import { canUseMcpServer } from "../../../shared/tool-scope.ts";
import { gateServer, mcpStdioServer } from "../../mcp-gate-config.ts";
import { codexConfigMcpServerNames, mountedMcpServerName } from "../codex-mcp-names.ts";
import { codexHostToolArgs } from "../host-tools.ts";
import { codexLocalProviderArgs } from "../local-inject.ts";
import { networkProxyEnvironment } from "../network-proxy.ts";
import { permissionLaunchCwd } from "../permission-command.ts";
import { spawnCli } from "../../procs.ts";
import { storedCodexLogin } from "../codex-login.ts";
import { codexLaunch, spawnHoldingSlot, tryCodexLaunchSlot } from "../codex-process.ts";
import { codexToolSurfaceArgs } from "../codex-tool-surface.ts";
import {
  chatgptPlanCodexArgs,
  codexAccessLaunch,
  GUEST_CONFINED_CODEX_ARGS,
  managedCodexArgs,
  ownerKeyCodexArgs,
} from "./launch-args.ts";
import {
  isSagaxPerspicaxBridge,
  isSagaxWorkplaceProxy,
  isolatedPerspicaxBridge,
  mountMcpServer,
  mountSagaxWorkplaceProxy,
  noteRenamedMcpServer,
  type McpApprovalMode,
} from "./mcp-mount.ts";
import {
  PRIVATE_ENV_FAMILIES,
  PROXY_LITERAL_ENV,
  SHELL_ESSENTIALS,
} from "./shell-policy.ts";
import type { CodexConfig } from "./config.ts";
import type { PreparedCodexLaunch } from "./turn-types.ts";
import type { SendTurnInput } from "../../contracts.ts";

export type PrepareLaunchDeps = {
  childEnv: () => Record<string, string | undefined>;
  chatgptTurn: boolean;
  planToken: string | undefined;
  turn: SendTurnInput;
  plan: boolean;
  config: CodexConfig;
  withholdHostTools: boolean;
  waitForLaunchSlot: (attempt: number) => Promise<(() => void) | null>;
};

export async function prepareCodexLaunch(deps: PrepareLaunchDeps, attempt: number): Promise<PreparedCodexLaunch | null> {
  const { childEnv, chatgptTurn, planToken, turn, plan, config, withholdHostTools, waitForLaunchSlot } = deps;
  const env = childEnv();
  const launchedLogin = chatgptTurn ? (storedCodexLogin(env) ?? null) : null;
  if (planToken) env.SAGAX_CHATGPT_TOKEN = planToken;
  // Desktop bridge: this turn's network traffic leaves through the
  // person's computer (never the model traffic: NO_PROXY).
  if (turn.networkProxy) Object.assign(env, networkProxyEnvironment(turn.networkProxy, env));
  // An organization owner key (codexAccessLaunch) wins over a ChatGPT
  // plan sign-in, which wins over a managed or local provider.
  const launch = codexAccessLaunch(env, turn.access);
  const appServerArgs = ["app-server", ...(launch.ownerKey ? ownerKeyCodexArgs() : plan ? chatgptPlanCodexArgs() : config.managed ? managedCodexArgs(config.managed) : codexLocalProviderArgs(env, turn.model)), ...codexToolSurfaceArgs(),
    // Native snapshots can restore inherited variables after the shell
    // policy has filtered them. Scoped MCP gate settings must stay private.
    ...(turn.toolScope === undefined ? [] : ["-c", "features.shell_snapshot=false"]),
    // A guest-driven turn (SendTurnInput.guestConfined): no shell and
    // no file reads, whatever the person's own config says (-c wins
    // over config files). The turn also starts with no environment.
    ...(turn.guestConfined ? GUEST_CONFINED_CODEX_ARGS : []),
    // Organization server: no shell or writes on the Sagax server.
    ...codexHostToolArgs(withholdHostTools)];
  // What the environment holds before any MCP mount writes to it, and
  // every name the mounts write.
  const baseEnv = new Map(Object.entries(env).filter(([, value]) => value !== undefined));
  const mountedNames = new Set<string>();
  const selectedMcp = new Map<string, StdioMcpSpec>();
  const selectedApprovals = new Map<string, McpApprovalMode>();
  /** Mounts whose big catalog is searched (plan turns' URL servers). */
  const directoryMounts = new Set<string>();
  /** Each mount's settings that are not secret (mountMcpServer's literalEnv). */
  const literalEnvs = new Map<string, Record<string, string>>();
  const scopedServer = (name: string, mountName: string, server: McpServerSpec): StdioMcpSpec | null => {
    if (!canUseMcpServer(turn.toolScope, name)) return null;
    // Every URL server is reached through Sagax's remote proxy,
    // on every Codex login, never by Codex's own MCP client: the proxy
    // opens the connection with the same minimal handshake as Settings
    // → Test (mcp-http.ts). Codex's own client adds capability fields
    // (codex-cli 0.160.1 sends elicitation.form/url; rmcp 3.2's form
    // capability can carry schemaValidation) that a strict server
    // refuses: a Voluum server answered "Unrecognized field
    // 'schemaValidation'", Codex started the thread without its tools,
    // and every call came back "Tool not found" while Settings → Test
    // listed 100+ tools. The proxy also speaks SSE, which Codex does not.
    // A plan turn has no tool_search (chatgptPlanCodexArgs): its URL
    // servers are also searched through the proxy's tool directory.
    // Own-login and Company turns keep Codex's hosted tool_search, so
    // their catalog passes through whole.
    const directory = plan && "url" in server;
    if (turn.toolScope === undefined && !("url" in server)) return server;
    const hash = createHash("sha256").update(mountName).digest("hex");
    // A proxy's network settings come from the environment Codex runs
    // with: Codex itself starts MCP children with only a few names.
    const proxy = turn.toolScope === undefined
      ? mcpStdioServer(server, { nodeEnv: { ELECTRON_RUN_AS_NODE: "1" }, ...(directory ? { directory: { name } } : {}), configEnvName: `SAGAX_REMOTE_MCP_CONFIG_${hash}`, sourceEnv: env })
      : gateServer({ name, server, threadId: turn.threadId, budget: 0, toolScope: turn.toolScope, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" },
        configEnvName: `SAGAX_GATE_CONFIG_${hash}`, directory, sourceEnv: env });
    if (proxy && directory) directoryMounts.add(mountName);
    if (!proxy) return null;
    // The proxy's own network switches go in its env table, so the
    // shell keeps the person's NO_PROXY and never gets the switch. A
    // gate already carries them inside its private record.
    const shared = { ...proxy.env };
    if (turn.toolScope === undefined) {
      const literal = Object.fromEntries(Object.entries(shared).filter(([key]) => PROXY_LITERAL_ENV.includes(key)));
      for (const key of PROXY_LITERAL_ENV) delete shared[key];
      if (Object.keys(literal).length) literalEnvs.set(mountName, literal);
    }
    return { command: proxy.command, args: proxy.args ?? [], env: shared };
  };
  const mountSelected = (name: string, mountName: string, server: McpServerSpec, approval: McpApprovalMode = "auto") => {
    let selected = scopedServer(name, mountName, server);
    if (selected) {
      // A selected gate already encapsulates its upstream's env in a
      // private per-mount record. Only a direct bridge needs prefixes.
      const directPerspicax = isSagaxPerspicaxBridge(selected);
      if (directPerspicax) {
        const isolated = isolatedPerspicaxBridge(mountName, selected);
        selected = isolated.server;
        literalEnvs.set(mountName, { ...literalEnvs.get(mountName), ...isolated.literal });
      }
      selectedMcp.set(mountName, selected);
      selectedApprovals.set(mountName, approval);
      mountMcpServer(appServerArgs, env, mountName, selected, approval, literalEnvs.get(mountName), mountedNames);
      if ((turn.toolScope !== undefined || directPerspicax) && approval === "prompt") appServerArgs.push("-c", `mcp_servers.${mountName}.default_tools_approval_mode="prompt"`);
    }
  };
  if (turn.integrations?.agents) {
    // Sagax's own coordination tools never ask, as on Claude
    // (mcp__agents is pre-allowed): "auto" quiets only read-only tools,
    // so coordinate_bots raised a card on every hand-off and an
    // unattended Chief's job died when the card timed out. A teammate's
    // own work still follows its own level; computer, browser,
    // connector and custom servers keep their approvals.
    // The whole catalog, with each family of tools as one tool
    // (agents-merged.ts). Not under a tool selection: there Codex asks
    // about agents tools by name and could not read a family call.
    mountSelected("agents", "agents", turn.toolScope === undefined
      ? { ...turn.integrations.agents, env: { ...turn.integrations.agents.env, SAGAX_MERGED_TOOLS: "1" } }
      : turn.integrations.agents, "approve");
  }
  if (turn.integrations?.localComputer) {
    // The host daemon and isolated Local VM both arrive as a direct Cua
    // Driver stdio MCP server. Codex sees the same computer tool surface.
    mountSelected("computer", "computer", turn.integrations.localComputer);
  }
  if (turn.integrations?.browser) {
    mountSelected("browser", "browser", turn.integrations.browser);
  }
  if (turn.integrations?.data) {
    // The bot's own database. Every call goes to Sagax's approval path
    // (2026-10-16 security review): the person's rules, the safety
    // review and the security keys apply, and a call that stays in the
    // bot's workspace is answered there without a card
    // (sagax-internal-tools.ts sagaxInternalSelfAnswers).
    mountSelected("data", "data", turn.integrations.data, "prompt");
  }
  // A custom server named like one in the user's own config.toml would
  // be merged with it by the `-c` override — a stdio command over a
  // remote url is "invalid configuration" and kills the turn before the
  // model is asked. Such a server mounts under a name of its own.
  const declaredInCodexConfig = codexConfigMcpServerNames(env);
  if (turn.toolScope !== undefined) {
    for (const name of declaredInCodexConfig) appServerArgs.push("-c", `mcp_servers.${name}.enabled=false`);
  }
  for (const [name, server] of Object.entries(turn.integrations?.custom ?? {})) {
    if (!("url" in server) && isSagaxWorkplaceProxy(name, server)) {
      mountSagaxWorkplaceProxy(appServerArgs, env, name, server, mountedNames);
      continue;
    }
    const mountName = mountedMcpServerName(name, declaredInCodexConfig);
    if (mountName !== name) noteRenamedMcpServer(name, mountName);
    mountSelected(name, mountName, server, "prompt");
  }
  if (turn.integrations?.phone) {
    if (turn.toolScope !== undefined) {
      mountSelected("phone", "openmausbot_phone", turn.integrations.phone);
    } else {
    const bridge = turn.integrations.phone;
    Object.assign(env, bridge.env);
    for (const name of Object.keys(bridge.env)) mountedNames.add(name);
    const prefix = "mcp_servers.openmausbot_phone";
    appServerArgs.push(
      "-c", `${prefix}.command=${JSON.stringify(bridge.command)}`,
      "-c", `${prefix}.args=${JSON.stringify(bridge.args)}`,
      "-c", `${prefix}.env_vars=${JSON.stringify(Object.keys(bridge.env))}`,
      "-c", `${prefix}.default_tools_approval_mode="auto"`,
    );
    }
  }
  // The Messages tool posts its own send card. Codex must not ask twice.
  if (turn.integrations?.messages) {
    if (turn.toolScope !== undefined) {
      mountSelected("messages", "sagax_messages", turn.integrations.messages);
    } else {
    const bridge = turn.integrations.messages;
    Object.assign(env, bridge.env);
    for (const name of Object.keys(bridge.env)) mountedNames.add(name);
    const prefix = "mcp_servers.sagax_messages";
    appServerArgs.push(
      "-c", `${prefix}.command=${JSON.stringify(bridge.command)}`,
      "-c", `${prefix}.args=${JSON.stringify(bridge.args)}`,
      "-c", `${prefix}.env_vars=${JSON.stringify(Object.keys(bridge.env))}`,
      "-c", `${prefix}.default_tools_approval_mode="auto"`,
    );
    }
  }

  // Codex hands its MCP children their variables from the one
  // environment it also runs shell commands in. Every variable a mount
  // writes there (a command server's token, a harness mount's
  // capability, a gate's or remote proxy's private record, which holds
  // a URL server's header values) is excluded from that shell below,
  // and shell snapshots, which can restore what the policy removed,
  // are off.
  // Not excluded: a value the environment already held that a mount
  // passes along unchanged (the person's proxy settings), and the few
  // variables no shell works without. ELECTRON_RUN_AS_NODE is never the
  // person's setting, so it is excluded wherever a mount sets it.
  const mountedEnv = [...mountedNames].filter((name) => env[name] !== undefined && !SHELL_ESSENTIALS.has(name) && !name.startsWith("LC_")
    && (name === "ELECTRON_RUN_AS_NODE" || baseEnv.get(name) !== env[name]));
  const privateEnv = [...new Set([
    ...(turn.toolScope !== undefined ? ["SAGAX_GATE_CONFIG_*"] : []),
    ...PRIVATE_ENV_FAMILIES.filter((family) => mountedEnv.some((name) => name.startsWith(family))).map((family) => `${family}*`),
    ...mountedEnv.filter((name) => !PRIVATE_ENV_FAMILIES.some((family) => name.startsWith(family))).sort(),
  ])];
  // Records this turn writes for a tool selection or a searched server
  // never run without proof that snapshots are off. The rest was there
  // before that guarantee, so a Codex that cannot say keeps working,
  // only with the exclusions.
  const provenPrivateEnv = turn.toolScope !== undefined || directoryMounts.size > 0;
  if (privateEnv.length && turn.toolScope === undefined) appServerArgs.push("-c", "features.shell_snapshot=false");

  const selectionConfig: { config?: Record<string, unknown> } = turn.toolScope === undefined ? {} : { config: { mcp_servers: Object.fromEntries(
    [...selectedMcp].map(([name, server]) => [name, {
      command: server.command, args: server.args, env_vars: Object.keys(server.env), env: {}, default_tools_approval_mode: selectedApprovals.get(name) ?? "prompt",
    }]),
  ) } };

  const commandCwd = permissionLaunchCwd(turn.cwd ?? homedir()) ?? (turn.cwd ?? homedir());
  const releaseSlot = tryCodexLaunchSlot() ?? await waitForLaunchSlot(attempt);
  if (!releaseSlot) return null;
  const child = spawnHoldingSlot(releaseSlot, () => spawnCli(...codexLaunch(config.cli, appServerArgs), {
    cwd: turn.cwd ?? homedir(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }, "bot"));

  return {
    env,
    launchedLogin,
    appServerArgs,
    privateEnv,
    provenPrivateEnv,
    selectedMcp,
    selectedApprovals,
    directoryMounts,
    selectionConfig,
    commandCwd,
    releaseSlot,
    child,
  };
}
