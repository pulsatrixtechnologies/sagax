// Security keys for sensitive approvals (wave 2, package E).
//
// A person may ask that some kinds of approval need one of their security
// keys or passkeys (WebAuthn) on top of the tap: Settings > Security. The
// server classes the card, finds which of those classes the person chose,
// and refuses the Allow unless it carries a step-up that this person's key
// signed for exactly this card, its content and this answer, once, within a
// short time. Without a key that can answer here, the Allow is refused; it
// is never let through silently.
//
// Pure: no clock, no disk, no node built-ins. The server gives the risks it
// read from the call (shared/custom-rules.ts callFacts).

import { canonicalJson } from "./canonical-json.ts";
import { readShell, type RiskClass } from "./custom-rules.ts";
import type { OptionCardData } from "./wire.ts";

export { canonicalJson };

export const STEP_UP_CLASSES = [
  "destructive",
  "irreversible",
  "money",
  "external-send",
  "always-grant",
  "publish-page",
  "rule-change",
] as const;
export type StepUpClass = (typeof STEP_UP_CLASSES)[number];

export function isStepUpClass(value: unknown): value is StepUpClass {
  return typeof value === "string" && (STEP_UP_CLASSES as readonly string[]).includes(value);
}

/** What the person answers besides Allow: each one can widen what the
 * answer does, so the step-up is bound to it too. */
export interface StepUpAnswer {
  /** "Always allow this session" (the provider keeps the allow). */
  always?: boolean;
  /** Remember the exact command for this bot. */
  rememberCommand?: boolean;
  /** Save the card's owner rule (Always allow / Always deny). */
  rule?: "allow" | "deny" | null;
  /** The bot's standing grant (allowKey) saved with this answer. */
  alwaysAllowKey?: string | null;
}

/** What a step-up is asked for. The server recomputes what it binds to
 * from the live card or from the change itself; the client's words are
 * never trusted beyond naming it. */
export type StepUpTarget =
  | { kind: "approval"; threadId: string; requestId: string; answer?: StepUpAnswer }
  | { kind: "settings"; action: StepUpSettingsAction; detail: Record<string, unknown> };

/** The settings changes a step-up can authorize. Each one loosens a
 * protection, or touches the keys themselves. */
export const STEP_UP_SETTINGS_ACTIONS = [
  "security-keys.add",
  "security-keys.remove",
  "security-keys.classes",
  "custom-rules.allow",
  "approval-rules.allow",
  /** A bot's or a thread's approval level made looser (Ask to Auto, Full...). */
  "approval-mode",
  /** An exact command saved so a bot runs it without asking. */
  "command-allowlist",
  /** Someone added to a bot's allowed recipients (shared/allowed-recipients.ts):
   * the bot then writes to them without asking. */
  "allowed-recipients",
  /** A deny or ask rule removed, turned off or made to allow less; an owner
   * rule removed or widened to every bot. */
  "rules.remove",
  /** The credential vault's values taken out in a file (Settings >
   * Credentials, Export): the key whenever the person has one. */
  "credentials.export",
  /** Allow a purchase with a saved card. The key when "money" is chosen. */
  "purchase.allow",
] as const;
export type StepUpSettingsAction = (typeof STEP_UP_SETTINGS_ACTIONS)[number];

export function isStepUpSettingsAction(value: unknown): value is StepUpSettingsAction {
  return typeof value === "string" && (STEP_UP_SETTINGS_ACTIONS as readonly string[]).includes(value);
}

/** The settings action each class protects (Settings pages that loosen a
 * rule need the key when "rule-change" is chosen). The key settings
 * themselves need a key whenever the person has one. */
export const SETTINGS_ACTION_CLASS: Readonly<Record<StepUpSettingsAction, StepUpClass | null>> = {
  "security-keys.add": null,
  "security-keys.remove": null,
  "security-keys.classes": null,
  "custom-rules.allow": "rule-change",
  "approval-rules.allow": "rule-change",
  "approval-mode": "rule-change",
  "command-allowlist": "always-grant",
  "allowed-recipients": "always-grant",
  "rules.remove": "rule-change",
  "credentials.export": null,
  "purchase.allow": "money",
};

/** Approval levels by how much runs without asking. Custom is a provider
 * config the app cannot read: any move to it, or from it to Full, loosens. */
const MODE_RANK: Readonly<Record<string, number>> = { ask: 0, edits: 1, auto: 2, full: 3, custom: 3 };

