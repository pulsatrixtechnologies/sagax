// Capabilities (« Capacités »): one word for everything a bot can receive
// on top of its engine (a plugin, a skill, an MCP server, an engine account's
// connector, a Perspicax Role, Flow). Each one is described the same way
// everywhere: its form, its source, its scope and its state, plus what the
// bot's engine actually receives of it.
//
// The server resolves the list of one bot for one engine
// (server/capabilities/capabilities.ts, GET /api/bots/:id/capabilities); Capabilities >
// Installed, Bot > Capabilities, the iPhone and the Perspicax console read
// that list. The field names below are the contract those screens read:
// add fields freely, never rename one without saying so in the PR.

export type CapabilityForm = "plugin" | "skill" | "mcp" | "connector" | "role" | "flow";

/** bot = this bot; me = the person (all their bots); organization = declared
 * by the organization (the organization's Flow today); installation =
 * "Everyone" and this server's own MCP servers (becomes organization at lot
 * 2); account = the engine account (claude.ai, xAI). */
export type CapabilityScope = "bot" | "me" | "organization" | "installation" | "account";

export type CapabilityState =
  | "on" //            switched on and served to this bot
  | "off" //           installed, switched off for this bot (or left out: see `reason`)
  | "to_connect" //    a sign-in, a key, GitHub or an environment is missing
  | "imposed" //       imposed by the organization (the organization's Flow)
  | "not_held" //      a Perspicax Role on the bot the person speaking does not hold
  | "not_served" //    this engine receives nothing of it
  | "reserved" //      a reserved name, never mounted
  | "unverifiable"; // a Grok account connector: a catalog, its state is not known

export type SourceKind = "marketplace" | "perspicax" | "account" | "file" | "catalog" | "installation";

export interface CapabilitySource {
  kind: SourceKind;
  label: string;
  version?: string;
  /** The installed signed Flow pack, absent for an incomplete mixed update. */
  pack?: string;
}

/** How an engine receives one part of a capability:
 * - native: the engine loads it itself (Claude's --plugin-dir, native skill folders)
 * - prompt: a file index, or whole instructions for chat-only engines
 * - mounted: an MCP server the engine itself connects to
 * - proxied: an MCP server Sagax connects to, its tools handed to the engine
 * - none: not received */
export type Receipt = "native" | "prompt" | "mounted" | "proxied" | "none";

/** What the bot's engine receives of this capability. A part the
 * capability does not bring is absent. */
export interface EngineReceipt {
  skills?: Receipt;
  commands?: Receipt;
  agents?: Receipt;
  mcp?: Receipt;
  tools?: Receipt;
  /** true when the engine receives nothing at all */
  nothing: boolean;
}

/** Why a capability is off, to connect or not served, when there is one
 * reason to say (a code, the screens word it):
 * - name_taken: a personal MCP server whose name another server of the turn already has
 * - not_selected: a server of this installation the bot's own list leaves out
 * - host_command: a command server of the installation (never run on an organization's host)
 * - policy: the organization does not allow it
 * - needs_github, needs_token, needs_sign_in, no_environment, private_address
 * - library_off: a skill of the library while the library is off
 * - not_assigned: a library skill not assigned to this bot
 * - guard_off: the organization's Flow while Perspicax holds it back
 * - not_member: the organization's Flow for a bot whose owner is not an active member
 * - not_installed: declared, not installed yet
 * - unknown_profile: a Role Perspicax no longer lists
 * - disabled: switched off where it is kept
 * - offered: offered by the organization (lot 4), off until the person
 *   turns it on for all their bots
 * - needs_runtime: a built-in plugin whose runtime (Node.js, npx) is not
 *   installed on this computer */
export type CapabilityReason =
  | "name_taken" | "not_selected" | "host_command" | "policy"
  | "needs_github" | "needs_token" | "needs_sign_in" | "no_environment" | "private_address"
  | "library_off" | "not_assigned" | "guard_off" | "not_member" | "not_installed" | "unknown_profile" | "disabled" | "offered" | "needs_runtime";

export interface CapabilityPromptIndex {
  bytes: number;
  maxBytes: number;
  skills: number;
  maxSkills: number;
  omitted: number;
  /** Discovery stopped early: more references may exist than were indexed. */
  incomplete?: boolean;
  /** Whole files actually included, by part. Absent on older servers. */
  parts?: { skills: number; commands: number; agents: number };
}

export interface Capability {
  /** stable, never shown (ex. "plugin:bot:name@market") */
  key: string;
  form: CapabilityForm;
  /** readable (readableName) */
  name: string;
  description?: string;
  source: CapabilitySource;
  scope: CapabilityScope;
  state: CapabilityState;
  /** the bot's switch */
  enabled: boolean;
  /** the person looking may switch it on or off for this bot */
  canToggle: boolean;
  updateAvailable?: boolean;
  /** An older bot tenant copy displaced by the installed signed Flow pack.
   * The installed tenant version, never the product or advertised version. */
  supersededBy?: { tenant: string; version: string };
  promptIndex?: CapabilityPromptIndex;
  brings?: { skills: string[]; commands: string[]; agents: string[]; mcpServers: string[] };
  engine: EngineReceipt;
  connect?: { reason: "sign_in" | "token" | "github" | "environment" | "account" | "key" };
  /** readable name, never an id */
  installedBy?: string;
  /** added (#2029): the installer's principal id, for a tooltip or a Copy
   * action only. Never shown as text. */
  installedById?: string;
  /** added (lot 1a): why it is off, to connect or not served */
  reason?: CapabilityReason;
  /** added (lot 1a): the MCP server names it puts on a turn of this bot
   * (an MCP server, a Role, a plugin "Everyone"'s servers). Names only. */
  mounts?: string[];
  /** added (lot 4): the Perspicax declaration an organization capability
   * comes from, for the person's own switch of an offered one. Never shown. */
  orgDeclaration?: string;
  /** added: the Sagax built-in plugin id (shared/builtin-plugins.ts), for
   * its own icon, translated description and switch. */
  builtin?: string;
}

