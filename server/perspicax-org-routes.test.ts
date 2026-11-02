// Who reaches /api/org/routine-delegation (slice 6, fix 2 contract item 5).
// The auth gate answers first (403 for a session-less local request under
// service trust, 401 for a session that expired or was revoked; see
// server/org/org-routines.e2e.test.ts); this is what the route itself answers.
import { describe, expect, it } from "vitest";

import { createPerspicaxOrgRoutes } from "./perspicax-org-routes.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import type { SessionRecord } from "./sessions.ts";

function answer(auth: RequestAuth, method = "GET") {
  const out: { status?: number; body?: unknown } = {};
  const routes = createPerspicaxOrgRoutes({
    issuer: "https://px.example.test",
    orgName: "Acme",
    directory: () => null,
    bySubject: () => null,
    viewerRole: () => "member",
    settings: () => ({ orgKeyConfigured: false, allowFullAccess: true, memberEnvironmentAutonomy: true, memberAutoApproval: true }),
    pendingAdminApprovals: () => [],
    routineDelegation: {
      status: () => ({ state: "none" }),
      suspendedCount: () => 0,
    },
  });
  const res = { setHeader: () => {}, headersSent: false, writableEnded: false };
  const ctx = {
    req: {}, res, url: new URL("http://127.0.0.1/api/org/routine-delegation"), path: "/api/org/routine-delegation", method, auth,
    json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
    readBody: async () => ({}),
  } as unknown as RouteContext;
  return routes(ctx).then((result) => ({ ...out, passed: result === PASS }));
}

const session = (overrides: Partial<SessionRecord> = {}): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, ...overrides } as SessionRecord,
});

describe("/api/org/routine-delegation", () => {
  it("answers 401 session_required to a local request under SAGAX_LOOPBACK_TRUST=owner", async () => {
    expect(await answer({ kind: "loopback", scopes: ["admin", "client"] })).toMatchObject({ status: 401, body: { code: "session_required" } });
  });

  it("answers 403 identity_perspicax to a session without a principal or a provider account", async () => {
    expect(await answer(session())).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    expect(await answer(session({ principalId: "pr_alice" }))).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
  });

  it("serves a person signed in with Pulsatrix, read-only: no consent to start, nothing to revoke (2026-10-08)", async () => {
    const alice = session({ principalId: "pr_alice", idp: { iss: "https://px.example.test", sub: "A1", grantRef: "g1" } } as Partial<SessionRecord>);
    expect(await answer(alice)).toMatchObject({ status: 200, body: { state: "none", suspended: 0, principalId: "pr_alice" } });
    expect((await answer(alice)).body).not.toHaveProperty("manageUrl");
    for (const method of ["POST", "DELETE"]) expect(await answer(alice, method)).toMatchObject({ status: 404 });
  });
});

describe("/api/org/directory manageUrl (person panel)", () => {
  async function directoryAs(role: "admin" | "member") {
    const out: { body?: { people: { principalId: string; manageUrl?: string }[] } } = {};
    const routes = createPerspicaxOrgRoutes({
      issuer: "https://px.example.test/",
      orgName: "Acme",
      directory: () => ({
        people: () => [{ sub: "u 1", login: "ada", name: "Ada Example", email: "ada@example.test", role: "employee", status: "active" }],
        state: () => ({ state: "ok" }),
        serverId: () => undefined,
      }) as never,
      bySubject: () => ({ id: "pr_ada" }) as never,
      viewerRole: () => role,
      settings: () => ({ orgKeyConfigured: false, allowFullAccess: true, memberEnvironmentAutonomy: true, memberAutoApproval: true }),
      pendingAdminApprovals: () => [],
    });
    const ctx = {
      req: {}, res: { setHeader: () => {} }, url: new URL("http://127.0.0.1/api/org/directory"), path: "/api/org/directory", method: "GET",
      auth: session({ principalId: "pr_viewer" }),
      json: (_res: unknown, _status: number, body: unknown) => { out.body = body as typeof out.body; },
      readBody: async () => ({}),
    } as unknown as RouteContext;
    await routes(ctx);
    return out.body!.people;
  }

  it("gives an admin each person's Perspicax console page", async () => {
    expect((await directoryAs("admin"))[0]).toMatchObject({ principalId: "pr_ada", manageUrl: "https://px.example.test/console/users/u%201" });
  });

  it("never sends the console page to a member", async () => {
    expect((await directoryAs("member"))[0]).not.toHaveProperty("manageUrl");
  });
});

