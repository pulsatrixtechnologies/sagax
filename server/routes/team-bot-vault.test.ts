import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { vaultHandle } from "../../shared/credential-vault.ts";
import { CredentialVault } from "../credential-vault.ts";
import { json, readBody } from "../harness/http.ts";
import { createTeamBotVaultRoutes, soloMayManage } from "./team-bot-vault.ts";
import { dispatchRoutes } from "./table.ts";

const FAKE_PASSWORD = "fake-Route-Pa55-for-tests";
const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function serve(mayManage = true) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-team-vault-routes-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const vault = new CredentialVault(dir, () => ({ kind: "key", key: Buffer.alloc(32, 5) }));
  const routes = [createTeamBotVaultRoutes({
    vault,
    botExists: (id) => id === "payroll",
    mayManage: () => mayManage,
  })];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void (async () => {
      const handled = await dispatchRoutes(routes, {
        req, res, url, path: url.pathname, method: req.method ?? "GET",
        auth: { kind: "session", principalId: "pr_manager", scopes: [] } as never,
        json, readBody,
      });
      if (!handled) json(res, 404, { from: "inline" });
    })();
  });
  cleanups.push(() => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (method: string, path: string, body?: Record<string, unknown>) => {
    const response = await fetch(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
  };
  return { api, vault };
}

describe("team bot vault routes", () => {
  it("lets a manager create, list, update and remove shared logins without leaking values", async () => {
    const { api } = await serve(true);
    const created = await api("POST", "/api/bots/payroll/credentials", {
      kind: "login",
      name: "Payroll SSO",
      username: "bot@example.test",
      password: FAKE_PASSWORD,
      domains: ["payroll.example.test"],
    });
    expect(created.status).toBe(201);
    const item = created.body.item as { id: string; name: string; hasPassword: boolean };
    expect(item).toMatchObject({ name: "Payroll SSO", hasPassword: true });
    expect(JSON.stringify(created.body)).not.toContain(FAKE_PASSWORD);

    const listed = await api("POST", "/api/bots/payroll/credentials/list");
    expect(listed.status).toBe(200);
    expect(listed.body.items as unknown[]).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(FAKE_PASSWORD);

    const patched = await api("PATCH", `/api/bots/payroll/credentials/${item.id}`, { name: "Renamed SSO" });
    expect(patched.status).toBe(200);
    expect((patched.body.item as { name: string }).name).toBe("Renamed SSO");

    const removed = await api("DELETE", `/api/bots/payroll/credentials/${item.id}`);
    expect(removed.status).toBe(200);
    const empty = await api("POST", "/api/bots/payroll/credentials/list");
    expect(empty.body.items as unknown[]).toHaveLength(0);
    expect(vaultHandle(item.id)).toMatch(/^cred_/);
  });

  it("refuses a non-manager and an unknown bot", async () => {
    const denied = await serve(false);
    const refused = await denied.api("POST", "/api/bots/payroll/credentials/list");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("not_manager");

    const missing = await (await serve(true)).api("POST", "/api/bots/unknown/credentials/list");
    expect(missing.status).toBe(404);
  });
});

describe("soloMayManage (server that is not an organization)", () => {
  const session = { kind: "session", principalId: "pr_b", scopes: [] } as never;
  const loopback = (trust: string) => ({ kind: "loopback", trust }) as never;
  const facts = { ownerOrAdmin: false, actOrEphemeral: false, loopbackOptIn: false };

  it("refuses a second member who is neither owner nor admin", () => {
    expect(soloMayManage(session, facts)).toBe(false);
    expect(soloMayManage(session, { ...facts, ownerOrAdmin: true })).toBe(true);
  });

  it("refuses an act or ephemeral session even for the owner", () => {
    expect(soloMayManage(session, { ...facts, ownerOrAdmin: true, actOrEphemeral: true })).toBe(false);
  });

  it("refuses a loopback service without the opt-in, allows the owner at this computer", () => {
    expect(soloMayManage(loopback("service"), facts)).toBe(false);
    expect(soloMayManage(loopback("service"), { ...facts, loopbackOptIn: true })).toBe(true);
    expect(soloMayManage(loopback("owner"), facts)).toBe(true);
  });
});

describe("team bot vault item input", () => {
  it("rejects an invalid site and a kind it does not fill", async () => {
    const { api } = await serve(true);
    const bad = await api("POST", "/api/bots/payroll/credentials", { name: "X", username: "a", password: "b", domains: ["not a site"] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid_domains");
    const card = await api("POST", "/api/bots/payroll/credentials", { kind: "card", name: "Card", username: "a", password: "b", domains: ["payroll.example.test"] });
    expect((card.body.item as { kind: string }).kind).toBe("login");
  });
});
