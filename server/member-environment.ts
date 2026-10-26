// A bot's commands in its owner's own isolated environment (JC, 2026-10-16).
//
// On an organization server a person's bots work in that person's own
// environment: their server environment (one isolated Linux sandbox per
// person, `sagax-environment`, docs/user-sandbox.md) or the Local VM on
// their own computer (the `local_vm` tool of `sagax-desktop`). Nothing there
// reaches the Sagax server or anyone else's space: the sandbox has no
// capabilities, no host mount and no private-network egress, and the Local
// VM is a VM on the person's own machine.
//
// So a call of one of those tools, made by a bot for the person who owns it
// in that person's own environment, is the owner's own work. While the
// organization allows it (`organization.memberEnvironmentAutonomy`, absent
// means on) it runs without a card, as Full access would, but bounded to
// that environment: it is never an admin approval, every call is still in
// the decision log (`own-environment`), and the safety holds, the person's
// own deny and ask rules, a sandbox widening and a guest's turn keep their
// card (server/auto-approve.ts).
//
// This computer (every other `sagax-desktop` tool: the person's real files,
// apps and network) is not an isolated environment and keeps today's rule.
//
// 2026-10-16 security review: the environment still holds the owner's own
// credentials (a git credential store, a GitHub CLI login) and has internet
// access, so "runs without a card" is bounded further
// (ownEnvironmentAutonomy):
// - only at a level that already runs work unasked (Auto, Auto-accept
//   edits), never at Ask: at Ask the person asked to see every call;
// - never when the call falls in a class the person protects with a
//   security key (shell that is not a plain read is destructive and
//   irreversible): the card shows and its Allow needs the key;
// - only for the owner's own turn: a turn another bot started (ask,
//   delegate, coordinate, a peer ask), a routine, a webhook, a typed trigger,
//   an email or any other automation, a room or another person gets the
//   reads only, every other call keeps its card; and even those reads never
//   reach a dotfile or a credential path (`.git-credentials`,
//   `.config/gh/hosts.yml`, `.ssh`, `.netrc`, `.npmrc`, `.aws`,
//   `.docker/config.json`, `.kube`, any `.`-name, a `..` segment, a key
//   file), which keep their card (ownEnvironmentSensitiveRead);
// - the person's own deny and ask rules, the safety review and the grant
//   guard run first (server/index.ts request.opened), on every engine: the
//   Grok gate holds these calls and sends them there (grok-approval-gate.ts).
// The tools are recognized by the mount Sagax itself made for this turn
// (`mountedServers`), never by a server's name alone; the names are also
// reserved for Sagax (mcp-registry.ts).
//
// Names are matched exactly, never by prefix: `mcp__<server>__<tool>`
// (Claude), `<server>__<tool>` (ACP titles, Codex, chat engines' mcpTool).
import type { ApprovalMode } from "../shared/approval-mode.ts";
import { DESKTOP_BRIDGE_MCP_NAME } from "../shared/bot-workplace.ts";
import { sagaxFolder } from "../shared/human-id.ts";
import type { TurnSpeaker } from "./engine-access.ts";
import { sensitiveEnvironmentPath } from "./sensitive-path.ts";
import { USER_SANDBOX_MCP_NAME } from "./user-sandbox-routing.ts";

/** The server environment's tools (server/user-sandbox-tools.ts). */
export const SERVER_ENVIRONMENT_TOOLS: ReadonlySet<string> = new Set([
  "run_command", "read_file", "write_file", "list_files", "browse", "computer_list_tools", "computer_use",
]);

/** The server environment's tools that only read: the ones a turn that is
 * not the owner's own may still run unasked. */
export const SERVER_ENVIRONMENT_READ_TOOLS: ReadonlySet<string> = new Set(["read_file", "list_files", "computer_list_tools"]);

/** The desktop bridge's one tool that acts in the isolated Local VM. */
export const LOCAL_VM_TOOL = "local_vm";

export type OwnEnvironment = "server-environment" | "local-vm";

/** Which of the owner's own environments a provider's tool name acts in, or
 * null (another tool, another server, This computer). */
export function ownEnvironmentTool(name: string | undefined): OwnEnvironment | null {
  const match = /^(?:mcp__)?([a-z][a-z-]{0,63})__([a-z][a-z0-9_]{0,63})$/.exec(name?.trim() ?? "");
  if (!match) return null;
  const [, server, tool] = match;
  if (server === USER_SANDBOX_MCP_NAME && SERVER_ENVIRONMENT_TOOLS.has(tool!)) return "server-environment";
  if (server === DESKTOP_BRIDGE_MCP_NAME && tool === LOCAL_VM_TOOL) return "local-vm";
  return null;
}

