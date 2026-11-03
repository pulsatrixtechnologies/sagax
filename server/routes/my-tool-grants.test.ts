// A person's own tool access (2026-10-26): theirs to grant and revoke
// without an admin inside their own environment; past it, an admin's.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { ToolGrantStore } from "../tool-grants.ts";
import { TOOL_POLICY_ROWS } from "../tool-policy.generated.ts";
import { createMyToolGrantRoutes } from "./my-tool-grants.ts";
import { dispatchRoutes } from "./table.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((d) => s.close(d)))); });

const member = (principalId: string | null, admin = false): RequestAuth =>
  ({ kind: "session", scopes: admin ? ["admin", "client"] : ["client"], session: { id: `s-${principalId}`, principalId } } as unknown as RequestAuth);

async function serve(auth: RequestAuth) {
  const grants = new ToolGrantStore(null, () => NOW);
  const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const routes = [createMyToolGrantRoutes({
    person: (a) => (a.kind === "session" ? (a.session as { principalId?: string | null }).principalId ?? null : null),
    isAdmin: (a) => a.scopes.includes("admin"),
    grants,
    audit: (action, _a, _r, detail) => audits.push({ action, detail }),
    now: () => NOW,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline" });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() as any };
  };
  return { grants, audits, send };
}

describe("a person's own tool access (Owner 2026-10-26)", () => {
  it("grants themselves a scope of their own environment, every tier, lists and revokes it, audited", async () => {
    const { send, grants, audits } = await serve(member("pr_ada"));
    grants.grant({ kind: "user", id: "pr_other" }, "agents:read", "x");
    grants.grant({ kind: "bot", id: "bot-1" }, "agents:read", "x");
    const created = await send("POST", "/api/me/tool-grants", { scope: "agents:admin", expiresAt: NOW + 7 * DAY });
    expect(created.status).toBe(201);
    expect(created.body.grant.subject).toEqual({ kind: "user", id: "pr_ada" });
    expect(grants.holds({ kind: "user", id: "pr_ada" }, "agents:write")).toBe(true);
    const listed = await send("GET", "/api/me/tool-grants");
    expect(listed.body.grants.map((g: { id: string; state: string }) => [g.id, g.state])).toEqual([[created.body.grant.id, "active"]]);
    expect(listed.body.mayGrantAdmin).toBe(true);
    expect(listed.body.adminOnlyAreas).toEqual(expect.arrayContaining(["org", "members", "billing"]));
    expect((await send("POST", `/api/me/tool-grants/${created.body.grant.id}/revoke`)).status).toBe(200);
    expect((await send("POST", `/api/me/tool-grants/${created.body.grant.id}/revoke`)).status).toBe(404);
    expect(audits.map((a) => a.action)).toEqual(["tool_grants.grant", "tool_grants.revoke"]);
  });

  it("a scope past their environment stays an admin's; an admin-tier grant still ends within 30 days", async () => {
    const { send } = await serve(member("pr_ada"));
    for (const scope of ["org:write", "members:admin", "billing:read", "fleet:admin", "tool-grants:admin"]) {
      const refused = await send("POST", "/api/me/tool-grants", { scope, expiresAt: NOW + DAY });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("org_scope_admin_only");
    }
    expect((await send("POST", "/api/me/tool-grants", { scope: "agents:admin" })).status).toBe(400);
    expect((await send("POST", "/api/me/tool-grants", { scope: "agents:admin", expiresAt: NOW + 31 * DAY })).status).toBe(400);
    expect((await send("POST", "/api/me/tool-grants", { scope: "agents:write" })).status).toBe(201);
    const admin = await serve(member("pr_boss", true));
    expect((await admin.send("POST", "/api/me/tool-grants", { scope: "org:write" })).status).toBe(201);
  });

  it("never reaches someone else's grant or a bot's, and nobody without a person", async () => {
    const { send, grants } = await serve(member("pr_ada"));
    const other = grants.grant({ kind: "user", id: "pr_other" }, "agents:read", "x");
    const bot = grants.grant({ kind: "bot", id: "bot-1" }, "agents:read", "x");
    expect((await send("POST", `/api/me/tool-grants/${other.id}/revoke`)).status).toBe(404);
    expect((await send("POST", `/api/me/tool-grants/${bot.id}/revoke`)).status).toBe(404);
    expect((await send("POST", "/api/me/tool-grants", { subject: { kind: "user", id: "pr_other" }, scope: "agents:read" })).status).toBe(400);
    const nobody = await serve(member(null));
    expect((await nobody.send("GET", "/api/me/tool-grants")).status).toBe(403);
  });

  it("members reach the handler; no agent tool may use the routes", () => {
    expect(requiredScope("GET", "/api/me/tool-grants")).toBe("client");
    expect(requiredScope("POST", "/api/me/tool-grants")).toBe("client");
    expect(requiredScope("POST", "/api/me/tool-grants/tg_x/revoke")).toBe("client");
    const rows = TOOL_POLICY_ROWS.filter((row) => row.route.includes("me/tool-grants") || row.route.includes("me\\/tool-grants"));
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row).toMatchObject({ tier: "admin", scope: "tool-grants:admin", defaultEnabled: false });
  });
});
