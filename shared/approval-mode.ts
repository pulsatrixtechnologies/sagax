/** The approval levels exposed by the app. Each one is a provider's own
 * permission mode, passed through: Sagax never decides a permission
 * itself (Full access aside, which answers residual prompts because that is
 * what the person granted). The order is the order the selector shows. */
export const APPROVAL_MODES = ["ask", "edits", "auto", "full", "custom"] as const;

export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** Why a thread keeps its own approval level instead of its bot's
 * (WireTask.approvalOwn, #1169/#1170). Every other thread follows its bot's
 * current level at the start of each turn: nothing is copied at creation. */
export const APPROVAL_EXCEPTIONS = ["thread", "delegated", "engine", "safety"] as const;
export type ApprovalException = (typeof APPROVAL_EXCEPTIONS)[number];
export function isApprovalException(value: unknown): value is ApprovalException {
  return typeof value === "string" && (APPROVAL_EXCEPTIONS as readonly string[]).includes(value);
}

/** The level a thread runs at as stored: its own while it holds an
 * exception, else its bot's, live. Standing approvals: an exception keeps
 * only its own; a thread that follows the bot gets the bot's and those
 * saved in the thread. Server (projectBotForTask) and clients share it. */
export function threadApprovalFields<B extends { approvalMode?: unknown; autoApprove?: boolean; alwaysAllow?: string[] }>(
  bot: B,
  task: { approvalOwn?: unknown; approvalMode?: unknown; autoApprove?: boolean; alwaysAllow?: string[] },
): Pick<B, "approvalMode" | "autoApprove" | "alwaysAllow"> {
  if (isApprovalException(task.approvalOwn)) {
    return {
      approvalMode: (task.approvalMode ?? (task.autoApprove === undefined ? bot.approvalMode : undefined)) as B["approvalMode"],
      autoApprove: task.autoApprove ?? bot.autoApprove,
      alwaysAllow: [...(task.alwaysAllow ?? bot.alwaysAllow ?? [])],
    };
  }
  return {
    approvalMode: bot.approvalMode as B["approvalMode"],
    autoApprove: bot.autoApprove,
    alwaysAllow: [...new Set([...(bot.alwaysAllow ?? []), ...(task.alwaysAllow ?? [])])],
  };
}

/** Only providers with an implemented permission mapping may expose a level.
 * `edits` (auto-accept edits) exists where the engine has such a mode:
 * Claude and Grok `acceptEdits`, Antigravity `auto_edit`, Qwen `auto-edit`,
 * Gemini `auto_edit`. Codex's Ask already runs `workspace-write`, so an edits
 * level would change nothing there. Full access, the default level (omb #2808),
 * runs on every engine: in the engine's own most permissive mode, or, where
 * it has none, with the harness answering the permission requests it leaves. */
export function supportsApprovalMode(driverKind: string | undefined, mode: ApprovalMode): boolean {
  if (mode === "custom") return driverKind === "codex";
  if (mode === "edits") return ["claudeAgent", "grokAgent", "antigravityAgent", "qwenAgent", "geminiAgent"].includes(driverKind ?? "");
  // Full access runs on every engine (omb #2808), including the
  // chat-completions family where the harness answers its own tool gate.
  return true;
}

/** Whether switching engines must first drop this level to Ask. A Custom
 * grant's rules belong to one provider's tool semantics, so it never crosses
 * engines. Full carries silently to any engine: the person gave this bot Full
 * access, and changing its engine must not take it back or ask again (owner
 * decision, Oct 12). Auto-accept edits stops at an engine without it.
 * Adapted from tahodev's provider-switch guard (#1120). */
export function modelSwitchNeedsAsk(
  mode: ApprovalMode,
  fromDriver: string | undefined,
  toDriver: string | undefined,
): boolean {
  return !supportsApprovalMode(toDriver, mode) ||
    (mode === "custom" && fromDriver !== toDriver);
}

export function hasNativeAutoReview(driverKind: string | undefined): boolean {
  // Qwen Code's `--approval-mode auto` is an LLM classifier that approves
  // safe actions and blocks risky ones — a reviewer, not a rubber stamp.
  return ["codex", "claudeAgent", "cursorAgent", "grokAgent", "qwenAgent"].includes(driverKind ?? "");
}

const APPROVAL_RANK: Record<ApprovalMode, number> = { ask: 0, edits: 1, auto: 2, full: 3, custom: 4 };

export function approvalModeWidens(from: ApprovalMode, to: ApprovalMode): boolean {
  return APPROVAL_RANK[to] > APPROVAL_RANK[from];
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value);
}

