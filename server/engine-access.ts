// Who a turn speaks for on an organization server, and the cards and
// approvals around engine access (slice 3, D13). Which credentials a turn
// runs with is server/engine-credentials.ts (the person who speaks pays;
// the bot's routines run on its owner's credentials).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 bis ("Où vivent les accès aux engines", "Échecs visibles").

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { memberOwnScopeTool, ownAct, builtinAgentToolName } from "./member-tool-scope.ts";
import { READABLE_HIDDEN_SEGMENTS } from "../shared/readable-hidden.ts";
import { dataToolName, foreignToolSpelling } from "./sagax-internal-tools.ts";

export type EngineAccessRefusal = "engine_missing" | "no_access";

/** Who a turn speaks for, stated by the path that starts it (the gate
 * never guesses the owner from a missing speaker):
 *   - person: a person's message; with no principal id the person is
 *     unknown and never counts as the owner;
 *   - operator: the operator at this computer (a loopback request);
 *   - owner-routine: a routine, webhook or other automation; `principalId`
 *     is the person it runs as (slice 6: its runAs), absent the owner;
 *   - peer: another bot's hop (ask_bot, delegation, an opened thread, an
 *     aside, a Primary Bot's retry). `principalId` is whoever the source turn spoke
 *     for ("" when that was an unknown person); absent, the requesting bot's
 *     owner speaks. `routinePayer` (2026-10-01): on a routine's hop, whose
 *     credentials the routine runs on (its bot's owner), carried along the
 *     hops. `routine` marks a hop a routine or other automation
 *     started, directly or through other hops: from slice 6 it reaches
 *     Perspicax only through the routine delegation of the person it speaks
 *     for, never through a sign-in. */
/** A server-created reference to the routine authorizing an unattended turn.
 * It identifies permission lineage, never the trust of event data. */
export interface RoutineOwnerAuthorization {
  runId: string;
  routineId: string;
  botId: string;
  principalId: string;
}

export type TurnSpeaker =
  /** `groupId`: the group the person writes in, whose "who pays" override
   * for the bot applies (shared/turn-payer.ts). */
  | { origin: "person"; principalId?: string; groupId?: string }
  | { origin: "operator" }
  | { origin: "owner-routine"; principalId?: string }
  /** `routineTrigger`: what started the routine a `routine` hop descends
   * from ("schedule", "manual", "webhook"), when known. */
  | { origin: "peer"; fromBotId?: string; principalId?: string; routine?: true; routinePayer?: string; routineTrigger?: string; routineOwnerAuthorization?: RoutineOwnerAuthorization };

/** A turn a routine or other automation started, directly or through hops. */
export function routineLineage(speaker: TurnSpeaker): boolean {
  return speaker.origin === "owner-routine" || (speaker.origin === "peer" && speaker.routine === true);
}

/** The speaker a turn start implies when its path did not state one. Fails
 * closed: nothing known about the speaker is an unknown person. */
export function resolveTurnSpeaker(input: {
  speaker?: TurnSpeaker;
  sender?: { id?: string };
  peerAsk?: { botId: string };
  trigger?: { kind: string };
  automationSource?: string;
}): TurnSpeaker {
  if (input.speaker) return input.speaker;
  if (input.peerAsk) return { origin: "peer", fromBotId: input.peerAsk.botId };
  if (input.sender?.id) return { origin: "person", principalId: input.sender.id };
  if (input.automationSource || input.trigger?.kind === "routine") return { origin: "owner-routine" };
  if (input.trigger?.kind === "owner") return { origin: "operator" };
  return { origin: "person" };
}

/** The principal a turn speaks for: "" when unknown (never the owner). A
 * peer hop with no known source speaks for the requesting bot's owner. */
export function speakerPrincipal(speaker: TurnSpeaker, ownerPrincipalId: string, peerOwnerPrincipalId?: string): string {
  switch (speaker.origin) {
    case "person": return speaker.principalId ?? "";
    case "operator": return ownerPrincipalId;
    case "owner-routine": return speaker.principalId ?? ownerPrincipalId;
    case "peer": return speaker.principalId ?? peerOwnerPrincipalId ?? "";
  }
}

