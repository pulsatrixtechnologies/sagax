// The capabilities resolver (lot 1a of the Capabilities migration): for ONE
// bot and ITS engine, the list of everything the bot receives on top of its
// engine (shared/capabilities.ts), read from today's stores with nothing
// migrated and nothing a turn mounts changed. Every screen reads this list
// (GET /api/bots/:id/capabilities, server/routes/bot-capabilities.ts; the
// main bot's sagax_settings `bot.capabilities`).
//
// Pure: the stores are handed in (`CapabilityInputs`, filled by
// server/index.ts). What a turn would mount comes from the same functions
// the turn calls (server/turn-mounts.ts), so the list says what a turn gets
// (server/capabilities.test.ts, "a turn mounts exactly what the list says").
// Ids never reach a name: names are readable, keys are never shown.
import { basename } from "node:path";
import type { McpServerSpec } from "./contracts.ts";
import type { GithubConnection, PersonalMcpServer } from "./person-connections.ts";
import type { PluginContents } from "./bot-plugins.ts";
import { engineServerMcp, perspicaxServerName, withoutHostCommands, personalMcpPrecheck, serverMcpAsPerson, turnPluginPromptDirs } from "./turn-mounts.ts";
import { pluginMcpPrecheck, selectPluginScopes } from "./capability-plugin-mounts.ts";
import {
  engineReceipt,
  engineWorksInFiles,
  type BotCapabilities,
  type Capability,
  type CapabilityReason,
  type CapabilityState,
  type EngineParts,
} from "../shared/capabilities.ts";
import { GROK_CLOUD_CONNECTORS } from "../shared/grok-cloud-connectors.ts";
import { reservedMcpName } from "../shared/mcp-reserved-names.ts";
import { readableName } from "../shared/readable-name.ts";

/** Who looks at the list, and so whose turn it previews: their personal
 * servers, their GitHub connection, the Roles they hold. */
export interface CapabilityViewer {
  /** The person (organization server); absent on a personal server. */
  principalId?: string;
  /** May switch the bot's own capabilities (its owner, a manager, an
   * organization admin). */
  mayChange: boolean;
}

export interface BotPluginInput {
  key: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  enabled: boolean;
  /** readable, never an id */
  installedBy?: string;
  declaredMcpServers: string[];
  /** the folder a turn would load (BotPlugins.pluginDir) */
  dir: string;
  /** the folder is there (BotPlugins.pluginDirs keeps only those) */
  present: boolean;
  contents: PluginContents;
  updateAvailable?: boolean;
}

export interface WorkspacePluginInput {
  key: string;
  name: string;
  marketplace: string;
  version?: string;
  description?: string;
  /** MCP server names it added to this installation */
  servers: string[];
  /** library skills it added */
  skills: string[];
  updateAvailable?: boolean;
  folder?: { dir: string; contents: PluginContents; declaredMcpServers: string[] };
}

export interface InstallationServerInput {
  name: string;
  /** a valid entry (parseStoredMcpServer) */
  valid: boolean;
  enabled: boolean;
  remote: boolean;
  url?: string;
  /** the marketplace it came from */
  source?: string;
}

export interface SkillInput {
  name: string;
  description: string;
  enabled: boolean;
  /** private (the bot's own copy) or library (assigned) */
  origin: "private" | "library";
  /** manifest source (`org:` for the organization library, a URL...) */
  source: string;
}

export interface CapabilityInputs<S extends Record<string, McpServerSpec> = Record<string, McpServerSpec>> {
  organization: boolean;
  /** readable name of the organization (Perspicax), for "From <org>" */
  organizationName?: string;
  bot: { id: string; name: string; mcpServers?: string[]; perspicaxProfiles: string[]; assignedSkills?: string[] };
  engine: { instanceId: string; kind: string; label: string; customMcp: boolean; agentsMcp?: boolean };

