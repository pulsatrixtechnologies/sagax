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
import { aggregateProactiveMetrics, MINUTES_PER_ACCEPTED, MINUTES_PER_REPORT, MINUTES_PER_WRITE, type ProactiveMetrics } from "../../shared/proactive-metrics.ts";
import { ProactiveMetricsLedger } from "./proactive-metrics.ts";
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
