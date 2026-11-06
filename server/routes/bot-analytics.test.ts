// GET /api/bots/:id/analytics through the route table: the days window is
// validated, a bot the caller cannot see answers 404, the owner (or an
// admin) reads every ledger row of the bot, and a plain member reads only
// their own turns and the failed runs of routines running as them.
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../auth/request-auth.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { appendUsage, flushUsageLedger, type UsageRow } from "../usage/usage-ledger.ts";
import { usageViewerOf } from "./usage.ts";
import type { BotAnalytics } from "../../shared/bot-analytics.ts";
import { createBotAnalyticsRoutes, type BotAnalyticsRouteDeps } from "./bot-analytics.ts";
import { dispatchRoutes } from "./table.ts";

const NOW = Date.UTC(2026, 10, 6, 15, 0, 0);
const DAY = 86_400_000;
const iso = (at: number) => new Date(at).toISOString();

interface Bot { id: string; name: string }
const bots: Record<string, Bot> = { pepper: { id: "pepper", name: "Pepper" }, ghost: { id: "ghost", name: "Ghost" } };

function ledgerRow(overrides: Partial<UsageRow> = {}): Omit<UsageRow, "at"> & { at?: string } {
  return {
    botId: "pepper", botName: "Pepper", threadId: "t-alice", instanceId: "claude", driverKind: "claudeAgent", model: "claude-sonnet-5",
    input: 100, output: 50, costUsd: null, trigger: { kind: "user", principalId: "alice" }, ownerPrincipalId: "alice",
    ...overrides,
  };
}

let dataDir: string;
const servers: Server[] = [];
beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "omb-bot-analytics-"));
  appendUsage(dataDir, ledgerRow({ at: iso(NOW - 60_000), costUsd: 0.01, durationMs: 60_000 }));
  appendUsage(dataDir, ledgerRow({ at: iso(NOW - 120_000), threadId: "t-bob", trigger: { kind: "user", principalId: "bob" }, ownerPrincipalId: "bob", input: 10, output: 5 }));
  appendUsage(dataDir, ledgerRow({ at: iso(NOW - DAY), threadId: "t-routine", trigger: { kind: "routine", routineId: "r1", runAsPrincipalId: "bob" }, ownerPrincipalId: "bob", durationMs: 1_800_000 }));
  // Another bot's turn never leaks into this bot's figures.
  appendUsage(dataDir, ledgerRow({ at: iso(NOW - 30_000), botId: "echo", botName: "Echo", threadId: "t-echo" }));
  // A turn older than the widest window.
  appendUsage(dataDir, ledgerRow({ at: iso(NOW - 100 * DAY) }));
  await flushUsageLedger(dataDir);
});
afterAll(async () => { await removeTempDir(dataDir); });
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const runs = [
  { id: "run-1", status: "failed", scheduledFor: NOW - DAY, startedAt: NOW - DAY, finishedAt: NOW - DAY + 1000, runAs: "bob" },
  { id: "run-2", status: "failed", scheduledFor: NOW - 3600_000, finishedAt: NOW - 3000_000, runAs: "alice" },
  { id: "run-3", status: "completed", scheduledFor: NOW - 7200_000, finishedAt: NOW - 7000_000, runAs: "alice" },
];

/** Pepper: alice owns it, bob and carol may see it; ghost: only the operator. */
function deps(overrides: Partial<BotAnalyticsRouteDeps<Bot>> = {}): BotAnalyticsRouteDeps<Bot> {
  return {
    dataDir,
    bot: (id) => bots[id],
    sees: (auth, bot) => auth.kind === "loopback" || (bot.id === "pepper" && ["alice", "bob", "carol"].includes(auth.session.principalId ?? "")),
    seesAll: (auth, bot) => auth.kind === "loopback" || (bot.id === "pepper" && auth.session.principalId === "alice"),
    viewer: (auth) => usageViewerOf(auth),
    prices: () => ({}),
    currency: () => "CAD",
    runs: (botId) => (botId === "pepper" ? runs : []),
    personName: (id) => ({ alice: "Alice Example" } as Record<string, string>)[id] ?? "",
    timeZone: () => "UTC",
    localPrincipalId: () => "alice",
    now: () => NOW,
    ...overrides,
  };
}

