// #2698: the per-bot proactivity ledger (wakes, proposals, writes, cost,
// precision, time saved), the proposals' events that feed it, and
// GET /api/bots/:id/proactive-metrics.
import { createServer, type Server } from "node:http";
import { mkdtempSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { requiredScope } from "../auth/request-auth.ts";
import { json, readBody } from "../harness/http.ts";
import { createProactiveMetricsRoutes } from "../routes/proactive-metrics.ts";
import { dispatchRoutes } from "../routes/table.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { aggregateProactiveMetrics, aggregateUsefulness, IGNORED_AFTER_HOURS, MINUTES_PER_ACCEPTED, MINUTES_PER_REPORT, MINUTES_PER_WRITE, type ProactiveMetrics } from "../../shared/proactive-metrics.ts";
import type { RoutineRun } from "../../shared/routines.ts";
import { recordCardAnswer } from "./answer-learning.ts";
import { ProactiveMetricsLedger, signalRoutineId, usefulnessSources } from "./proactive-metrics.ts";
import { cardSignalEnding, settleCardSignals, SignalLedger, signalKeys, type SignalEntry, type SignalLedgerStorage } from "./signal-ledger.ts";
import { REACH_CARD_KIND, REACH_NOTICE_KIND } from "../reach-me/service.ts";
import { ROUTINE_PROBLEM_KIND } from "../routines/routine-problem-card.ts";
import { PROPOSAL_TTL_MS, ProactiveProposals, type ProactiveProposalEvent } from "./proactive-wake.ts";

const NOW = Date.UTC(2026, 10, 8, 15, 0, 0);
const DAY = 86_400_000;
const dirs: string[] = [];
const servers: Server[] = [];

afterAll(async () => {
  for (const server of servers) await new Promise<void>((done) => server.close(() => done()));
  for (const dir of dirs) removeTempDir(dir);
});

function wake(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, botId: "pepper", status, proactive: { mode: "act" }, finishedAt: NOW, ...extra } as never;
}

describe("ProactiveMetricsLedger", () => {
  it("counts a settled wake once, by its end, with its cost", () => {
    const ledger = new ProactiveMetricsLedger({ file: null, now: () => NOW });
    expect(ledger.noteRun(wake("r1", "running"))).toBe(false);
    expect(ledger.noteRun(wake("r1", "completed", { cost: 0.25 }))).toBe(true);
    expect(ledger.noteRun(wake("r1", "completed", { cost: 0.25 }))).toBe(false);
    ledger.noteRun(wake("r2", "completed", { quiet: true, cost: 0.05 }));
    ledger.noteRun(wake("r3", "nothing_to_report"));
    ledger.noteRun(wake("r4", "failed"));
    ledger.noteRun(wake("r5", "cancelled"));
    ledger.noteRun({ id: "r6", botId: "pepper", status: "completed" } as never);
    const { totals } = ledger.read("pepper", 7);
    expect(totals).toMatchObject({ wakes: 5, reported: 1, quiet: 2, failed: 1, cost: 0.3, costRuns: 2 });
  });

  it("derives precision and the time estimate from the counts", () => {
    const ledger = new ProactiveMetricsLedger({ file: null, now: () => NOW });
    ledger.noteRun(wake("r1", "completed"));
    ledger.count("pepper", "proposed", 5);
    ledger.count("pepper", "accepted", 3);
    ledger.count("pepper", "declined");
    ledger.count("pepper", "expired");
    ledger.count("pepper", "writes", 4);
    const { totals } = ledger.read("pepper", 7);
    expect(totals.precision).toBeCloseTo(0.6);
    expect(totals.minutesSaved).toBe(MINUTES_PER_REPORT + 4 * MINUTES_PER_WRITE + 3 * MINUTES_PER_ACCEPTED);
    expect(ledger.read("ghost", 7).totals.precision).toBeNull();
  });

  it("cuts days in the range and keeps older days out of a short window", () => {
    let now = NOW - 10 * DAY;
    const ledger = new ProactiveMetricsLedger({ file: null, now: () => now });
    ledger.count("pepper", "writes", 2);
    now = NOW;
    ledger.count("pepper", "writes");
    expect(ledger.read("pepper", 7).totals.writes).toBe(1);
    const month = ledger.read("pepper", 30);
    expect(month.totals.writes).toBe(3);
    expect(month.series).toHaveLength(30);
    expect(month.to).toBe("2026-11-08");
  });

  it("persists at 0600 and reloads, and forgets a deleted bot", () => {
    const dir = mkdtempSync(join(tmpdir(), "proactive-metrics-"));
    dirs.push(dir);
    const file = join(dir, "proactive-metrics.json");
    const first = new ProactiveMetricsLedger({ file, now: () => NOW, saveNow: true });
    first.noteRun(wake("r1", "completed", { cost: 1 }));
    first.count("pepper", "accepted");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const second = new ProactiveMetricsLedger({ file, now: () => NOW, saveNow: true });
    expect(second.read("pepper", 7).totals).toMatchObject({ wakes: 1, accepted: 1, cost: 1 });
    expect(second.noteRun(wake("r1", "completed", { cost: 1 }))).toBe(false);
    second.forgetBot("pepper");
    expect(new ProactiveMetricsLedger({ file, now: () => NOW }).read("pepper", 7).totals.wakes).toBe(0);
  });

  it("reads a damaged stored day as zeros", () => {
    const out = aggregateProactiveMetrics("pepper", { "2026-11-08": { wakes: -1, writes: "x", accepted: 2 } }, ["2026-11-08"]);
    expect(out.totals).toMatchObject({ wakes: 0, writes: 0, accepted: 2 });
  });
});