/** The tool part of an own-environment tool name, or null. */
function ownEnvironmentParts(name: string | undefined): { server: string; tool: string } | null {
  const match = /^(?:mcp__)?([a-z][a-z-]{0,63})__([a-z][a-z0-9_]{0,63})$/.exec(name?.trim() ?? "");
  return match && ownEnvironmentTool(name) ? { server: match[1]!, tool: match[2]! } : null;
}

/** Whether an own-environment tool only reads (SERVER_ENVIRONMENT_READ_TOOLS). */
export function ownEnvironmentReadTool(name: string | undefined): boolean {
  const parts = ownEnvironmentParts(name);
  return Boolean(parts && parts.server !== DESKTOP_BRIDGE_MCP_NAME && SERVER_ENVIRONMENT_READ_TOOLS.has(parts.tool));
}

/** Whether a read in the owner's environment reaches a dotfile or a
 * credential path: a `.`-name or `..` anywhere in the path (`.ssh`,
 * `.git-credentials`, `.config/gh/hosts.yml`, `.netrc`, `.npmrc`, `.aws`,
 * `.docker/config.json`, `.kube`), a key or credentials file, or a
 * process's secrets under /proc (`/proc/self/environ`, `/proc/<pid>/cmdline`,
 * `/proc/<pid>/mem`, 2026-10-17). Input that cannot be read counts as
 * sensitive (fail closed). No path (a listing of the working folder, the
 * screen tools) is not. A name is all this sees: the environment resolves
 * the path's links before the read runs and refuses one that leads to a
 * credential location (user-sandbox-tools.ts, sensitive-path.ts). */
export function ownEnvironmentSensitiveRead(input: string | undefined): boolean {
  if (input === undefined || input.trim() === "" || input.trim() === "{}") return false;
  let args: unknown;
  try { args = JSON.parse(input); } catch { return true; }
  if (!args || typeof args !== "object" || Array.isArray(args)) return true;
  const path = (args as Record<string, unknown>).path;
  if (path === undefined) return false;
  if (typeof path !== "string") return true;
  // 2026-10-22 (#875, read-only never a card): the bot's own Sagax-made
  // workspace (workspaces/<bot>, task-workspaces/<bot>/<thread>,
  // parallel-worktrees/<bot>/<thread>) sits under the server data dir
  // (~/.sagax, the legacy ~/.openmausbot), so its own name begins with a dot.
  // That data-dir dotfile is not a user credential: a read of the bot's own
  // work area is a plain read, so a turn that is not the owner's own runs it
  // unasked and it never surfaces a card. Only a credential path BELOW the
  // workspace root still cards; .ssh, .env, .aws and every real secret
  // elsewhere stay sensitive (sensitiveEnvironmentPath, unchanged).
  const made = sagaxFolder(path);
  if (made) return made.rest.length > 0 && sensitiveEnvironmentPath(made.rest.join("/"));
  return sensitiveEnvironmentPath(path);
}

/** Whose turn a permission request comes from, for the owner's own
 * environment: "owner" only when the bot's owner (or the operator at this
 * computer) wrote the request themselves; "other" for another bot's hop, a
 * routine, a webhook or typed trigger, an email, any automation, a room
 * without a known person, another person, or anything unknown. */
export function ownEnvironmentTurnOrigin(input: {
  speaker: TurnSpeaker | undefined;
  ownerPrincipalId: string;
  /** The turn is a bot's hop (commsDepth > 0, a coordinated node). */
  internalTurn: boolean;
  /** A routine or other automation started this turn or one of its hops. */
  routineLineage: boolean;
  /** The request was started by a routine run, a webhook or a trigger. */
  automation: boolean;
  /** The bot works unattended on this thread (a routine run). */
  unattended: boolean;
}): "owner" | "other" {
  if (input.internalTurn || input.routineLineage || input.automation || input.unattended) return "other";
  const speaker = input.speaker;
  if (!speaker) return "other";
  if (speaker.origin === "operator") return "owner";
  if (speaker.origin !== "person" || !speaker.principalId) return "other";
  const owner = input.ownerPrincipalId.trim().toLowerCase();
  return owner && speaker.principalId.trim().toLowerCase() === owner ? "owner" : "other";
}

/** Whether Sagax answers one own-environment call itself (no card): the
 * call is in the owner's own environment (ownEnvironmentCall), the level
 * runs work unasked (Auto, Auto-accept edits; never Ask, Custom or a guest's
 * Ask), the person protects none of its classes with a security key, and
 * the turn is the owner's own unless the call only reads. */
