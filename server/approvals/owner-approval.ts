// What a bot's owner decided ahead of time (2026-10-14):
// docs/superpowers/specs/2026-10-14-bot-owner-permissions.md.
//
// A bot acts with its owner's rights. A permission card that stays within
// those rights (the "owner" route of engine-access.ts) is answered by the
// owner's own rules and the bot's permission mode before it reaches them:
//
// - rules belong to a person (The owner), optionally narrowed to one bot,
//   and name one tool plus a scope read from the call's arguments (the
//   target: resource, operation, repository, host...), never "this tool,
//   whatever it does" unless the owner widened it on purpose;
// - deny wins over ask, which wins over allow;
// - a destructive call (a delete, a bulk change, an external email or SMS)
//   is covered only by an allow rule made for that same kind, in every
//   mode: never implicitly. 2026-10-26: except a delete or a bulk change in
//   the person's own isolated environment (their sandbox, their Local VM)
//   at auto or bypass, which is their own work;
// - modes: approval (default: rules, then a card), auto (rules, then
//   approve what no rule covers unless it is destructive), bypass (no card
//   for the owner route, only the journal; deny and ask rules and the
//   destructive rule still hold). 2026-10-26: the mode is no longer a
//   setting of its own; it is read from the bot's one approval level
//   (owner-autonomy.ts ownerModeForTurn).
//
// Nothing here answers an admin card, a safety hold, a sandbox widening, a
// question or a guest's turn: the caller never asks (ownerDecision returns
// "card" for them). Pure: the store and the routes live in
// owner-approval-store.ts and index.ts.

import { createHash } from "node:crypto";

import { approvalAction, describeApproval, parseArgs, parseToolId, type ApprovalWords, ENGLISH_WORDS } from "../../shared/approval-describe.ts";
import { canonicalJson } from "../../shared/canonical-json.ts";
import { sagaxFolder } from "../../shared/human-id.ts";
import { singleProgramOf } from "../../shared/read-only-command.ts";
import { readShell } from "../../shared/custom-rules.ts";
import { isOutboundTool } from "../../shared/outbound.ts";
import { parseGrokGatewayToolId } from "../../shared/grok-cloud-connectors.ts";
import { connectorWriteKind } from "../../shared/engine-connectors.ts";
import { screenAppTarget, type ScreenAppIdentity } from "../../shared/computer-app.ts";
import { standingGrantsAllowed } from "../rules/custom-rules-org.ts";
import { credentialReadPath, sensitiveReadPath, shellCredentialPaths } from "../safety/sensitive-path.ts";

export const BOT_PERMISSION_MODES = ["approval", "auto", "bypass"] as const;
export type BotPermissionMode = (typeof BOT_PERMISSION_MODES)[number];
export const RULE_BEHAVIORS = ["allow", "ask", "deny"] as const;
export type RuleBehavior = (typeof RULE_BEHAVIORS)[number];
export type DestructiveKind = "delete" | "bulk" | "external-message";

export type RuleScope = Record<string, string>;

export interface OwnerRule {
  id: string;
  /** The person whose rule it is: the bot's owner when it was made. */
  ownerId: string;
  /** One bot, or null for every bot this person owns. */
  botId: string | null;
  /** normalizeRuleTool: `server__tool` for MCP, the engine's name otherwise. */
  tool: string;
  /** Every key must match the call's own target; empty is any target. */
  scope: RuleScope;
  /** Set only on a rule made for a destructive call of this kind. */
  destructive?: DestructiveKind;
  behavior: RuleBehavior;
  /** Plain words, made from the card, editable by the owner. */
  description: string;
  /** 2026-10-19 ("Toujours permettre" on every card): the situation
   * of the card the rule was saved from, when it is one an ordinary rule
   * never answers. "admin": an admin's (or a host.commands holder's) card
   * of a member's bot, answered later only while the rule's person still
   * holds that right; "hold": a safety hold or a sandbox widening of that
   * same exact scope; "origin": a turn that is not the person's own words
   * (a routine, a webhook, another bot) or their real computer. A rule
   * without it answers only the ordinary owner route. */
  from?: RuleSituation;
  createdAt: number;
  updatedAt: number;
}

export const RULE_SITUATIONS = ["admin", "hold", "origin"] as const;
export type RuleSituation = (typeof RULE_SITUATIONS)[number];

/** One permission call, as the rules read it. */
export interface RuleCall {
  ownerId: string;
  botId: string;
  /** The engine's own tool name (`mcp__srv__tool`, `srv__tool`, `Bash`). */
  tool: string;
  /** The call's JSON arguments, as text (the card's toolInput). */
  input?: string;
  /** MCP annotations, when known. */
  hints?: { readOnly?: boolean; destructive?: boolean };
  /** 2026-10-19: the folder a native shell line runs in, as the engine
   * reports it: an exact command is bound to it (`./deploy.sh` elsewhere is
   * another script). */
  cwd?: string;
  /** 2026-10-21 (parité R10, ligne 80): the app a screen action of the
   * person's own computer acts on, as the SERVER read it from the call's
   * process id (server/computer/computer-app.ts): its name, bundle id and signing
   * team, never from the call's arguments.
   * Set only for the person's own turn on their own computer. */
  app?: ScreenAppIdentity;
  /** 2026-10-27 (#1098): the call runs in the person's own sandbox (their
   * cloud computer, their Local VM): their allow rules answer there even
   * while the organization turned "Toujours permettre" off. Never a scope. */
  ownSandbox?: boolean;
}

/** `mcp__srv__tool` and `srv__tool` are one tool; a built-in keeps its name. */
export function normalizeRuleTool(tool: string): string {
  const trimmed = tool.trim();
  const parsed = parseToolId(trimmed);
  return parsed.server ? `${parsed.server}__${parsed.name}`.toLowerCase() : trimmed;
}

/** Argument keys that name WHERE a call acts, in the order they are kept.
 * `api`, `resource` and `verb` (or `action`) are the three parts of the
 * per-resource key of the MCP permission registry (`cw:ticket.update`,
 * PR #508, server/mcp/mcp-permissions.ts resourceKeyForCall): a rule made on a
 * gateway `api_write` card names the same api, resource and verb, so an
 * Always allow for ticket updates never covers ticket creates. */