async function serve(routeDeps: BotAnalyticsRouteDeps<Bot> = deps()): Promise<string> {
  const routes = [createBotAnalyticsRoutes<Bot>(routeDeps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const who = req.headers["x-viewer"];
    const auth = typeof who === "string"
      ? { kind: "session", scopes: ["client"], session: { id: who, principalId: who } }
      : { kind: "loopback", scopes: ["admin"] };
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: auth as never, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = async (base: string, path: string, viewer?: string) => {
  const res = await fetch(`${base}${path}`, { headers: viewer ? { "x-viewer": viewer } : {} });
  return { status: res.status, headers: res.headers, body: await res.json() as BotAnalytics & { error?: string } };
};

describe("bot analytics API", () => {
  it("is open to a client session for reads", () => {
    expect(requiredScope("GET", "/api/bots/pepper/analytics")).toBe("client");
    expect(requiredScope("POST", "/api/bots/pepper/analytics")).not.toBe("client");
  });

  it("accepts only 7, 30 or 90 days, 7 by default", async () => {
    const base = await serve();
    expect((await get(base, "/api/bots/pepper/analytics?days=14", "alice")).status).toBe(400);
    expect((await get(base, "/api/bots/pepper/analytics?days=abc", "alice")).status).toBe(400);
    const seven = await get(base, "/api/bots/pepper/analytics", "alice");
    expect(seven.status).toBe(200);
    expect(seven.body.days).toBe(7);
    expect(seven.body.series).toHaveLength(7);
    const thirty = await get(base, "/api/bots/pepper/analytics?days=30", "alice");
    expect(thirty.body.days).toBe(30);
    expect(thirty.body.series).toHaveLength(30);
  });

  it("answers 404 for an unknown bot and for one the caller cannot see", async () => {
    const base = await serve();
    expect((await get(base, "/api/bots/nobody/analytics", "alice")).status).toBe(404);
    expect((await get(base, "/api/bots/ghost/analytics", "carol")).status).toBe(404);
    expect((await get(base, "/api/bots/ghost/analytics")).status).toBe(200);
  });

  it("gives the owner every row of the bot, nothing of another bot, with the billing currency", async () => {
    const base = await serve();
    const out = await get(base, "/api/bots/pepper/analytics", "alice");
    expect(out.status).toBe(200);
    expect(out.headers.get("cache-control")).toBe("no-store");
    expect(out.body.from).toBe("2026-10-31T00:00:00.000Z");
    expect(out.body.to).toBe(iso(NOW));
    expect(out.body.totals).toEqual({ messages: 3, turns: 3, tokens: 315, costUsd: 0.01, conversations: 3, routinesRun: 1, routinesFailed: 2, hoursSaved: 0.5167 });
    expect(out.body.series[6]).toMatchObject({ day: "2026-11-06", messages: 2, costUsd: 0.01, routinesFailed: 1 });
    expect(out.body.series[5]).toMatchObject({ day: "2026-11-05", messages: 1, costUsd: null, routinesRun: 1, routinesFailed: 1, hoursSaved: 0.5 });
    expect(out.body.topUsers).toEqual([
      { principalId: "bob", name: "bob", messages: 2, hoursSaved: 0.5 },
      { principalId: "alice", name: "Alice Example", messages: 1, hoursSaved: 0.0167 },
    ]);
    expect(out.body.hoursSavedBasis).toBe("turnDuration");
    expect(out.body.currency).toBe("CAD");
    // The operator reads the same.
    expect((await get(base, "/api/bots/pepper/analytics")).body.totals.messages).toBe(3);
  });

  it("narrows a plain member to their own turns and their own failed runs", async () => {
    const base = await serve();
    const bob = await get(base, "/api/bots/pepper/analytics", "bob");
    expect(bob.status).toBe(200);
    expect(bob.body.totals).toMatchObject({ messages: 2, turns: 2, tokens: 165, costUsd: null, conversations: 2, routinesRun: 1, routinesFailed: 1, hoursSaved: 0.5 });
    expect(bob.body.topUsers).toEqual([{ principalId: "bob", name: "bob", messages: 2, hoursSaved: 0.5 }]);
    expect(JSON.stringify(bob.body)).not.toContain("alice");

    const carol = await get(base, "/api/bots/pepper/analytics", "carol");
    expect(carol.status).toBe(200);
    expect(carol.body.totals).toEqual({ messages: 0, turns: 0, tokens: 0, costUsd: null, conversations: 0, routinesRun: 0, routinesFailed: 0, hoursSaved: null });
    expect(carol.body.series.every((day) => day.messages === 0)).toBe(true);
    expect(carol.body.topUsers).toEqual([]);
    expect(carol.body.hoursSavedBasis).toBeNull();
  });

  it("reports no currency without a price list", async () => {
    const base = await serve(deps({ prices: () => null }));
    const out = await get(base, "/api/bots/pepper/analytics", "alice");
    expect(out.body.currency).toBeNull();
    expect(out.body.totals.costUsd).toBe(0.01);
  });
});
