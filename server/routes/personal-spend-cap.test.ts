// GET/PUT /api/me/spend-cap: a person's own monthly limit. Read by anyone
// signed in, written with admin scope, solo servers only.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { resetSpendCacheForTests } from "../spend.ts";
import { assertWithinBudget } from "../spend.ts";
import { appendUsage, flushUsageLedger } from "../usage-ledger.ts";
import { createUsageRoutes } from "./usage.ts";
import { dispatchRoutes } from "./table.ts";

describe("/api/me/spend-cap", () => {
  let dataDir: string;
  const servers: Server[] = [];
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "sagax-pcap-")); resetSpendCacheForTests(); });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function serve(organization = false) {
    const routes = [createUsageRoutes({ dataDir, prices: () => null, budget: () => null, currency: () => "USD", organization: () => organization })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const auth = { kind: "loopback", scopes: ["admin", "client"] } as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (method: string, body?: unknown) => {
      const response = await fetch(`${base}/api/me/spend-cap`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as any };
    };
  }

  it("reads for every client and writes with admin scope", () => {
    expect(requiredScope("GET", "/api/me/spend-cap")).toBe("client");
    expect(requiredScope("PUT", "/api/me/spend-cap")).toBe("admin");
  });

  it("sets, reads, raises and removes the limit, and a reached limit stops a turn until raised", async () => {
    const api = await serve();
    expect((await api("GET")).body).toMatchObject({ supported: true, minUsd: 1, cap: null });
    const set = await api("PUT", { monthlyUsd: 2 });
    expect(set.status).toBe(200);
    expect(set.body.cap).toMatchObject({ monthlyUsd: 2, exceeded: false });
    appendUsage(dataDir, { at: new Date().toISOString(), botId: "b", botName: "B", threadId: "t", instanceId: "i", driverKind: "d", model: "m", input: 1, output: 1, costUsd: 3, trigger: { kind: "owner" } });
    await flushUsageLedger(dataDir);
    resetSpendCacheForTests();
    expect((await api("GET")).body.cap).toMatchObject({ exceeded: true });
    expect(() => assertWithinBudget({}, dataDir, new Date(), () => false)).toThrow(/personal monthly spend limit/);
    expect((await api("PUT", { monthlyUsd: 20 })).body.cap).toMatchObject({ monthlyUsd: 20, exceeded: false });
    expect(() => assertWithinBudget({}, dataDir, new Date(), () => false)).not.toThrow();
    expect((await api("PUT", { monthlyUsd: null })).body.cap).toBeNull();
  });

  it("refuses a limit under $1 or not a number, and any write on an organization server", async () => {
    const api = await serve();
    for (const monthlyUsd of [0, 0.5, -3, "10", undefined]) expect((await api("PUT", { monthlyUsd })).status, String(monthlyUsd)).toBe(400);
    const org = await serve(true);
    expect((await org("GET")).body).toMatchObject({ supported: false, cap: null });
    expect((await org("PUT", { monthlyUsd: 10 })).status).toBe(409);
  });
});
