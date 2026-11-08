import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { dispatchRoutes } from "./table.ts";
import { createRemoteHostsRoutes } from "./remote-hosts.ts";
import { RemoteHostTeams } from "../remote-support/remote-host-teams.ts";
import { RemoteHostAccess } from "../remote-support/remote-host-access.ts";
import type { UnattendedHostRow } from "../../shared/remote-unattended-host.ts";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const HOST = `h_${"ab".repeat(16)}`;
const OFF = `h_${"cd".repeat(16)}`;
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const auth = (principalId?: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s", label: "app", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId } as never,
});
const row = (hostId: string, lastSeenAt: string | null): UnattendedHostRow => ({
  hostId, hostname: hostId === HOST ? "PC-A" : "PC-B", org: "Acme", scope: "full-control", installedBy: null,
  enrolledAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-30T00:00:00.000Z", lastSeenAt, revokedAt: null, state: "enrolled",
});

async function serve(principalId: string | null = "tech@example.org") {
  const dir = mkdtempSync(path.join(tmpdir(), "remote-hosts-route-")); dirs.push(dir);
  const teams = new RemoteHostTeams(path.join(dir, "teams.json"), () => NOW);
  const access = new RemoteHostAccess(path.join(dir, "access.json"), () => NOW);
  const installCode = vi.fn(async () => ({ ok: true as const, code: "K7QM", enrollUrl: null, org: "Acme", scope: "view-only" as const, expiresAt: null, installCommand: "sagax-remote-access install", installCommands: { macos: "sudo m", linux: "sudo l", windows: "w" } }));
  const routes = [createRemoteHostsRoutes({
    principalId: (a) => (a.kind === "session" ? (a.session as { principalId?: string }).principalId : undefined),
    available: async () => ({ available: true, hosts: [row(HOST, new Date(NOW - 30_000).toISOString()), row(OFF, null)] }),
    installCode,
    teams,
    access,
    sectionsFor: () => ["Support"],
    now: () => NOW,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: auth(principalId ?? undefined), json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, teams, access, installCode };
}

const send = (url: string, method: string, body?: unknown) => fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("/api/remote-hosts", () => {
  it("lists the person's hosts with online state and team", async () => {
    const { base, teams } = await serve();
    teams.assign("tech@example.org", HOST, "Support");
    const body = await (await fetch(`${base}/api/remote-hosts`)).json() as { available: boolean; hosts: Array<{ hostId: string; online: boolean; section: string | null }> };
    expect(body.available).toBe(true);
    expect(body.hosts.map((h) => [h.hostId, h.online, h.section])).toEqual([[HOST, true, "Support"], [OFF, false, null]]);
  });

  it("issues an install code for the caller", async () => {
    const { base, installCode } = await serve();
    const res = await send(`${base}/api/remote-hosts/code`, "POST", { scope: "view-only", consentRef: "CW-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "K7QM", scope: "view-only", installCommand: "sagax-remote-access install" });
    expect(installCode).toHaveBeenCalledWith("tech@example.org", { scope: "view-only", consentRef: "CW-1" });
    expect((await send(`${base}/api/remote-hosts/code`, "POST", { scope: "root" })).status).toBe(400);
  });

  it("saves what bots may do with one of the caller's hosts and lists it", async () => {
    const { base, access } = await serve();
    expect((await send(`${base}/api/remote-hosts/${HOST}/access`, "PUT", { access: "never" })).status).toBe(200);
    expect(access.get("tech@example.org", HOST)).toBe("never");
    expect(access.get("other@example.org", HOST)).toBe("always");
    const body = await (await fetch(`${base}/api/remote-hosts`)).json() as { hosts: Array<{ hostId: string; access: string }> };
    expect(body.hosts.map((h) => [h.hostId, h.access])).toEqual([[HOST, "never"], [OFF, "always"]]);
    expect((await send(`${base}/api/remote-hosts/${HOST}/access`, "PUT", { access: "sometimes" })).status).toBe(400);
    expect((await send(`${base}/api/remote-hosts/h_${"ee".repeat(16)}/access`, "PUT", { access: "ask" })).status).toBe(404);
    expect((await send(`${base}/api/remote-hosts/${HOST}/access`, "PUT", { access: "always" })).status).toBe(200);
    expect(access.forPrincipal("tech@example.org").size).toBe(0);
  });

  it("places a host on one of the caller's teams and takes it off", async () => {
    const { base, teams } = await serve();
    expect((await send(`${base}/api/remote-hosts/${HOST}/team`, "PUT", { section: "Support" })).status).toBe(200);
    expect(teams.forPrincipal("tech@example.org").get(HOST)?.section).toBe("Support");
    expect((await send(`${base}/api/remote-hosts/${HOST}/team`, "PUT", { section: "Elsewhere" })).status).toBe(404);
    expect((await send(`${base}/api/remote-hosts/h_${"ee".repeat(16)}/team`, "PUT", { section: "Support" })).status).toBe(404);
    expect((await send(`${base}/api/remote-hosts/${HOST}/team`, "PUT", { section: null })).status).toBe(200);
    expect(teams.forPrincipal("tech@example.org").size).toBe(0);
  });

  it("asks to sign in without a person", async () => {
    const { base } = await serve(null);
    expect((await fetch(`${base}/api/remote-hosts`)).status).toBe(401);
  });
});