  // plugins
  botPlugins: BotPluginInput[];
  personalPlugins?: BotPluginInput[];
  /** Private inputs, never returned: the exact currently selected installs
   * whose MCP declarations the turn considers after the personal servers. */
  pluginMcp?: Array<{ scope: "organization" | "person" | "bot"; key: string; name: string; spec: McpServerSpec }>;
  pluginEnvironment?: boolean;
  pluginHostRefused?: (url: string) => boolean | undefined;
  /** the bot's enabled plugin folders as a turn reads them (BotPlugins.pluginDirs) */
  botPluginDirs: string[];
  workspacePlugins: WorkspacePluginInput[];
  orgFlow: {
    /** the organization's Flow folders for this bot (OrgFlowPlugins.dirsFor) */
    dirsFor: (own: readonly string[]) => string[];
    /** the declared plugins (absent: no declaration) */
    declared?: Array<{ name: string; version: string; tenant: boolean }>;
    /** Perspicax enforces the Flow guard and the switch is on */
    guarded: boolean;
    /** the bot's owner is an active member */
    member: boolean;
    /** the folder of one declared plugin, when its copy is installed here */
    dirOf: (name: string) => string | undefined;
  };

  // this installation's MCP servers
  installationServers: InstallationServerInput[];
  /** customMcpServers(cfg, bot.mcpServers): enabled, valid, not reserved, in the bot's own list */
  configured: S;
  filterPolicy: (servers: S) => S;
  /** the turn person's GitHub token for the GitHub servers (never shown) */
  githubToken?: string;
  /** a remote server's sign-in state (mcpOAuth.status) */
  serverAuth: (name: string) => string | undefined;

  // the viewer's own MCP servers (organization server)
  personal?: {
    servers: Record<string, PersonalMcpServer>;
    github?: GithubConnection;
    hasEnvironment: boolean;
    /** the address check a turn makes (cached; undefined: not checked yet, passes) */
    hostRefused: (url: string) => boolean | undefined;
    /** an OAuth server signed in and usable */
    signedIn: (name: string, server: PersonalMcpServer) => boolean;
  };

  // skills
  skills: SkillInput[];
  personalSkills?: Array<{ name: string; description: string; enabled: boolean; shadowed?: boolean }>;
  /** Current library provenance, including unassigned skills while the
   * library is off. Installed-plugin records can outlive their contents. */
  librarySkills: Array<{ name: string; source: string }>;
  skillsLibrary: boolean;
  promptIndex?: BotCapabilities["promptIndex"];

  // Perspicax Roles
  roles: {
    catalog: Array<{ id: string; slug: string; name: string; description: string }>;
    /** the Role ids the viewer holds (null: not known to Perspicax) */
    held: string[] | null;
  };

  // engine account connectors
  claudeAi: { rides: boolean; connectors?: Array<{ name: string; status: string }> };
  grokCloud: boolean;
}

const has = (list: readonly string[] | undefined) => Boolean(list && list.length);