export function ownEnvironmentAutonomy(input: {
  call: boolean;
  mode: ApprovalMode;
  tool: string | undefined;
  /** The call's arguments (JSON), to keep a read of a dotfile or a
   * credential path from a turn that is not the owner's own. */
  input?: string;
  origin: "owner" | "other";
  /** The security key classes the person chose that this call falls in. */
  stepUpRequired: readonly string[];
}): boolean {
  if (!input.call) return false;
  if (input.mode !== "auto" && input.mode !== "edits") return false;
  if (input.stepUpRequired.length) return false;
  if (input.origin === "owner") return true;
  return ownEnvironmentReadTool(input.tool) && !ownEnvironmentSensitiveRead(input.input);
}

/** The organization's policy: on unless an admin turned it off. */
export function memberEnvironmentAutonomyAllowed(organization: { memberEnvironmentAutonomy?: unknown } | undefined): boolean {
  return organization?.memberEnvironmentAutonomy !== false;
}

/** Whether one permission request runs unasked in the owner's own
 * environment: the policy is on, the tool acts in an own environment, the
 * environment mounted for this turn belongs to the bot's owner, and no
 * guest drives the turn. */
export function ownEnvironmentCall(input: {
  identity: "solo" | "perspicax";
  policyAllowed: boolean;
  tool: string | undefined;
  /** Whose environment this turn mounted (its workplace decision), if any. */
  environmentPrincipalId: string | null | undefined;
  ownerPrincipalId: string;
  guestDriven: boolean;
  /** The servers Sagax itself mounted as this owner's environment for this
   * turn (mountUserSandbox). A tool of a server not in it (a person's own
   * server under the same name, a stale mount) is not the environment. */
  mountedServers: ReadonlySet<string>;
}): boolean {
  if (input.identity !== "perspicax" || !input.policyAllowed || input.guestDriven) return false;
  const parts = ownEnvironmentParts(input.tool);
  if (!parts) return false;
  if (!input.mountedServers.has(parts.server)) return false;
  const environment = input.environmentPrincipalId?.trim().toLowerCase();
  return Boolean(environment) && environment === input.ownerPrincipalId.trim().toLowerCase();
}

// 2026-10-19 (JC): a person's own destinations are theirs. A tool of their
// server environment or of their own computer (the desktop bridge, every
// tool: This computer and its Local VM), mounted by Sagax for this turn as
// the environment of the bot's owner, is that owner's own work: its card is
// theirs at their own approval level, never an organization admin's. Unlike
// ownEnvironmentCall this does not depend on the organization's autonomy
// policy (memberEnvironmentAutonomy decides whether a card shows, not who
// answers it), and it covers the owner's own computer, which is not an
// isolated environment and so never runs unasked by this rule.

/** Whether a call acts on the bot owner's own destination (their server
 * environment, their own computer or its Local VM) mounted for this turn. */
export function ownDestinationCall(input: {
  identity: "solo" | "perspicax";
  tool: string | undefined;
  environmentPrincipalId: string | null | undefined;
  ownerPrincipalId: string;
  guestDriven: boolean;
  mountedServers: ReadonlySet<string>;
}): boolean {
  if (input.identity !== "perspicax" || input.guestDriven) return false;
  const match = /^(?:mcp__)?([a-z][a-z-]{0,63})__([a-z][a-z0-9_]{0,63})$/.exec(input.tool?.trim() ?? "");
  if (!match) return false;
  const server = match[1]!;
  if (server !== USER_SANDBOX_MCP_NAME && server !== DESKTOP_BRIDGE_MCP_NAME) return false;
  if (!input.mountedServers.has(server)) return false;
  const environment = input.environmentPrincipalId?.trim().toLowerCase();
  return Boolean(environment) && environment === input.ownerPrincipalId.trim().toLowerCase();
}

// 2026-10-19 (JC, prod 0.5.27, then #810 follow-up): computer_select
// ("sagax-computer", server/auto-computer.ts) only chooses among the places
// Sagax already mounted for this turn as one person's own: their cloud
// computer, their own computer, its Local VM, the built-in browser. There is
// no menu for the person any more: the bot decides where it works. So when
// those places belong to the person this turn is for (who speaks, or who
// answers its cards), the choice needs no card at all, at any approval
// level, on every engine (Claude already pre-allows it). It never reaches a
// computer the organization shares (`agents` shared_computer keeps its
// card). Each call on the place it picks keeps its own rules: on their real
// computer, always a card. Recognized by Sagax's own mount for this turn,
// never by a name alone.