const TARGET_KEYS = ["api", "resource", "resource_prefix", "entity", "operation", "method", "verb", "action", "repo", "repository", "server", "domain", "url", "board", "channel", "to", "cc", "bcc"] as const;
const MAX_SCOPE_VALUE = 120;
/** 2026-10-19 (a precise scope on every "Always allow"): keys kept on
 * top of the four above, compared exactly (case included). A shell line is
 * its exact text, a file its exact path: "Always allow" on `npm test` never
 * covers `npm test; rm -rf ~`, and on one file never another. A value too
 * long to keep makes the scope unkeepable (`EXACT_TOO_LONG`), never wider. */
export const EXACT_KEYS = ["command", "cmd", "args", "argv", "path", "file_path", "filePath", "notebook_path"] as const;
export const MAX_EXACT_VALUE = 4_000;
const EXACT_TOO_LONG = "\u0000too-long";

function scopeValue(key: string, value: unknown): string | undefined {
  // recipients as a list: every one of them, sorted, never dropped
  if ((key === "to" || key === "cc" || key === "bcc") && Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === "string")) return EXACT_TOO_LONG;
    const list = JSON.stringify((value as string[]).map((entry) => entry.trim().toLowerCase()).sort());
    return list.length <= MAX_EXACT_VALUE ? list : EXACT_TOO_LONG;
  }
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value === "boolean") value = String(value);
  // 2026-10-20 (security review): a known key whose value cannot be kept
  // (a list, an object, an unreadable address) makes the scope unkeepable,
  // never one key fewer
  if (typeof value !== "string") return EXACT_TOO_LONG;
  let text = value.trim();
  if (!text) return undefined;
  if (key === "url") {
    try {
      text = new URL(text).hostname;
    } catch {
      return EXACT_TOO_LONG;
    }
    if (!text) return EXACT_TOO_LONG;
  }
  if (key === "resource" || key === "resource_prefix" || key === "entity") {
    // service/tickets/123 and service.tickets are the family service/tickets
    text = text.replace(/\./g, "/").replace(/^\/+|\/+$/g, "");
    const parts = text.split("/").filter(Boolean);
    while (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]!)) parts.pop();
    text = parts.join("/");
  }
  text = text.toLowerCase();
  // 2026-10-19 (security review): too long to keep is never "any value"
  return text ? (text.length <= MAX_SCOPE_VALUE ? text : EXACT_TOO_LONG) : undefined;
}

/** The target of a call: up to four argument values that say where it acts.
 * Two calls with the same scope act on the same kind of target. */
export function ruleScopeFor(input: string | undefined): RuleScope {
  const args = parseArgs(input);
  if (!args) return {};
  const scope: RuleScope = {};
  for (const key of TARGET_KEYS) {
    const value = scopeValue(key, args[key]);
    if (value !== undefined) scope[key === "url" ? "host" : key] = value;
  }
  for (const key of EXACT_KEYS) {
    const raw = args[key];
    if (Array.isArray(raw)) {
      // an argv array is kept as the list itself: ["a b"] and ["a", "b"] differ
      const list = raw.every((part) => typeof part === "string") ? JSON.stringify(raw) : EXACT_TOO_LONG;
      if (raw.length) scope[key] = list.length <= MAX_EXACT_VALUE ? list : EXACT_TOO_LONG;
      continue;
    }
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      scope[key] = EXACT_TOO_LONG;
      continue;
    }
    const text = raw.trim();
    if (!text) continue;
    scope[key] = text.length <= MAX_EXACT_VALUE ? text : EXACT_TOO_LONG;
  }
  return scope;
}

/** Whether a scope can be kept as a rule (no exact value was too long). */
export function scopeKeepable(scope: RuleScope): boolean {
  return !Object.values(scope).includes(EXACT_TOO_LONG);
}

const EXACT_KEY_SET: ReadonlySet<string> = new Set([...EXACT_KEYS, "cwd"]);
/** 2026-10-20 (security review): keys an allow rule must name to cover a
 * call that has them. A rule on `npm test` never covers it in another
 * folder, a rule for one recipient never covers a message with a Bcc. */
const STRICT_KEY_SET: ReadonlySet<string> = new Set([...EXACT_KEY_SET, "to", "cc", "bcc"]);
/** 2026-10-26 (#1065, "Toujours permettre" : ce fichier ou tout le dossier):
 * the argument keys that name one file or folder, and the scope key of a
 * rule kept for a whole folder tree. `path_in` holds the folder, lexically
 * normalized (normalizeFolderPath); it covers a call whose every path (a
 * file, both ends of a rename or a move, each file of a batch) is inside
 * that folder or its subfolders, never a path with `..`, never a sensitive
 * one (a dotfile, a credential, /proc: server/safety/sensitive-path.ts), and never
 * a call that carries any other exact argument (a command, a folder it runs
 * in). A folder rule made on a card that changes files (write, create,
 * rename, move, delete, recursive or in a batch) covers every such file
 * tool of the same server in that folder; one made on a read covers that
 * tool. */
export const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"] as const;
/** Both ends of a rename or a move, as engines and MCP servers name them. */
const MOVE_KEYS = ["from", "to", "source", "destination", "src", "dest", "old_path", "new_path", "oldPath", "newPath", "from_path", "to_path", "source_path", "destination_path"] as const;
/** Lists of files (a batch delete or move). */
const PATH_LIST_KEYS = ["paths", "files", "file_paths", "filePaths"] as const;
export const FOLDER_KEY = "path_in";

/** The paths a file call names, or undefined when it names none or one that
 * cannot be read as text (fail closed). */
export function callFilePaths(input: string | undefined): string[] | undefined {
  const args = parseArgs(input);
  if (!args) return undefined;
  const found: string[] = [];
  for (const key of [...PATH_KEYS, ...MOVE_KEYS]) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !value.trim()) return undefined;
    found.push(value);
  }
  for (const key of PATH_LIST_KEYS) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || !value.length || !value.every((entry) => typeof entry === "string" && entry.trim())) return undefined;
    found.push(...(value as string[]));
  }
  return found.length ? found : undefined;
}