describe("/api/org/settings githubClientId", () => {
  async function patchGithub(opts: {
    role: "admin" | "member";
    body: unknown;
    save?: (clientId: string | null) => void;
    omitSave?: boolean;
  }) {
    const out: { status?: number; body?: unknown } = {};
    const saved: Array<string | null> = [];
    const routes = createPerspicaxOrgRoutes({
      issuer: "https://px.example.test",
      orgName: "Acme",
      directory: () => null,
      bySubject: () => null,
      viewerRole: () => opts.role,
      settings: () => ({
        orgKeyConfigured: false,
        allowFullAccess: true, memberEnvironmentAutonomy: true, memberAutoApproval: true,
        github: { clientId: saved.at(-1) ?? null, fromEnvironment: false },
      }),
      pendingAdminApprovals: () => [],
      ...(opts.omitSave
        ? {}
        : {
            saveGithubClientId: (clientId: string | null) => {
              saved.push(clientId);
              opts.save?.(clientId);
            },
          }),
    });
    const ctx = {
      req: {},
      res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL("http://127.0.0.1/api/org/settings"),
      path: "/api/org/settings",
      method: "PATCH",
      auth: session({ principalId: "pr_admin" }),
      json: (_res: unknown, status: number, body: unknown) => {
        out.status = status;
        out.body = body;
      },
      readBody: async () => opts.body,
    } as unknown as RouteContext;
    await routes(ctx);
    return { ...out, saved };
  }

  it("lets an admin save a trimmed id and clear it with null", async () => {
    const set = await patchGithub({ role: "admin", body: { githubClientId: "  Iv1.acme  " } });
    expect(set).toMatchObject({ status: 200, saved: ["Iv1.acme"] });
    expect(set.body).toMatchObject({ settings: { github: { clientId: "Iv1.acme" } } });
    const cleared = await patchGithub({ role: "admin", body: { githubClientId: null } });
    expect(cleared).toMatchObject({ status: 200, saved: [null] });
  });

  it("refuses a member, a missing saver and a value that is not printable ASCII 1 to 128", async () => {
    expect(await patchGithub({ role: "member", body: { githubClientId: "Iv1.acme" } })).toMatchObject({ status: 403 });
    expect(await patchGithub({ role: "admin", body: { githubClientId: "Iv1.acme" }, omitSave: true })).toMatchObject({ status: 400 });
    for (const githubClientId of ["", "   ", "bad\nid", "a".repeat(129)]) {
      expect(await patchGithub({ role: "admin", body: { githubClientId } })).toMatchObject({ status: 400, saved: [] });
    }
  });
});

describe("/api/org/settings has no GitHub token list of its own", () => {
  // The organization's GitHub credentials are in the one list
  // (/api/me/github/credentials, scope org): this route neither lists nor
  // changes them any more (2026-10-28).
  async function call(input: { method?: "GET" | "PATCH"; body?: unknown }) {
    const method = input.method ?? "PATCH";
    const path = method === "GET" ? "/api/org" : "/api/org/settings";
    const out: { status?: number; body?: Record<string, unknown> } = {};
    const routes = createPerspicaxOrgRoutes({
      issuer: "https://px.example.test",
      orgName: "Acme",
      directory: () => null,
      bySubject: () => null,
      viewerRole: () => "admin",
      settings: () => ({ orgKeyConfigured: false, allowFullAccess: true, memberEnvironmentAutonomy: true, memberAutoApproval: true, github: { clientId: null, fromEnvironment: false }, pluginMarketplaces: { mode: "any" as const } }),
      pendingAdminApprovals: () => [],
      saveGithubClientId: () => {},
    });
    await routes({
      req: {},
      res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL(`http://127.0.0.1${path}`),
      path,
      method,
      auth: session({ principalId: "pr_admin" }),
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body as Record<string, unknown>; },
      readBody: async () => input.body ?? {},
    } as unknown as RouteContext);
    return out;
  }

  it("refuses githubTokens and never lists it", async () => {
    const secret = "fake-alpha-token-1111";
    const refused = await call({ body: { githubTokens: { op: "add", label: "Alpha org", token: secret } } });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body).includes(secret)).toBe(false);
    const read = await call({ method: "GET" });
    expect(read.body?.settings).not.toHaveProperty("githubTokens");
  });
});