/** The one tool of Sagax's computer choice, as a provider spells it. */
const COMPUTER_CHOICE_TOOL = /^(?:mcp__)?sagax-computer__computer_select$/;

/** Whether a call is Sagax's own computer_select, mounted for this turn,
 * choosing among the places of the person this turn is for. */
export function ownComputerChoiceCall(input: {
  identity: "solo" | "perspicax";
  tool: string | undefined;
  /** Sagax mounted its computer_select server for this turn. */
  mounted: boolean;
  /** Whose places the turn may reach (the workplace decision's person). */
  choicePrincipalId: string | null | undefined;
  /** The person this turn is for: who answers its cards, and the speaker
   * when they wrote it themselves in their own conversation. */
  personPrincipalIds: readonly string[];
  guestDriven: boolean;
}): boolean {
  if (input.identity !== "perspicax" || input.guestDriven || !input.mounted) return false;
  if (!COMPUTER_CHOICE_TOOL.test(input.tool?.trim() ?? "")) return false;
  const places = input.choicePrincipalId?.trim().toLowerCase();
  return Boolean(places) && input.personPrincipalIds.some((person) => person.trim().toLowerCase() === places);
}

/** The read-only tools of a person's own destination that may read their
 * own attachments without a card. */
const ATTACHMENT_READ_TOOLS: ReadonlySet<string> = new Set(["read_file", "list_files", "search_files"]);

/** A path, normalized for a prefix test on the platform it belongs to:
 * forward slashes, no trailing slash, case folded on Windows and macOS
 * (case-insensitive file systems). Null when it is not absolute or has a
 * `.` or `..` segment (a traversal never counts as inside). */
export function normalizedDestinationPath(path: string, platform: "darwin" | "win32" | "linux"): string | null {
  if (typeof path !== "string" || !path.trim() || /[\0\r\n]/.test(path)) return null;
  let value = path.trim();
  if (platform === "win32") {
    value = value.replace(/\\/g, "/");
    if (/^\/\/[?.]\//.test(value)) value = value.slice(4);
    if (!/^[a-zA-Z]:\//.test(value)) return null;
  } else if (!value.startsWith("/")) return null;
  const segments = value.split("/");
  const head = segments.shift()!;
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === "") continue;
    if (segment === "." || segment === "..") return null;
    kept.push(segment);
  }
  const joined = `${head}/${kept.join("/")}`;
  return platform === "linux" ? joined : joined.toLowerCase();
}

/** Whether a call only reads the person's own attachments on their own
 * destination: a read tool (read_file, list_files, search_files) whose path
 * is inside one of `roots` (the attachments folder Sagax staged their files
 * in: the desktop app's own folder on their computer, /workspace/attachments
 * in their server environment). A Windows short name (BOBSMI~1) is compared
 * as written: the root is the folder the app itself reported, and the bot
 * sees the path Sagax staged under it. Arguments that cannot be read, a
 * missing path, a relative path or a traversal are not a read of the
 * attachments (fail closed: the card shows). */
export function ownAttachmentRead(input: {
  tool: string | undefined;
  input: string | undefined;
  /** Each root with the server whose tools reach it: a folder of the
   * person's computer is never a path of their server environment. */
  roots: ReadonlyArray<{ server: string; path: string; platform: "darwin" | "win32" | "linux" }>;
}): boolean {
  const match = /^(?:mcp__)?([a-z][a-z-]{0,63})__([a-z][a-z0-9_]{0,63})$/.exec(input.tool?.trim() ?? "");
  if (!match || !ATTACHMENT_READ_TOOLS.has(match[2]!)) return false;
  if (match[1] !== USER_SANDBOX_MCP_NAME && match[1] !== DESKTOP_BRIDGE_MCP_NAME) return false;
  if (match[1] === USER_SANDBOX_MCP_NAME && match[2] === "search_files") return false;
  let args: unknown;
  try { args = JSON.parse(input.input ?? ""); } catch { return false; }
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const path = (args as Record<string, unknown>).path;
  if (typeof path !== "string") return false;
  const server = match[1]!;
  return input.roots.some((root) => {
    if (root.server !== server) return false;
    const base = normalizedDestinationPath(root.path, root.platform);
    const target = normalizedDestinationPath(path, root.platform);
    if (!base || !target) return false;
    return target === base || target.startsWith(base.endsWith("/") ? base : `${base}/`);
  });
}
