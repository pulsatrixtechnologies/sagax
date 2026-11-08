import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { dispatchRoutes } from "./table.ts";
import { createRemoteSessionsAdminRoutes } from "./remote-sessions-admin.ts";
import { createRemoteSessionsAdmin } from "../remote-support/remote-sessions-admin.ts";
import { createUnattendedConsentStore } from "../remote-support/remote-session-consent-store.ts";
import { requiredScope } from "../auth/request-auth.ts";
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
    const { policyFor } = await import("../tools/tool-policy.ts");
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
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: person("viewer@acme"), json, readBody })) json(res, 404, {});
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
    expect(hosts.list).toHaveBeenCalledWith({ principalId: "viewer@acme" });
  });

  it("opens for a non-admin (no admin approval, always on)", async () => {
    const { base, hosts } = await serveHosts();
    const opened = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/open`, { scope: "view-only" });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ code: "K7QMNP", botId: "bot-7", threadId: "t" });
    expect(hosts.open).toHaveBeenCalledWith({ principalId: "viewer@acme" }, HOST, { scope: "view-only" });
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
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: person("viewer@acme"), json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const opened = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/open`);
    expect(opened.status).toBe(404);
    expect(await opened.json()).toMatchObject({ code: "not_found", error: "That computer is not one of your enrolled hosts." });
    expect(hosts.open).toHaveBeenCalledWith({ principalId: "viewer@acme" }, HOST, {});
  });

  it("revokes with an optional reason", async () => {
    const { base, hosts } = await serveHosts();
    const revoked = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/revoke`);
    expect(revoked.status).toBe(200);
    expect(hosts.revoke).toHaveBeenCalledWith({ principalId: "viewer@acme" }, HOST, "");
    const withReason = await post(`${base}/api/admin/remote-sessions/hosts/${HOST}/revoke`, { reason: "poste remplacé" });
    expect(withReason.status).toBe(200);
    expect(hosts.revoke).toHaveBeenLastCalledWith({ principalId: "viewer@acme" }, HOST, "poste remplacé");
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

describe("bot scope and sharing routes (#2957)", () => {
  const HOST = `h_${"ab".repeat(16)}`;
  const SHARED = `h_${"ef".repeat(16)}`;
  const enrolled = (hostId: string, over: Record<string, unknown> = {}) => ({
    hostId, hostname: hostId === HOST ? "PC-A" : "SRV-B", org: "acme", scope: "full-control", installedBy: null,
    enrolledAt: "2026-10-01T00:00:00Z", expiresAt: "2026-12-30T00:00:00Z", lastSeenAt: null, revokedAt: null, state: "enrolled", ...over,
  });

  async function serveSharing() {
    const dir = mkdtempSync(path.join(tmpdir(), "rsadmin-sharing-")); dirs.push(dir);
    const consent = createUnattendedConsentStore({ dataDir: dir, now: () => NOW });
    const admin = createRemoteSessionsAdmin({ rows: () => [], botLabel: () => "Atlas", consent, log: () => [], closeById: vi.fn(async () => true), now: () => NOW });
    const { RemoteHostSharing } = await import("../remote-support/remote-host-sharing.ts");
    const sharing = new RemoteHostSharing(path.join(dir, "sharing.json"), () => NOW);
    const hosts = {
      list: vi.fn(async () => ({ available: true as const, hosts: [enrolled(HOST), enrolled(SHARED, { sharedBy: "Marie Tremblay" })] })),
      open: vi.fn(async () => ({ ok: true as const, code: "K7QMNP", botId: "bot-7", threadId: "t" })),
      revoke: vi.fn(async () => ({ ok: true as const })),
    };
    const names: Record<string, string> = { "person:marie@acme": "Marie Tremblay", "team:team-support": "Support", "person:viewer@acme": "Viewer" };
    const routes = [createRemoteSessionsAdminRoutes({
      admin, hosts: hosts as never, principalId: (auth) => (auth.kind === "session" ? (auth.session as { principalId?: string }).principalId : undefined), orgAdmin: () => false,
      hostSharing: {
        botScopes: (who) => sharing.botScopes(who),
        setBotScope: (who, hostId, botIds) => sharing.setBotScope(who, hostId, botIds),
        ownsBot: (_who, botId) => botId.startsWith("bot-mine"),
        sharesByOwner: (who) => sharing.sharesByOwner(who),
        share: (who, hostId, target) => sharing.share(who, hostId, target),
        unshare: (who, hostId, target) => sharing.unshare(who, hostId, target),
        forget: (who, hostId) => sharing.forget(who, hostId),
        targetName: (target) => names[`${target.kind}:${target.id}`] ?? null,
      },
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: person("viewer@acme"), json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hosts, sharing };
  }
  const send = (method: string) => (url: string, body?: unknown) =>
    fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const put = send("PUT");
  const del = send("DELETE");
  type Listed = { hosts: Array<{ hostId: string; bots?: string[] | null; shares?: unknown[]; sharedBy?: string }> };

  it("sets the bots allowed on an own host, only among the person's bots", async () => {
    const { base, sharing } = await serveSharing();
    let listed = await (await fetch(`${base}/api/admin/remote-sessions/hosts`)).json() as Listed;
    expect(listed.hosts.map((row) => [row.hostId, row.bots, row.shares])).toEqual([[HOST, null, []], [SHARED, null, undefined]]);

    const saved = await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/bots`, { botIds: ["bot-mine-1", "bot-mine-2"] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ bots: ["bot-mine-1", "bot-mine-2"] });
    expect(sharing.botScope("viewer@acme", HOST)).toEqual(["bot-mine-1", "bot-mine-2"]);
    listed = await (await fetch(`${base}/api/admin/remote-sessions/hosts`)).json() as Listed;
    expect(listed.hosts[0]!.bots).toEqual(["bot-mine-1", "bot-mine-2"]);

    const foreign = await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/bots`, { botIds: ["bot-theirs"] });
    expect(foreign.status).toBe(400);
    expect(sharing.botScope("viewer@acme", HOST)).toEqual(["bot-mine-1", "bot-mine-2"]);
    expect((await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/bots`, { botIds: "all" })).status).toBe(400);
    expect((await put(`${base}/api/admin/remote-sessions/hosts/h_${"99".repeat(16)}/bots`, { botIds: null })).status).toBe(404);
    expect((await send("GET")(`${base}/api/admin/remote-sessions/hosts/${HOST}/bots`)).status).toBe(405);

    const reset = await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/bots`, { botIds: null });
    expect(await reset.json()).toEqual({ bots: null });
  });

  it("shares an own host with a person or a team, lists them with names, and unshares", async () => {
    const { base, sharing } = await serveSharing();
    expect(await (await fetch(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares`)).json()).toEqual({ shares: [] });

    const marie = await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares`, { kind: "person", id: "marie@acme" });
    expect(marie.status).toBe(200);
    expect(await marie.json()).toEqual({ shares: [{ kind: "person", id: "marie@acme", name: "Marie Tremblay" }] });
    const team = await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares`, { kind: "team", id: "team-support" });
    expect(await team.json()).toEqual({ shares: [
      { kind: "person", id: "marie@acme", name: "Marie Tremblay" }, { kind: "team", id: "team-support", name: "Support" },
    ] });
    expect(sharing.sharedWith("marie@acme")).toEqual([{ hostId: HOST, owner: "viewer@acme" }]);

    // self, unknown target, bad body
    expect((await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares`, { kind: "person", id: "Viewer@Acme" })).status).toBe(400);
    expect((await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares`, { kind: "person", id: "nobody@acme" })).status).toBe(404);
    expect((await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares`, { kind: "group", id: "x" })).status).toBe(400);
    // a host shared with me is not mine to share on
    expect((await put(`${base}/api/admin/remote-sessions/hosts/${SHARED}/shares`, { kind: "person", id: "marie@acme" })).status).toBe(404);
    expect((await fetch(`${base}/api/admin/remote-sessions/hosts/${SHARED}/shares`)).status).toBe(404);

    const listed = await (await fetch(`${base}/api/admin/remote-sessions/hosts`)).json() as Listed;
    expect(listed.hosts[0]!.shares).toHaveLength(2);
    expect(listed.hosts[1]!.shares).toBeUndefined();

    const gone = await del(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares/person/${encodeURIComponent("marie@acme")}`);
    expect(await gone.json()).toEqual({ shares: [{ kind: "team", id: "team-support", name: "Support" }] });
    expect(sharing.sharedWith("marie@acme")).toEqual([]);
  });

  it("revoking a host forgets its scope and shares", async () => {
    const { base, sharing } = await serveSharing();
    await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/bots`, { botIds: ["bot-mine-1"] });
    await put(`${base}/api/admin/remote-sessions/hosts/${HOST}/shares`, { kind: "team", id: "team-support" });
    expect((await send("POST")(`${base}/api/admin/remote-sessions/hosts/${HOST}/revoke`, {})).status).toBe(200);
    expect(sharing.botScope("viewer@acme", HOST)).toBeNull();
    expect(sharing.sharesOf("viewer@acme", HOST)).toEqual([]);
  });
});
