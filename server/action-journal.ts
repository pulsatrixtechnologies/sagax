// The Journal of the Approvals screen (2026-10-26, shared/action-journal.ts):
// every action of the person's own bots, with what decided it.
//
// Nothing is captured for the Journal's sake. Three records already on disk
// know it between them: the decision log (server/decision-log.ts) says what
// was asked, which rule or level answered and who answered a card; the
// per-thread tool runs (server/activity.ts readToolRuns) say what ran and
// whether it failed, including what the engine ran without asking; the
// agent tools' audit rows (server/agent-api.ts and agent-tool-card-guard.ts,
// in the admin activity log) carry the tool guard's verdict. This module
// folds them into one row per action, the same way the bot's activity log
// does (server/activity.ts), and replays a rule over them ("Tester cette
// règle") with the real matcher (server/rules/custom-rules-review.ts).
//
// Pure: the server passes what the person may read (their bots, their
// confidential threads) and how to name things; this never reads a file.
import type { AdminActionRow } from "./admin-activity.ts";
import { hashJournalLink, JOURNAL_GENESIS, type JournalSealFields } from "./encryption/journal-seal.ts";
import type { ActivityRow } from "./activity.ts";
import type { DecisionActor, DecisionCall, DecisionKind, DecisionRow } from "./decision-log.ts";
import type { CustomRuleBehavior, CustomRuleDecision, RiskClass } from "../shared/custom-rules.ts";
import {
  JOURNAL_MAX_ENTRIES,
  RULE_TEST_MAX_HITS,
  ruleTestChanged,
  type JournalDecider,
  type JournalEntry,
  type JournalGuard,
  type JournalOutcome,
  type RuleTestEffect,
  type RuleTestHit,
  type RuleTestResult,
} from "../shared/action-journal.ts";

/** A Journal row as the server keeps it: the wire entry plus what a rule
 * test reads of the call (never sent). */
export interface JournalRow extends JournalEntry {
  call?: DecisionCall;
}

export interface JournalRuleInfo {
  text: string;
  behavior?: CustomRuleBehavior;
  org?: boolean;
}

export interface JournalInput {
  decisions: readonly DecisionRow[];
  /** agents.* rows of the admin activity log in the same window */
  agentAudit?: readonly AdminActionRow[];
  /** the tool runs of the person's threads, each with its bot */
  runs?: ReadonlyArray<{ botId: string; runs: readonly ActivityRow[] }>;
  /** the person may read this bot's row in this thread (their own bot, their
   * confidential thread) */
  owns(botId: string | undefined, threadId: string): boolean;
  botName(botId: string): string | undefined;
  /** a rule's words from its id, per the source that wrote it */
  rule(source: string, ruleId: string, botId: string): JournalRuleInfo | undefined;
  /** who answered a card, as the person reads it */
  answeredBy(actor: DecisionActor | undefined): string | undefined;
  /** the plain word for a bot that is gone */
  deletedBot: string;
  max?: number;
}

/** An approval is folded into the tool run it unblocked when the run
 * started inside this window around the decision (server/activity.ts). */
const MATCH_BEFORE_MS = 5_000;
const MATCH_AFTER_MS = 30_000;

const OUTCOME: Record<DecisionKind, JournalOutcome | null> = {
  "auto-approved": "allowed",
  "user-approved": "allowed",
  "auto-denied": "denied",
  "user-denied": "denied",
  "user-undone": "denied",
  expired: "expired",
  "card-shown": "asked",
  // the reviewer's shadow verdicts are not decisions
  "review-would-approve": null,
  "review-would-deny": null,
};

const SAFETY_SOURCES = new Set(["safety-hold", "explicit-approval-block"]);
const ALWAYS_SOURCES = new Set(["owner-rule", "owner-rule-deny", "owner-rule-ask", "command-allowlist", "allow-rule"]);
const ERROR_SOURCES = new Set(["restart", "auto-fallback"]);

/** What decided, in the person's terms, from the decision log's source. */
export function deciderOf(source: string, org = false): JournalDecider {
  if (source === "custom-rule" || source === "custom-rule-ask" || source === "custom-rule-deny") return org ? "org-rule" : "custom-rule";
  if (ALWAYS_SOURCES.has(source)) return "always-allow";
  if (source === "admin-rule") return "admin-rule";
  if (source === "owner-auto") return "level";
  if (source === "no-grant") return "level";
  if (source === "full-access" || source === "owner-bypass") return "full-access";
  if (source === "auto-review" || source === "auto-review-shadow") return "reviewer";
  if (source === "user") return "person";
  if (source === "expired" || source === "timeout") return "expired";
  if (ERROR_SOURCES.has(source)) return "error";
  if (SAFETY_SOURCES.has(source)) return "safety";
  return "sagax";
}