/** The level a bot or conversation runs at until a person picks one: Full
 * access, as in t3code (omb #2808 / PRO-RÈGLE). Each provider maps it to
 * its own most permissive mode; a real question or a missing credential
 * still reaches a person. */
export const DEFAULT_APPROVAL_MODE: ApprovalMode = "full";

let defaultApprovalMode: ApprovalMode = DEFAULT_APPROVAL_MODE;

/** On a shared company / organization workspace Full access comes only from
 * the owner's own grant, so those servers make Ask (or the org New-bot
 * policy) the default once, at startup. */
export function setDefaultApprovalMode(mode: ApprovalMode): void {
  defaultApprovalMode = mode;
}

/** Resolve the durable mode. A bot or conversation nobody has set a level on
 * runs at the default. The legacy Auto bit, written before approvalMode
 * existed, stays safe Auto, and an unknown persisted value fails closed to
 * Ask. */
export function approvalModeFor(bot: {
  approvalMode?: unknown;
  autoApprove?: unknown;
  /** Server-only two-phase grant marker. Until Electron confirms it, the
   * stored elevated selection is deliberately executable only as Ask. */
  approvalGrant?: unknown;
  threadId?: string;
}): ApprovalMode {
  const grant = bot.approvalGrant;
  const otherThread = grant && typeof grant === "object" && "threadOnly" in grant && grant.threadOnly === true &&
    "threadId" in grant && typeof grant.threadId === "string" && typeof bot.threadId === "string" && grant.threadId !== bot.threadId;
  if (grant && !otherThread) return "ask";
  if (isApprovalMode(bot.approvalMode)) return bot.approvalMode;
  if (bot.autoApprove === true) return "auto";
  return bot.approvalMode === undefined ? defaultApprovalMode : "ask";
}

/** Ask, Edits and Auto can change while the bot is working. The next
 * approval in that turn reads the new level. A stricter one also reaches the
 * running engine, or stops the turn when the engine cannot take it (#1373,
 * applyStricterApprovalLive). Full and Custom still wait. */
const LIVE_APPROVAL_LEVELS = new Set<ApprovalMode>(["ask", "edits", "auto"]);

export function liveApprovalChange(current: ApprovalMode, next: ApprovalMode): boolean {
  return LIVE_APPROVAL_LEVELS.has(current) && LIVE_APPROVAL_LEVELS.has(next);
}

/** #1373: Auto to Edits or Ask, or Edits to Ask, while a turn runs. */
export function liveApprovalTightens(current: ApprovalMode, next: ApprovalMode): boolean {
  return liveApprovalChange(current, next) && APPROVAL_RANK[next] < APPROVAL_RANK[current];
}

/** A private late-grant recovery may revoke an elevated mode even after a
 * turn began. It can only move to the fail-closed Ask mode. Ask, Edits and
 * Auto use liveApprovalChange instead. */
export function isEmergencyApprovalDowngrade(
  current: ApprovalMode,
  next: ApprovalMode,
): boolean {
  return next === "ask" && (current === "full" || current === "custom");
}

/** 2026-10-26 (one approval level): the level an engine runs natively
 * for one turn. Full access with an Ask or Deny rule in force (the
 * person's own, the bot's or the organization's) runs the engine at Ask, so
 * every call it would have made unasked reaches Sagax: the rule decides
 * the calls it covers and Sagax answers the rest as Full access
 * (auto-approve.ts autoVerdict "full-access"). The server keeps judging
 * with the bot's own level; only the engine's native mode changes. */
