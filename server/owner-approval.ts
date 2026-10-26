// What a bot's owner decided ahead of time (2026-10-14, JC):
// docs/superpowers/specs/2026-10-14-bot-owner-permissions.md.
//
// A bot acts with its owner's rights. A permission card that stays within
// those rights (the "owner" route of engine-access.ts) is answered by the
// owner's own rules and the bot's permission mode before it reaches them:
//
// - rules belong to a person (the owner), optionally narrowed to one bot,
//   and name one tool plus a scope read from the call's arguments (the
//   target: resource, operation, repository, host...), never "this tool,
//   whatever it does" unless the owner widened it on purpose;
// - deny wins over ask, which wins over allow;
// - a destructive call (a delete, a bulk change, an external email or SMS)
//   is covered only by an allow rule made for that same kind, in every
//   mode: never implicitly;
// - modes: approval (default: rules, then a card), auto (rules, then
//   approve what no rule covers unless it is destructive), bypass (no card
//   for the owner route, only the journal; deny rules and the destructive
//   rule still hold).
//
// Nothing here answers an admin card, a safety hold, a sandbox widening, a
// question or a guest's turn: the caller never asks (ownerDecision returns
// "card" for them). Pure: the store and the routes live in
// owner-approval-store.ts and index.ts.

import { createHash } from "node:crypto";

import { approvalAction, describeApproval, parseArgs, parseToolId, type ApprovalWords, ENGLISH_WORDS } from "../shared/approval-describe.ts";
import { sagaxFolder } from "../shared/human-id.ts";
import { singleProgramOf } from "../shared/read-only-command.ts";
import { readShell } from "../shared/custom-rules.ts";
import { isOutboundTool } from "../shared/outbound.ts";
import { screenAppTarget, type ScreenAppIdentity } from "../shared/computer-app.ts";
import { standingGrantsAllowed } from "./custom-rules-org.ts";

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
  /** 2026-10-19 (JC: "Toujours permettre" on every card): the situation
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
   * process id (server/computer-app.ts): its name, bundle id and signing
   * team, never from the call's arguments.
   * Set only for the person's own turn on their own computer. */
  app?: ScreenAppIdentity;
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
 * PR #508, server/mcp-permissions.ts resourceKeyForCall): a rule made on a
 * gateway `api_write` card names the same api, resource and verb, so an
 * Always allow for ticket updates never covers ticket creates. */
const TARGET_KEYS = ["api", "resource", "resource_prefix", "entity", "operation", "method", "verb", "action", "repo", "repository", "server", "domain", "url", "board", "channel", "to", "cc", "bcc"] as const;
const MAX_SCOPE_VALUE = 120;
/** 2026-10-19 (JC: a precise scope on every "Always allow"): keys kept on
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
/** The scope key that binds a rule to the whole call (every argument), for
 * the cards that never had a rule before (an admin's card, a held card, a
 * turn that is not the person's own): only that very request passes again. */
export const WHOLE_CALL_KEY = "call";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

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
  // 2026-10-20 (JC): the one program a plain command line runs, which a
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

/** Which destructive kind a call is, or undefined. A delete first, then a
 * change to two or more records at once, then a message that leaves the
 * organization (email, SMS, call). */
export function destructiveKindOf(call: Pick<RuleCall, "tool" | "input" | "hints">): DestructiveKind | undefined {
  const described = describeApproval(call.tool, call.input, call.hints);
  if (described.risk === "destructive") return "delete";
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
  const shellLine = typeof args?.command === "string" ? args.command
    : typeof args?.cmd === "string" ? args.cmd
      : typeof args?.script === "string" ? args.script
        : undefined;
  if (shellLine && readShell(shellLine).actions.has("delete")) return "delete";
  const writes = described.risk === "write" || described.risk === "execute";
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
  } else if (normalizeRuleTool(rule.tool) !== normalizeRuleTool(call.tool)) return false;
  if (rule.behavior === "allow" && Object.keys(rule.scope).length) {
    for (const key of Object.keys(callScope)) {
      if (STRICT_KEY_SET.has(key) && !(key in rule.scope) && !(PROGRAM_KEY in rule.scope && (key === "command" || key === "cmd"))) return false;
    }
  }
  for (const [key, value] of Object.entries(rule.scope)) {
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
  if (rule.behavior === "allow" && destructive && rule.destructive !== destructive) return false;
  return true;
}

/** The rule that decides a call: deny first, then ask, then allow; within
 * one behavior, the narrowest (most scope keys, one bot over all). While
 * the organization turned "Toujours permettre" off
 * (server/custom-rules-org.ts), no allow rule answers. */