/** The notification body for a refused turn (never provider text). A
 * no_access turn is the payer's to fix: the person who speaks, or the
 * owner for the bot's routines (engine-credentials.ts). */
export function engineAccessNotice(reason: EngineAccessRefusal | "key_refused", engine: string, refusal: { payer?: "speaker" | "owner"; cause?: "payer_disabled" | "no_credentials" | "server_engine_not_allowed" | "owner_model_offline" | "sign_in_expired"; routine?: boolean; ownerName?: string } = {}): string {
  if (reason === "engine_missing") return `This bot uses ${engine}, which is not installed on this server.`;
  if (refusal.cause === "sign_in_expired") return `Your ${engine} sign-in has expired. Reconnect ${engine} to keep using this bot.`;
  if (refusal.cause === "owner_model_offline") return `${refusal.ownerName?.trim() || "The owner"}'s model isn't reachable right now.`;
  if (reason === "key_refused") return "The provider refused this bot's key.";
  if (refusal.cause === "payer_disabled") {
    return refusal.routine || refusal.payer === "owner"
      ? `This bot can't run: its owner's account is disabled, so their ${engine} access is off.`
      : `This bot can't answer: your account is disabled.`;
  }
  if (refusal.cause === "server_engine_not_allowed") {
    return refusal.routine
      ? `This routine can't run: the organization has not given its owner ${engine} on its account. Their own subscription or key would serve it, or an admin can give it in Perspicax.`
      : `Your organization has not given you ${engine} on its account: sign in with your own ${engine} subscription or add your key in Perspicax, or ask an admin.`;
  }
  if (refusal.routine) return `This routine can't run: its owner has no ${engine} subscription or key here, and the server has no organization key for it.`;
  return `No ${engine} access for this turn: sign in with your own ${engine} subscription or add your key in Perspicax, or ask an admin to set the organization's key.`;
}

/** A bot owned by someone who is not an organization admin (rule until
 * per-owner containers): it never runs with full access, and its server
 * commands need an admin's approval. */
export function memberOwnedBot(input: { identity: "solo" | "perspicax"; ownerOrgRole: "admin" | "member" | undefined }): boolean {
  return input.identity === "perspicax" && input.ownerOrgRole !== "admin";
}

/** An approval card that would run a command on the server: the provider
 * described a shell command, or the tool is a shell or exec tool. */
export function serverCommandApproval(input: { tool?: string; command?: unknown }): boolean {
  if (input.command) return true;
  const tool = input.tool?.trim() ?? "";
  return /^(bash|shell|sh|exec|execute|exec_command|run_command|run_shell_command|local_shell|terminal)$/i.test(tool) || /(^|[_.:])(bash|shell|exec)([_.:]|$)/i.test(tool);
}

/** File tools an owner may approve for their own bot when every path stays
 * in the bot's own task workspace. */
const WORKSPACE_FILE_TOOLS = new Set(["read", "write", "edit", "multiedit", "notebookedit", "notebookread", "glob", "grep", "ls"]);
/** The ones that only read. */
const READ_ONLY_FILE_TOOLS = new Set(["read", "notebookread", "glob", "grep", "ls"]);
/** #1169: Sagax's own file-view tools ("<bot> wants to view files"), as an
 * MCP server spells them: a read of the bot's own folders is the owner's,
 * like a native Read there. */
const MCP_FILE_VIEW_TOOL = /^(?:mcp__)?(?:sagax-environment|sagax-desktop|files)__(read_file|list_files|search_files)$/i;

/** The path a file-view MCP call names in its arguments, when absolute. */
export function fileViewToolPaths(tool: string | undefined, input: string | undefined): string[] {
  if (!MCP_FILE_VIEW_TOOL.test(tool?.trim() ?? "")) return [];
  let args: unknown;
  try { args = JSON.parse(input ?? ""); } catch { return []; }
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const path = (args as Record<string, unknown>).path;
  return typeof path === "string" && isAbsolute(path) ? [path] : [];
}