const FILE_KEYS: ReadonlySet<string> = new Set([...PATH_KEYS, ...MOVE_KEYS, ...PATH_LIST_KEYS]);
const CHANGE_WORDS: ReadonlySet<string> = new Set(["write", "edit", "multiedit", "notebookedit", "create", "rename", "move", "mv", "delete", "remove", "rm", "mkdir", "copy", "cp", "append", "patch", "touch", "save", "replace", "truncate", "rmdir"]);
const FILE_WORDS: ReadonlySet<string> = new Set(["file", "files", "dir", "dirs", "directory", "folder", "folders", "path", "paths", "notebook"]);

/** Whether a tool name changes files: write_file, edit, delete_files,
 * move_path, create_directory... (a verb and a file word, or a bare
 * Write, Edit, MultiEdit, NotebookEdit). */
export function fileChangeTool(tool: string): boolean {
  const name = parseToolId(tool).name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  const words = name.split(/[^a-z]+/).filter(Boolean);
  if (words.length === 1) return ["write", "edit", "multiedit", "notebookedit"].includes(words[0]!);
  return words.some((word) => CHANGE_WORDS.has(word)) && words.some((word) => FILE_WORDS.has(word) || word === "multiedit" || word === "notebookedit");
}

/** Leaves of a file tool that only reads. A change is never one of these. */
const READ_ONLY_FILE_LEAVES: ReadonlySet<string> = new Set([
  "read", "notebookread", "glob", "grep", "ls", "readfile", "listfiles", "searchfiles",
]);

/** Whether a tool only reads files (Read, Glob, list_files, search_files). */
function readOnlyFileTool(tool: string): boolean {
  if (fileChangeTool(tool)) return false;
  const name = parseToolId(tool).name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  const leaf = name.split(/[^a-z]+/).filter(Boolean).join("");
  return READ_ONLY_FILE_LEAVES.has(leaf);
}

function sameServer(ruleTool: string, callTool: string): boolean {
  const a = parseToolId(normalizeRuleTool(ruleTool)).server ?? "";
  const b = parseToolId(normalizeRuleTool(callTool)).server ?? "";
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether a folder rule saved for `ruleTool` also answers `callTool`: the
 * same tool, two read-only file tools of the same server, or two
 * file-changing tools of the same server. A read never covers a write. */
function folderToolCovers(ruleTool: string, callTool: string): boolean {
  if (normalizeRuleTool(ruleTool) === normalizeRuleTool(callTool)) return true;
  if (readOnlyFileTool(ruleTool) && readOnlyFileTool(callTool)) return sameServer(ruleTool, callTool);
  if (!fileChangeTool(ruleTool) || !fileChangeTool(callTool)) return false;
  return sameServer(ruleTool, callTool);
}

/** A path as text that can be compared by prefix: slashes, no `.` part, no
 * trailing slash; a path on a drive letter compares without case.
 * Undefined when it holds a `..` part (never resolved here). */
export function normalizeFolderPath(path: string): string | undefined {
  const flat = path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!flat) return undefined;
  const parts = flat.split("/");
  if (parts.some((part) => part === "..")) return undefined;
  const kept = parts.filter((part) => part !== ".");
  const text = kept.join("/").replace(/(.)\/+$/, "$1");
  return /^[a-z]:(\/|$)/i.test(text) ? text.toLowerCase() : text;
}

/** Tools whose path argument is itself a folder (a listing, a search). */
const FOLDER_TARGET_TOOL = /(^|[_.:-])(list|search|find|glob|grep|tree|dir|ls)([_.:-]|$)/i;

/** The folder a folder rule would cover for a call of `tool` on `path`: the
 * folder itself for a listing or a search, the file's parent otherwise;
 * never the root, a drive, the home folder itself or a sensitive name. */
export function folderOfPath(path: string, tool = ""): string | undefined {
  const normal = normalizeFolderPath(path);
  if (!normal) return undefined;
  let folder = normal;
  if (fileChangeTool(tool) || !FOLDER_TARGET_TOOL.test(parseToolId(tool).name)) {
    const cut = normal.lastIndexOf("/");
    if (cut <= 0) return undefined;
    folder = normal.slice(0, cut);
  }
  if (!folder || folder === "~" || /^[a-z]:\/?$/i.test(folder) || /^\/+$/.test(folder) || folder.length > MAX_EXACT_VALUE) return undefined;
  if (sensitiveReadPath(folder)) return undefined;
  return folder;
}

/** Whether `path` is the folder or lies under it. */
export function pathInFolder(path: string, folder: string): boolean {
  const normal = normalizeFolderPath(path);
  if (!normal || !folder) return false;
  return normal === folder || normal.startsWith(`${folder}/`);
}

/** The scope key that binds a rule to the whole call (every argument), for
 * the cards that never had a rule before (an admin's card, a held card, a
 * turn that is not the person's own): only that very request passes again. */
export const WHOLE_CALL_KEY = "call";

/** A fingerprint of every argument of a call (the rule keeps it, never the
 * arguments). */
