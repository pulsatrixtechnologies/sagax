// /api/code/status asks Perspicax once whether it serves the cloud agents
// API (#372). A Perspicax without it (404 on /api/v1/agents/environments,
// as GOX 1.8.39) gives `not_available`: no error, no repeated calls.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { CloudAgentManager } from "../cloud-agents/manager.ts";
import { PerspicaxAgentsClient } from "../cloud-agents/perspicax-client.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createCodeRoutes, PROBE_TTL_MS } from "./code.ts";
import { PASS } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

/** A Perspicax that answers `status` on every agents route, and counts. */
async function perspicax(status: number) {
  const seen: string[] = [];
  const url = await listen((req, res) => {
    seen.push(req.url ?? "");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 200 ? JSON.stringify({ items: [], total: 0 }) : JSON.stringify({ code: "not_found", message: "not found" }));
  });
  return { url, seen };
}

async function sagax(perspicaxUrl: string, clock: { now: number }) {
  const handler = createCodeRoutes({
    client: new PerspicaxAgentsClient(),
    manager: {} as CloudAgentManager,
    reachable: () => ({ ok: true }),
    access: async () => ({ ok: true, principalId: "pr_alice", access: { baseUrl: perspicaxUrl, token: "tok", link: () => "link-tok" } }),
    consoleUrl: () => `${perspicaxUrl}/console/agents`,
    botVisible: () => true,
    now: () => clock.now,
  });
  const url = await listen((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    void handler({ req, res, url: u, path: u.pathname, method: req.method ?? "GET", auth: { kind: "local" } as unknown as RequestAuth, json, readBody })
      .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
  });
  return async () => {
    const res = await fetch(`${url}/api/code/status`);
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
}

describe("/api/code/status probes the agents API", () => {
  it("a Perspicax without it (404) is not_available, asked once per few minutes", async () => {
    const px = await perspicax(404);
    const clock = { now: 1_000_000 };
    const status = await sagax(px.url, clock);
    for (let i = 0; i < 5; i++) expect(await status()).toEqual({ status: 200, body: { available: false, reason: "not_available" } });
    expect(px.seen).toEqual(["/api/v1/agents/environments?page=1&page_size=1"]);
    clock.now += PROBE_TTL_MS + 1;
    expect((await status()).body.reason).toBe("not_available");
    expect(px.seen.length).toBe(2);
  });

  it("405 and 501 mean not available too", async () => {
    for (const code of [405, 501]) {
      const px = await perspicax(code);
      const status = await sagax(px.url, { now: 0 });
      expect((await status()).body).toEqual({ available: false, reason: "not_available" });
    }
  });

  it("401 and 403 (the API served, not to this token) are not available, never kept", async () => {
    for (const code of [401, 403]) {
      const px = await perspicax(code);
      const status = await sagax(px.url, { now: 0 });
      expect(await status()).toEqual({ status: 200, body: { available: false, reason: "not_available" } });
      expect((await status()).body.reason).toBe("not_available");
      expect(px.seen.length).toBe(2);
    }
  });

  it("a Perspicax that serves it is available, with its console", async () => {
    const px = await perspicax(200);
    const status = await sagax(px.url, { now: 0 });
    expect(await status()).toEqual({ status: 200, body: { available: true, consoleUrl: `${px.url}/console/agents` } });
  });

  it("a failing Perspicax is unreachable, never available", async () => {
    const px = await perspicax(500);
    const status = await sagax(px.url, { now: 0 });
    expect((await status()).body).toEqual({ available: false, reason: "unreachable" });
  });
});