/** A path's real location: the deepest existing ancestor resolved through
 * its symlinks, then the part that does not exist yet. */
function realLocation(path: string): string {
  const absolute = resolve(path);
  let head = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail.reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return absolute;
      tail.push(basename(head));
      head = parent;
    }
  }
}

/** Built-in MCP servers that act on the shared host (its desktop, its
 * browser, its files, a shell): never the owner's to approve. */
export const HOST_LEVEL_MCP_SERVERS: ReadonlySet<string> = new Set([
  "computer", "sagax-computer", "sagax-desktop", "sagax-environment", "browser", "shell", "files", "terminal",
]);

/** Engine tools that never touch the host: a web search runs at the
 * provider, the task list is the turn's own. */
const OWNER_SCOPED_BUILTINS = new Set(["websearch", "web_search", "todowrite", "todo_write"]);

/** 2026-10-14: a tool within the owner's own rights (spec
 * 2026-10-14-bot-owner-permissions.md, section 2): an owner-scoped built-in,
 * or a tool of an MCP server that acts through the owner's identity
 * elsewhere and is not a host-level built-in. */
export function ownerScopedTool(tool: string, ownerScopedMcpServer?: (server: string) => boolean): boolean {
  if (OWNER_SCOPED_BUILTINS.has(tool.toLowerCase())) return true;
  const match = /^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_.-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(tool);
  if (!match || !ownerScopedMcpServer) return false;
  const server = match[1]!;
  if (HOST_LEVEL_MCP_SERVERS.has(server.toLowerCase()) || server.toLowerCase() === "agents") return false;
  return ownerScopedMcpServer(server);
}

/** 2026-10-16 (hotfix 0.5.10): a claude.ai connector (`claude_ai_<Service>`)
 * acts as the account the turn runs on. On an organization server those
 * connectors are mounted only when the turn runs on the speaker's own Claude
 * subscription (harness-connectors.ts claudeAiConnectorsForTurn), so they are
 * that person's own rights, like a personal connection: the owner answers
 * the card, not an admin. On any other access they are nobody's. */
export function claudeAiOwnerScopedServer(server: string, via: string | undefined): boolean {
  return via === "subscription" && /^claude_ai_[A-Za-z0-9]/i.test(server);
}

/** 2026-10-28 (a member does everything in their own environment):
 * where a host-level agents tool call lands, as the harness knows it. */
export interface MemberHostToolPlace {
  /** The turn's Local VM is this bot's own (per-bot mode), never a VM the
   * server shares between bots or a pooled seat other people reuse. */
  ownLocalVm: boolean;
  /** shared_computer reaches only the speaking person's own computers on
   * this server, and that person owns the bot (organization server). */
  ownComputers: boolean;
  /** add_mcp_server adds to the speaking person's own server list (a
   * remote URL of theirs, or a command in their own environment), never to
   * the server's shared list (organization server). */
  ownMcpList: boolean;
  /** The bot's own folders (its task workspaces, its workspace). */
  botRoots: readonly string[];
}

/** The Local VM's workspace as a bot names it (agents-catalog attach_file). */
const VM_GUEST_WORKSPACE = "/home/cua/workspace";