describe("/api/org/settings memberAutoApproval", () => {
  async function patch(role: "admin" | "member", body: unknown, withSaver = true) {
    const out: { status?: number; body?: unknown } = {};
    let current = true;
    const saved: boolean[] = [];
    const routes = createPerspicaxOrgRoutes({
      issuer: "https://px.example.test",
      orgName: "Acme",
      directory: () => null,
      bySubject: () => null,
      viewerRole: () => role,
      settings: () => ({ orgKeyConfigured: false, allowFullAccess: false, memberEnvironmentAutonomy: true, memberAutoApproval: current }),
      pendingAdminApprovals: () => [],
      ...(withSaver ? { saveMemberAutoApproval: (allowed: boolean) => { saved.push(allowed); current = allowed; } } : {}),
    });
    const ctx = {
      req: {}, res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL("http://127.0.0.1/api/org/settings"), path: "/api/org/settings", method: "PATCH",
      auth: session({ principalId: "pr_admin" }),
      json: (_res: unknown, status: number, answer: unknown) => { out.status = status; out.body = answer; },
      readBody: async () => body,
    } as unknown as RouteContext;
    await routes(ctx);
    return { ...out, saved };
  }

  it("lets an admin turn it on and off, and answers the saved settings", async () => {
    const off = await patch("admin", { memberAutoApproval: false });
    expect(off).toMatchObject({ status: 200, body: { settings: { memberAutoApproval: false } }, saved: [false] });
    const on = await patch("admin", { memberAutoApproval: true });
    expect(on).toMatchObject({ status: 200, body: { settings: { memberAutoApproval: true } }, saved: [true] });
  });

  it("refuses a member, a value that is not a boolean, and a server without the setter", async () => {
    expect(await patch("member", { memberAutoApproval: false })).toMatchObject({ status: 403, saved: [] });
    for (const value of ["yes", 1, null]) expect(await patch("admin", { memberAutoApproval: value })).toMatchObject({ status: 400, saved: [] });
    expect(await patch("admin", { memberAutoApproval: true }, false)).toMatchObject({ status: 400 });
  });
});

describe("/api/org/settings allowVaultExport (2026-10-18)", () => {
  async function patch(role: "admin" | "member", body: unknown, withSaver = true) {
    const out: { status?: number; body?: unknown } = {};
    let current = true;
    const saved: boolean[] = [];
    const routes = createPerspicaxOrgRoutes({
      issuer: "https://px.example.test",
      orgName: "Acme",
      directory: () => null,
      bySubject: () => null,
      viewerRole: () => role,
      settings: () => ({ orgKeyConfigured: false, allowFullAccess: false, memberEnvironmentAutonomy: true, memberAutoApproval: true, allowVaultExport: current }),
      pendingAdminApprovals: () => [],
      ...(withSaver ? { saveAllowVaultExport: (allowed: boolean) => { saved.push(allowed); current = allowed; } } : {}),
    });
    const ctx = {
      req: {}, res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL("http://127.0.0.1/api/org/settings"), path: "/api/org/settings", method: "PATCH",
      auth: session({ principalId: "pr_admin" }),
      json: (_res: unknown, status: number, answer: unknown) => { out.status = status; out.body = answer; },
      readBody: async () => body,
    } as unknown as RouteContext;
    await routes(ctx);
    return { ...out, saved };
  }

  it("lets an admin turn it on and off, and answers the saved settings", async () => {
    const off = await patch("admin", { allowVaultExport: false });
    expect(off).toMatchObject({ status: 200, body: { settings: { allowVaultExport: false } }, saved: [false] });
    const on = await patch("admin", { allowVaultExport: true });
    expect(on).toMatchObject({ status: 200, body: { settings: { allowVaultExport: true } }, saved: [true] });
  });

  it("refuses a member, a value that is not a boolean, and a server without the setter", async () => {
    expect(await patch("member", { allowVaultExport: false })).toMatchObject({ status: 403, saved: [] });
    for (const value of ["yes", 1, null]) expect(await patch("admin", { allowVaultExport: value })).toMatchObject({ status: 400, saved: [] });
    expect(await patch("admin", { allowVaultExport: true }, false)).toMatchObject({ status: 400 });
  });
});