export function engineApprovalMode(level: ApprovalMode, rulesHold: boolean): ApprovalMode {
  return level === "full" && rulesHold ? "ask" : level;
}

/** Why the level a conversation runs at is not the bot's own setting
 * (2026-10-28, one source of truth: what the selector shows is what the
 * server applies). The server works it out where it judges a turn
 * (approvalModeForTurn); every client reads it, never guesses it.
 * - thread, delegated, engine, safety: the conversation holds its own level
 *   (WireTask.approvalOwn);
 * - pending: a Full or Custom choice still waits for its confirmation;
 * - consent: Full needs the bot's current owner to confirm it;
 * - member-policy: the organization keeps this level off for members' bots;
 * - engine-unsupported: the conversation's engine cannot run this level;
 * - guest: someone else drives this turn on a Cloud home;
 * - mail: a routine woken by an email runs at Ask. */
export const APPLIED_LEVEL_REASONS = [
  "thread", "delegated", "engine", "safety", "pending", "consent", "member-policy", "engine-unsupported", "guest", "mail",
] as const;
export type AppliedLevelReason = (typeof APPLIED_LEVEL_REASONS)[number];

/** The level a conversation really runs at, when it is not the bot's own
 * setting; absent when both are the same. */
export interface AppliedApprovalLevel {
  mode: ApprovalMode;
  reason: AppliedLevelReason;
}

export function isAppliedLevelReason(value: unknown): value is AppliedLevelReason {
  return typeof value === "string" && (APPLIED_LEVEL_REASONS as readonly string[]).includes(value);
}

/** The first reason, in the order the server applies them, that keeps a
 * conversation off its bot's setting. `applied` is the level the server
 * computed for the turn; `checks` are the facts the server read. */
export function appliedLevelReason(setting: ApprovalMode, applied: ApprovalMode, checks: {
  /** the conversation's own exception (WireTask.approvalOwn), if any */
  threadException?: unknown;
  /** the level that exception holds */
  threadLevel?: ApprovalMode;
  pending?: boolean;
  consentMissing?: boolean;
  memberPolicy?: boolean;
  guest?: boolean;
  mail?: boolean;
}): AppliedLevelReason | undefined {
  if (applied === setting) return undefined;
  if (checks.pending) return "pending";
  if (isApprovalException(checks.threadException) && checks.threadLevel !== undefined && checks.threadLevel !== setting) return checks.threadException;
  if (checks.guest) return "guest";
  if (checks.mail) return "mail";
  if (setting === "full" && checks.consentMissing) return "consent";
  if (checks.memberPolicy) return "member-policy";
  return "engine-unsupported";
}

/** Whether a conversation's own exception may give way to its bot's
 * setting at start-up (2026-10-28 migration): an exception nobody chose in
 * that conversation ("engine": an engine change asked again; "safety": a
 * grant that never finished), narrower than the bot's setting, on an engine
 * that runs the bot's setting. A person's own choice in the conversation
 * ("thread") and a Primary Bot's handoff ("delegated") stay, and a level is
 * never narrowed. */
export function staleThreadException(input: {
  exception: unknown;
  threadLevel: ApprovalMode;
  setting: ApprovalMode;
  engineRunsSetting: boolean;
}): boolean {
  if (input.exception !== "engine" && input.exception !== "safety") return false;
  if (!input.engineRunsSetting) return false;
  // Custom is a separate grant, never reached by this pass
  if (input.setting === "custom" || input.threadLevel === "custom") return false;
  return approvalModeWidens(input.threadLevel, input.setting);
}

/** The bot's own setting as a client reads it: `approvalSetting` from a
 * server that sends it (never a conversation's level), else the record's
 * level as before. */
export function botApprovalSetting(bot: { approvalSetting?: unknown; approvalMode?: unknown; autoApprove?: unknown; approvalGrant?: unknown }): ApprovalMode {
  return isApprovalMode(bot.approvalSetting) ? bot.approvalSetting : approvalModeFor(bot);
}