function guardOf(after: Record<string, unknown> | undefined): JournalGuard | undefined {
  if (!after || typeof after.guard !== "string") return undefined;
  return {
    allow: after.guardAllow === true,
    reason: after.guard,
    mode: typeof after.guardMode === "string" ? after.guardMode : "shadow",
    ...(typeof after.scope === "string" ? { scope: after.scope } : {}),
  };
}

/** One row per action, newest first. */
export function buildJournal(input: JournalInput): { rows: JournalRow[]; truncated: boolean } {
  const max = input.max ?? JOURNAL_MAX_ENTRIES;
  const nameOf = (botId: string, recorded?: string) => input.botName(botId) ?? recorded ?? input.deletedBot;

  // ── decisions, one group per request ──
  const groups = new Map<string, DecisionRow[]>();
  input.decisions.forEach((row, index) => {
    if (!row.botId || OUTCOME[row.decision] === undefined || OUTCOME[row.decision] === null) return;
    if (!input.owns(row.botId, row.threadId)) return;
    const key = row.requestId ? `${row.threadId}:${row.requestId}` : `row:${index}:${row.at}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  });
  const rows: JournalRow[] = [];
  const byRequest = new Map<string, JournalRow>();
  for (const [key, group] of groups) {
    const opened = group[0]!;
    const latest = group[group.length - 1]!;
    const botId = opened.botId!;
    const card = group.find((row) => row.decision === "card-shown");
    let outcome = OUTCOME[latest.decision]!;
    // an approval left open when Sagax restarted died with its request
    if (ERROR_SOURCES.has(latest.source) && outcome === "denied") outcome = "failed";
    const ruleRow = [...group].reverse().find((row) => (row.ruleId || row.rule) && row.source !== "user");
    const matchedRuleId = ruleRow?.ruleId ?? ruleRow?.rule;
    const rule = matchedRuleId ? input.rule(ruleRow!.source, matchedRuleId, botId) : undefined;
    const decider: JournalDecider = latest.decision === "expired" ? "expired"
      : latest.source === "user" || latest.source === "question" && latest.decision !== "card-shown" ? "person"
        : outcome === "failed" ? "error"
          : deciderOf(latest.source, latest === ruleRow && rule?.org === true);
    const askedBy = card && card !== latest ? deciderOf(card.source, card === ruleRow && rule?.org === true) : undefined;
    const summary = group.find((row) => row.summary)?.summary;
    const call = group.find((row) => row.call)?.call;
    const reason = group.find((row) => row.reason)?.reason;
    const answered = latest.source === "user" ? input.answeredBy(latest.actor) : undefined;
    const entry: JournalRow = {
      key,
      at: opened.at,
      botId,
      botName: nameOf(botId, opened.botName),
      threadId: opened.threadId,
      ...(opened.requestId ? { requestId: opened.requestId } : {}),
      tool: latest.tool ?? opened.tool ?? "action",
      ...(summary ? { summary: summary.slice(0, 400) } : {}),
      outcome,
      decider,
      source: latest.source,
      ...(askedBy ? { askedBy, askedSource: card!.source } : {}),
      ...(rule ? { ruleText: rule.text.slice(0, 300), ...(rule.behavior ? { ruleBehavior: rule.behavior } : {}), ruleId: matchedRuleId! } : {}),
      ...(reason ? { reason: reason.slice(0, 200) } : {}),
      ...(answered ? { answeredBy: answered } : {}),
      ...(group.some((row) => row.unattended) ? { unattended: true as const } : {}),
      ...(call ? { call, replayable: true as const } : {}),
    };
    rows.push(entry);
    if (opened.requestId) byRequest.set(opened.requestId, entry);
  }

  // ── tool runs: what ran, and what the engine ran without a card ──
  const runRows: Array<{ row: JournalRow; matched: boolean }> = [];
  for (const { botId, runs } of input.runs ?? []) {
    for (const run of runs) {
      if (!input.owns(botId, run.threadId)) continue;
      runRows.push({
        matched: false,
        row: {
          key: `run:${run.threadId}:${run.turnId ?? ""}:${run.at}:${run.tool}`,
          at: run.at,
          botId,
          botName: nameOf(botId),
          threadId: run.threadId,
          tool: run.tool,
          outcome: run.outcome === "failed" ? "failed" : "allowed",
          decider: run.outcome === "failed" ? "error" : "no-card",
          ...(run.outcome === "ran" || run.outcome === "failed" ? { ran: run.outcome } : {}),
        },
      });
    }
  }
  for (const entry of rows) {
    if (entry.outcome !== "allowed") continue;
    const askedAt = Date.parse(entry.at);
    let best: { row: JournalRow; matched: boolean } | null = null;
    for (const candidate of runRows) {
      if (candidate.matched || candidate.row.threadId !== entry.threadId || candidate.row.tool !== entry.tool) continue;
      const delta = Date.parse(candidate.row.at) - askedAt;
      if (delta < -MATCH_BEFORE_MS || delta > MATCH_AFTER_MS) continue;
      if (!best || Math.abs(delta) < Math.abs(Date.parse(best.row.at) - askedAt)) best = candidate;
    }
    if (!best) continue;
    best.matched = true;
    if (best.row.ran) entry.ran = best.row.ran;
    if (best.row.ran === "failed") entry.outcome = "failed";
  }

  // ── agent tools: the guard's verdict ──
  for (const audit of input.agentAudit ?? []) {
    if (!audit.action.startsWith("agents.")) continue;
    const after = audit.after ?? {};
    const callerBotId = typeof after.callerBotId === "string" ? after.callerBotId : undefined;
    if (!callerBotId) continue;
    const tool = audit.action.slice("agents.".length);
    const guard = guardOf(after);
    const requestId = typeof after.requestId === "string" ? after.requestId : undefined;
    const outcome = typeof after.outcome === "string" ? after.outcome : "";
    // the card's own rows: the guard's verdict joins the card's entry
    if (outcome === "card" || outcome === "declined" || outcome === "expired") {
      const entry = requestId ? byRequest.get(requestId) : undefined;
      if (entry && guard) entry.guard = guard;
      continue;
    }
    const threadId = typeof after.threadId === "string" ? after.threadId : "";
    if (!input.owns(callerBotId, threadId)) continue;
    const at = Date.parse(audit.at);
    const run = runRows.find((candidate) => candidate.row.botId === callerBotId && candidate.row.tool.replace(/^mcp__/, "").endsWith(`agents__${tool}`)
      && Math.abs(Date.parse(candidate.row.at) - at) <= MATCH_AFTER_MS && !candidate.row.guard);
    if (run && (outcome === "ok" || outcome === "error")) {
      if (guard) {
        run.row.guard = guard;
        if (run.row.decider === "no-card") run.row.decider = guard.reason === "grant" ? "grant" : "default";
      }
      continue;
    }
    const code = typeof after.code === "string" ? after.code : undefined;
    rows.push({
      key: `agents:${audit.at}:${tool}:${callerBotId}`,
      at: audit.at,
      botId: callerBotId,
      botName: nameOf(callerBotId, typeof after.callerBotName === "string" ? after.callerBotName : undefined),
      threadId,
      tool: `agents__${tool}`,
      outcome: outcome === "ok" ? "allowed" : outcome === "error" ? "failed" : "denied",
      decider: outcome === "ok" ? (guard?.reason === "grant" ? "grant" : "default")
        : outcome === "error" ? "error"
          : code === "not_granted" || after.phase === "pre_card" ? "grant" : "sagax",
      ...(code ? { source: code } : {}),
      ...(guard ? { guard } : {}),
    });
  }

  for (const candidate of runRows) if (!candidate.matched) rows.push(candidate.row);
  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key.localeCompare(b.key)));
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}

/** The wire entry, without what only a replay reads. */
export function journalWire(row: JournalRow): JournalEntry {
  const { call: _call, ...entry } = row;
  return entry;
}

/** What a rule test asks of the real matcher for one past action: the
 * decision of the person's rules with the draft among them, or null when
 * the action is not one a rule reads (a question, a proposal). */
export type ReplayDecision = (row: JournalRow) => CustomRuleDecision | null;

/** Replay a draft over past actions: what it would have allowed, held or
 * refused, and where that differs from what happened. `draftId` names the
 * draft among the rules the matcher was given. */
export function testRuleOnJournal(rows: readonly JournalRow[], draftId: string, replay: ReplayDecision, days: number, unreadable = false): RuleTestResult {
  const result: RuleTestResult = {
    days, scanned: 0, matched: 0,
    counts: { allowed: 0, asked: 0, denied: 0, cardStays: 0, changed: 0 },
    hits: [],
    ...(unreadable ? { unreadable: true as const } : {}),
  };
  if (unreadable) return result;
  for (const row of rows) {
    const decision = replay(row);
    if (!decision) continue;
    result.scanned += 1;
    let would: RuleTestEffect | null = null;
    let missing: RiskClass[] | undefined;
    if (decision.kind !== "none" && decision.rule.id === draftId) {
      would = decision.kind === "allow" ? "allowed" : decision.kind === "deny" ? "denied" : "asked";
    } else if (decision.kind === "none" && decision.riskBlocked?.rule.id === draftId) {
      would = "card-stays";
      missing = decision.riskBlocked.missing;
    }
    if (!would) continue;
    result.matched += 1;
    const changed = ruleTestChanged(row.outcome, would);
    if (would === "allowed") result.counts.allowed += 1;
    else if (would === "asked") result.counts.asked += 1;
    else if (would === "denied") result.counts.denied += 1;
    else result.counts.cardStays += 1;
    if (changed) result.counts.changed += 1;
    if (result.hits.length < RULE_TEST_MAX_HITS) {
      const hit: RuleTestHit = {
        key: row.key, at: row.at, botName: row.botName, tool: row.tool,
        ...(row.summary ? { summary: row.summary } : {}),
        actual: row.outcome, would, changed,
        ...(missing?.length ? { missing } : {}),
        ...(row.call ? {} : { approximate: true as const }),
      };
      result.hits.push(hit);
    }
  }
  // the changes first, then newest
  result.hits.sort((a, b) => Number(b.changed) - Number(a.changed) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return result;
}

export { JOURNAL_GENESIS, hashJournalLink, type JournalSealFields };

/** Whether a past action is one a rule reads: a tool call, never a
 * question or a proposal card. */

/** One link of the export. No summary, no rule words, no reason: those can
 * carry a message or a secret. The hash covers only the fields below. */
export interface JournalChainLink {
  at: string;
  botId: string;
  tool: string;
  outcome: string;
  decider: string;
  source: string;
  ran: string;
  prev: string;
  hash: string;
}

export interface JournalChain {
  version: 1;
  genesis: string;
  entries: JournalChainLink[];
}

/** Oldest first. Each hash is SHA-256 of the previous hash and this row's
 * decision fields. Prefer the links sealed on disk (journal-seal.ts):
 * hashing the live sources again would bless a rewritten file. */
export function sealJournal(entries: readonly JournalEntry[]): JournalChain {
  const ordered = [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key.localeCompare(b.key)));
  let prev = JOURNAL_GENESIS;
  const links = ordered.map((entry) => {
    const hash = hashJournalLink({
      at: entry.at,
      botId: entry.botId,
      tool: entry.tool,
      outcome: entry.outcome,
      decider: entry.decider,
      source: entry.source ?? "",
      ran: entry.ran ?? "",
    }, prev);
    const link: JournalChainLink = {
      at: entry.at,
      botId: entry.botId,
      tool: entry.tool,
      outcome: entry.outcome,
      decider: entry.decider,
      source: entry.source ?? "",
      ran: entry.ran ?? "",
      prev,
      hash,
    };
    prev = hash;
    return link;
  });
  return { version: 1, genesis: JOURNAL_GENESIS, entries: links };
}

/** Recompute every link. The first broken index, or ok.
 * When `sources` is the file as it is now, a rewritten row fails: its
 * fields no longer hash to the link sealed when it was written. */
export function verifyJournal(chain: JournalChain, sources?: readonly JournalSealFields[]): { ok: true } | { ok: false; index: number } {
  if (chain.version !== 1 || chain.genesis !== JOURNAL_GENESIS) return { ok: false, index: 0 };
  let prev = JOURNAL_GENESIS;
  for (let index = 0; index < chain.entries.length; index += 1) {
    const entry = chain.entries[index]!;
    if (entry.prev !== prev || hashJournalLink(entry, prev) !== entry.hash) return { ok: false, index };
    prev = entry.hash;
  }
  if (!sources) return { ok: true };
  if (sources.length !== chain.entries.length) return { ok: false, index: Math.min(sources.length, chain.entries.length) };
  prev = JOURNAL_GENESIS;
  for (let index = 0; index < sources.length; index += 1) {
    if (hashJournalLink(sources[index]!, prev) !== chain.entries[index]!.hash) return { ok: false, index };
    prev = chain.entries[index]!.hash;
  }
  return { ok: true };
}

export function replayable(row: JournalRow): boolean {
  if (row.source === "question" || row.askedSource === "question") return false;
  if (["proposal", "routine", "skill", "profile", "model"].includes(row.tool)) return false;
  return !["routine", "skill", "profile", "model", "self", "primary-bot", "team-memory"].includes(row.source ?? "");
}