export function wholeCallDigest(input: string | undefined): string {
  const args = parseArgs(input);
  const text = args ? canonicalJson(args) : (input ?? "").trim();
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** The scope keys of an app rule: the name, bundle id and signing team the
 * server read (review of #954: bound to the signature, not the folder). */
export const APP_KEY = "app";
export const APP_BUNDLE_KEY = "bundle";
export const APP_TEAM_KEY = "team";
const APP_KEYS = [APP_KEY, APP_BUNDLE_KEY, APP_TEAM_KEY] as const;
/** The tool an app rule is kept under: it covers every screen action of
 * that one app (see, click, type), never another app, never a call whose
 * app the server did not read. */
export const APP_RULE_TOOL = "computer_app";
const MAX_APP_LABEL = 80;

/** The call's scope, its shell folder included when the engine reports one. */
function appScope(app: ScreenAppIdentity): RuleScope | null {
  const label = app.label.trim();
  const bundle = app.bundleId.trim();
  const team = app.team.trim();
  if (!label || !bundle || !team || label.length > MAX_APP_LABEL || bundle.length > 255 || team.length > 40) return null;
  return { [APP_KEY]: label, [APP_BUNDLE_KEY]: bundle, [APP_TEAM_KEY]: team };
}

export function callScopeFor(call: Pick<RuleCall, "input" | "cwd" | "app">): RuleScope {
  const scope = ruleScopeFor(call.input);
  const app = call.app ? appScope(call.app) : null;
  if (app) Object.assign(scope, app);
  const cwd = call.cwd?.trim();
  if (cwd && (scope.command !== undefined || scope.cmd !== undefined)) {
    // a folder Sagax made for this bot (a conversation's, a parallel task's,
    // the bot's own) is named by its kind: the rule holds in each new
    // conversation of the bot, never in another folder
    const made = sagaxFolder(cwd);
    scope.cwd = made && made.rest.length === 0 ? `sagax:${made.kind}` : cwd.length <= MAX_EXACT_VALUE ? cwd : EXACT_TOO_LONG;
  }
  // 2026-10-20: the one program a plain command line runs, which a
  // "Toujours permettre" rule saved for that program matches
  const program = singleProgramOf(scope.command ?? scope.cmd);
  if (program) scope[PROGRAM_KEY] = program;
  return scope;
}

/** The scope key of a rule kept for one program (`git`, `npm`): it covers
 * a command line that runs only that program (shared/read-only-command.ts
 * singleProgramOf), in the same folder, never a chain with another one. */
export const PROGRAM_KEY = "program";

const BULK_TOOL = /(^|[_.:-])(bulk|batch|mass|many)([_.:-]|$)/i;
const ID_LIST_KEYS = ["ids", "id", "records", "items", "tickets", "entries", "targets", "recordIds", "ticketIds"];
const MESSAGE_RESOURCE = /(^|\/)(messages?|mail|emails?|sms|calls?)$/i;

/** The shell line a call carries, under command, cmd or script (the
 * built-in Bash, an engine's own shell tool, the folded native command line
 * of Codex and the ACP engines); with `argv`, a list of words reads as
 * its words joined. */
function shellLineOf(args: Record<string, unknown> | undefined, argv = false): string | undefined {
  for (const key of ["command", "cmd", "script"]) {
    const value = args?.[key];
    if (typeof value === "string") return value;
    if (argv && Array.isArray(value) && value.length && value.every((word) => typeof word === "string")) return value.join(" ");
  }
  return undefined;
}

/** #3697: a call that reads a credential file or folder or a process
 * secret (server/safety/sensitive-path.ts credentialReadPath, one rule for
 * both): named by a file tool that only reads (readOnlyFileTool: Read,
 * Grep, Glob, LS, an environment's read_file or list_files), or read by a
 * shell line (shellCredentialPaths). The `path` of any other tool (a
 * connector's API route, a file change) is not a local read. A Glob whose
 * folder is only inside its `pattern` is not seen. */
export function credentialReadOf(call: Pick<RuleCall, "tool" | "input">): boolean {
  const args = parseArgs(call.input);
  const line = shellLineOf(args, true);
  if (line !== undefined && shellCredentialPaths(line).length) return true;
  if (!readOnlyFileTool(call.tool)) return false;
  return (callFilePaths(call.input) ?? []).some((path) => credentialReadPath(path));
}

/** Which destructive kind a call is, or undefined. A delete first, then a
 * change to two or more records at once, then a message that leaves the
 * organization (email, SMS, call). */
export function destructiveKindOf(call: Pick<RuleCall, "tool" | "input" | "hints">): DestructiveKind | undefined {
  const parsed = parseToolId(call.tool);
  // Grok's gateway escapes action separators (delete_5fmail_5fmessage).
  // Read that action for risk without changing the tool identity a rule names.
  const gateway = parseGrokGatewayToolId(call.tool);
  const action = gateway?.tool.replace(/-/g, "_");
  const described = describeApproval(gateway ? `mcp__${gateway.server}__${action}` : call.tool, call.input, call.hints);
  const connectorWrite = connectorWriteKind(call.tool);
  if (described.risk === "destructive" || (connectorWrite && /(^|[_.:-])trash([_.:-]|$)/i.test(action ?? parsed.name))) return "delete";
  const args = parseArgs(call.input);
  // 2026-10-22: describeApproval reads a shell tool only as "execute" and
  // never parses the line, so a native `rm -rf`, `shred`, `find -delete`...
  // used to slip past the owner auto/bypass destructive guard and run with no
  // card. The custom-rules risk engine already extracts the delete from the
  // same line (shared/custom-rules.ts readShell); the owner route reads it the
  // same way, so a destructive shell line is a delete in every mode unless an
  // allow rule was made for a delete. The line arrives under command/cmd/script
  // (the built-in Bash, an engine's own shell tool, and the folded native
  // command line index.ts builds for Codex and the ACP engines alike).
  const shellLine = shellLineOf(args);
  if (shellLine && readShell(shellLine).actions.has("delete")) return "delete";
  const writes = described.risk === "write" || described.risk === "execute" || connectorWrite !== null;
  if (BULK_TOOL.test(parseToolId(call.tool).name)) return "bulk";
  if (args && writes && ID_LIST_KEYS.some((key) => Array.isArray(args[key]) && (args[key] as unknown[]).length >= 2)) return "bulk";
  const bare = call.tool.startsWith("mcp__") ? call.tool : (() => {
    const parsed = parseToolId(call.tool);
    return parsed.server ? `mcp__${parsed.server}__${parsed.name}` : call.tool;
  })();
  if (isOutboundTool(bare)) return "external-message";
  const resource = typeof args?.resource === "string" ? args.resource.replace(/\./g, "/").replace(/\/+$/, "") : "";
  if (resource && MESSAGE_RESOURCE.test(resource) && (described.risk === "write" || described.risk === "execute")) {
    const op = typeof args?.operation === "string" ? args.operation.toLowerCase() : typeof args?.method === "string" ? args.method.toLowerCase() : "";
    if (!op || op === "create" || op === "post" || op === "send") return "external-message";
  }
  return undefined;
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether one rule covers one call. */
export function ruleMatches(rule: OwnerRule, call: RuleCall, callScope: RuleScope, destructive: DestructiveKind | undefined): boolean {
  if (!sameText(rule.ownerId, call.ownerId)) return false;
  if (rule.botId !== null && rule.botId !== call.botId) return false;
  if (rule.tool === APP_RULE_TOOL) {
    // an app rule: a screen action whose app the server read, that same app
    if (!APP_KEYS.every((key) => key in rule.scope) || !call.app || !screenAppTarget(call.tool, call.input)) return false;
  } else if (rule.scope[FOLDER_KEY] !== undefined ? !folderToolCovers(rule.tool, call.tool) : normalizeRuleTool(rule.tool) !== normalizeRuleTool(call.tool)) return false;
  const folder = rule.scope[FOLDER_KEY];
  if (folder !== undefined) {
    // a folder rule: every path of the call is inside it, never a
    // sensitive one (an allow only: a deny or ask rule still reads it)
    const paths = callFilePaths(call.input);
    if (!paths || !paths.every((path) => pathInFolder(path, folder))) return false;
    if (rule.behavior === "allow" && paths.some((path) => sensitiveReadPath(path))) return false;
  }
  if (rule.behavior === "allow" && Object.keys(rule.scope).length) {
    for (const key of Object.keys(callScope)) {
      if (folder !== undefined && FILE_KEYS.has(key)) continue;
      if (STRICT_KEY_SET.has(key) && !(key in rule.scope) && !(PROGRAM_KEY in rule.scope && (key === "command" || key === "cmd"))) return false;
    }
  }
  for (const [key, value] of Object.entries(rule.scope)) {
    if (key === FOLDER_KEY) continue;
    if (key === WHOLE_CALL_KEY) {
      if (wholeCallDigest(call.input) !== value) return false;
      continue;
    }
    const own = callScope[key];
    if (own === undefined || own === EXACT_TOO_LONG) return false;
    if (EXACT_KEY_SET.has(key) ? own !== value : !sameText(own, value)) return false;
  }
  // A deny or ask rule covers any kind; an allow covers a destructive call
  // only when it was made for that same kind.
  // A folder rule covers the deletes (one, recursive or in a batch) of its
  // folder: the person chose the whole folder, changes included. Never an
  // outward message.
  const inFolder = folder !== undefined && (destructive === "delete" || destructive === "bulk") && fileChangeTool(call.tool);
  if (rule.behavior === "allow" && destructive && rule.destructive !== destructive && !inFolder) return false;
  return true;
}

/** The rule that decides a call: deny first, then ask, then allow; within
 * one behavior, the narrowest (most scope keys, one bot over all). While
 * the organization turned "Toujours permettre" off
 * (server/rules/custom-rules-org.ts), no allow rule answers. */
export function matchOwnerRule(rules: readonly OwnerRule[], call: RuleCall): OwnerRule | undefined {
  const scope = callScopeFor(call);
  const destructive = destructiveKindOf(call);
  const weight = (rule: OwnerRule) => RULE_BEHAVIORS.indexOf(rule.behavior);
  const allowRules = standingGrantsAllowed({ ownSandbox: call.ownSandbox === true });
  return rules
    .filter((rule) => (allowRules || rule.behavior !== "allow") && ruleMatches(rule, call, scope, destructive))
    .sort((a, b) =>
      weight(b) - weight(a)
      || Object.keys(b.scope).length - Object.keys(a.scope).length
      || Number(b.botId !== null) - Number(a.botId !== null))[0];
}

export type OwnerDecisionSource = "owner-rule" | "owner-rule-deny" | "owner-auto" | "owner-bypass";

export type OwnerDecision =
  | { kind: "allow"; source: Exclude<OwnerDecisionSource, "owner-rule-deny">; rule?: OwnerRule }
  | { kind: "deny"; source: "owner-rule-deny"; rule: OwnerRule }
  | { kind: "card"; reason: "admin" | "hold" | "no-rule" | "ask-rule" | "destructive" | "step-up" | "origin" | "cross-person"; rule?: OwnerRule; destructive?: DestructiveKind };

/** What happens to a permission call of the owner route before a card. */
export function ownerDecision(input: {
  mode: BotPermissionMode;
  rules: readonly OwnerRule[];
  call: RuleCall;
  /** The call goes beyond the owner's rights: an admin card, never a rule. */
  adminRoute?: boolean;
  /** A safety hold, a sandbox widening, a question, a guest's turn: a
   * person answers, whatever the mode or rules say. */
  personMustAnswer?: boolean;
  /** The call falls in a class the person protects with a security key
   * (server/auth/step-up-gate.ts callStepUpClasses): no rule and no mode allows
   * it, the card shows and its Allow needs the key. A deny rule still
   * denies. */
  stepUpRequired?: boolean;
  /** Sagax itself would not run this call unasked (an own-environment call
   * from a turn that is not the owner's own, member-environment.ts):
   * neither the mode (auto, bypass) nor an Always allow rule answers it,
   * since what started the turn (another bot, a webhook, an email) may carry
   * someone else's words. A deny rule still denies. */
  autonomyRefused?: boolean;
  /** The call reaches someone else's environment or data (a guest's turn,
   * another person's destination): judged at Ask, answered only by an allow
   * rule its answerer saved from such a card (#2091). */
  crossPerson?: boolean;
  /** 2026-10-26 (#1065): `autonomyRefused` holds only because the call acts
   * on the owner's real computer (sagax-desktop), and the turn is the
   * owner's own words on their own bot. Bypass, which the owner chose with
   * its confirmation (and bots.fullAccess on an organization server),
   * answers it like any other call of the owner route: deny rules, the
   * destructive rule, holds and security keys still come first.
   * 2026-10-26 (the person's own environment is theirs): Approve for me
   * (auto) answers it the same way; only Approval keeps the card. A webhook,
   * a routine that is not theirs or another person's bot never sets this. */
  ownComputerOwnTurn?: boolean;
  /** 2026-10-26: the call acts in the person's own isolated
   * environment as Sagax mounted it for this turn (their server sandbox or
   * the Local VM on their computer, member-environment.ts
   * ownEnvironmentCall), never their real computer, the organization's
   * server or someone else's. A delete or a bulk change there is the
   * person's own work: at auto and bypass it runs like any other call of
   * theirs (rules, holds and security keys first). A message that leaves
   * the organization keeps its card wherever it is sent from. */
  ownEnvironment?: boolean;
}): OwnerDecision {
  if (input.adminRoute) return { kind: "card", reason: "admin" };
  const bypassOwnComputer = (input.mode === "bypass" || input.mode === "auto") && input.autonomyRefused === true && input.ownComputerOwnTurn === true;
  // 2026-10-19 ("Toujours permettre" on every card): a held card (a
  // safety hold, a sandbox widening) and a turn that is not the person's own
  // are answered only by an allow rule the person saved from that same kind
  // of card; deny and ask rules answer as before.
  // 2026-11-05 (#2091): someone else's destination is a turn that is not
  // the answerer's own: an allow rule they saved from such a card answers
  // it, like any other origin.
  const situation: RuleSituation | undefined = input.personMustAnswer ? "hold" : input.crossPerson || (input.autonomyRefused && !bypassOwnComputer) ? "origin" : undefined;
  const rule = matchOwnerRule(input.rules.filter((candidate) => candidate.behavior !== "allow" || ruleCoversSituation(candidate, situation)), input.call);
  if (rule?.behavior === "deny") return { kind: "deny", source: "owner-rule-deny", rule };
  if (input.stepUpRequired) return { kind: "card", reason: "step-up", ...(rule ? { rule } : {}) };
  if (situation) {
    if (rule?.behavior === "allow") return { kind: "allow", source: "owner-rule", rule };
    // 2026-10-26: an ask rule is an ask rule here too, whatever the level
    if (rule?.behavior === "ask") return { kind: "card", reason: "ask-rule", rule };
    return { kind: "card", reason: input.crossPerson ? "cross-person" : situation, ...(rule ? { rule } : {}) };
  }
  if (rule?.behavior === "allow") return { kind: "allow", source: "owner-rule", rule };
  // 2026-10-26 (one approval level): a rule decides whatever the level.
  // An ask rule shows its card even in Full access (bypass), where it used
  // to be skipped; the level only decides what no rule covers.
  if (rule?.behavior === "ask") return { kind: "card", reason: "ask-rule", rule };
  // 2026-11-06 (the owner: "my bot is even in bypass mode"): Full access (bypass)
  // asks nothing the person did not keep with a rule. A send on their
  // behalf, a delete or a bulk change is the work they authorized; the
  // organization's rules and their own Ask/Deny rules (read above and in
  // autoVerdict), isolation and sensitive paths are what still stands
  // (full-access-gate.ts).
  if (input.mode === "bypass") return { kind: "allow", source: "owner-bypass" };
  const destructive = destructiveKindOf(input.call);
  // 2026-10-26: a delete or a bulk change in the person's own isolated
  // environment is theirs at auto; Approval, a message to a third party
  // and anything outside that environment keep the card (answered by an
  // Always allow rule saved on it).
  const ownEnvironmentChange = input.ownEnvironment === true && input.mode !== "approval" && (destructive === "delete" || destructive === "bulk");
  if (destructive && !ownEnvironmentChange) return { kind: "card", reason: "destructive", destructive };
  // #3697: Approve for me never reads a credential file or folder, or a
  // process secret, unasked (a file tool or a shell command's arguments);
  // an Always allow saved on that card answers it next time.
  if (input.mode === "auto" && credentialReadOf(input.call)) return { kind: "card", reason: "no-rule" };
  if (input.mode === "auto") return { kind: "allow", source: "owner-auto" };
  return { kind: "card", reason: "no-rule" };
}

/** 2026-10-26 (#1065): the order of precedence once the owner decided.
 * An organization rule ("Refuser", "Demander d'abord", ids `orule_`) and the
 * person's own rule in their words (custom rules) are read first by
 * autoVerdict: a deny refuses and an ask keeps the card, so neither the
 * owner's mode (Auto, Bypass) nor an Always allow ever answers past them.
 * Otherwise the owner's allow replaces the base verdict. */
export function ownerVerdictOver<V extends { approve: string | null; source: string }>(
  base: V | null,
  owner: OwnerDecision | null,
  tool: string,
): V | { approve: string; source: Exclude<OwnerDecisionSource, "owner-rule-deny">; rule?: string } | { approve: null; source: "owner-rule-ask"; rule: string } | null {
  if (base?.source === "custom-rule-deny" || base?.source === "custom-rule-ask") return base;
  // 2026-10-26 (one approval level): the person's own ask rule keeps its
  // card even when the level (Full access, Approve for me) would have
  // answered it. The person's answer on a draft's own card stays an answer.
  if (owner?.kind === "card" && owner.reason === "ask-rule" && owner.rule && base?.source !== "email-draft-approval") {
    return { approve: null, source: "owner-rule-ask", rule: owner.rule.id };
  }
  if (owner?.kind !== "allow") return base;
  // 2026-10-30: Approve for me never sends for the person. An outward call
  // the driver flagged (an engine connector's write whose tool name does not
  // read as a send, connector-ask.ts) is held by the outbound guard; only a
  // rule the person saved, or Full access (already the base), answers it.
  if (owner.source === "owner-auto" && base?.source === "outbound-guard") return base;
  return {
    approve: owner.source === "owner-rule"
      ? `approved ${tool} (your rule)`
      : owner.source === "owner-auto" ? `approved ${tool} (automatic approval)` : `approved ${tool} (bypass)`,
    source: owner.source,
    ...(owner.rule ? { rule: owner.rule.id } : {}),
  };
}

/** Whether an allow rule answers a call in this situation: an ordinary
 * call any rule; a held card or a turn that is not the person's own only a
 * rule saved from that same kind of card. */
export function ruleCoversSituation(rule: Pick<OwnerRule, "from">, situation: RuleSituation | undefined): boolean {
  if (!situation) return true;
  return rule.from === situation;
}

/** 2026-10-19: whether an allow rule saved on a card that is not an engine's
 * tool call (an act or a setting change, a widget's change, a proposal)
 * covers this one: same tool and the very same scope, key for key. Never
 * while the organization turned "Toujours permettre" off
 * (server/rules/custom-rules-org.ts). */
export function ruleCoversExactScope(rule: OwnerRule, tool: string, scope: RuleScope): boolean {
  if (rule.behavior !== "allow" || rule.tool !== tool || !standingGrantsAllowed()) return false;
  const keys = Object.keys(rule.scope);
  if (keys.length !== Object.keys(scope).length) return false;
  return keys.every((key) => scope[key] === rule.scope[key]);
}

/** What the card offers to remember: the rule "Always allow" or "Always
 * deny" would save, described in plain words. */
export interface RuleCandidate {
  tool: string;
  scope: RuleScope;
  destructive?: DestructiveKind;
  description: string;
}

function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
}

export function describeRule(tool: string, scope: RuleScope, words: ApprovalWords = ENGLISH_WORDS, input?: string): string {
  const action = capitalize(approvalAction(tool, input, undefined, words));
  // a Sagax-made folder is the bot's own; any other folder is named
  const target = Object.entries(scope).filter(([key, value]) => key !== WHOLE_CALL_KEY && !(key === "cwd" && value.startsWith("sagax:"))).map(([, value]) => value).join(", ");
  return (target ? `${action} (${target})` : action).slice(0, 500);
}

export function ruleCandidateFor(call: Pick<RuleCall, "tool" | "input" | "hints" | "cwd">, words: ApprovalWords = ENGLISH_WORDS, options: { wholeCall?: boolean; programScope?: boolean } = {}): RuleCandidate {
  const full = callScopeFor(call);
  // 2026-10-20 ("Toujours permettre" in one click, this program and not
  // the exact string): a plain command line of one program is kept as that
  // program (and its folder); anything else keeps the exact command.
  const program = options.programScope ? full[PROGRAM_KEY] : undefined;
  if (program) {
    const scope: RuleScope = { [PROGRAM_KEY]: program, ...(full.cwd !== undefined ? { cwd: full.cwd } : {}) };
    const destructive = destructiveKindOf(call);
    return {
      tool: normalizeRuleTool(call.tool),
      scope,
      ...(destructive ? { destructive } : {}),
      description: describeRule(call.tool, scope, words, call.input),
    };
  }
  const scope: RuleScope = { ...full };
  delete scope[PROGRAM_KEY];
  // 2026-11-06 (the owner: "I have chosen always allow it does not respect it"):
  // a call with arguments but no target the scope reads (a post's text, a
  // query, a body) keeps the tool on this server for this bot. Keeping the
  // digest of the whole request (2026-10-20) made a rule that never matched
  // the next call, so the card came back on every post. Only `wholeCall`
  // (an admin's card) keeps the exact request.
  if (options.wholeCall) scope[WHOLE_CALL_KEY] = wholeCallDigest(call.input);
  const destructive = destructiveKindOf(call);
  return {
    tool: normalizeRuleTool(call.tool),
    scope,
    ...(destructive ? { destructive } : {}),
    description: describeRule(call.tool, scope, words, call.input),
  };
}

/** 2026-10-21 (review of #938): the arguments a rule reads for a call.
 * Codex and the ACP engines (Grok, Cursor, Qwen, Kimi, OpenCode, Hermes,
 * Droid) report a shell line as the event's `command` beside no `input`: the
 * line is read as the call's `command` argument, at a rule's creation and at
 * each use, so its program (or exact text) is kept, never an empty scope that
 * would cover every command of the bot. A call that names its command
 * already, or whose input is not a JSON object, is kept as is. */
export function ruleInputFor(input: string | undefined, command: string | undefined): string | undefined {
  const line = typeof command === "string" && command.trim() ? command : undefined;
  if (!line) return input;
  if (input === undefined || !input.trim()) return JSON.stringify({ command: line });
  const args = parseArgs(input);
  if (!args || "command" in args || "cmd" in args) return input;
  return JSON.stringify({ ...args, command: line });
}

/** What "Always allow" or "Always deny" on a permission card would keep, or
 * undefined when nothing safe can be kept.
 * - an ordinary card (no `from`): the target, a command as its one program;
 * - a card that never had a rule (`from`: an admin's, a held one, a turn
 * that is not the person's own) keeps the whole request, every argument;
 * - 2026-10-21 ("Toujours permettre" on a member's bot must stick): on
 * an admin's card (or a holder's), the engine's own shell line is kept like
 * on a solo bot, as its one program in its folder (else its exact text),
 * for that bot only; the engine writes a new `description` beside each
 * command, so the whole request never matched again;
 * - review of #938: a held card (a safety hold, a sandbox widening, Codex
 * additional permissions or network, requiresExplicitApproval) keeps the
 * whole request even when it is an admin's card. */
export function cardRuleCandidate(
  call: { tool: string; input?: string; command?: string; cwd?: string; app?: ScreenAppIdentity },
  situation: { from?: RuleSituation; held?: boolean },
  words: ApprovalWords = ENGLISH_WORDS,
): RuleCandidate & { from?: RuleSituation } {
  // 2026-10-21 (parité R10, ligne 80): a screen action on the person's own
  // computer whose app the server read keeps that app, never more: "Toujours
  // permettre" then covers seeing, clicking and typing in that one app.
  // Only an ordinary card: a held card, an admin's card and a turn that is
  // not the person's own keep their own rule (review of R10).
  const app = call.app && appScope(call.app) ? call.app : null;
  if (app && situation.held !== true && situation.from === undefined && screenAppTarget(call.tool, call.input)) {
    return appRuleCandidate(app, words);
  }
  const input = ruleInputFor(call.input, call.command);
  const from = situation.from ? { from: situation.from } : {};
  // 2026-11-05 (#2091: "Toujours permettre" on every card, no exception
  // added by caution): a call with no readable arguments keeps the whole
  // tool for this bot; a scope too long to keep exactly keeps the whole
  // request (its digest). Never undefined for a tool call.
  if (input === undefined || !input.trim()) return { tool: normalizeRuleTool(call.tool), scope: {}, description: describeRule(call.tool, {}, words), ...from };
  const args = parseArgs(input);
  if (args && Object.keys(args).length === 0) return { tool: normalizeRuleTool(call.tool), scope: {}, description: describeRule(call.tool, {}, words, input), ...from };
  const held = situation.held === true || situation.from === "hold";
  const nativeShell = situation.from === "admin" && !held && typeof call.command === "string" && call.command.trim().length > 0;
  const candidate = ruleCandidateFor({ tool: call.tool, input, ...(call.cwd ? { cwd: call.cwd } : {}) }, words, {
    // 2026-11-06: a held card and a turn that is not the person's own keep
    // the scope an ordinary card keeps (the target, else this tool), so
    // the rule the person saved answers the next one; an admin's card on a
    // member's bot (the shared server) keeps the exact request.
    wholeCall: situation.from === "admin" && !nativeShell,
    programScope: !held && (situation.from !== "admin" || nativeShell),
  });
  if (!scopeKeepable(candidate.scope)) {
    const scope: RuleScope = { [WHOLE_CALL_KEY]: wholeCallDigest(input) };
    return { ...candidate, scope, description: describeRule(call.tool, scope, words, input), ...from };
  }
  return { ...candidate, ...from };
}

/** The deepest folder that holds every path (lexical), or undefined. */
function commonFolder(paths: string[], tool: string): string | undefined {
  const folders = paths.map((path) => folderOfPath(path, tool));
  if (folders.some((folder) => folder === undefined)) return undefined;
  let common = folders[0]!;
  for (const folder of folders.slice(1)) {
    while (common && !pathInFolder(folder!, common)) {
      const cut = common.lastIndexOf("/");
      common = cut > 0 ? common.slice(0, cut) : "";
    }
    if (!common) return undefined;
  }
  return folderOfPath(`${common}/x`, "");
}

/** The one root every path sits in, or undefined when they span two roots
 * or one path sits in none or in more than one. */
function singleContainingRoot(paths: readonly string[], roots: readonly string[]): string | undefined {
  const normalized = [...new Set(roots.map((root) => normalizeFolderPath(root)).filter((root): root is string => root !== undefined))];
  let chosen: string | undefined;
  for (const path of paths) {
    const hits = normalized.filter((root) => pathInFolder(path, root));
    if (hits.length !== 1) return undefined;
    if (chosen === undefined) chosen = hits[0];
    else if (chosen !== hits[0]) return undefined;
  }
  return chosen;
}

/** 2026-10-26 (#1065): the second choice of "Toujours permettre", every
 * file of the folder of the one this card reads or changes (and its
 * subfolders), or undefined when it is not offered. An ordinary card
 * (no `from`, not held) of a call that reads files or changes them
 * offers the common parent, when that parent is not the root, a drive
 * or the home folder and holds no sensitive name. An admin card
 * (`from: "admin"`) offers one agent root only, and only for a read
 * whose every path sits in that one root (`call.roots`: the bot
 * workspace or this conversation's task folder). Never a command, a
 * write on an admin card, a held card or an outward send. A rule made
 * on a change covers every file-changing tool of that server in the
 * folder; a rule made on a read covers the other read-only file tools
 * of that server. `writes` says a change rule on the card. */
export function folderRuleCandidate(
  call: { tool: string; input?: string; command?: string; cwd?: string; app?: ScreenAppIdentity; roots?: readonly string[] },
  situation: { from?: RuleSituation; held?: boolean },
  words: ApprovalWords = ENGLISH_WORDS,
): (RuleCandidate & { writes?: true; from?: "admin" }) | undefined {
  if (situation.held === true || call.app) return undefined;
  if (situation.from !== undefined && situation.from !== "admin") return undefined;
  if (call.command?.trim()) return undefined;
  const input = ruleInputFor(call.input, call.command);
  if (!input) return undefined;
  const destructive = destructiveKindOf({ tool: call.tool, input });
  if (destructive === "external-message") return undefined;
  const changes = fileChangeTool(call.tool);
  const risk = describeApproval(call.tool, input).risk;
  if (destructive ? !changes : risk !== "read" && !(risk === "write" && changes)) return undefined;
  const paths = callFilePaths(input);
  if (!paths) return undefined;
  // any other exact argument (a command, a folder it runs in, a recipient
  // list) is outside what a folder covers
  const scope = callScopeFor({ input });
  if (Object.keys(scope).some((key) => !FILE_KEYS.has(key))) return undefined;
  if (paths.some((path) => sensitiveReadPath(path))) return undefined;
  const admin = situation.from === "admin";
  let folder: string | undefined;
  if (admin) {
    // An admin read keeps one agent root, never a write and never a
    // parent that would cover a sibling conversation.
    if (changes || risk !== "read" || !call.roots?.length) return undefined;
    const root = singleContainingRoot(paths, call.roots);
    folder = root ? normalizeFolderPath(root) : undefined;
    if (!folder || sensitiveReadPath(folder) || folderOfPath(`${folder}/x`, "") !== folder) return undefined;
  } else {
    folder = commonFolder(paths, call.tool);
    if (!folder || sensitiveReadPath(folder)) return undefined;
  }
  const key = changes ? "approval.rule.folderChanges" : "approval.rule.folder";
  const action = capitalize(approvalAction(call.tool, input, undefined, words));
  const worded = words.t(key, { action, folder });
  const fallback = changes
    ? `Create, change, rename, move and delete files in ${folder} and its subfolders`
    : `${action} in ${folder} and its subfolders`;
  return {
    tool: normalizeRuleTool(call.tool),
    scope: { [FOLDER_KEY]: folder },
    ...(changes ? { writes: true as const } : {}),
    ...(admin ? { from: "admin" as const } : {}),
    description: (worded === key ? fallback : worded).slice(0, 500),
  };
}

/** The rule "Toujours permettre" keeps for one app of this computer. */
export function appRuleCandidate(identity: ScreenAppIdentity, words: ApprovalWords = ENGLISH_WORDS): RuleCandidate {
  const key = "approval.rule.computerApp";
  const app = identity.label.trim();
  const worded = words.t(key, { app });
  return {
    tool: APP_RULE_TOOL,
    scope: appScope(identity) ?? {},
    description: (worded === key ? `Use ${app} on this computer (see it, click and type in it)` : worded).slice(0, 500),
  };
}

export function isRuleBehavior(value: unknown): value is RuleBehavior {
  return typeof value === "string" && (RULE_BEHAVIORS as readonly string[]).includes(value);
}