export interface BotCapabilities {
  botId: string;
  engine: { kind: string; label: string };
  items: Capability[];
  /** the skills index of the prompt (#1748): bytes and count, caps, omitted */
  promptIndex?: CapabilityPromptIndex;
  /** added (#2029): the person this list is resolved for (the bot's owner on
   * the Perspicax console). `name` is readable, never an id; `principalId`
   * is for a tooltip only. Absent when the list is the viewer's own. */
  computedFor?: { principalId: string; name: string };
}

export const CAPABILITIES_PATH = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/capabilities`;

/** Engines with no local folder of their own (server/workspace/workspace.ts
 * supportsWorkspaceFiles): API engines, whose turn is a chat request. They
 * have no native file tools. Managed skills_list/workspace_read allow a
 * short index with bodies loaded on demand (#1997); without those reads,
 * the prompt carries whole files within each capability's visible budget. */
export const ENGINES_WITHOUT_FILES: readonly string[] = ["grok", "openai-compat", "minimax", "mistral", "cerebras", "groq"];

export function engineWorksInFiles(driverKind: string): boolean {
  return !ENGINES_WITHOUT_FILES.includes(driverKind);
}

/** What a capability brings, for engineReceipt. */
export interface EngineParts {
  /** the engine mounts MCP servers (adapter.capabilities.customMcp) */
  customMcp: boolean;
  skills?: boolean;
  commands?: boolean;
  agents?: boolean;
  /** MCP servers (a server, a Role, a plugin "Everyone"'s servers) */
  mcp?: boolean;
  /** an engine account's connectors: whose account they come with */
  account?: "claude" | "grok";
  /** skills read only through the prompt index (a library skill: no native
   * link, so Claude reads it from the prompt too) */
  indexOnly?: boolean;
  /** Managed skills_list/workspace_read is mounted: instruction bodies can
   * be loaded on demand from the prompt index, including on an API engine. */
  skillDiscovery?: boolean;
}

const CLAUDE = "claudeAgent";
const GROK_KINDS = new Set(["grok", "grokAgent"]);

/** The engine matrix: one function, used by the resolver AND the texts.
 *
 * - Claude (`claudeAgent`) loads a bot's plugins whole with --plugin-dir
 *   (skills, commands and agents: native), including the organization's
 *   Flow. Its skills are linked into its native skills folder.
 * - The other engines with files (Codex, Pi, Grok CLI, ...) get a plugin's
 *   skills, commands and agents named in the turn prompt with their path
 *   (server/turns/plugin-turn.ts), and the bot's skills in the skills index.
 * - Engines without files (`grok`, `openai-compat`, `minimax`, `mistral`,
 *   `cerebras`, `groq`) get a short index when managed reads are allowed,
 *   otherwise whole files within the visible per-capability budget
 *   (server/capabilities/capability-prompt.ts). Plugin hooks and LSP stay out of
 *   discovery on every non-Claude engine; MCP is proxied when customMcp is
 *   on.
 * - MCP follows `customMcp`: an engine with files connects to the servers
 *   itself (mounted); one without files gets their tools through Sagax
 *   (proxied, server/drivers/chat-mcp-tools.ts).
 * - An account's connectors come with the engine of that account only. */
export function engineReceipt(driverKind: string, form: CapabilityForm, parts: EngineParts): EngineReceipt {
  const files = engineWorksInFiles(driverKind);
  const claude = driverKind === CLAUDE;
  const out: EngineReceipt = { nothing: true };
  const fileReceipt = (): Receipt => {
    if (claude) return parts.indexOnly ? "prompt" : "native";
    // Every other engine reads them through the prompt: file engines by
    // path or managed reads; API engines without retrieval get files inline.
    return "prompt";
  };
  if (form === "plugin" || form === "skill" || form === "flow") {
    if (parts.skills) out.skills = fileReceipt();
    if (parts.commands) out.commands = fileReceipt();
    if (parts.agents) out.agents = fileReceipt();
  }
  if (parts.mcp && (form === "plugin" || form === "mcp" || form === "role" || form === "flow")) {
    out.mcp = parts.customMcp ? (files ? "mounted" : "proxied") : "none";
  }
  if (form === "role" && parts.mcp) out.tools = out.mcp;
  if (form === "connector" && parts.account) {
    out.tools = (parts.account === "claude" && claude) || (parts.account === "grok" && GROK_KINDS.has(driverKind)) ? "native" : "none";
  }
  out.nothing = !(["skills", "commands", "agents", "mcp", "tools"] as const).some((part) => out[part] !== undefined && out[part] !== "none");
  return out;
}

/** The capabilities a turn of this bot really gets: on (or imposed) and
 * received by the engine. The test "a turn mounts exactly what the list
 * says" compares these with what the turn functions mount. */
export function servedCapabilities(items: readonly Capability[]): Capability[] {
  return items.filter((item) => (item.state === "on" || item.state === "imposed") && !item.engine.nothing);
}