function argsOf(input: unknown): Record<string, unknown> | null {
  let raw = input;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

/** Whether a host-level agents tool call stays in the member's own
 * environment (2026-10-28): then it is the owner's card at their own level,
 * never an admin's. What would touch the shared server stays admin:
 *   vm_exec          the bot's own Local VM only
 *   shared_computer  the person's own computers only (the route lists the
 *                    speaker's own on an organization server)
 *   add_mcp_server   the person's own server list only
 *   attach_file      a file of the bot's own folders (no sensitive hidden
 *                    name, sensitiveHiddenSegment), or of
 *                    its own Local VM's workspace
 * api_reload and review_write (Perspicax admin) never are. */
export function memberOwnHostToolCall(tool: string | undefined, input: unknown, place: MemberHostToolPlace): boolean {
  switch (builtinAgentToolName(tool?.trim())) {
    case "vm_exec": return place.ownLocalVm;
    case "shared_computer": return place.ownComputers;
    case "add_mcp_server": return place.ownMcpList;
    case "attach_file": {
      const path = argsOf(input)?.path;
      if (typeof path !== "string" || !path.trim() || !isAbsolute(path)) return false;
      if (place.ownLocalVm && (path === VM_GUEST_WORKSPACE || path.startsWith(`${VM_GUEST_WORKSPACE}/`))
        && !path.split("/").some((segment) => segment === ".." || segment === ".")) return true;
      const real = realLocation(path);
      return place.botRoots.some((root) => {
        const rel = relative(realLocation(root), real);
        if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return false;
        return !rel.split(sep).some((segment) => sensitiveHiddenSegment(segment));
      });
    }
    default: return false;
  }
}

/** #1098 (2026-10-28): hidden names in a bot's workspace that stay an
 * admin's card, read or write. Every bot shares one container, one user and
 * one HOME, so these can run a command on the shared server (git hooks,
 * engine settings and hooks, MCP servers, plugin manifests, package manager
 * and shell start files, direnv) or hold a credential (keys, tokens, engine
 * logins). Compared without case (a case-insensitive disk opens `.Git` as
 * `.git`). Every other hidden name (.gitignore, .github, .vscode,
 * .editorconfig, .env.example...) is the owner's. */
const SENSITIVE_HIDDEN_NAMES: ReadonlySet<string> = new Set([
  // engines, their settings, hooks, MCP servers and logins
  ".claude", ".claude.json", ".claude-plugin", ".mcp.json", ".codex", ".grok", ".cursor", ".agents", ".hermes", ".gemini",
  ".credentials.json", ".pulsabot-login.json", ".agent-browser",
  // Sagax's own state in a workspace
  ".sagax", ".backups", ".openmausbot", ".revisions",
  // git: hooks, config and credentials
  ".git", ".gitconfig", ".git-credentials", ".githooks", ".husky",
  // package managers and shells that run code on install or start
  ".npmrc", ".yarnrc", ".yarnrc.yml", ".yarn", ".pnpmfile.cjs", ".envrc", ".bashrc", ".bash_profile", ".profile",
  ".zshrc", ".zshenv", ".zprofile",
  // keys, tokens and tool configuration of the shared HOME
  ".ssh", ".gnupg", ".netrc", ".pgpass", ".aws", ".azure", ".kube", ".docker", ".config", ".local", ".cache",
]);
const ENV_EXAMPLE = /^\.env\.(?:example|sample|template|dist)$/;

/** Whether a path segment is a hidden name that stays an admin's card. */
export function sensitiveHiddenSegment(segment: string): boolean {
  if (!segment.startsWith(".")) return false;
  const name = segment.toLowerCase();
  if (name === "." || name === "..") return true;
  if (SENSITIVE_HIDDEN_NAMES.has(name)) return true;
  // .env and its variants hold secrets; the documented templates do not
  return (name === ".env" || name.startsWith(".env.")) && !ENV_EXAMPLE.test(name);
}

/** Whether a permission card of a member's bot on an organization server
 * waits for an organization admin (rule until per-owner containers). Every
 * bot shares one container, one user and one HOME, so a write to the shared
 * Claude settings or a read of a secret is as good as a server command.
 * The owner answers only a file tool (Read, Write, Edit, ...) whose every
 * path is absolute and, symlinks resolved, stays inside the bot's own task
 * workspace outside a sensitive hidden name (sensitiveHiddenSegment:
 * .claude, .git, .mcp.json... can hold commands), and a built-in Sagax tool that stays in the member's own scope
 * (./member-tool-scope.ts: list_bots, the bot's threads, memory, its own
 * setup, messages to its own bots), and since 2026-10-14 a tool within the
 * owner's own rights (ownerScopedTool: a remote or personal MCP server, a
 * web search). Everything else, a shell command first, needs an admin. `tool` is the provider's own name for the tool, an MCP
 * tool qualified with its server (`agents__list_bots`), never the model's
 * arguments. */
export function memberBotAdminApproval(input: {
  tool?: string;
  command?: unknown;
  paths?: string[];
  workspaceRoot: string;
  /** #1169: more of the bot's own folders it may read without an admin
   * (its workspace, where send_prompt files land in inbox/). Reads only. */
  readRoots?: string[];
  /** 2026-10-14 (bot owner permissions): whether this MCP server acts
   * through its owner's identity elsewhere (a remote server mounted for the
   * bot, or a personal connection of the owner, which runs in their own
   * environment). Absent: no MCP server is. */
  ownerScopedMcpServer?: (server: string) => boolean;
  /** 2026-10-16: the call acts in the owner's own isolated environment
   * (member-environment.ts ownEnvironmentCall): the owner's work, never an
   * admin's. */
  ownEnvironment?: boolean;
  /** 2026-10-17: the servers of the turn that are not Sagax's own. A name
   * one of them could have spelled is never a built-in tool
   * (sagax-internal-tools.ts foreignToolSpelling). */
  foreignMcpServers?: Iterable<string>;
  /** 2026-10-19: the call acts on one of the owner's own destinations
   * (their server environment, their own computer or its Local VM) mounted
   * for this turn (member-environment.ts ownDestinationCall): the owner's
   * card at their own level, never an admin's, whatever the tool. */
  ownDestination?: boolean;
  /** 2026-10-19 (prod 0.5.27): Sagax's own computer_select, mounted for this
   * turn, choosing among the answerer's own places
   * (member-environment.ts ownComputerChoiceCall): never an admin's. */
  ownComputerChoice?: boolean;
  /** 2026-10-19: the owner holds `host.commands` (given in Perspicax): the
   * server commands of their own bots are theirs to approve. */
  ownerRunsServerCommands?: boolean;
  /** #1269: the raw input of an `act` call. */
  rawInput?: unknown;
  /** #1269: bots that belong to the member who owns the calling bot. */
  ownsBot?: (id: string) => boolean;
  /** #1269: the calling bot, for an `act` plugin list that omits botId. */
  callerBotId?: string;
  /** 2026-10-28: where a host-level agents tool lands for this turn
   * (memberOwnHostToolCall). Absent: none is the member's own. */
  hostPlace?: MemberHostToolPlace;
}): boolean {
  if (input.ownEnvironment || input.ownDestination || input.ownComputerChoice || input.ownerRunsServerCommands) return false;
  const builtin = !foreignToolSpelling(input.tool, input.foreignMcpServers ?? []);
  const toolName = input.tool?.trim();
  // #1269, #1098 (2026-10-28): act on the member's own bots and on routes
  // of their own environment, a write included, is their own card (it runs
  // as them, the route checks their rights). A call on someone else's bot,
  // or on a route that reaches the organization, still waits for an admin.
  // Judged before the own-scope list, which would otherwise let every act
  // through.
  if (!input.command && builtin && builtinAgentToolName(toolName) === "act"
    && !ownAct(toolName, input.rawInput, { ownsBot: input.ownsBot, callerBotId: input.callerBotId })) return true;
  // 2026-10-19 (member admin audit): a built-in tool of the member's own
  // scope is judged by its exact name before the shell pattern, which read
  // `agents__offer_shell_terminal` (a card the person approves) as a shell
  // command and sent the member's terminal offer to an admin.
  if (!input.command && builtin && memberOwnScopeTool(toolName)) return false;
  // 2026-10-28: vm_exec, shared_computer, attach_file and add_mcp_server
  // that stay in the member's own environment are the owner's card.
  if (!input.command && builtin && input.hostPlace && memberOwnHostToolCall(toolName, input.rawInput, input.hostPlace)) return false;
  if (serverCommandApproval(input)) return true;
  // 2026-10-16: the Data tools are the bot's own database, confined to its
  // own folders on an organization server (sagax-internal-tools.ts).
  if (builtin && dataToolName(input.tool)) return false;
  if (ownerScopedTool(input.tool?.trim() ?? "", input.ownerScopedMcpServer)) return false;
  const tool = input.tool?.trim().toLowerCase() ?? "";
  // #1169: Sagax's own file views (read_file, list_files, search_files) only
  // read, like a native Read: inside the bot's own folders they are the
  // owner's card, so the bot's level (Full included) answers them.
  const fileView = MCP_FILE_VIEW_TOOL.test(tool);
  if (!WORKSPACE_FILE_TOOLS.has(tool) && !fileView) return true;
  if (!input.paths?.length) return true;
  // 2026-10-19 (bot quality, cause A): a read may open the bot's own skill
  // revisions and plugin manifests (READABLE_HIDDEN_SEGMENTS). #1098
  // (2026-10-28): any other hidden name of the bot's own workspace
  // (.gitignore, .github, .vscode, .env.example...) is the owner's too; only
  // the names that run commands or hold credentials on the shared server
  // (sensitiveHiddenSegment) still wait for an admin.
  const reads = fileView || READ_ONLY_FILE_TOOLS.has(tool);
  const roots = [input.workspaceRoot, ...(reads ? input.readRoots ?? [] : [])].map(realLocation);
  return !input.paths.every((path) => {
    if (typeof path !== "string" || !isAbsolute(path)) return false;
    const real = realLocation(path);
    return roots.some((root) => {
      const rel = relative(root, real);
      if (rel === "") return true;
      if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return false;
      return !rel.split(sep).some((segment) => sensitiveHiddenSegment(segment) && !(reads && READABLE_HIDDEN_SEGMENTS.has(segment)));
    });
  });
}

/** A setup error from a key-backed engine on an organization server (the
 * provider refused the key: 401, invalid key, quota) becomes the
 * key_refused card instead of the generic error row. `redact` cleans the
 * provider's words, which only the owner and admins receive. Null when the
 * error is anything else. */
export function keyRefusedCard(input: {
  identity: "solo" | "perspicax";
  setup: boolean | undefined;
  claudeUpdate: boolean | undefined;
  keyBacked: boolean;
  message: string;
  botId: string;
  ownerPrincipalId: string;
  engine: string;
  redact: (text: string) => string;
  /** The person whose own key the turn ran on (slice 4): the card is theirs. */
  payerPrincipalId?: string;
}): { reason: "key_refused"; engine: string; botId: string; ownerPrincipalId: string; detail?: string; payerPrincipalId?: string } | null {
  if (input.identity !== "perspicax" || !input.setup || input.claudeUpdate || !input.keyBacked) return null;
  const detail = input.redact(input.message.trim()).slice(0, 200);
  return {
    reason: "key_refused", engine: input.engine, botId: input.botId, ownerPrincipalId: input.ownerPrincipalId,
    ...(detail ? { detail } : {}),
    ...(input.payerPrincipalId ? { payerPrincipalId: input.payerPrincipalId } : {}),
  };
}

/** What a viewer receives of an access card: `detail` (the provider's
 * redacted words) only for the bot's owner and organization admins. */
export function accessCardForViewer<T extends { access?: { ownerPrincipalId: string; detail?: string } }>(message: T, viewer: { principalId?: string; admin: boolean }): T {
  const access = message.access;
  if (!access?.detail || viewer.admin || (viewer.principalId && viewer.principalId.toLowerCase() === access.ownerPrincipalId.toLowerCase())) return message;
  const { detail: _hidden, ...rest } = access;
  return { ...message, access: rest };
}

/** Who an access card is for on an organization server (2026-10-01): the
 * person it is about, never the other members of the thread or room. A
 * no_access or engine_missing card goes to whose credentials the turn needed
 * (the person who spoke, or the bot's owner for its routines); a card
 * written before `payerPrincipalId` existed, or for an unknown speaker,
 * falls back to the bot's owner, whose credentials those turns used. A paused
 * routine goes to the person it runs as and the bot's owner. key_refused is
 * private only when the refused key was a person's own (`payerPrincipalId`);
 * the organization's key concerns everyone, so that card stays shared (its
 * provider words still go to the owner and admins only). Null: shared. */
export function accessCardAudience(access: { reason: string; ownerPrincipalId: string; payerPrincipalId?: string; runAsPrincipalId?: string; ownerPays?: boolean; speakerPrincipalId?: string }): string[] | null {
  const ids = (list: Array<string | undefined>) => {
    const out: string[] = [];
    for (const id of list) {
      const trimmed = id?.trim();
      if (trimmed && !out.some((seen) => seen.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
    }
    return out;
  };
  if (access.reason === "routine_delegation") return ids([access.runAsPrincipalId, access.ownerPrincipalId]);
  if (access.reason === "key_refused") return access.payerPrincipalId?.trim() ? ids([access.payerPrincipalId]) : null;
  // #1137: the owner pays, so the person who wrote learns why too.
  return ids([access.payerPrincipalId || access.ownerPrincipalId, access.ownerPays ? access.speakerPrincipalId : undefined]);
}

/** The notifications of a refused or paused routine run, split by who can
 * open the thread its access card sits in (2026-10-01). A routine runs as a
 * person, in that person's private thread, but its card may be for the bot's
 * owner (The owner's credentials pay): the owner cannot read that thread, so
 * The owner's copy names no thread and carries `routineRunId`, which opens
 * the run in the bot's Coding activity (the same card, its audience only).
 * Without an audience (a shared card) or a run, it is one notification, as
 * before. */
export function routineAccessNotifications<N extends { threadId: string; audience?: string[]; routineRunId?: string }>(
  notification: N,
  audience: string[] | null,
  input: { routineRunId?: string; readable: (principalId: string) => boolean },
): N[] {
  if (!audience) return [notification];
  if (!input.routineRunId) return [{ ...notification, audience }];
  const readers = audience.filter((id) => input.readable(id));
  const others = audience.filter((id) => !readers.includes(id));
  const out: N[] = [];
  if (readers.length) out.push({ ...notification, audience: readers });
  if (others.length) out.push({ ...notification, threadId: "", routineRunId: input.routineRunId, audience: others });
  return out;
}

/** Whether a stored row reaches this viewer: an access card only reaches its
 * audience (accessCardAudience); every other row is unchanged. An empty
 * audience reaches nobody. */
export function accessCardVisibleTo(message: { kind?: unknown; access?: { reason: string; ownerPrincipalId: string; payerPrincipalId?: string; runAsPrincipalId?: string; ownerPays?: boolean; speakerPrincipalId?: string } }, viewerId: string | undefined | null): boolean {
  if (message.kind !== "access" || !message.access) return true;
  const audience = accessCardAudience(message.access);
  if (!audience) return true;
  const viewer = viewerId?.trim().toLowerCase();
  return Boolean(viewer) && audience.some((id) => id.toLowerCase() === viewer);
}

/** Who may answer a card on an organization server: "admin" lets an
 * organization admin answer an adminApproval card without being the bot's
 * owner; "refused" is anyone else on such a card (The owner included:
 * 403 admin_approval_required); null is every other card, answered as
 * before. A card already settled is no longer an admin approval. */
export function adminApprovalDecision(input: {
  identity: "solo" | "perspicax";
  card: { adminApproval?: boolean; answered?: unknown; dismissed?: unknown; expired?: unknown } | null | undefined;
  callerIsOrgAdmin: boolean;
}): "admin" | "refused" | null {
  const card = input.card;
  if (input.identity !== "perspicax" || !card?.adminApproval || card.answered || card.dismissed || card.expired) return null;
  return input.callerIsOrgAdmin ? "admin" : "refused";
}

const EMAIL_IN_NAME = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** #1533: the engine name a member reads. An admin may name a second
 * account's engine after its email address; a member is never shown an
 * address, only the engine's own name and that it is another account. An
 * admin reads the name as it was saved. Pure. */
export function engineNameForViewer(name: string, driverName: string, admin: boolean): string {
  if (admin || !EMAIL_IN_NAME.test(name)) return name;
  return `${driverName} (other account)`;
}

/** #1533 (2026-10-28): the name a member reads for an engine that runs
 * only on the organization's API key (Claude, Grok, OpenAI...): the
 * provider and who pays, "Claude (organization key)", in their language.
 * An admin reads the name as it was saved. Pure. */
export function orgKeyEngineName(provider: string, language: string): string {
  return language.trim().toLowerCase().startsWith("fr") ? `${provider} (clé de l'organisation)` : `${provider} (organization key)`;
}

/** #1533: the provider an API-key engine is named after: Claude, Grok, else
 * its own saved name without "(API key)" (OpenAI, OpenRouter). Pure. */
export function keyEngineProvider(driver: string, savedName: string): string {
  if (driver === "claudeAgent") return "Claude";
  if (driver === "grok") return "Grok";
  return savedName.replace(/\s*\((?:api key|clé api)\)\s*$/i, "").trim() || savedName;
}

/** #1533: Claude Code words when its OAuth sign-in was refused and could not
 * be refreshed ("Failed to authenticate: OAuth session expired and could not
 * be refreshed", `authentication_failed`), plus the canonical reconnect
 * sentence (`CLAUDE_SIGN_IN_EXPIRED`) and used-up extra-usage credits. */
const CLAUDE_SIGN_IN_REFUSED = /Claude's sign-in has expired|Reconnect Claude|oauth session expired|could not be refreshed|failed to authenticate|authentication_failed|oauth token (?:has )?expired|invalid (?:oauth|bearer) token|not logged in|please run \/login|runs on extra usage for your account, and those credits are used up/i;

/** #1759: Codex ChatGPT refusals (same shapes as `codexSignInRefused` /
 * `CODEX_SIGN_IN_EXPIRED`) and Grok ACP account refusals
 * (`invalid_credentials`, `inactive_subscription`, and the sentences
 * `describeGrokAccountError` emits). Kept as plain regex so this module
 * stays free of driver imports. */
const CODEX_GROK_SIGN_IN_REFUSED = /ChatGPT sign-in has expired|Codex isn't signed in|workspace routing discovery unauthorized|ChatGPT login is required|auth data is not available|please (?:log out and )?sign in again|access token could not be refreshed|authentication session could not be refreshed|\binvalid_credentials\b|\binactive_subscription\b|Sign in to Grok again|Reconnect Grok|Grok sign-in or xAI key it runs on was rejected|Grok account it runs on has no active subscription|Grok is not signed in to your grok\.com account/i;

/** #1533 / #1759: a subscription engine's own sign-in was refused. Pure. */
export function subscriptionSignInRefused(message: string): boolean {
  if (!message) return false;
  return CLAUDE_SIGN_IN_REFUSED.test(message) || CODEX_GROK_SIGN_IN_REFUSED.test(message);
}

/** #1533 / #1759: the access card for a turn that ran on the speaker's own
 * subscription (organization server) and that the provider refused because
 * the sign-in expired: "Reconnect Claude / Codex / Grok" for that person,
 * instead of the engine's raw words. Null for anything else (a key, the
 * organization's key, a solo server, another error). Pure. */
export function signInExpiredCard(input: {
  identity: "solo" | "perspicax";
  via: string | undefined;
  subscriptionDriver: boolean;
  message: string;
  payerPrincipalId: string | undefined;
  botId: string;
  botName?: string;
  ownerPrincipalId: string;
  engine: string;
  routine?: boolean;
}): { reason: "no_access"; cause: "sign_in_expired"; engine: string; botId: string; ownerPrincipalId: string; payerPrincipalId: string; subscriptionSignIn: true; botName?: string; routine?: true } | null {
  if (input.identity !== "perspicax" || input.via !== "subscription" || !input.subscriptionDriver || !input.payerPrincipalId) return null;
  if (!subscriptionSignInRefused(input.message)) return null;
  return {
    reason: "no_access", cause: "sign_in_expired", engine: input.engine, botId: input.botId, ownerPrincipalId: input.ownerPrincipalId,
    payerPrincipalId: input.payerPrincipalId, subscriptionSignIn: true,
    ...(input.botName?.trim() ? { botName: input.botName.trim().slice(0, 200) } : {}),
    ...(input.routine ? { routine: true as const } : {}),
  };
}
