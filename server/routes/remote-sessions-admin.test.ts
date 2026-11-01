import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { dispatchRoutes } from "./table.ts";
import { createRemoteSessionsAdminRoutes } from "./remote-sessions-admin.ts";
import { createRemoteSessionsAdmin } from "../remote-sessions-admin.ts";
import { createUnattendedConsentStore } from "../remote-session-consent-store.ts";
import { requiredScope } from "../request-auth.ts";
import type { AdminSessionInput } from "../../shared/remote-session-admin.ts";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const person = (principalId: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s", label: "app", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId } as never,
});

function row(over: Partial<AdminSessionInput> = {}): AdminSessionInput {
  return {
    id: "a1b2c3d4e5f6", code: "ABC234", os: "windows", elevated: false,
    endAt: "2026-10-22T18:00:00Z", state: "connected", createdAt: NOW - 1000,
    hostname: "PC-A", serial: "SN-A", user: "marie", ownerId: "tech@example.com",
    openedBy: "tech@example.com", botId: "bot-7", reachable: true, ...over,
  };
}

async function serve(rows: AdminSessionInput[], orgAdmin: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), "rsadmin-route-")); dirs.push(dir);
  const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
  const closeById = vi.fn(async () => true);
  const admin = createRemoteSessionsAdmin({ rows: () => rows, botLabel: () => "Atlas", consent, log: () => [{ at: "2026-10-22T12:00:00Z", kind: "exec", command: "whoami", readOnly: true }], closeById, now: () => NOW });
  const routes = [createRemoteSessionsAdminRoutes({ admin, principalId: (auth) => (auth.kind === "session" ? (auth.session as { principalId?: string }).principalId : undefined), orgAdmin: () => orgAdmin })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: person("viewer@example.com"), json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, consent, closeById };
}

