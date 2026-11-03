import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { ToolGrantStore } from "../tools/tool-grants.ts";
import { TOOL_POLICY_ROWS } from "../tool-policy.generated.ts";
import { createToolGrantRoutes } from "./tool-grants.ts";
import { dispatchRoutes } from "./table.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((d) => s.close(d)))); });

async function serve(auth: RequestAuth = { kind: "loopback", scopes: ["admin"] }) {
  const grants = new ToolGrantStore(null, () => NOW);
  const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const routes = [createToolGrantRoutes({ grants, botExists: (id) => id === "bot-1", audit: (action, _a, _r, detail) => audits.push({ action, detail }), now: () => NOW })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline" });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body?: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { base, grants, audits, post };
}

describe("tool grants routes (B3a)", () => {
  it("needs admin scope at the gate and in the handler", async () => {
    expect(requiredScope("GET", "/api/tool-grants")).toBe("admin");
    expect(requiredScope("POST", "/api/tool-grants/tg_x/revoke")).toBe("admin");
    const { base, post } = await serve({ kind: "loopback", scopes: ["client"] });
    expect((await fetch(`${base}/api/tool-grants`)).status).toBe(403);
    expect((await post("/api/tool-grants", { subject: { kind: "bot", id: "bot-1" }, scope: "agents:write" })).status).toBe(403);
  });

  it("grants, lists with state, revokes, and audits both changes", async () => {
    const { base, post, audits } = await serve();
    const created = await post("/api/tool-grants", { subject: { kind: "bot", id: "bot-1" }, scope: "agents:write" });
    expect(created.status).toBe(201);
    const { grant } = (await created.json()) as { grant: { id: string; grantedBy: string } };
    expect(grant.grantedBy).toBe("loopback");
    let list = (await (await fetch(`${base}/api/tool-grants?kind=bot&id=bot-1`)).json()) as { grants: Array<{ state: string }> };
    expect(list.grants.map((g) => g.state)).toEqual(["active"]);
    expect((await post(`/api/tool-grants/${grant.id}/revoke`)).status).toBe(200);
    expect((await post(`/api/tool-grants/${grant.id}/revoke`)).status).toBe(404);
    list = (await (await fetch(`${base}/api/tool-grants`)).json()) as { grants: Array<{ state: string }> };
    expect(list.grants.map((g) => g.state)).toEqual(["revoked"]);
    expect(audits.map((a) => a.action)).toEqual(["tool_grants.grant", "tool_grants.revoke"]);
  });

  it("refuses bad bodies, unknown bots, past expiries and open-ended admin grants", async () => {
    const { post, grants } = await serve();
    expect((await post("/api/tool-grants", { subject: { kind: "bot", id: "bot-1" }, scope: "agents" })).status).toBe(400);
    expect((await post("/api/tool-grants", { subject: { kind: "bot", id: "nope" }, scope: "agents:read" })).status).toBe(404);
    expect((await post("/api/tool-grants", { subject: { kind: "user", id: "pr_1" }, scope: "agents:read", expiresAt: NOW - 1 })).status).toBe(400);
    const open = await post("/api/tool-grants", { subject: { kind: "user", id: "pr_1" }, scope: "org:admin" });
    expect(open.status).toBe(400);
    expect(((await open.json()) as { code: string }).code).toBe("admin_expiry");
    expect((await post("/api/tool-grants", { subject: { kind: "user", id: "pr_1" }, scope: "org:admin", expiresAt: NOW + 31 * DAY })).status).toBe(400);
    expect((await post("/api/tool-grants", { subject: { kind: "user", id: "pr_1" }, scope: "org:admin", expiresAt: NOW + 7 * DAY })).status).toBe(201);
    expect(grants.all()).toHaveLength(1);
  });

  it("is never reachable by agent tools: every row admin, off by default", () => {
    const rows = TOOL_POLICY_ROWS.filter((r) => r.route.includes("tool-grants"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r).toMatchObject({ tier: "admin", scope: "tool-grants:admin", defaultEnabled: false });
  });

  it("passes other paths on", async () => {
    const { base } = await serve();
    expect(await (await fetch(`${base}/api/tool-grantsx`)).json()).toEqual({ from: "inline" });
  });
});