/** The one list of a bot for its engine. */
export function resolveBotCapabilities(inputs: CapabilityInputs, viewer: CapabilityViewer): BotCapabilities {
  const engine = inputs.engine;
  const kind = engine.kind;
  const receipt = (form: Capability["form"], parts: Omit<EngineParts, "customMcp">) => engineReceipt(kind, form, { customMcp: engine.customMcp, skillDiscovery: engine.agentsMcp === true, ...parts });
  const items: Capability[] = [];
  const push = (item: Capability) => {
    // a capability the engine receives nothing of is not served, whatever
    // its own switch says (on, imposed, held)
    if ((item.state === "on" || item.state === "imposed") && item.engine.nothing) item.state = "not_served";
    items.push(item);
  };

  // ── plugins of this bot, and the organization's Flow ──────────────────
  const folders = selectPluginScopes({
    organization: [...inputs.orgFlow.dirsFor([]).map((dir) => ({ name: basename(dir), dir })), ...inputs.workspacePlugins.flatMap((plugin) => plugin.folder ? [{ name: plugin.name, dir: plugin.folder.dir }] : [])],
    person: (inputs.personalPlugins ?? []).filter((plugin) => plugin.enabled && plugin.present),
    bot: inputs.botPluginDirs.map((dir) => ({ name: basename(dir), dir })),
  });
  const dirs = new Set(kind === "claudeAgent" ? folders.map((plugin) => plugin.dir)
    : turnPluginPromptDirs(kind, folders.filter((plugin) => plugin.scope !== "organization" || inputs.workspacePlugins.some((installed) => installed.folder?.dir === plugin.dir)).map((plugin) => plugin.dir)));
  for (const { plugin, scope } of [
    ...(inputs.personalPlugins ?? []).map((plugin) => ({ plugin, scope: "me" as const })),
    ...inputs.botPlugins.map((plugin) => ({ plugin, scope: "bot" as const })),
  ]) {
    const loaded = dirs.has(plugin.dir);
    const selected = folders.some((folder) => folder.dir === plugin.dir);
    const state: CapabilityState = !plugin.enabled || !selected ? "off" : loaded ? "on" : plugin.present ? "not_served" : "off";
    push({
      key: `plugin:${scope}:${plugin.key}`,
      form: "plugin",
      name: readableName(plugin.name),
      ...(plugin.description ? { description: plugin.description } : {}),
      source: { kind: "marketplace", label: plugin.marketplace, ...(plugin.version ? { version: plugin.version } : {}) },
      scope,
      state,
      enabled: plugin.enabled,
      canToggle: scope === "me" || viewer.mayChange,
      ...(plugin.updateAvailable ? { updateAvailable: true } : {}),
      brings: { skills: plugin.contents.skills, commands: plugin.contents.commands, agents: plugin.contents.agents, mcpServers: plugin.declaredMcpServers },
      // MCP receipts are completed below using the actual selected mounts.
      engine: receipt("plugin", { skills: has(plugin.contents.skills), commands: has(plugin.contents.commands), agents: has(plugin.contents.agents) }),
      ...(plugin.installedBy ? { installedBy: plugin.installedBy } : {}),
      ...(plugin.enabled && !plugin.present ? { reason: "not_installed" as const }
        : plugin.enabled && !folders.some((folder) => folder.dir === plugin.dir) ? { reason: "name_taken" as const } : {}),
    });
  }
  // Organization folders have already won their names over personal and
  // bot copies. A declaration without a current folder claims nothing.
  for (const declared of inputs.orgFlow.declared ?? []) {
    const dir = inputs.orgFlow.dirOf(declared.name);
    const loaded = dir !== undefined && dirs.has(dir);
    let state: CapabilityState = "imposed";
    let reason: CapabilityReason | undefined;
    if (!inputs.orgFlow.guarded) { state = "off"; reason = "guard_off"; }
    else if (!inputs.orgFlow.member) { state = "off"; reason = "not_member"; }
    else if (!dir) { state = "off"; reason = "not_installed"; }
    else if (!loaded) state = "not_served";
    push({
      key: `flow:organization:${declared.name}`,
      form: "flow",
      name: readableName(declared.name),
      source: { kind: "perspicax", label: inputs.organizationName ?? "Perspicax", version: declared.version },
      scope: "organization",
      state,
      enabled: state === "imposed",
      canToggle: false,
      // skills, commands and agents from the signed pack (Claude only, C-3)
      engine: receipt("flow", { skills: true, commands: true, agents: true }),
      ...(reason ? { reason } : {}),
    });
  }

  // ── this installation's MCP servers, and plugins "Everyone" ───────────
  const selected = engineServerMcp({ configured: inputs.configured, organization: inputs.organization, filterPolicy: inputs.filterPolicy });
  const asPerson = serverMcpAsPerson(selected, { organization: inputs.organization, githubToken: inputs.githubToken });
  const mounted = new Set(engine.customMcp ? Object.keys(asPerson.servers) : []);
  const withheld = new Set(asPerson.githubWithheld);
  const policyKept = new Set(Object.keys(inputs.filterPolicy(withoutHostCommands(inputs.organization, inputs.configured))));
  const serverOwners = currentPluginOwners(inputs.installationServers.filter((server) => server.valid), inputs.workspacePlugins, (plugin) => plugin.servers);
  const skillOwners = currentPluginOwners(inputs.librarySkills, inputs.workspacePlugins, (plugin) => plugin.skills);
  const serverRow = (server: InstallationServerInput): { state: CapabilityState; reason?: CapabilityReason; connect?: Capability["connect"] } => {
    if (reservedMcpName(server.name)) return { state: "reserved" };
    if (!server.enabled) return { state: "off", reason: "disabled" };
    if (inputs.bot.mcpServers && !inputs.bot.mcpServers.includes(server.name)) return { state: "off", reason: "not_selected" };
    if (inputs.organization && !server.remote) return { state: "off", reason: "host_command" };
    if (!policyKept.has(server.name)) return { state: "off", reason: "policy" };
    if (withheld.has(server.name)) return { state: "to_connect", reason: "needs_github", connect: { reason: "github" } };
    if (!mounted.has(server.name)) return { state: engine.customMcp ? "off" : "not_served" };
    const auth = inputs.serverAuth(server.name);
    // mounted all the same: its tools refuse until the sign-in (C-18)
    if (auth === "required" || auth === "expired" || auth === "error") return { state: "on", reason: "needs_sign_in", connect: { reason: "sign_in" } };
    return { state: "on" };
  };
  const serverItems = new Map<string, ReturnType<typeof serverRow>>();
  for (const server of inputs.installationServers) {
    if (!server.valid) continue;
    const row = serverRow(server);
    serverItems.set(server.name, row);
    if (serverOwners.has(server.name)) continue; // folded into its current, unique plugin below
    push({
      key: `mcp:installation:${server.name}`,
      form: "mcp",
      name: readableName(server.name),
      source: server.source ? { kind: "marketplace", label: server.source } : { kind: "installation", label: "Sagax" },
      scope: "installation",
      state: row.state,
      enabled: !(row.state === "off" && (row.reason === "not_selected" || row.reason === "disabled")),
      // the bot's own list of servers (bot.mcpServers) is the bot's switch
      canToggle: viewer.mayChange && row.state !== "reserved",
      engine: receipt("mcp", { mcp: true }),
      ...(row.connect ? { connect: row.connect } : {}),
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.state === "on" ? { mounts: [server.name] } : {}),
    });
  }
  const skillByName = new Map(inputs.skills.map((skill) => [skill.name, skill] as const));
  const pluginSkills = new Set<string>();
  for (const plugin of inputs.workspacePlugins) {
    const servers = [...new Set(plugin.servers)].filter((name) => serverOwners.get(name) === plugin.key);
    const ownedSkills = [...new Set(plugin.skills)].filter((name) => skillOwners.get(name) === plugin.key);
    const on = servers.filter((name) => serverItems.get(name)!.state === "on");
    const skills = ownedSkills.filter((name) => skillByName.get(name)?.origin === "library" && skillByName.get(name)!.source === plugin.marketplace && skillByName.get(name)!.enabled);
    if (engineWorksInFiles(kind)) for (const name of ownedSkills) pluginSkills.add(name);
    const needs = servers.map((name) => serverItems.get(name)!).find((row) => row.state === "to_connect" || row.connect);
    const complete = plugin.folder && dirs.has(plugin.folder.dir);
    let state: CapabilityState = complete || on.length || skills.length ? "on" : needs?.state === "to_connect" ? "to_connect" : "off";
    let reason: CapabilityReason | undefined = needs?.reason;
    // its skills wait in the library: off, or not assigned to this bot (C-2)
    if (state === "off" && ownedSkills.length && !servers.length) reason = inputs.skillsLibrary ? "not_assigned" : "library_off";
    if (state === "off" && !reason && servers.length) reason = servers.map((name) => serverItems.get(name)!.reason).find(Boolean);
    if (state === "on" && !engine.customMcp && !skills.length && !complete) state = "not_served";
    push({
      key: `plugin:installation:${plugin.key}`,
      form: "plugin",
      name: readableName(plugin.name),
      ...(plugin.description ? { description: plugin.description } : {}),
      source: { kind: "marketplace", label: plugin.marketplace, ...(plugin.version ? { version: plugin.version } : {}) },
      scope: "installation",
      state,
      enabled: state !== "off",
      canToggle: false,
      ...(plugin.updateAvailable ? { updateAvailable: true } : {}),
      brings: { skills: plugin.folder?.contents.skills ?? ownedSkills, commands: plugin.folder?.contents.commands ?? [], agents: plugin.folder?.contents.agents ?? [], mcpServers: [...new Set([...servers, ...(plugin.folder?.declaredMcpServers ?? [])])] },
      engine: receipt("plugin", { mcp: on.length > 0, skills: complete ? has(plugin.folder!.contents.skills) : skills.length > 0, commands: complete && has(plugin.folder!.contents.commands), agents: complete && has(plugin.folder!.contents.agents), indexOnly: !plugin.folder }),
      ...(needs?.connect ? { connect: needs.connect } : {}),
      ...(reason ? { reason } : {}),
      ...(on.length ? { mounts: on } : {}),
    });
  }

  // ── Perspicax Roles of the bot (as the person looking) ────────────────
  const taken = new Set(mounted);
  if (inputs.organization) {
    const catalog = new Map(inputs.roles.catalog.map((role) => [role.id, role] as const));
    const held = new Set(inputs.roles.held ?? []);
    for (const id of [...new Set(inputs.bot.perspicaxProfiles)].sort()) {
      const role = catalog.get(id);
      let state: CapabilityState = "on";
      let reason: CapabilityReason | undefined;
      if (!role) { state = "off"; reason = "unknown_profile"; }
      else if (!held.has(id)) state = "not_held";
      const mount = role && state === "on" && engine.customMcp ? perspicaxServerName(role.slug || role.id, taken) : undefined;
      if (mount) taken.add(mount);
      push({
        key: `role:bot:${id}`,
        form: "role",
        // never the id: an unknown Role is named as such by the screens
        name: role ? role.name || readableName(role.slug) : "",
        ...(role?.description ? { description: role.description } : {}),
        source: { kind: "perspicax", label: inputs.organizationName ?? "Perspicax" },
        scope: "bot",
        state,
        enabled: true,
        canToggle: viewer.mayChange,
        engine: receipt("role", { mcp: true }),
        ...(reason ? { reason } : {}),
        ...(mount ? { mounts: [mount] } : {}),
      });
    }
  }

  // ── the viewer's own MCP servers (mountPersonalMcp) ───────────────────
  if (inputs.organization && inputs.personal && viewer.principalId) {
    const personal = inputs.personal;
    for (const [name, server] of Object.entries(personal.servers)) {
      const check = personalMcpPrecheck(name, server, { taken: (other) => taken.has(other), hasEnvironment: personal.hasEnvironment, github: personal.github });
      let state: CapabilityState = "on";
      let reason: CapabilityReason | undefined;
      let connect: Capability["connect"] | undefined;
      if ("skip" in check) {
        switch (check.skip) {
          case "off": state = "off"; reason = "disabled"; break;
          // a name another server of the turn has: it was skipped in silence (C-18)
          case "name_taken": state = "off"; reason = "name_taken"; break;
          case "reserved": state = "reserved"; break;
          case "no_environment": state = "to_connect"; reason = "no_environment"; connect = { reason: "environment" }; break;
          case "needs_github": state = "to_connect"; reason = "needs_github"; connect = { reason: "github" }; break;
          case "needs_token": state = "to_connect"; reason = "needs_token"; connect = { reason: "token" }; break;
        }
      } else if (server.kind === "remote") {
        if (personal.hostRefused(server.url)) { state = "off"; reason = "private_address"; }
        else if (server.auth === "oauth" && !personal.signedIn(name, server)) { state = "to_connect"; reason = "needs_sign_in"; connect = { reason: "sign_in" }; }
      }
      if (state === "on" && !engine.customMcp) state = "not_served";
      if (state === "on") taken.add(name);
      push({
        key: `mcp:me:${name}`,
        form: "mcp",
        name: readableName(name),
        source: { kind: "file", label: server.kind === "remote" ? hostOf(server.url) : "command" },
        scope: "me",
        state,
        enabled: server.enabled,
        // the person's own switch is in Mes connexions, for all their bots
        canToggle: false,
        engine: receipt("mcp", { mcp: true }),
        ...(connect ? { connect } : {}),
        ...(reason ? { reason } : {}),
        ...(state === "on" ? { mounts: [name] } : {}),
      });
    }
  }

  // Complete-plugin MCP servers, in the runtime's exact order. The
  // selected plugin folder has already resolved organization/person/bot.
  for (const candidate of inputs.pluginMcp ?? []) {
    const row = items.find((item) => item.key === `plugin:${candidate.scope === "organization" ? "installation" : candidate.scope === "person" ? "me" : "bot"}:${candidate.key}`);
    if (!row) continue;
    const check = pluginMcpPrecheck(candidate.name, candidate.spec, {
      taken: (name) => taken.has(name), organization: inputs.organization,
      hasEnvironment: inputs.pluginEnvironment ?? inputs.personal?.hasEnvironment ?? !inputs.organization,
    });
    const allowed = Object.hasOwn(inputs.filterPolicy({ [candidate.name]: candidate.spec }), candidate.name);
    const privateAddress = "url" in candidate.spec && inputs.organization && inputs.pluginHostRefused?.(candidate.spec.url);
    if (check || !allowed || privateAddress || !engine.customMcp) {
      if (!row.reason && check !== "invalid" && check !== "reserved") row.reason = check ?? (!allowed ? "policy" : privateAddress ? "private_address" : undefined);
      continue;
    }
    taken.add(candidate.name);
    row.mounts = [...(row.mounts ?? []), candidate.name];
    row.engine = { ...row.engine, mcp: receipt("mcp", { mcp: true }).mcp, nothing: false };
    row.state = "on";
  }

  // ── skills of the bot and of the library ──────────────────────────────
  for (const skill of inputs.personalSkills ?? []) {
    push({
      key: `skill:me:${skill.name}`, form: "skill", name: skill.name,
      description: skill.description, source: { kind: "file", label: "Me" },
      scope: "me", state: skill.enabled && !skill.shadowed ? "on" : "off", enabled: skill.enabled,
      ...(skill.shadowed ? { reason: "name_taken" as const } : {}),
      canToggle: true, engine: receipt("skill", { skills: true, indexOnly: true }),
    });
  }
  const assigned = new Set(inputs.bot.assignedSkills ?? []);
  for (const skill of inputs.skills) {
    if (skill.origin === "library" && pluginSkills.has(skill.name)
      && inputs.librarySkills.some((current) => current.name === skill.name && current.source === skill.source)) continue; // folded into its current plugin
    const fromOrg = skill.origin === "private" && skill.source.startsWith("org:");
    push({
      key: `skill:${skill.origin === "library" ? "installation" : fromOrg ? "organization" : "bot"}:${skill.name}`,
      form: "skill",
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      source: fromOrg
        ? { kind: "perspicax", label: inputs.organizationName ?? "Organization" }
        : skill.origin === "library" ? { kind: "installation", label: "Library" } : { kind: "file", label: sourceLabel(skill.source) },
      scope: skill.origin === "library" ? "installation" : fromOrg ? "organization" : "bot",
      state: skill.enabled && !inputs.personalSkills?.some((own) => own.enabled && !own.shadowed && own.name === skill.name) ? "on" : "off",
      ...(inputs.personalSkills?.some((own) => own.enabled && !own.shadowed && own.name === skill.name) ? { reason: "name_taken" as const } : {}),
      enabled: skill.enabled,
      canToggle: viewer.mayChange,
      engine: receipt("skill", { skills: true, indexOnly: skill.origin === "library" }),
    });
  }
  // assigned while the library is off: kept on the bot, read by no turn (C-2)
  if (!inputs.skillsLibrary) {
    for (const name of [...assigned].sort()) {
      if (inputs.skills.some((skill) => skill.name === name) || pluginSkills.has(name)) continue;
      push({
        key: `skill:installation:${name}`,
        form: "skill",
        name,
        source: { kind: "installation", label: "Library" },
        scope: "installation",
        state: "off",
        enabled: true,
        canToggle: viewer.mayChange,
        engine: receipt("skill", { skills: true, indexOnly: true }),
        reason: "library_off",
      });
    }
  }

  // ── engine account connectors ─────────────────────────────────────────
  if (inputs.claudeAi.rides) {
    for (const connector of inputs.claudeAi.connectors ?? []) {
      if (connector.status === "unknown") continue;
      const connected = connector.status === "connected";
      push({
        key: `connector:account:claude:${connector.name}`,
        form: "connector",
        name: connector.name,
        source: { kind: "account", label: "Claude" },
        scope: "account",
        state: connected ? "on" : "to_connect",
        enabled: true,
        canToggle: false,
        engine: receipt("connector", { account: "claude" }),
        ...(connected ? {} : { connect: { reason: "account" as const }, reason: "needs_sign_in" as const }),
      });
    }
  }
  if (inputs.grokCloud) {
    for (const connector of GROK_CLOUD_CONNECTORS) {
      items.push({
        key: `connector:account:grok:${connector.id}`,
        form: "connector",
        name: connector.name,
        source: { kind: "catalog", label: "Grok" },
        scope: "account",
        // a static catalog of grok.com: nothing here says it is connected
        state: "unverifiable",
        enabled: true,
        canToggle: false,
        engine: receipt("connector", { account: "grok" }),
      });
    }
  }

  return {
    botId: inputs.bot.id,
    engine: { kind, label: engine.label },
    items,
    ...(inputs.promptIndex ? { promptIndex: inputs.promptIndex } : {}),
  };
}