/** Whether going from one approval level to another lets more run unasked. */
export function approvalModeLoosens(from: string | undefined, to: string): boolean {
  const before = from ?? "ask";
  if (before === to) return false;
  if (to === "custom" || (to === "full" && before === "custom")) return true;
  return (MODE_RANK[to] ?? 3) > (MODE_RANK[before] ?? 0);
}

/** What a bot asked to do through act, as the step-up reads it. */
export interface BotActTargetLike {
  kind: "route" | "ui";
  method?: string;
  path?: string;
  write?: boolean;
  /** A screen command's name (createRoutine, deleteRoutine...). */
  command?: string;
}

const ROUTINE_PATH = /^\/api\/routines(?:\/|$)/;
const ROUTINE_GRANT_COMMANDS = new Set(["createRoutine", "updateRoutine", "runRoutine"]);

const SEND_PATH = /\/(?:messages|send|mail|email[\w-]*|nudges|invite[\w-]*|share[\w-]*|publish[\w-]*)(?:\/|$)/i;

/** A bot act's classes: a delete is destructive, a send reaches outside, and
 * any other write is in a class too (irreversible), since the act names a
 * route the step-up cannot read. Unknown (expired) fails closed. */
export function botActClasses(target: BotActTargetLike | undefined): StepUpClass[] {
  if (!target) return ["irreversible"];
  const out = new Set<StepUpClass>();
  const method = (target.method ?? "").toUpperCase();
  const write = target.kind === "route" ? method !== "GET" && method !== "HEAD" : target.write !== false;
  if (!write) return [];
  if (method === "DELETE") out.add("destructive");
  // a routine runs later without asking: a standing grant; removing one is a delete
  if (target.kind === "route" && target.path && ROUTINE_PATH.test(target.path)) out.add(method === "DELETE" ? "destructive" : "always-grant");
  if (target.kind === "ui" && target.command && ROUTINE_GRANT_COMMANDS.has(target.command)) out.add("always-grant");
  if (target.kind === "ui" && target.command === "deleteRoutine") out.add("destructive");
  if (target.path && SEND_PATH.test(target.path)) out.add("external-send");
  if (target.path && PUBLISH_TOOL.test(target.path.replace(/\//g, "_"))) out.add("publish-page");
  out.add("irreversible");
  return STEP_UP_CLASSES.filter((name) => out.has(name));
}

/** The facts of a shell call that matter to a step-up. */
export interface ShellFactsLike {
  command?: string;
  pureRead?: boolean;
  opaque?: boolean;
  risks: readonly RiskClass[];
}

/** The call's risk classes: the rules' own, and for a shell command that is
 * not a plain read (or cannot be read at all: `bash -c "$(...)"`,
 * `python3 -c`, `node -e`), destructive and irreversible. When in doubt a
 * command is in a class. */
export function riskClassesFromFacts(facts: ShellFactsLike): RiskClass[] {
  const out = new Set<RiskClass>(facts.risks);
  if (facts.command !== undefined && (facts.opaque === true || facts.pureRead !== true)) {
    out.add("destructive");
    out.add("irreversible");
  }
  return [...out];
}

/** The refusal a route answers when a step-up is needed or failed. */
export interface StepUpRefusal {
  error: string;
  code: "step_up_required" | "step_up_failed" | "step_up_unavailable";
  /** The classes that asked for the key. */
  classes: StepUpClass[];
  /** Why a presented step-up did not count. */
  reason?: StepUpFailure;
  /** What to ask a step-up for, so a client can start it and try again. */
  target?: StepUpTarget;
}

export type StepUpFailure =
  | "missing"
  | "expired"
  | "not-verified"
  | "wrong-person"
  | "wrong-target"
  | "used"
  | "unreadable";

/** One registered key as the app sees it: never its public key. */
export interface SecurityKeyView {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  /** The address the key answers on (WebAuthn RP ID). */
  rpId: string;
  /** "multiDevice": a synced passkey; "singleDevice": a hardware key or a
   * passkey kept on one device. */
  deviceType?: "singleDevice" | "multiDevice";
  backedUp?: boolean;
}

export interface SecurityKeysState {
  keys: SecurityKeyView[];
  classes: StepUpClass[];
  /** The address keys made here answer on, or null when this page cannot
   * use WebAuthn (an IP address, plain http off this computer). */
  rpId: string | null;
  /** The saved keys could not be read: every chosen class refuses. */
  unreadable?: boolean;
  /** No key yet and this sign-in is too old to add the first one: sign in
   * again first (the register route answers `reauth_required`). */
  needsSignIn?: boolean;
}

/** The fields of a card that say what an Allow would do. Status fields
 * (answered, held, who answered...) are left out: they change while the
 * card waits without changing the action. */
const CARD_CONTENT_FIELDS = [
  "requestId",
  "requestType",
  "tool",
  "mcpTool",
  "toolInput",
  "toolHints",
  "title",
  "subtitle",
  "allowKey",
  "allowSession",
  "ownerRule",
  "ownerRuleFolder",
  "commandAllowlist",
  "approvalScope",
  "adminApproval",
  "outboundRequest",
  "teamMemoryRequest",
  "routineRequest",
  "profileRequest",
  "modelRequest",
  "ruleRequest",
  "teamSetupRequest",
  "skillRequest",
  "botActRequest",
  "confidentialMemoryRequest",
  "terminalRequest",
  "cwActionRequest",
  "customRuleCandidate",
] as const satisfies ReadonlyArray<keyof OptionCardData>;

/** The text whose hash binds a step-up to a card's content. */
export function cardContentText(card: OptionCardData): string {
  const picked: Record<string, unknown> = {};
  for (const field of CARD_CONTENT_FIELDS) {
    if (card[field] !== undefined) picked[field] = card[field];
  }
  // An email draft's status follows the send: only what it sends counts.
  if (card.emailSendRequest) {
    const { status: _status, error: _error, ...rest } = card.emailSendRequest as unknown as Record<string, unknown>;
    picked.emailSendRequest = rest;
  }
  return canonicalJson(picked);
}

/** The answer's parts that widen it, normalized (false and absent are one). */
export function normalizeAnswer(answer: StepUpAnswer | undefined): Required<Pick<StepUpAnswer, "always" | "rememberCommand">> & { rule: "allow" | "deny" | null; alwaysAllowKey: string | null } {
  return {
    always: answer?.always === true,
    rememberCommand: answer?.rememberCommand === true,
    rule: answer?.rule === "allow" || answer?.rule === "deny" ? answer.rule : null,
    alwaysAllowKey: typeof answer?.alwaysAllowKey === "string" && answer.alwaysAllowKey ? answer.alwaysAllowKey : null,
  };
}

const PUBLISH_TOOL = /(^|[_\-.])publish(es|ed|ing)?([_\-.]|$)/i;
const RULE_TOOL = /(^|[_\-.])(rules?|permissions?|polic(y|ies)|allowlist|approval[_\-.]?mode|permission[_\-.]?mode)([_\-.]|$)/i;
const READ_VERB = /^(get|list|read|search|find|query|describe|show|view|fetch|lookup)([_\-.]|$)/i;

function bareToolName(tool: string): string {
  const match = /^(?:mcp__)?[A-Za-z0-9][A-Za-z0-9_.-]*?__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(tool);
  return (match ? match[1]! : tool).trim();
}

function parsedInput(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a tool's name says it changes rules, permissions, policies or an
 * approval level (the "rule-change" class), as stepUpClassesForCard reads
 * it. Such a call never answers itself (server/auto-approve.ts). */
export function toolChangesRules(tool: string | undefined): boolean {
  if (!tool) return false;
  const bare = bareToolName(tool);
  return RULE_TOOL.test(bare) && !READ_VERB.test(bare);
}

/** The classes an Allow on this card falls in. `risks` are the call's
 * risk classes as the server read them (custom-rules callFacts); a card
 * that is no tool call passes none. Classes only ever add up: when in
 * doubt a card is in a class, never out of one. */
export function stepUpClassesForCard(
  card: OptionCardData,
  risks: readonly RiskClass[] = [],
  answer?: StepUpAnswer,
): StepUpClass[] {
  const out = new Set<StepUpClass>();
  for (const risk of risks) out.add(risk);
  if (card.plain?.risk === "destructive" || card.toolHints?.destructive === true) out.add("destructive");
  if (card.ownerRule?.destructive === "delete" || card.ownerRule?.destructive === "bulk") out.add("destructive");
  if (card.ownerRule?.destructive === "external-message") out.add("external-send");
  if (card.outboundRequest || card.emailSendRequest) out.add("external-send");
  if (card.routineRequest?.operation?.action === "delete") out.add("destructive");
  // a routine runs later without asking: a standing grant
  if (card.routineRequest && ["create", "update", "resume", "run_now"].includes(card.routineRequest.operation?.action)) out.add("always-grant");
  if (card.teamSetupRequest?.deletion) out.add("destructive");
  // an interactive shell can do anything a command can
  if (card.terminalRequest) {
    out.add("destructive");
    out.add("irreversible");
  }
  const tool = card.mcpTool ?? card.tool;
  if (tool) {
    const bare = bareToolName(tool);
    const input = parsedInput(card.toolInput);
    const action = typeof input?.action === "string" ? input.action.toLowerCase() : undefined;
    // Claude's Artifact tool publishes a page unless it only reads or lists.
    if (/^artifact$/i.test(bare) && (action === undefined || action === "publish")) out.add("publish-page");
    else if (PUBLISH_TOOL.test(bare)) out.add("publish-page");
    if (RULE_TOOL.test(bare) && !READ_VERB.test(bare)) out.add("rule-change");
  }
  const normalized = normalizeAnswer(answer);
  if (normalized.always || normalized.rememberCommand || normalized.rule === "allow" || normalized.alwaysAllowKey) out.add("always-grant");
  if (normalized.rule) out.add("rule-change");
  return STEP_UP_CLASSES.filter((name) => out.has(name));
}

/** The classes a person chose that this call falls in. */
export function requiredClasses(chosen: readonly StepUpClass[], classes: readonly StepUpClass[]): StepUpClass[] {
  return STEP_UP_CLASSES.filter((name) => chosen.includes(name) && classes.includes(name));
}

/** A WebAuthn RP ID this page can use, or null. An IP address is never one,
 * and off this computer WebAuthn needs https. */
export function usableRpId(hostname: string, protocol: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  if (host === "localhost") return host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (protocol !== "https:") return null;
  return host;
}

// ── the classes of an action tool (2026-10-17, leftovers of #688/#689/#690) ──
//
// Writing a file, driving a screen and opening a web page were in no class,
// so a person who protected "destructive" with a security key saw Sagax's own
// environment tools, their Local VM and an engine's file writes run without
// it. Read from the call's name and arguments only; when in doubt a call is
// in a class.

/** Tools that create or replace a file (any engine, any server). */
const FILE_WRITE_TOOL = /^(?:write|edit|multiedit|notebookedit|str_replace_editor|str_replace_based_edit_tool|apply_patch|move_file|(?:write|create|save|edit)[_-](?:text[_-])?file|file[_-](?:write|edit|create))$/i;
/** Write tools that never only create the file they name: a move removes
 * its source, a patch names its files in its text. */
const NEVER_CREATE_ONLY = /^(?:move_file|apply_patch)$/i;
/** Paths inside the thread's folder that an engine or a tool reads as
 * configuration or instructions (`.claude/settings.json` hooks, `.mcp.json`,
 * `.git/hooks`, `.envrc`, `AGENTS.md`...): a new file there is not "only
 * a new file". Any dot segment, and the engines' instruction files. */
const SENSITIVE_SEGMENT = /^(?:\..*|claude\.md|agents?\.md|gemini\.md|codex\.md)$/i;
/** The arguments that name the file a write lands in. */
const FILE_WRITE_PATH_KEYS = ["path", "file_path", "filePath", "notebook_path", "filename", "destination", "target_path"] as const;
/** Computer-use tools that only look at a screen. */
const SCREEN_READS: ReadonlySet<string> = new Set([
  "screenshot", "get_screen_size", "get_desktop_state", "list_apps", "list_windows", "get_cursor_position", "cursor_position", "zoom", "computer_list_tools",
]);
/** Servers whose tools drive a screen. */
const SCREEN_SERVERS: ReadonlySet<string> = new Set(["computer", "sagax-computer"]);
/** Keys that remove, close or quit, alone or in a combination. */
const DESTRUCTIVE_KEY = /(?:^|[\s+_-])(?:delete|del|backspace|back_space|kp_delete)(?:$|[\s+_-])/i;
/** Modifiers that make a key a command (close, quit, select all, erase). */
const COMMAND_MODIFIER = /(?:^|[\s+_-])(?:cmd|command|super|meta|win|windows|ctrl|control|alt|option|opt)(?:$|[\s+_-])/i;
/** Navigation tools: they read a page unless they send something. */
const WEB_NAV_TOOL = /^(?:browse|fetch_url|fetch|webfetch|open_url|navigate|browser_navigate|goto|open_page)$/i;
const WEB_SEND_KEYS = ["body", "data", "form", "form_data", "formData", "fields", "submit", "post_data", "postData", "payload", "json"] as const;

/** Where a write is judged from: the thread's own folders, and the server's
 * view of its disk. Without them, any write that names a path is judged as
 * possibly overwriting. */
export interface ActionClassContext {
  /** The thread's own folders (absolute, real). */
  threadFolders?: readonly string[];
  /** Whether a path exists, after the server resolved it. */
  exists?: (absolute: string) => boolean;
  /** The server's realpath (deepest existing ancestor when missing). */
  resolve?: (absolute: string) => string;
  /** Whether nothing is at this path yet, not even a broken link, and the
   * deepest thing that exists on its way is a live folder: a write there
   * can only create a file. */
  freshPath?: (absolute: string) => boolean;
}

function serverOf(tool: string): string | undefined {
  const match = /^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_.-]*?)__[A-Za-z0-9][A-Za-z0-9_.-]*$/.exec(tool);
  return match ? match[1]!.toLowerCase() : undefined;
}

function insideFolder(path: string, folder: string): boolean {
  const base = folder.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`);
}

/** 2026-10-17 (#695 follow-up): a write that only creates a new file in the
 * thread's own folder is undone by removing that file; nothing that was
 * there is lost. Every named path must be absolute, land (after the
 * server's realpath) strictly inside one of the thread's folders, have
 * nothing there yet (fresh, no broken link) and name no configuration or
 * instruction file. A tool's own server (another machine), a move, a patch,
 * or a missing view of the disk never qualifies. Overwriting or editing a
 * file in the thread's folder stays irreversible: that folder has no
 * checkpoint (server/index.ts checkpointCwd). */
function createsOnlyInThread(bare: string, server: string | undefined, paths: readonly string[], context: ActionClassContext): boolean {
  if (server || NEVER_CREATE_ONLY.test(bare) || !paths.length) return false;
  const folders = context.threadFolders ?? [];
  if (!folders.length || !context.resolve || !context.freshPath) return false;
  return paths.every((raw) => {
    if (!raw.startsWith("/")) return false;
    const real = context.resolve!(raw);
    const folder = folders.find((candidate) => insideFolder(real, candidate) && real !== candidate.replace(/\/+$/, ""));
    if (!folder) return false;
    const inner = real.slice(folder.replace(/\/+$/, "").length + 1).split("/").filter(Boolean);
    if (!inner.length || inner.some((segment) => SENSITIVE_SEGMENT.test(segment))) return false;
    return context.freshPath!(raw);
  });
}

function keyTexts(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => keyTexts(item, depth + 1));
  return [];
}

/** A screen action's classes: irreversible unless it only looks; also
 * destructive for a delete key or any key with a command modifier
 * (cmd+q, ctrl+w, alt+F4, super+Delete). */
function screenActionClasses(toolName: string, args: Record<string, unknown> | undefined): RiskClass[] {
  const name = toolName.trim().toLowerCase();
  if (SCREEN_READS.has(name)) return [];
  const out: RiskClass[] = ["irreversible"];
  // a key tool's text is its key (Claude's computer: action "key", text "cmd+q")
  const keyTool = /key|hotkey|shortcut/.test(name) || (typeof args?.action === "string" && /key|hotkey|shortcut/i.test(args.action));
  const keys = [
    ...keyTexts(args?.key), ...keyTexts(args?.keys), ...keyTexts(args?.combo), ...keyTexts(args?.hotkey), ...keyTexts(args?.shortcut),
    ...(keyTool ? keyTexts(args?.text) : []),
  ];
  const modifiers = keyTexts(args?.modifiers);
  const destructive = keys.some((item) => DESTRUCTIVE_KEY.test(` ${item} `))
    || modifiers.some((item) => COMMAND_MODIFIER.test(` ${item} `))
    || keys.some((item) => COMMAND_MODIFIER.test(` ${item} `) && /[+\s-]/.test(item.trim()));
  // 2026-10-17 (#695 follow-up): typed text is read as the shell line it
  // may be (a terminal on that screen runs it): `rm -rf ~` typed is
  // destructive like the command (shared/custom-rules.ts readShell).
  const typing = !keyTool && (/(?:^|[_-])type(?:$|[_-])|typing|(?:input|write|send|insert|enter)[_-]text/.test(name)
    || (typeof args?.action === "string" && /^(?:type|typing|type[_-]text)$/i.test(args.action)));
  const typed = typing ? [...keyTexts(args?.text), ...keyTexts(args?.value), ...keyTexts(args?.string)] : [];
  if (!destructive && typed.some(typedTextIsDestructive)) out.push("destructive");
  if (destructive) out.push("destructive");
  return out;
}

/** Whether typed text holds a line the shell reads as a deletion. Each line
 * on its own (a typed newline runs it). Text too long to read (over 256
 * lines or a line over 8 KiB) is in the class: when in doubt, in a class. */
function typedTextIsDestructive(text: string): boolean {
  const lines = text.split(/\r?\n|\r/);
  if (lines.length > 256) return true;
  return lines.some((line) => {
    const trimmed = line.trim();
    if (trimmed.length > 8_192) return true;
    return trimmed.length > 0 && readShell(trimmed).risks.has("destructive");
  });
}

/** The risk classes of an action tool, from its name and arguments: a file
 * write (irreversible; destructive when it may replace a file outside the
 * thread's own folders), a screen action (computer_use, the Local VM's
 * screen, a computer server: irreversible; destructive for a delete key or a
 * command combination), a web page opened with a form, a body or a method
 * other than GET (external-send). Other calls: none from here. */
export function actionToolClasses(call: { tool: string; mcpTool?: string; input?: string }, context: ActionClassContext = {}): RiskClass[] {
  const name = call.mcpTool ?? call.tool;
  const bare = bareToolName(name).toLowerCase();
  const server = serverOf(name);
  const args = parsedInput(call.input);
  const out = new Set<RiskClass>();

  if (FILE_WRITE_TOOL.test(bare)) {
    const paths = FILE_WRITE_PATH_KEYS.map((key) => args?.[key]).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    // a new file in the thread's own folder is undone by removing it
    if (!createsOnlyInThread(bare, server, paths, context)) out.add("irreversible");
    // a server's write lands on another machine (the person's server
    // environment, their computer, a third party): Sagax cannot see what is
    // there, so it may replace a file. A write here is judged on this disk.
    if (server || !paths.length) out.add("destructive");
    else {
      for (const raw of paths) {
        if (!raw.startsWith("/")) { out.add("destructive"); break; }
        const real = context.resolve ? context.resolve(raw) : raw;
        if ((context.threadFolders ?? []).some((folder) => insideFolder(real, folder))) continue;
        if (!context.exists || context.exists(real)) { out.add("destructive"); break; }
      }
    }
  }

  // computer use: any server's computer_use (sagax-environment, sagax-desktop)
  if (bare === "computer_use") {
    const inner = typeof args?.tool_name === "string" ? args.tool_name : "";
    const innerArgs = args?.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments as Record<string, unknown> : undefined;
    for (const risk of inner ? screenActionClasses(inner, innerArgs) : ["irreversible", "destructive"] as RiskClass[]) out.add(risk);
    if (inner.toLowerCase() === "open_url") for (const risk of webSendClasses(innerArgs)) out.add(risk);
  }
  // the Local VM's screen (sagax-desktop local_vm, action use)
  if (bare === "local_vm" && args?.action === "use") {
    const inner = typeof args.tool_name === "string" ? args.tool_name : "";
    const innerArgs = args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments as Record<string, unknown> : undefined;
    for (const risk of inner ? screenActionClasses(inner, innerArgs) : ["irreversible", "destructive"] as RiskClass[]) out.add(risk);
  }
  // a computer server's own tools (Claude's computer, the cloud computer)
  if (server && SCREEN_SERVERS.has(server) && bare !== "computer_select") {
    for (const risk of screenActionClasses(bare, args)) out.add(risk);
  }

  if (WEB_NAV_TOOL.test(bare)) for (const risk of webSendClasses(args)) out.add(risk);
  return RISK_ORDER.filter((risk) => out.has(risk));
}

const RISK_ORDER: readonly RiskClass[] = ["destructive", "irreversible", "money", "external-send"];

/** A navigation that sends: a method other than GET or HEAD, a body, form
 * fields or a submit. */
function webSendClasses(args: Record<string, unknown> | undefined): RiskClass[] {
  if (!args) return [];
  const method = typeof args.method === "string" ? args.method.trim().toUpperCase() : "";
  if (method && method !== "GET" && method !== "HEAD") return ["external-send"];
  for (const key of WEB_SEND_KEYS) {
    const value = args[key];
    if (value === undefined || value === null || value === false || value === "") continue;
    return ["external-send"];
  }
  return [];
}
