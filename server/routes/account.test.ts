import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createAccountRoutes, type AccountRouteDeps } from "./account.ts";
import { dispatchRoutes } from "./table.ts";

const ADA = "pr_00000000-0000-4000-8000-000000000001";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const person = (principalId?: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: "s", label: "phone", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, ...(principalId ? { principalId } : {}) } as never,
});

async function serve(auth: RequestAuth, deps: Partial<AccountRouteDeps>) {
  const deleted: string[] = [];
  const routes = [createAccountRoutes({
    organization: () => true,
    perspicaxDeletion: async () => ({ ok: false, error: "unsupported", status: 404 }),
    deletePersonData: async (principalId) => { deleted.push(principalId); return { bots: 2, threads: 3 }; },
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const reauth = (body: unknown = { client: "phone" }) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me/reauth`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const remove = (body: unknown = { confirm: true }) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me`, {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { remove, reauth, deleted };
}

describe("DELETE /api/me", () => {
  it("is member scope (a person deletes only themselves)", () => {
    expect(requiredScope("DELETE", "/api/me")).toBe("client");
    expect(requiredScope("GET", "/api/me")).toBe("admin");
  });

  it("answers personal_server on a personal computer", async () => {
    const { remove } = await serve({ kind: "loopback", scopes: ["admin", "client"] }, { organization: () => false });
    const res = await remove();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "personal_server" });
  });

  it("answers 501 perspicax_deletion_unavailable and deletes nothing when Perspicax has no erase route", async () => {
    const { remove, deleted } = await serve(person(ADA), {});
    const res = await remove();
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ code: "perspicax_deletion_unavailable" });
    expect(deleted).toEqual([]);
  });

  it("erases the Perspicax account first, then the person's data, only when confirmed", async () => {
    const calls: string[] = [];
    const { remove, deleted } = await serve(person(ADA), { perspicaxDeletion: async (id, sessionId) => { calls.push(id); expect(sessionId).toBe("s"); return { ok: true }; } });
    expect((await remove({})).status).toBe(400);
    expect(calls).toEqual([]);
    const res = await remove();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, bots: 2, threads: 3 });
    expect(calls).toEqual([ADA]);
    expect(deleted).toEqual([ADA]);
    expect((await (await serve(person(), {})).remove()).status).toBe(403);
  });

  it.each([
    ["a refused sign-in token", { ok: false, error: "subject", status: 403 }, 409, "account_sign_in_again"],
    ["no recent sign-in (2026-10-18)", { ok: false, error: "reauth_required", status: 403 }, 409, "reauth_required"],
    ["the last active admin", { ok: false, error: "last_admin", status: 409 }, 409, "last_admin"],
    ["a key a product still uses", { ok: false, error: "bound", status: 409 }, 409, "perspicax_key_in_use"],
    ["another refusal (its 4xx)", { ok: false, error: "refused", status: 404 }, 404, "perspicax_deletion_failed"],
    ["a link or service account conflict", { ok: false, error: "refused", status: 409 }, 409, "perspicax_deletion_failed"],
    ["a refusal without a 4xx", { ok: false, error: "refused", status: 500 }, 502, "perspicax_deletion_failed"],
    ["no link", { ok: false, error: "link" }, 502, "perspicax_deletion_failed"],
    ["an unreachable Perspicax", { ok: false, error: "unreachable", status: 503 }, 502, "perspicax_deletion_failed"],
  ] as const)("maps %s and deletes nothing", async (_what, answer, status, code) => {
    const { remove, deleted } = await serve(person(ADA), { perspicaxDeletion: async () => answer });
    const res = await remove();
    expect(res.status).toBe(status);
    expect(res.status).not.toBe(401);
    const body = await res.json() as { code: string; error: string };
    expect(body.code).toBe(code);
    expect(body.error.length).toBeGreaterThan(0);
    expect(deleted).toEqual([]);
  });

  it("says the deletion may have gone through when Perspicax does not confirm it", async () => {
    const { remove } = await serve(person(ADA), { perspicaxDeletion: async () => ({ ok: false, error: "unreachable" }) });
    const body = await (await remove()).json() as { error: string };
    expect(body.error).toMatch(/automatically/);
  });

  it("answers 500 account_deletion_pending when the local deletion fails after Perspicax erased the account", async () => {
    const { remove } = await serve(person(ADA), {
      perspicaxDeletion: async () => ({ ok: true }),
      deletePersonData: async () => { throw new Error("disk"); },
    });
    const res = await remove();
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe("account_deletion_pending");
  });

  it("answers 502 and deletes nothing when the Perspicax call throws", async () => {
    const { remove, deleted } = await serve(person(ADA), { perspicaxDeletion: async () => { throw new Error("down"); } });
    expect((await remove()).status).toBe(502);
    expect(deleted).toEqual([]);
  });
});

describe("POST /api/me/reauth (2026-10-18)", () => {
  it("is member scope, like the deletion it opens", () => {
    expect(requiredScope("POST", "/api/me/reauth")).toBe("client");
    expect(requiredScope("GET", "/api/me/reauth")).toBe("admin");
  });

  it("opens the sign-in again for this session's own person and answers the address, no-store", async () => {
    const asked: unknown[] = [];
    const { reauth } = await serve(person(ADA), {
      reauthStart: (input) => { asked.push(input); return { url: "https://sagax.example.test/auth/oidc/reauth?ticket=t&client=phone", expiresAt: 42 }; },
    });
    const res = await reauth();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ url: "https://sagax.example.test/auth/oidc/reauth?ticket=t&client=phone", expiresAt: 42 });
    expect(asked).toEqual([{ principalId: ADA, sessionId: "s", client: "phone" }]);
    expect((await reauth({})).status).toBe(200);
    expect(asked[1]).toMatchObject({ client: "web" });
  });

  it("refuses another client, no person, a personal server, a server that cannot sign in again, and GET", async () => {
    const opened = { reauthStart: () => ({ url: "u", expiresAt: 1 }) };
    expect((await (await serve(person(ADA), opened)).reauth({ client: "desktop" })).status).toBe(400);
    expect((await (await serve(person(), opened)).reauth()).status).toBe(403);
    const personal = await (await serve(person(ADA), { ...opened, organization: () => false })).reauth();
    expect((await personal.json() as { code: string }).code).toBe("personal_server");
    const none = await (await serve(person(ADA), {})).reauth();
    expect(none.status).toBe(503);
    expect((await none.json() as { code: string }).code).toBe("reauth_unavailable");
    const failing = await (await serve(person(ADA), { reauthStart: () => ({ error: "unavailable" }) })).reauth();
    expect(failing.status).toBe(503);
  });

  it("answers reauth_required with where to sign in again, and deletes nothing", async () => {
    const { remove, deleted } = await serve(person(ADA), { perspicaxDeletion: async () => ({ ok: false, error: "reauth_required" }) });
    const res = await remove();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "reauth_required", reauthPath: "/api/me/reauth" });
    expect(deleted).toEqual([]);
  });
});