/** Installed records keep names after a resource is removed or replaced.
 * Fold only when its current provenance identifies exactly one owner.
 * Two historical claims from one marketplace are ambiguous: the resource
 * stays a separate row rather than being credited to either plugin. */
function currentPluginOwners(resources: ReadonlyArray<{ name: string; source?: string }>, plugins: readonly WorkspacePluginInput[], names: (plugin: WorkspacePluginInput) => readonly string[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const resource of resources) {
    if (!resource.source) continue;
    const candidates = plugins.filter((plugin) => plugin.marketplace === resource.source && names(plugin).includes(resource.name));
    if (candidates.length === 1) owners.set(resource.name, candidates[0]!.key);
  }
  return owners;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return "remote"; }
}

/** A skill's source as a short label: the repository or host, never a
 * local path. */
function sourceLabel(source: string): string {
  if (source.startsWith("learn:") || source.startsWith("learned")) return "Learned";
  try {
    const url = new URL(source);
    const parts = url.pathname.split("/").filter(Boolean);
    return url.hostname === "github.com" && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : url.hostname;
  } catch {
    return source.includes("/") && !source.startsWith("/") ? source.split("@")[0]!.slice(0, 80) : "File";
  }
}

/** The MCP server names a turn of this bot gets from the list: what the
 * test compares with the turn functions. */
export function listedMounts(capabilities: BotCapabilities): string[] {
  return [...new Set(capabilities.items.filter((item) => item.state === "on" && item.mounts).flatMap((item) => item.mounts!))].sort();
}
