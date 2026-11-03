// #1918: GET /api/limit-resets answers with the asking person's limits, each
// engine from the account that pays their turns on it, never another
// person's or the server's own when the person pays for themselves.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { EngineLimitsReport } from "../../shared/limit-reset.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { json, readBody } from "../harness/http.ts";
import type { RoutineManager } from "../routines/routines.ts";
import { createLimitResetHost, SERVER_LIMIT_SCOPE } from "../usage/limit-reset-host.ts";
import { type PlanAccount, type PlanProviderRow, type PlanUsageReport } from "../usage/plan-usage.ts";
import { createLimitResetRoutes } from "./limit-resets.ts";
import { dispatchRoutes } from "./table.ts";

const ADA = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-03T10:00:00Z");
const HOUR = 3_600_000;

const person = (principalId: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s", label: "desktop", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId } as never,
});

function grokRow(used: number, resetsAt: number): PlanProviderRow {
  return {
    id: "grok", name: "Grok", driver: "grok", plan: null, ok: true, error: null, state: "windows", access: "subscription", instanceId: "grok", failure: null,
    fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
    weekly: { available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: new Date(resetsAt).toISOString() },
    extra: [], models: [],
  };
}

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

/** An organization-like host: the server's own Grok account sits at its limit; Ada's own Grok sign-in is at 14%;
 * Bob has no sign-in, so the organization pays his Grok turns. */
async function serve() {
  const grok = (home: string): PlanAccount => ({ id: "grok", name: "Grok", driver: "grok", environment: { HOME: home }, instanceId: "grok" });
  const usage: Record<string, PlanProviderRow> = {
    server: grokRow(100, NOW + 30 * HOUR),
    [ADA]: grokRow(14, NOW + 96 * HOUR),
  };
  const host = createLimitResetHost({
    accounts: () => [grok("server")],
    scopeAccounts: (scope) => scope === `person:${ADA}` ? [grok(ADA)] : [],
    loadUsage: async (accounts): Promise<PlanUsageReport> => ({
      fetchedAt: new Date(NOW).toISOString(),
      providers: accounts.flatMap((account) => usage[account.environment.HOME ?? ""] ? [usage[account.environment.HOME ?? ""]!] : []),
    }),
    now: () => NOW,
    routines: () => [],
    retime: () => {},
  });
  const scopeFor = (principalId: string) => (_engine: string) => principalId === ADA ? `person:${ADA}` : SERVER_LIMIT_SCOPE;
  const routes = [createLimitResetRoutes({
    limits: (auth) => {
      const principalId = auth.kind === "session" ? auth.session.principalId ?? "" : "";
      return host.view(`person:${principalId}`, scopeFor(principalId));
    },
    routines: { listRoutines: () => [], deferNextRun: () => null } as unknown as RoutineManager,
    requests: { submit: async () => { throw new Error("unused"); } },
    threadTitle: () => null,
    threadEngine: () => "grok",
    engineName: () => "Grok",
  })];
  const listen = async (auth: RequestAuth) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return async () => {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/limit-resets`);
      expect(res.status).toBe(200);
      return await res.json() as EngineLimitsReport;
    };
  };
  return { host, ada: await listen(person(ADA)), bob: await listen(person(BOB)) };
}

describe("GET /api/limit-resets (#1918)", () => {
  it("shows a person who pays with their own sign-in their own usage, not the server's account at its limit", async () => {
    const { ada, bob } = await serve();
    expect((await ada()).engines).toEqual([expect.objectContaining({ engine: "grok", usedPercent: 14, blocked: false, resetsAt: NOW + 96 * HOUR })]);
    // the organization pays Bob's Grok turns: the server's account is his limit
    expect((await bob()).engines).toEqual([expect.objectContaining({ engine: "grok", blocked: true, resetsAt: NOW + 30 * HOUR })]);
  });

  it("keeps a refusal on the account of the turn's payer, and a success there clears it", async () => {
    const { host, ada, bob } = await serve();
    await ada();
    await bob();
    host.noteRefusal("grok", NOW + 5 * HOUR, `person:${ADA}`);
    expect((await ada()).engines).toEqual([expect.objectContaining({ engine: "grok", blocked: true, resetsAt: NOW + 5 * HOUR })]);
    expect((await bob()).engines).toEqual([expect.objectContaining({ blocked: true, resetsAt: NOW + 30 * HOUR })]);

    host.noteSuccess("grok", `person:${ADA}`);
    expect((await ada()).engines).toEqual([expect.objectContaining({ engine: "grok", usedPercent: 14, blocked: false })]);

    // a turn that succeeds on the organization's account clears the server's stale "at its limit" too
    host.noteSuccess("grok", SERVER_LIMIT_SCOPE);
    expect((await bob()).engines).toEqual([expect.objectContaining({ engine: "grok", blocked: false })]);
    expect((await ada()).engines).toEqual([expect.objectContaining({ usedPercent: 14, blocked: false })]);
  });

  it("solo: one view of the server's own accounts, as before", async () => {
    const { host } = await serve();
    const solo = host.view(SERVER_LIMIT_SCOPE, () => SERVER_LIMIT_SCOPE);
    await solo.ensureFresh();
    expect(solo.report().engines).toEqual([expect.objectContaining({ engine: "grok", blocked: true })]);
    expect(solo.report()).toEqual(host.clock.report());
  });
});
