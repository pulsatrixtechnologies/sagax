// Perspicax asks for an immediate directory fetch with the link token
// (2026-10-11, server/org/org-link-routes.ts).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createOrgLinkRoutes, DIRECTORY_REFRESH_MAX_PER_MINUTE, DIRECTORY_REFRESH_PATH, DirectoryRefreshScheduler, type OrgLinkRoutesOptions } from "./org-link-routes.ts";
import { AuthFailureLimiter } from "../triggers/webhook-ingress.ts";

const TOKEN = `pxat1.${"a".repeat(43)}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("DirectoryRefreshScheduler", () => {
  it("starts at once, then coalesces every call during a fetch into exactly one more", async () => {
    const gates: Array<ReturnType<typeof deferred>> = [];
    const scheduler = new DirectoryRefreshScheduler(() => {
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    }, 0);
    expect(scheduler.request()).toBe("started");
    await Promise.resolve();
    expect(scheduler.request()).toBe("queued");
    expect(scheduler.request()).toBe("queued");
    expect(scheduler.request()).toBe("queued");
    expect(gates).toHaveLength(1);
    gates[0]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // the change made during the first fetch is read by a second one
    expect(gates).toHaveLength(2);
    gates[1]!.resolve();
    await scheduler.whenIdle();
    expect(gates).toHaveLength(2);
  });

  it("spaces two fetches by the minimum interval, and a failed fetch does not stop the next", async () => {
    const clock = { now: 10_000 };
    let runs = 0;
    const scheduler = new DirectoryRefreshScheduler(async () => {
      runs += 1;
      if (runs === 1) throw new Error("unreachable");
    }, 30, () => clock.now);
    expect(scheduler.request()).toBe("started");
    await scheduler.whenIdle();
    expect(runs).toBe(1);
    clock.now += 10;
    expect(scheduler.request()).toBe("queued");
    expect(scheduler.request()).toBe("queued");
    await scheduler.whenIdle();
    expect(runs).toBe(2);
    clock.now += 1_000;
    expect(scheduler.request()).toBe("started");
    await scheduler.whenIdle();
    expect(runs).toBe(3);
  });
});

describe("POST /api/org/link/directory-refresh", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function start(patch: Partial<OrgLinkRoutesOptions> = {}) {
    const asked: string[] = [];
    const routes = createOrgLinkRoutes({
      linked: () => true,
      linkTokenMatches: (token) => token === TOKEN,
      scheduler: { request: () => { asked.push("refresh"); return asked.length === 1 ? "started" : "queued"; } },
      log: () => {},
      ...patch,
    });
    const server = createServer((req, res) => {
      void routes(req, res, new URL(req.url ?? "/", "http://localhost")).then((answered) => {
        if (!answered) { res.writeHead(418); res.end(); }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (init: RequestInit & { path?: string } = {}) => {
      const response = await fetch(`${base}${init.path ?? DIRECTORY_REFRESH_PATH}`, { method: "POST", ...init });
      return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
    };
    return { asked, call };
  }

  it("asks for a fetch with the link token and answers 202, never reading the body", async () => {
    const h = await start();
    const first = await h.call({ headers: { authorization: `Bearer ${TOKEN}` }, body: "ignored" });
    expect(first).toMatchObject({ status: 202, body: { ok: true, refresh: "started" } });
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await h.call({ headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 202, body: { ok: true, refresh: "queued" } });
    expect(h.asked).toHaveLength(2);
  });

  it("refuses a missing, wrong or misplaced token the same way, and opens nothing else", async () => {
    const h = await start();
    for (const init of [
      {},
      { headers: { authorization: `Bearer ${TOKEN}x` } },
      { headers: { authorization: `Basic ${Buffer.from(`pulsa-bot-server:${TOKEN}`).toString("base64")}` } },
      { headers: { "x-link-token": TOKEN } },
      { path: `${DIRECTORY_REFRESH_PATH}?token=${TOKEN}` },
      { headers: { cookie: `omb_session=${TOKEN}` } },
    ]) {
      expect(await h.call(init), JSON.stringify(init)).toMatchObject({ status: 401, body: { error: "unauthorized" } });
    }
    expect(await h.call({ method: "GET", headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 405 });
    expect(await h.call({ path: "/api/org/link/other", headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 404 });
    expect(await h.call({ path: "/api/other" })).toMatchObject({ status: 418 });
    expect(h.asked).toHaveLength(0);
  });

  it("answers 404 on a server with no link", async () => {
    const h = await start({ linked: () => false });
    expect(await h.call({ headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(h.asked).toHaveLength(0);
  });

  it("blocks a source after 10 failures, even with the good token, and caps accepted calls", async () => {
    const h = await start({ limiter: new AuthFailureLimiter(10, 60_000) });
    for (let i = 0; i < 10; i++) expect((await h.call({ headers: { authorization: "Bearer nope" } })).status).toBe(401);
    const blocked = await h.call({ headers: { authorization: `Bearer ${TOKEN}` } });
    expect(blocked).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(h.asked).toHaveLength(0);

    const fresh = await start({ limiter: new AuthFailureLimiter(10, 60_000) });
    for (let i = 0; i < DIRECTORY_REFRESH_MAX_PER_MINUTE; i++) expect((await fresh.call({ headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(202);
    expect(await fresh.call({ headers: { authorization: `Bearer ${TOKEN}` } })).toMatchObject({ status: 429 });
    expect(fresh.asked).toHaveLength(DIRECTORY_REFRESH_MAX_PER_MINUTE);
  });
});