describe("admin remote-sessions routes", () => {
  it("is admin-scoped in the tool policy (defaultEnabled false)", async () => {
    const { policyFor } = await import("../tool-policy.ts");
    const list = policyFor("GET", "/api/admin/remote-sessions");
    expect(list.tier).toBe("admin");
    expect(list.defaultEnabled).toBe(false);
    // requiredScope treats /api/admin/* as admin
    expect(requiredScope("GET", "/api/admin/remote-sessions")).toBe("admin");
  });

  it("lists sessions and filters by active/unattended/search", async () => {
    const { base } = await serve([row({ id: "aaaaaaaaaaaa", state: "connected" }), row({ id: "bbbbbbbbbbbb", state: "ended", hostname: "PC-B", serial: "SN-B" })], true);
    const all = await (await fetch(`${base}/api/admin/remote-sessions`)).json() as { sessions: { id: string }[]; admin: boolean };
    expect(all.sessions).toHaveLength(2);
    expect(all.admin).toBe(true);
    const active = await (await fetch(`${base}/api/admin/remote-sessions?active=1`)).json() as { sessions: { id: string }[] };
    expect(active.sessions.map((s: { id: string }) => s.id)).toEqual(["aaaaaaaaaaaa"]);
    const search = await (await fetch(`${base}/api/admin/remote-sessions?q=PC-B`)).json() as { sessions: { id: string }[] };
    expect(search.sessions.map((s: { id: string }) => s.id)).toEqual(["bbbbbbbbbbbb"]);
  });

  it("serves a redacted log and ends a session", async () => {
    const { base, closeById } = await serve([row({ id: "cccccccccccc" })], true);
    const logs = await (await fetch(`${base}/api/admin/remote-sessions/cccccccccccc/logs`)).json() as { entries: { kind: string; command?: string }[] };
    expect(logs.entries[0]).toMatchObject({ kind: "exec", command: "whoami" });
    const end = await fetch(`${base}/api/admin/remote-sessions/cccccccccccc/end`, { method: "POST" });
    expect(end.status).toBe(200);
    expect(closeById).toHaveBeenCalledWith("cccccccccccc");
  });

  it("grants and revokes unattended consent as an admin", async () => {
    const { base, consent } = await serve([row({ id: "dddddddddddd", serial: "SN-A", state: "connected" })], true);
    const grant = await fetch(`${base}/api/admin/remote-sessions/unattended`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host_key: "sn-a", org: "acme", banner_visible: false }) });
    expect(grant.status).toBe(200);
    expect(consent.get("sn-a")?.bannerVisible).toBe(false);
    const revoke = await fetch(`${base}/api/admin/remote-sessions/unattended/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host_key: "sn-a" }) });
    expect(revoke.status).toBe(200);
    expect(consent.get("sn-a")?.revokedAt).toBeTruthy();
  });

  it("always allows unattended grant (no server gate)", async () => {
    const { base, consent } = await serve([row({ id: "ffffffffffff", serial: "SN-A" })], true);
    const list = await (await fetch(`${base}/api/admin/remote-sessions`)).json() as { unattendedEnabled?: boolean };
    expect(list.unattendedEnabled).toBeUndefined();
    const grant = await fetch(`${base}/api/admin/remote-sessions/unattended`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host_key: "sn-a", org: "acme" }) });
    expect(grant.status).toBe(200);
    expect(consent.get("sn-a")).toBeTruthy();
  });

  it("a non-admin cannot see another person's session or grant consent", async () => {
    const { base } = await serve([row({ id: "eeeeeeeeeeee", ownerId: "other@example.com" })], false);
    const logs = await fetch(`${base}/api/admin/remote-sessions/eeeeeeeeeeee/logs`);
    expect(logs.status).toBe(403);
    // SN-A runs another person's session: not the caller's host.
    const grant = await fetch(`${base}/api/admin/remote-sessions/unattended`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host_key: "sn-a", org: "acme", installed_by: "x" }) });
    expect(grant.status).toBe(403);
  });

  it("a non-admin grants for their own host under their principal and revokes it; another person's grant stays theirs", async () => {
    const { base, consent } = await serve([row({ id: "eeeeeeeeeeee", ownerId: "viewer@example.com", openedBy: "viewer@example.com", serial: "SN-A" })], false);
    const grant = await fetch(`${base}/api/admin/remote-sessions/unattended`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host_key: "sn-a", org: "acme", installed_by: "someone-else" }) });
    expect(grant.status).toBe(200);
    expect(consent.get("sn-a")?.installedBy).toBe("viewer@example.com");
    const revoke = await fetch(`${base}/api/admin/remote-sessions/unattended/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host_key: "sn-a" }) });
    expect(revoke.status).toBe(200);
    expect(consent.get("sn-a")?.revokedAt).toBeTruthy();
    consent.grant({ hostKey: "sn-z", org: "acme", installedBy: "bob@example.com" });
    const theirs = await fetch(`${base}/api/admin/remote-sessions/unattended/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host_key: "sn-z" }) });
    expect(theirs.status).toBe(403);
    expect(consent.get("sn-z")?.revokedAt).toBeFalsy();
  });
});

describe("enrolled hosts routes", () => {
  const HOST = `h_${"ab".repeat(16)}`;

  async function serveHosts() {
    const dir = mkdtempSync(path.join(tmpdir(), "rsadmin-hosts-")); dirs.push(dir);
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    const admin = createRemoteSessionsAdmin({ rows: () => [], botLabel: () => "Atlas", consent, log: () => [], closeById: vi.fn(async () => true), now: () => NOW });
    const hosts = {
      list: vi.fn(async () => ({ available: true as const, hosts: [] })),
      open: vi.fn(async () => ({ ok: true as const, code: "K7QMNP", botId: "bot-7", threadId: "t" })),
      revoke: vi.fn(async () => ({ ok: true as const })),
    };
    const routes = [createRemoteSessionsAdminRoutes({ admin, hosts: hosts as never, principalId: (auth) => (auth.kind === "session" ? (auth.session as { principalId?: string }).principalId : undefined), orgAdmin: () => false })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: person("viewer@gox"), json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hosts };
  }
  const post = (url: string, body: unknown = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("lists hosts without an openEnabled gate", async () => {
    const { base, hosts } = await serveHosts();
    const listed = await (await fetch(`${base}/api/admin/remote-sessions/hosts`)).json() as { available: boolean; openEnabled?: boolean };
    expect(listed).toMatchObject({ available: true });
    expect(listed.openEnabled).toBeUndefined();
    expect(hosts.list).toHaveBeenCalledWith({ principalId: "viewer@gox" });
  });

  it("opens for a non-admin (no admin approval, always on)", async () => {
    const { base, hosts } = await serveHosts();
    const opened = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/open`, { scope: "view-only" });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ code: "K7QMNP", botId: "bot-7", threadId: "t" });
    expect(hosts.open).toHaveBeenCalledWith({ principalId: "viewer@gox" }, HOST, { scope: "view-only" });
  });

  it("the open route surfaces an ownership refusal from hosts.open", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rsadmin-own-")); dirs.push(dir);
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    const admin = createRemoteSessionsAdmin({ rows: () => [], botLabel: () => "Atlas", consent, log: () => [], closeById: vi.fn(async () => true), now: () => NOW });
    const hosts = {
      list: vi.fn(async () => ({ available: true as const, hosts: [] })),
      open: vi.fn(async () => ({ ok: false as const, error: "not_found" as const, message: "That computer is not one of your enrolled hosts." })),
      revoke: vi.fn(async () => ({ ok: true as const })),
    };
    const routes = [createRemoteSessionsAdminRoutes({ admin, hosts: hosts as never, principalId: (auth) => (auth.kind === "session" ? (auth.session as { principalId?: string }).principalId : undefined), orgAdmin: () => false })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: person("viewer@gox"), json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const opened = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/open`);
    expect(opened.status).toBe(404);
    expect(await opened.json()).toMatchObject({ code: "not_found", error: "That computer is not one of your enrolled hosts." });
    expect(hosts.open).toHaveBeenCalledWith({ principalId: "viewer@gox" }, HOST, {});
  });

  it("revokes with an optional reason", async () => {
    const { base, hosts } = await serveHosts();
    const revoked = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/revoke`);
    expect(revoked.status).toBe(200);
    expect(hosts.revoke).toHaveBeenCalledWith({ principalId: "viewer@gox" }, HOST, "");
    const withReason = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/revoke`, { reason: "poste remplacé" });
    expect(withReason.status).toBe(200);
    expect(hosts.revoke).toHaveBeenLastCalledWith({ principalId: "viewer@gox" }, HOST, "poste remplacé");
    expect((await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/revoke`, { reason: "x".repeat(300) })).status).toBe(400);
  });

  it("refuses a malformed host id or body", async () => {
    const { base, hosts } = await serveHosts();
    expect((await post(`${base}/api/admin/remote-sessions/hosts/PC-01/open`)).status).toBe(404);
    expect((await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/open`, { scope: "root" })).status).toBe(400);
    expect((await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/open`, { nodekey: "x" })).status).toBe(400);
    expect(hosts.open).not.toHaveBeenCalled();
  });
});
