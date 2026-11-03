// /api/me/github/credentials: a member keeps their own credentials with no
// admin; the organization's need an organization admin; no answer carries a
// token (a label and the last 4 characters).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { json, readBody } from "../harness/http.ts";
import { CLIENT_ALLOW, type RequestAuth } from "../auth/request-auth.ts";
import { GithubCredentials } from "../github-credentials.ts";
import { createGithubCredentialRoutes } from "./github-credentials.ts";

const MINE = "fake-member-token-7777";
const SHARED = "fake-shared-token-8888";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const session = (principalId: string) => ({ kind: "session", via: "bearer", scopes: ["client"], session: { principalId } }) as unknown as RequestAuth;

function setup(options: { denied?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-gh-cred-route-"));
  dirs.push(dir);
  const store = new GithubCredentials(dir, () => ({ kind: "key", key: Buffer.alloc(32, 9) }));
  const audits: unknown[] = [];
  const route = createGithubCredentialRoutes({
    store,
    owner: (auth) => (auth.kind === "session" ? (auth.session as { principalId?: string }).principalId ?? null : null),
    organization: () => true,
    canManageOrg: (auth) => auth.kind === "session" && (auth.session as { principalId?: string }).principalId === "p-admin",
    deviceFlow: () => false,
    ownIntegrationsRefusal: () => (options.denied ? { error: "forbidden", permission: "apps.ownIntegrations" } : null),
    auditOrg: (_auth, row) => audits.push(row),
  });
  const call = async (method: string, body: unknown, auth: RequestAuth) => {
    let status = 0;
    let sent: unknown;
    const res = { headersSent: false, writableEnded: false, setHeader() {} };
    await route({
      req: { headers: { "content-type": "application/json" } } as never, res: res as never, url: new URL("http://x/api/me/github/credentials"),
      path: "/api/me/github/credentials", method, auth,
      json: ((_r: unknown, code: number, payload: unknown) => { status = code; sent = payload; }) as unknown as typeof json,
      readBody: (async () => body) as unknown as typeof readBody,
    });
    return { status, body: sent as Record<string, unknown> };
  };
  return { store, call, audits };
}

describe("/api/me/github/credentials", () => {
  it("is open to a member (client scope)", () => {
    for (const method of ["GET", "POST"]) {
      expect(CLIENT_ALLOW.some((rule) => rule.methods.includes(method) && rule.path.test("/api/me/github/credentials"))).toBe(true);
    }
    expect(CLIENT_ALLOW.some((rule) => rule.methods.includes("PUT") && rule.path.test("/api/bots/bot-a/plugins/marketplaces/team/credential"))).toBe(true);
  });

  it("a member adds, renames, replaces and removes their own, with no admin and no token answered", async () => {
    const { call } = setup();
    const member = session("p-alice");
    const added = await call("POST", { op: "add", label: "Other organization", token: MINE }, member);
    expect(added.status).toBe(200);
    expect(JSON.stringify(added.body)).not.toContain(MINE);
    const [entry] = added.body.credentials as Array<{ id: string; label: string; hint: string; owner: string }>;
    expect(entry).toMatchObject({ label: "Other organization", hint: "7777", owner: "mine" });
    expect((await call("POST", { op: "rename", id: entry!.id, label: "Repository group" }, member)).status).toBe(200);
    const replaced = await call("POST", { op: "replace", id: entry!.id, token: SHARED }, member);
    expect(JSON.stringify(replaced.body)).not.toContain(SHARED);
    expect((replaced.body.credentials as Array<{ hint: string }>)[0]!.hint).toBe("8888");
    const removed = await call("POST", { op: "remove", id: entry!.id }, member);
    expect(removed.body.credentials).toEqual([]);
  });

  it("the organization's list: an admin changes it, a member sees it and cannot", async () => {
    const { call, audits } = setup();
    const refused = await call("POST", { op: "add", label: "Shared", token: SHARED, scope: "org" }, session("p-alice"));
    expect(refused.status).toBe(403);
    const added = await call("POST", { op: "add", label: "Shared", token: SHARED, scope: "org" }, session("p-admin"));
    expect(added.status).toBe(200);
    expect(JSON.stringify(audits)).not.toContain(SHARED);
    expect(audits).toEqual([expect.objectContaining({ op: "add", label: "Shared", count: 1 })]);
    const seen = await call("GET", undefined, session("p-alice"));
    const list = seen.body.credentials as Array<{ id: string; owner: string }>;
    expect(list).toEqual([expect.objectContaining({ label: "Shared", owner: "org" })]);
    expect(seen.body.canManageOrg).toBe(false);
    expect((await call("POST", { op: "remove", id: list[0]!.id }, session("p-alice"))).status).toBe(403);
    // another member's credential does not exist for them
    const own = await call("POST", { op: "add", label: "Bob's", token: MINE }, session("p-bob"));
    const bobs = (own.body.credentials as Array<{ id: string; owner: string }>).find((entry) => entry.owner === "mine")!;
    expect((await call("POST", { op: "remove", id: bobs.id }, session("p-alice"))).status).toBe(404);
  });

  it("a person without apps.ownIntegrations reads but does not change their own", async () => {
    const { call } = setup({ denied: true });
    const listed = await call("GET", undefined, session("p-alice"));
    expect(listed.status).toBe(200);
    expect((listed.body as Record<string, unknown>).managedByAdmin).toBeUndefined();
    const refused = await call("POST", { op: "add", label: "Mine", token: MINE }, session("p-alice"));
    expect(refused.status).toBe(403);
    expect((refused.body as Record<string, unknown>).permission).toBe("apps.ownIntegrations");
  });
});