describe("ProactiveProposals events", () => {
  it("tells proposed, accepted, declined and expired", () => {
    let now = NOW;
    const proposals = new ProactiveProposals(null, () => now);
    const events: ProactiveProposalEvent[] = [];
    proposals.observe((event) => events.push(event));
    const base = { botId: "pepper", threadId: "t", messageId: "m", events: [], more: 0, hops: 0, confined: false };
    const a = proposals.add(base);
    const b = proposals.add(base);
    proposals.add(base);
    proposals.answer(a.id, "accepted");
    proposals.answer(a.id, "declined");
    proposals.answer(b.id, "declined");
    now += PROPOSAL_TTL_MS + 1;
    proposals.open();
    expect(events.map((event) => event.kind)).toEqual(["proposed", "proposed", "proposed", "accepted", "declined", "expired"]);
    proposals.open();
    expect(events).toHaveLength(6);
  });
});

describe("GET /api/bots/:id/proactive-metrics", () => {
  async function serve(): Promise<string> {
    const ledger = new ProactiveMetricsLedger({ file: null, now: () => NOW });
    ledger.count("pepper", "writes", 2);
    const routes = [createProactiveMetricsRoutes<{ id: string; owner: string }>({
      bot: (id) => (id === "pepper" ? { id, owner: "alice" } : undefined),
      sees: (auth, bot) => (auth as { kind: string }).kind === "loopback" || ["alice", "bob"].includes((auth as { session: { principalId: string } }).session.principalId) && Boolean(bot),
      seesAll: (auth, bot) => (auth as { kind: string }).kind === "loopback" || (auth as { session: { principalId: string } }).session.principalId === bot.owner,
      read: (botId, days) => ledger.read(botId, days),
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-viewer"];
      const auth = typeof who === "string" ? { kind: "session", session: { principalId: who } } : { kind: "loopback" };
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: auth as never, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("answers the owner, hides the bot from others, checks days", async () => {
    const base = await serve();
    const get = async (path: string, viewer?: string) => {
      const res = await fetch(`${base}${path}`, { headers: viewer ? { "x-viewer": viewer } : {} });
      return { status: res.status, body: await res.json() as ProactiveMetrics & { error?: string } };
    };
    const owner = await get("/api/bots/pepper/proactive-metrics?days=30", "alice");
    expect(owner.status).toBe(200);
    expect(owner.body.days).toBe(30);
    expect(owner.body.totals.writes).toBe(2);
    expect((await get("/api/bots/pepper/proactive-metrics", "bob")).status).toBe(404);
    expect((await get("/api/bots/pepper/proactive-metrics", "eve")).status).toBe(404);
    expect((await get("/api/bots/ghost/proactive-metrics")).status).toBe(404);
    expect((await get("/api/bots/pepper/proactive-metrics?days=12")).status).toBe(400);
    expect(requiredScope("GET", "/api/bots/pepper/proactive-metrics")).toBe("client");
  });
});

const HOUR = 3_600_000;

function memoryStorage(): SignalLedgerStorage & { saved: Map<string, SignalEntry[]> } {
  const saved = new Map<string, SignalEntry[]>();
  return {
    saved,
    load: () => (saved.size ? new Map([...saved].map(([person, entries]) => [person, JSON.parse(JSON.stringify(entries)) as SignalEntry[]])) : null),
    save: (person, entries) => { saved.set(person, JSON.parse(JSON.stringify(entries)) as SignalEntry[]); },
  };
}

function run(id: string, routineId: string, status: string, extra: Record<string, unknown> = {}): RoutineRun {
  return { id, routineId, routineName: `Routine ${routineId}`, botId: "pepper", status, scheduledFor: NOW - HOUR, finishedAt: NOW - HOUR, ...extra } as unknown as RoutineRun;
}

describe("#4250 (S9): usefulness from the signal ledger and the routine runs", () => {
  it("counts told, answered, ignored and the median time to answer, per bot and routine", () => {
    const now = NOW;
    const range = { from: NOW - 7 * 24 * HOUR, to: NOW, now };
    const { usefulness, routines } = aggregateUsefulness({
      signals: [
        { state: "answered", firstAt: NOW - 10 * HOUR, toldAt: NOW - 10 * HOUR, answeredAt: NOW - 9 * HOUR, routineId: "rt-a", awaits: true },
        { state: "answered", firstAt: NOW - 8 * HOUR, toldAt: NOW - 8 * HOUR, answeredAt: NOW - 5 * HOUR, routineId: "rt-a", awaits: true },
        { state: "expired", firstAt: NOW - 30 * HOUR, toldAt: NOW - 30 * HOUR, routineId: "rt-b", awaits: true },
        // still waiting past the threshold, and one still fresh
        { state: "told", firstAt: NOW - (IGNORED_AFTER_HOURS + 1) * HOUR, toldAt: NOW - HOUR, awaits: true },
        { state: "told", firstAt: NOW - HOUR, toldAt: NOW - HOUR, routineId: "rt-b", awaits: true },
        // the cause went away by itself: told, neither answered nor ignored
        { state: "retired", firstAt: NOW - 2 * HOUR, toldAt: NOW - 2 * HOUR, awaits: true },
        // a notice told for information (a run's failure), a day old: told only
        { state: "told", firstAt: NOW - (IGNORED_AFTER_HOURS + 5) * HOUR, toldAt: NOW - (IGNORED_AFTER_HOURS + 5) * HOUR, routineId: "rt-b" },
        // never told, and told before the range: left out
        { state: "open", firstAt: NOW - HOUR, awaits: true },
        { state: "answered", firstAt: NOW - 9 * 24 * HOUR, toldAt: NOW - 9 * 24 * HOUR, answeredAt: NOW - 9 * 24 * HOUR + HOUR, routineId: "rt-a", awaits: true },
      ],
      runs: [
        { routineId: "rt-a", routineName: "Inbox sweep", status: "nothing_to_report", scheduledFor: NOW - 3 * HOUR, finishedAt: NOW - 3 * HOUR },
        { routineId: "rt-a", routineName: "Inbox sweep", status: "nothing_to_report", scheduledFor: NOW - 2 * HOUR, finishedAt: NOW - 2 * HOUR },
        { routineId: "rt-a", routineName: "Inbox sweep", status: "completed", scheduledFor: NOW - HOUR, finishedAt: NOW - HOUR },
        { routineId: "rt-b", routineName: "Backups", status: "nothing_to_report", scheduledFor: NOW - 20 * 24 * HOUR },
      ],
      turns: [
        { at: NOW - HOUR, tokens: 9_000, routineId: "rt-a" },
        { at: NOW - 2 * HOUR, tokens: 3_000, routineId: "rt-b" },
        { at: NOW - 20 * 24 * HOUR, tokens: 50_000, routineId: "rt-a" },
      ],
      // the routine store's current name comes before a kept run's
      routineName: (routineId) => (routineId === "rt-b" ? "Nightly backups" : undefined),
    }, range);
    expect(usefulness).toEqual({ told: 7, answered: 2, ignored: 2, medianAnswerMs: 2 * HOUR, turnsAvoided: 2, tokens: 12_000, tokensPerAnswered: 6_000 });
    expect(routines).toEqual([
      { routineId: "rt-b", name: "Nightly backups", told: 3, answered: 0, ignored: 1, medianAnswerMs: null, turnsAvoided: 0, tokens: 3_000, tokensPerAnswered: null },
      { routineId: "rt-a", name: "Inbox sweep", told: 2, answered: 2, ignored: 0, medianAnswerMs: 2 * HOUR, turnsAvoided: 2, tokens: 9_000, tokensPerAnswered: 4_500 },
    ]);
  });

  it("finds an entry's routine by its key, its run or the conversation it points at", () => {
    const byId = new Map([["run-1", run("run-1", "rt-a", "completed")]]);
    const byThread = new Map([["thread-9", run("run-9", "rt-c", "completed")]]);
    const runs = { byId, byThread };
    expect(signalRoutineId({ key: "routine-problem:rt-x" }, runs)).toBe("rt-x");
    expect(signalRoutineId({ key: "away-skips:rt-y:123" }, runs)).toBe("rt-y");
    expect(signalRoutineId({ key: "routine-cheap-path:rt-z" }, runs)).toBe("rt-z");
    expect(signalRoutineId({ key: "routine-suspended:rt-z:person_out:5" }, runs)).toBe("rt-z");
    expect(signalRoutineId({ key: signalKeys.runProblem("run-1", "failed") }, runs)).toBe("rt-a");
    expect(signalRoutineId({ key: signalKeys.runNeedsYou("run-1", "msg-2") }, runs)).toBe("rt-a");
    expect(signalRoutineId({ key: "run-access:run-1" }, runs)).toBe("rt-a");
    expect(signalRoutineId({ key: "proposal:p-1", ref: { threadId: "thread-9" } }, runs)).toBe("rt-c");
    expect(signalRoutineId({ key: "proposal:p-2", ref: { threadId: "elsewhere" } }, runs)).toBe("");
    expect(signalRoutineId({ key: signalKeys.runProblem("gone", "failed") }, runs)).toBe("");
  });

  it("reads the ledger told items, answers ended by their card, and survives a restart", () => {
    let now = NOW - 5 * HOUR;
    const storage = memoryStorage();
    const ledger = new SignalLedger({ storage, now: () => now, schedule: (fn) => fn() });
    // a run's card, told; the person answers it two hours later
    ledger.told("alice", { key: signalKeys.runNeedsYou("run-1", "msg-card"), kind: "needs-you", bot: "pepper", ref: { threadId: "t-src" } });
    // a proposal card, told pointing at its card; the person skips it
    ledger.told("alice", { key: signalKeys.proposal("p-9"), kind: "proposal", bot: "pepper", ref: { threadId: "t-home", requestId: "msg-p" } });
    // a bot message's card, told; it expires unanswered
    ledger.told("alice", { key: signalKeys.needsYou({ threadId: "t-home", messageId: "msg-q" }), kind: "needs-you", bot: "pepper" });
    // an answer record of answer learning is not a signal told
    recordCardAnswer(ledger, { person: "alice", bot: "pepper", routineId: "rt-a" }, { askKey: "ticket-1", threadId: "t-src", messageId: "msg-card", answer: "Close it" });
    now += 2 * HOUR;
    expect(settleCardSignals(ledger, { threadId: "t-src", messageId: "msg-card" }, "answered", "Close it")).toBe(1);
    expect(settleCardSignals(ledger, { threadId: "t-home", messageId: "msg-q" }, "expired")).toBe(1);
    expect(settleCardSignals(ledger, { threadId: "t-home", messageId: "msg-p" }, "answered")).toBe(1);
    // a card answered twice ends once
    expect(settleCardSignals(ledger, { threadId: "t-src", messageId: "msg-card" }, "answered")).toBe(0);
    ledger.flush();

    // the previous version's reader keeps its fields: the file is the same shape
    const restarted = new SignalLedger({ storage, now: () => now });
    const answered = restarted.get("alice", "pepper", signalKeys.runNeedsYou("run-1", "msg-card"))!;
    expect(answered).toMatchObject({ state: "answered", answer: "Close it", answeredAt: NOW - 3 * HOUR, firstAt: NOW - 5 * HOUR });

    now = NOW;
    const metrics = new ProactiveMetricsLedger({
      file: null,
      now: () => now,
      usefulness: usefulnessSources({
        signals: (botId) => restarted.entries({ bot: botId }).map(({ entry }) => entry),
        runs: () => [run("run-1", "rt-a", "completed", { routineName: "Ticket triage" }), run("run-2", "rt-a", "nothing_to_report", { routineName: "Ticket triage" })],
        turns: () => [
          { at: new Date(NOW - HOUR).toISOString(), input: 4_000, output: 1_000, routineId: "rt-a" },
          { at: NOW - HOUR, input: 100, output: 0 },
        ],
      }),
    });
    const read = metrics.read("pepper", 7);
    expect(read.usefulness).toEqual({ told: 3, answered: 2, ignored: 1, medianAnswerMs: 2 * HOUR, turnsAvoided: 1, tokens: 5_000, tokensPerAnswered: 2_500 });
    expect(read.routines).toEqual([{ routineId: "rt-a", name: "Ticket triage", told: 1, answered: 1, ignored: 0, medianAnswerMs: 2 * HOUR, turnsAvoided: 1, tokens: 5_000, tokensPerAnswered: 5_000 }]);
    expect(read.ignoredAfterHours).toBe(IGNORED_AFTER_HOURS);
  });

  it("an answer reopened by a new spell starts its time to answer over", () => {
    let now = NOW;
    const ledger = new SignalLedger({ now: () => now });
    ledger.told("alice", { key: "proposal:p-1", kind: "proposal", bot: "pepper" });
    now += HOUR;
    ledger.settle("alice", "pepper", "proposal:p-1", "answered", "accepted");
    expect(ledger.get("alice", "pepper", "proposal:p-1")?.answeredAt).toBe(NOW + HOUR);
    now += HOUR;
    ledger.told("alice", { key: "proposal:p-1", kind: "proposal", bot: "pepper" });
    expect(ledger.get("alice", "pepper", "proposal:p-1")).toMatchObject({ state: "told", firstAt: NOW + 2 * HOUR });
    expect(ledger.get("alice", "pepper", "proposal:p-1")?.answeredAt).toBeUndefined();
  });

  it("the route carries the usefulness figures", async () => {
    const ledger = new SignalLedger({ now: () => NOW });
    ledger.told("alice", { key: "proposal:p-1", kind: "proposal", bot: "pepper" });
    const metrics = new ProactiveMetricsLedger({ file: null, now: () => NOW, usefulness: usefulnessSources({ signals: (botId) => ledger.entries({ bot: botId }).map(({ entry }) => entry), runs: () => [], turns: () => [] }) });
    const routes = [createProactiveMetricsRoutes<{ id: string }>({ bot: (id) => ({ id }), sees: () => true, seesAll: () => true, read: (botId, days) => metrics.read(botId, days) })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback" } as never, json, readBody });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/pepper/proactive-metrics`);
    const body = await res.json() as ProactiveMetrics;
    expect(body.usefulness).toMatchObject({ told: 1, answered: 0, ignored: 0 });
    expect(body.routines).toEqual([]);
  });

  it("a card closed without the person ends its items retired, never answered", () => {
    const card = (fields: Record<string, unknown>) => cardSignalEnding({ id: "m", from: { botId: "pepper" }, card: { requestId: "r1", ...fields } })?.state ?? null;
    // closeOpenApprovals (a stalled turn, an interrupt, a reload, a routine group stop)
    expect(card({ answered: "unavailable", dismissed: true })).toBe("retired");
    // an automatic apply (model or profile request at Full access, a wait's receipt)
    expect(card({ options: [], dismissed: true })).toBe("retired");
    expect(card({ answered: "allow", dismissed: true, autoApplied: true })).toBe("retired");
    // a restart or a newer proposal closed it as stale
    expect(card({ answered: "deny", expired: true, options: [] })).toBe("retired");
    // the person's own acts
    expect(card({ answered: "allow" })).toBe("answered");
    expect(card({ answered: "skipped", skipped: true, options: [] })).toBe("answered");
    // past its delay, unanswered
    expect(card({ expired: true, options: [] })).toBe("expired");
    expect(card({})).toBeNull();
    // an attention row: handled or skipped by the person, or past its delay
    const row = (fields: Record<string, unknown>) => cardSignalEnding({ id: "m", attention: { botId: "pepper", threadId: "t-src", sourceMessageId: "m-src", kind: "question", items: [], ...fields } });
    expect(row({ handledAt: NOW })).toEqual({ state: "answered", bot: "pepper", source: { threadId: "t-src", messageId: "m-src" } });
    expect(row({ handledAt: NOW, closed: "skipped" })?.state).toBe("answered");
    expect(row({ handledAt: NOW, closed: "expired" })?.state).toBe("expired");
    expect(row({})).toBeNull();

    // a proposal's card closed by the server: told, neither answered nor ignored, even a day later
    let now = NOW - 30 * HOUR;
    const ledger = new SignalLedger({ now: () => now });
    ledger.told("alice", { key: signalKeys.proposal("p-1"), kind: "proposal", bot: "pepper", ref: { threadId: "t-home", requestId: "msg-p" } });
    const ended = cardSignalEnding({ id: "msg-p", from: { botId: "pepper" }, card: { requestId: "r9", answered: "unavailable", dismissed: true } })!;
    now += HOUR;
    expect(settleCardSignals(ledger, { threadId: "t-home", messageId: "msg-p", ...ended }, ended.state)).toBe(1);
    expect(ledger.get("alice", "pepper", signalKeys.proposal("p-1"))).toMatchObject({ state: "retired" });
    expect(ledger.get("alice", "pepper", signalKeys.proposal("p-1"))?.answeredAt).toBeUndefined();
    now = NOW;
    const metrics = new ProactiveMetricsLedger({ file: null, now: () => now, usefulness: usefulnessSources({ signals: (botId) => ledger.entries({ bot: botId }).map(({ entry }) => entry), runs: () => [], turns: () => [] }) });
    expect(metrics.read("pepper", 7).usefulness).toMatchObject({ told: 1, answered: 0, ignored: 0, medianAnswerMs: null });
  });

  it("a notice told for information counts as told, never ignored; an approval's reach entry is left out", () => {
    let now = NOW - 40 * HOUR;
    const ledger = new SignalLedger({ now: () => now });
    // tell-only kinds, never answered: a run's failure, a reach notice, a paused routine, runs skipped while away
    ledger.told("alice", { key: signalKeys.runProblem("run-1", "failed"), kind: "routine-run", bot: "pepper" });
    ledger.told("alice", { key: "notice-1", kind: REACH_NOTICE_KIND, bot: "pepper", ref: { threadId: "t-home" } });
    ledger.told("alice", { key: signalKeys.routineSuspended("rt-a", { reason: "person_out", at: 5 }), kind: "routine-suspended", bot: "pepper" });
    ledger.told("alice", { key: signalKeys.awaySkips("rt-a", { firstAt: 7 }), kind: "routine-run", bot: "pepper" });
    // a "needs you" item still unanswered a day later: ignored
    ledger.told("alice", { key: signalKeys.needsYou({ threadId: "t-home", messageId: "m-q" }), kind: "needs-you", bot: "pepper" });
    // an approval's reach entry: raised, answered within the hour (no reminder ever rang)
    ledger.note("alice", { key: "card:t-home:r1", kind: REACH_CARD_KIND, level: "urgent", bot: "pepper", ref: { threadId: "t-home", requestId: "r1" } });
    // another one answered after its reminder rang three hours later
    ledger.note("alice", { key: "card:t-home:r2", kind: REACH_CARD_KIND, level: "urgent", bot: "pepper", ref: { threadId: "t-home", requestId: "r2" } });
    now += 30 * 60_000;
    ledger.settle("alice", "pepper", "card:t-home:r1", "answered");
    now += 3 * HOUR;
    ledger.reminded("alice", "pepper", "card:t-home:r2", 1);
    ledger.settle("alice", "pepper", "card:t-home:r2", "answered");
    now = NOW;
    const metrics = new ProactiveMetricsLedger({ file: null, now: () => now, usefulness: usefulnessSources({ signals: (botId) => ledger.entries({ bot: botId }).map(({ entry }) => entry), runs: () => [], turns: () => [] }) });
    expect(metrics.read("pepper", 7).usefulness).toMatchObject({ told: 5, answered: 0, ignored: 1, medianAnswerMs: null });
  });

  it("a keyed card's answer and an attention row marked handled end their own entries", () => {
    let now = NOW - 3 * HOUR;
    const ledger = new SignalLedger({ now: () => now });
    ledger.told("alice", { key: "routine-problem:rt-a", kind: ROUTINE_PROBLEM_KIND, bot: "pepper" });
    ledger.told("alice", { key: signalKeys.needsYou({ threadId: "t-src", messageId: "m-src" }), kind: "needs-you", bot: "pepper" });
    now += HOUR;
    const keyed = cardSignalEnding({ id: "m-k", from: { botId: "pepper" }, card: { askKey: "routine-problem:rt-a", answered: "Retry" } })!;
    expect(settleCardSignals(ledger, { threadId: "t-home", messageId: "m-k", ...keyed }, keyed.state, "Retry")).toBe(1);
    now += HOUR;
    const handled = cardSignalEnding({ id: "m-row", attention: { botId: "pepper", threadId: "t-src", sourceMessageId: "m-src", handledAt: now } })!;
    expect(settleCardSignals(ledger, { threadId: "t-home", messageId: "m-row", ...handled }, handled.state)).toBe(1);
    now = NOW;
    const metrics = new ProactiveMetricsLedger({ file: null, now: () => now, usefulness: usefulnessSources({ signals: (botId) => ledger.entries({ bot: botId }).map(({ entry }) => entry), runs: () => [], turns: () => [] }) });
    expect(metrics.read("pepper", 7).usefulness).toMatchObject({ told: 2, answered: 2, ignored: 0, medianAnswerMs: Math.round(1.5 * HOUR) });
  });
});