export function matchOwnerRule(rules: readonly OwnerRule[], call: RuleCall): OwnerRule | undefined {
  const scope = callScopeFor(call);
  const destructive = destructiveKindOf(call);
  const weight = (rule: OwnerRule) => RULE_BEHAVIORS.indexOf(rule.behavior);
  const allowRules = standingGrantsAllowed();
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
   * (server/step-up-gate.ts callStepUpClasses): no rule and no mode allows
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
   * another person's destination): no rule of anyone answers it and none is
   * offered. 2026-10-19 (JC): the one situation "Always allow" never widens. */
  crossPerson?: boolean;
}): OwnerDecision {
  if (input.adminRoute) return { kind: "card", reason: "admin" };
  if (input.crossPerson) return { kind: "card", reason: "cross-person" };
  // 2026-10-19 (JC: "Toujours permettre" on every card): a held card (a
  // safety hold, a sandbox widening) and a turn that is not the person's own
  // are answered only by an allow rule the person saved from that same kind
  // of card; deny and ask rules answer as before.
  const situation: RuleSituation | undefined = input.personMustAnswer ? "hold" : input.autonomyRefused ? "origin" : undefined;
  const rule = matchOwnerRule(input.rules.filter((candidate) => candidate.behavior !== "allow" || ruleCoversSituation(candidate, situation)), input.call);
  if (rule?.behavior === "deny") return { kind: "deny", source: "owner-rule-deny", rule };
  if (input.stepUpRequired) return { kind: "card", reason: "step-up", ...(rule ? { rule } : {}) };
  if (situation) {
    if (rule?.behavior === "allow") return { kind: "allow", source: "owner-rule", rule };
    return { kind: "card", reason: situation, ...(rule ? { rule } : {}) };
  }
  if (rule?.behavior === "allow") return { kind: "allow", source: "owner-rule", rule };
  const destructive = destructiveKindOf(input.call);
  if (destructive) return { kind: "card", reason: "destructive", destructive, ...(rule ? { rule } : {}) };
  if (input.mode === "bypass") return { kind: "allow", source: "owner-bypass", ...(rule ? { rule } : {}) };
  if (rule?.behavior === "ask") return { kind: "card", reason: "ask-rule", rule };
  if (input.mode === "auto") return { kind: "allow", source: "owner-auto" };
  return { kind: "card", reason: "no-rule" };
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
 * (server/custom-rules-org.ts). */
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
  // 2026-10-20 (JC: "Toujours permettre" in one click, this program and not
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
  // 2026-10-20 (security review): a call with arguments but no target the
  // scope reads (a query, a body, recipients under another key) keeps the
  // whole request, never the whole tool
  const args = parseArgs(call.input);
  if (options.wholeCall || (Object.keys(scope).length === 0 && args && Object.keys(args).length > 0)) scope[WHOLE_CALL_KEY] = wholeCallDigest(call.input);
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

const NO_ARGUMENT_DIGESTS: ReadonlySet<string> = new Set([wholeCallDigest(undefined), wholeCallDigest("{}")]);

/** 2026-10-21 (review of #938): whether a scope may be kept from a card. An
 * empty scope is the whole tool, and the fingerprint of a call with no
 * arguments covers every such call (on main, every input-less shell line of
 * Codex or an ACP engine): neither is ever saved from a card. "Any target"
 * stays the person's explicit choice on their own rule (PATCH anyTarget). */
export function scopeRemembers(scope: RuleScope): boolean {
  const keys = Object.keys(scope);
  if (!keys.length) return false;
  return !(keys.length === 1 && keys[0] === WHOLE_CALL_KEY && NO_ARGUMENT_DIGESTS.has(scope[WHOLE_CALL_KEY]!));
}

/** What "Always allow" or "Always deny" on a permission card would keep, or
 * undefined when nothing safe can be kept.
 * - an ordinary card (no `from`): the target, a command as its one program;
 * - a card that never had a rule (`from`: an admin's, a held one, a turn
 *   that is not the person's own) keeps the whole request, every argument;
 * - 2026-10-21 (JC: "Toujours permettre" on a member's bot must stick): on
 *   an admin's card (or a holder's), the engine's own shell line is kept like
 *   on a solo bot, as its one program in its folder (else its exact text),
 *   for that bot only; the engine writes a new `description` beside each
 *   command, so the whole request never matched again;
 * - review of #938: a held card (a safety hold, a sandbox widening, Codex
 *   additional permissions or network, requiresExplicitApproval) keeps the
 *   whole request even when it is an admin's card. */
export function cardRuleCandidate(
  call: { tool: string; input?: string; command?: string; cwd?: string; app?: ScreenAppIdentity },
  situation: { from?: RuleSituation; held?: boolean },
  words: ApprovalWords = ENGLISH_WORDS,
): (RuleCandidate & { from?: RuleSituation }) | undefined {
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
  if (input === undefined || !input.trim()) return undefined;
  const args = parseArgs(input);
  if (args && Object.keys(args).length === 0) return undefined;
  const held = situation.held === true || situation.from === "hold";
  const nativeShell = situation.from === "admin" && !held && typeof call.command === "string" && call.command.trim().length > 0;
  const candidate = ruleCandidateFor({ tool: call.tool, input, ...(call.cwd ? { cwd: call.cwd } : {}) }, words, {
    wholeCall: situation.from !== undefined && !nativeShell,
    programScope: !held && (situation.from !== "admin" || nativeShell),
  });
  if (!scopeKeepable(candidate.scope) || !scopeRemembers(candidate.scope)) return undefined;
  return { ...candidate, ...(situation.from ? { from: situation.from } : {}) };
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

export function isBotPermissionMode(value: unknown): value is BotPermissionMode {
  return typeof value === "string" && (BOT_PERMISSION_MODES as readonly string[]).includes(value);
}

export function isRuleBehavior(value: unknown): value is RuleBehavior {
  return typeof value === "string" && (RULE_BEHAVIORS as readonly string[]).includes(value);
}
