// The Journal tab of the Approvals screen (2026-10-26, chantier « Confiance »):
// every action of the signed-in person's own bots, allowed, asked (a card),
// refused, failed or expired, with what decided it. Built by the server
// (server/action-journal.ts) from what is already on disk: the decision log
// (server/decision-log.ts), the per-thread tool runs (server/activity/activity.ts)
// and the agent tools' audit rows (server/agent-api.ts, the tool guard).
//
// Read by the desktop (src/components/approvals/ApprovalsJournal.tsx) and
// iOS (ios/Sources/CompanionCore/ActionJournal.swift). Never an id on
// screen: `key`, `threadId`, `requestId` and `ruleId` route and select,
// nothing more.
import type { CustomRuleBehavior, RiskClass } from "./custom-rules.ts";

/** What happened to the action. */
export type JournalOutcome = "allowed" | "asked" | "denied" | "failed" | "expired";

/** What decided it, in the person's terms. */
export type JournalDecider =
  /** one of the person's own rules in their words (Settings > Security) */
  | "custom-rule"
  /** an organization rule (Refuser, Demander d'abord) */
  | "org-rule"
  /** a "Toujours permettre" rule, a saved command or a gate's Always allow */
  | "always-allow"
  /** an admin's saved rule on an admin card */
  | "admin-rule"
  /** the bot's approval level (Ask for approval asks, Approve for me answers) */
  | "level"
  /** Full access */
  | "full-access"
  /** a tool access grant (the tool guard) */
  | "grant"
  /** allowed by default, nothing to grant (the tool guard) */
  | "default"
  /** the automatic reviewer (examen automatique) applied a rule */
  | "reviewer"
  /** a safety hold kept the card */
  | "safety"
  /** Sagax's own allowance (its own tools, the person's own environment, a read) */
  | "sagax"
  /** a person answered the card */
  | "person"
  /** nobody answered in time */
  | "expired"
  /** something broke: the tool failed, the app restarted, the answer was not delivered */
  | "error"
  /** the engine ran it without a card at this level */
  | "no-card";

/** The tool guard's verdict on an agent tool call (server/tools/tool-guard.ts). */
export interface JournalGuard {
  allow: boolean;
  /** default, grant, not_granted, speaker_not_granted */
  reason: string;
  /** shadow (the default: recorded only), enforce, off */
  mode: string;
  /** the scope the call needed, `<area>:<tier>` */
  scope?: string;
}

export interface JournalEntry {
  /** selection and replay: the request id, or a stable synthetic key */
  key: string;
  /** when it was asked or started (ISO) */
  at: string;
  botId: string;
  botName: string;
  threadId: string;
  requestId?: string;
  /** the engine's tool name, for the plain title (never shown raw) */
  tool: string;
  /** the call's one line, already redacted */
  summary?: string;
  outcome: JournalOutcome;
  decider: JournalDecider;
  /** the raw decision-log source, for the precise label */
  source?: string;
  /** what kept a card in front of the person, when one was shown */
  askedBy?: JournalDecider;
  askedSource?: string;
  /** the rule's own words (a custom rule's "when", an Always allow's
   * description), when a rule decided */
  ruleText?: string;
  ruleBehavior?: CustomRuleBehavior;
  /** the rule's id: Edit rule, Test this rule; never shown */
  ruleId?: string;
  /** the automatic reviewer's reason */
  reason?: string;
  /** who answered, as the person reads it ("you" for their own answer) */
  answeredBy?: string;
  /** the turn ran with nobody at the keyboard */
  unattended?: true;
  /** the tool ran and then failed (outcome "failed") or finished */
  ran?: "ran" | "failed";
  guard?: JournalGuard;
  /** the call's arguments were kept, so a rule test reads it exactly */
  replayable?: true;
}

export interface JournalPayload {
  entries: JournalEntry[];
  /** the window read, in days */
  days: number;
  /** more actions happened than the list holds */
  truncated?: true;
}

/** `answeredBy` when the person answered the card themselves: the
 * client says "you" in its own language. */
export const JOURNAL_SELF = "@self";

export const JOURNAL_DAYS = [7, 30] as const;
export const JOURNAL_DEFAULT_DAYS = 7;
export const JOURNAL_MAX_ENTRIES = 1_000;
export const RULE_TEST_DAYS = 7;
export const RULE_TEST_MAX_HITS = 200;

export function journalDays(raw: string | null | undefined): number {
  const n = Number(raw);
  return (JOURNAL_DAYS as readonly number[]).includes(n) ? n : JOURNAL_DEFAULT_DAYS;
}

// ── filters ─────────────────────────────────────────────────────────────

export type JournalOutcomeFilter = "" | JournalOutcome;

/** The rows that match an outcome, a bot and a free-text search (bot, tool,
 * summary, rule), newest first. */
export function filterJournal(entries: readonly JournalEntry[], filters: { outcome: JournalOutcomeFilter; bot: string; q: string }): JournalEntry[] {
  const needle = filters.q.trim().toLowerCase();
  return entries
    .filter((entry) => !filters.outcome || entry.outcome === filters.outcome)
    .filter((entry) => !filters.bot || entry.botId === filters.bot)
    .filter((entry) => !needle || [entry.botName, entry.tool, entry.summary, entry.ruleText, entry.answeredBy]
      .some((field) => typeof field === "string" && field.toLowerCase().includes(needle)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key.localeCompare(b.key)));
}

export function journalCounts(entries: readonly JournalEntry[]): Record<JournalOutcome, number> {
  const counts: Record<JournalOutcome, number> = { allowed: 0, asked: 0, denied: 0, failed: 0, expired: 0 };
  for (const entry of entries) counts[entry.outcome] += 1;
  return counts;
}

// ── Test this rule ──────────────────────────────────────────────────────

/** A rule to replay: a saved one (its id) or a draft not saved yet. */
export interface RuleTestDraft {
  /** a saved rule being edited: it replaces that rule in the replay */
  id?: string;
  when: string;
  behavior: CustomRuleBehavior;
  /** one bot, or null for all of the person's bots */
  botId: string | null;
  riskScope: RiskClass[];
}

/** What the rule would have done to one past action. */
export type RuleTestEffect = "allowed" | "asked" | "denied" | "card-stays";

export interface RuleTestHit {
  key: string;
  at: string;
  botName: string;
  tool: string;
  summary?: string;
  /** what really happened */
  actual: JournalOutcome;
  /** what the rule would have done */
  would: RuleTestEffect;
  /** the rule changes the outcome */
  changed: boolean;
  /** an allow that matched but leaves these risk classes unticked */
  missing?: RiskClass[];
  /** the call's arguments were not kept (an older action): read from its one line */
  approximate?: true;
}

export interface RuleTestResult {
  days: number;
  /** actions read */
  scanned: number;
  /** actions the rule touches */
  matched: number;
  counts: { allowed: number; asked: number; denied: number; cardStays: number; changed: number };
  hits: RuleTestHit[];
  /** the phrase named nothing the matcher can read: it would match nothing */
  unreadable?: true;
}

/** Whether the rule's effect differs from what really happened. */
export function ruleTestChanged(actual: JournalOutcome, would: RuleTestEffect): boolean {
  if (would === "card-stays") return false;
  if (would === "denied") return actual !== "denied";
  if (would === "allowed") return actual !== "allowed";
  // ask: a card would show where none did
  return actual === "allowed" || actual === "failed";
}
