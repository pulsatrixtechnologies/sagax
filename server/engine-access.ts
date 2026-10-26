// Who a turn speaks for on an organization server, and the cards and
// approvals around engine access (slice 3, D13). Which credentials a turn
// runs with is server/engine-credentials.ts (the person who speaks pays;
// the bot's routines run on its owner's credentials).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 bis ("Où vivent les accès aux engines", "Échecs visibles").

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { memberOwnScopeTool } from "./member-tool-scope.ts";
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
export type TurnSpeaker =
  | { origin: "person"; principalId?: string }
  | { origin: "operator" }
  | { origin: "owner-routine"; principalId?: string }
  | { origin: "peer"; fromBotId?: string; principalId?: string; routine?: true; routinePayer?: string };

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
export function engineAccessNotice(reason: EngineAccessRefusal | "key_refused", engine: string, refusal: { payer?: "speaker" | "owner"; cause?: "payer_disabled" | "no_credentials" | "server_engine_not_allowed"; routine?: boolean } = {}): string {
  if (reason === "engine_missing") return `This bot uses ${engine}, which is not installed on this server.`;
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

/** A bot owned by someone who is not an organization admin (JC rule until
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

/** Whether a permission card of a member's bot on an organization server
 * waits for an organization admin (JC rule until per-owner containers). Every
 * bot shares one container, one user and one HOME, so a write to the shared
 * Claude settings or a read of a secret is as good as a server command.
 * The owner answers only a file tool (Read, Write, Edit, ...) whose every
 * path is absolute and, symlinks resolved, stays inside the bot's own task
 * workspace outside any dot folder (.claude, .git, .mcp.json can hold
 * commands), and a built-in Sagax tool that stays in the member's own scope
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
  /** 2026-10-19 (JC): the call acts on one of the owner's own destinations
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
}): boolean {
  if (input.ownEnvironment || input.ownDestination || input.ownComputerChoice || input.ownerRunsServerCommands) return false;
  const builtin = !foreignToolSpelling(input.tool, input.foreignMcpServers ?? []);
  // 2026-10-19 (member admin audit): a built-in tool of the member's own
  // scope is judged by its exact name before the shell pattern, which read
  // `agents__offer_shell_terminal` (a card the person approves) as a shell
  // command and sent the member's terminal offer to an admin.
  if (!input.command && builtin && memberOwnScopeTool(input.tool?.trim())) return false;
  if (serverCommandApproval(input)) return true;
  // 2026-10-16: the Data tools are the bot's own database, confined to its
  // own folders on an organization server (sagax-internal-tools.ts).
  if (builtin && dataToolName(input.tool)) return false;
  if (ownerScopedTool(input.tool?.trim() ?? "", input.ownerScopedMcpServer)) return false;
  const tool = input.tool?.trim().toLowerCase() ?? "";
  if (!WORKSPACE_FILE_TOOLS.has(tool)) return true;
  if (!input.paths?.length) return true;
  const root = realLocation(input.workspaceRoot);
  // 2026-10-19 (bot quality, cause A): a read may open the bot's own skill
  // revisions and plugin manifests (READABLE_HIDDEN_SEGMENTS); every other
  // dot folder, and any write into a dot folder, still waits for an admin.
  const reads = READ_ONLY_FILE_TOOLS.has(tool);
  return !input.paths.every((path) => {
    if (typeof path !== "string" || !isAbsolute(path)) return false;
    const rel = relative(root, realLocation(path));
    if (rel === "") return true;
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return false;
    return !rel.split(sep).some((segment) => segment.startsWith(".") && !(reads && READABLE_HIDDEN_SEGMENTS.has(segment)));
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
export function accessCardAudience(access: { reason: string; ownerPrincipalId: string; payerPrincipalId?: string; runAsPrincipalId?: string }): string[] | null {
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
  return ids([access.payerPrincipalId || access.ownerPrincipalId]);
}

/** The notifications of a refused or paused routine run, split by who can
 * open the thread its access card sits in (2026-10-01). A routine runs as a
 * person, in that person's private thread, but its card may be for the bot's
 * owner (the owner's credentials pay): the owner cannot read that thread, so
 * the owner's copy names no thread and carries `routineRunId`, which opens
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
export function accessCardVisibleTo(message: { kind?: unknown; access?: { reason: string; ownerPrincipalId: string; payerPrincipalId?: string; runAsPrincipalId?: string } }, viewerId: string | undefined | null): boolean {
  if (message.kind !== "access" || !message.access) return true;
  const audience = accessCardAudience(message.access);
  if (!audience) return true;
  const viewer = viewerId?.trim().toLowerCase();
  return Boolean(viewer) && audience.some((id) => id.toLowerCase() === viewer);
}

/** Who may answer a card on an organization server: "admin" lets an
 * organization admin answer an adminApproval card without being the bot's
 * owner; "refused" is anyone else on such a card (the owner included:
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
