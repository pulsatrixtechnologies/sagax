// Slice 7: the organization admin API (server/org-admin-routes.ts) with its
// dependencies faked: the assertion gate, the role per route, a manager's
// reach, and the answer shapes. The real verifier and server are proven in
// oidc-rp.test.ts and org-admin.e2e.test.ts.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OidcError, type ConsoleAssertion } from "./oidc-rp.ts";
import {
  AssertionReplayCache,
  botInReach,
  createOrgAdminRoutes,
  managedReach,
  sortAdminBots,
  wireAuditRow,
  type AdminApproval,
  type AdminBot,
  type AdminBotReach,
  type OrgAdminRouteDeps,
  type OrgAdminViewer,
} from "./org-admin-routes.ts";
import type { UsageRow } from "./usage-ledger.ts";
import { botLook, botPersona } from "./org-admin-look.ts";
import { fail, ok, type ConsoleAuditEntry } from "./org-admin-console.ts";

const ISS = "http://127.0.0.1:19191";
const ORIGIN = "http://127.0.0.1:19192";
const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1); // admin
const MONA = pid(2); // manager of T
const CAROL = pid(3); // in T
const BOB = pid(4); // employee, no team
const DAVE = pid(5); // in U
const GONE = pid(6); // disabled
const people: Record<string, { sub: string; name: string; disabled?: boolean; teams: string[] }> = {
  [ALICE]: { sub: "alice", name: "Alice", teams: [] },
  [MONA]: { sub: "mona", name: "Mona", teams: ["T"] },
  [CAROL]: { sub: "carol", name: "Carol", teams: ["T"] },
  [BOB]: { sub: "bob", name: "Bob", teams: [] },
  [DAVE]: { sub: "dave", name: "Dave", teams: ["U"] },
  [GONE]: { sub: "gone", name: "Gone", disabled: true, teams: [] },
};
const bySub = (sub: string) => Object.entries(people).find(([, person]) => person.sub === sub);

function bot(id: string, owner: string, reach: Partial<AdminBotReach> = {}): { bot: AdminBot; reach: AdminBotReach } {
  return {
    bot: {
      id, name: id.toUpperCase(), owner: { principalId: owner, sub: people[owner]!.sub, name: people[owner]!.name }, ownerRole: owner === ALICE ? "admin" : "member",
      engine: { instanceId: "claude", driverKind: "claudeAgent", installed: true }, model: null, access: "none",
      mcpProfiles: [], grants: [], sections: [], routines: 0, createdAt: null, lastActivityAt: null,
      status: "active", label: null, threads: 1,
      look: botLook({ name: id, color: "green" }, () => false), persona: botPersona({ name: id }), approvalMode: "ask",
    },
    reach: { ownerPrincipalId: owner, grantTargets: [], sectionMemberTargets: [], ...reach },
  };
}

const usageRows: UsageRow[] = [
  { at: "2026-09-29T10:00:00.000Z", botId: "x", botName: "X", threadId: "t", instanceId: "claude", driverKind: "claudeAgent", model: "m", input: 1, output: 1, costUsd: null, trigger: { kind: "user", principalId: CAROL }, ownerPrincipalId: ALICE, access: "owner-key" },
  { at: "2026-09-29T10:00:00.000Z", botId: "x", botName: "X", threadId: "t", instanceId: "claude", driverKind: "claudeAgent", model: "m", input: 1, output: 1, costUsd: null, trigger: { kind: "user", principalId: BOB }, ownerPrincipalId: ALICE, access: "owner-key" },
  { at: "2026-09-29T10:00:00.000Z", botId: "x", botName: "X", threadId: "t", instanceId: "claude", driverKind: "claudeAgent", model: "m", input: 1, output: 1, costUsd: null, trigger: { kind: "owner" }, ownerPrincipalId: CAROL },
];

let server: ReturnType<typeof createServer>;
let base = "";
const answers: Array<{ viewer: OrgAdminViewer; threadId: string; requestId: string; decision: string }> = [];
const recorded: Array<{ principalId: string; entry: ConsoleAuditEntry }> = [];
const auditCalls: Array<Record<string, unknown>> = [];
const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
let identity: "solo" | "perspicax" = "perspicax";

function assertion(sub: string, role: ConsoleAssertion["role"], teams: ConsoleAssertion["teams"] = [], locale?: string): string {
  const token = `tok${++jti}`;
  const now = Math.floor(Date.now() / 1000);
  tokens.set(token, { iss: ISS, sub, jti: `jti-${String(jti).padStart(16, "0")}`, iat: now, exp: now + 60, serverId: "srv", role, teams, ...(locale ? { locale } : {}), actor: "console" });
  return token;
}

beforeAll(async () => {
  const deps: OrgAdminRouteDeps = {
    get identity() { return identity; },
    issuer: ISS,
    publicOrigin: () => ORIGIN,
    linkServerId: () => "srv",
    verify: async (token, audience, serverId) => {
      expect(audience).toBe(ORIGIN);
      expect(serverId).toBe("srv");
      const found = tokens.get(token);
      if (!found) throw new OidcError("console_assertion_signature", "The console_assertion signature does not verify.");
      return found;
    },
    principalFor: (iss, sub) => {
      expect(iss).toBe(ISS);
      const found = bySub(sub);
      return found ? { id: found[0], name: found[1].name, disabled: Boolean(found[1].disabled) } : null;
    },
    person: (id) => ({ principalId: id, sub: people[id]?.sub ?? null, name: people[id]?.name ?? id }),
    teamPeople: (teamIds) => Object.entries(people).filter(([, person]) => person.teams.some((team) => teamIds.includes(team))).map(([id]) => id),
    bots: () => [
      bot("x", ALICE, { grantTargets: ["team:T"] }),
      bot("y", BOB, { grantTargets: [`user:${ALICE}`] }),
      bot("z", CAROL, { sectionMemberTargets: ["team:T"] }),
      bot("w", DAVE),
      bot("v", BOB, { sectionMemberTargets: [`user:${CAROL}`] }),
    ],
    usageRows: () => usageRows,
    approvalsFor: (viewer) => {
      const list: AdminApproval[] = [
        { botId: "x", botName: "X", threadId: "t2", requestId: "r2", kind: "owner", type: "tool", owner: { principalId: ALICE, sub: "alice", name: "Alice" }, at: 20, decidable: true, link: `${ORIGIN}/#thread=t2&bot=x` },
        { botId: "x", botName: "X", threadId: "t1", requestId: "r1", kind: "owner", type: "skill", owner: { principalId: ALICE, sub: "alice", name: "Alice" }, at: 10, decidable: false, link: `${ORIGIN}/#thread=t1&bot=x` },
      ];
      return viewer.principalId === ALICE ? list : [];
    },
    answer: async (viewer, threadId, requestId, decision) => {
      answers.push({ viewer, threadId, requestId, decision });
      if (requestId === "gone") return { ok: false, status: 404, code: "not_found", message: "No such approval." };
      return { ok: true };
    },
    auditCategories: ["rights", "bot", "people"],
    version: () => "0.4.14",
    engines: () => [
      { id: "claude", name: "Claude", kind: "cloud", installed: true, auth: "oauth" },
      { id: "openai", name: "OpenAI", kind: "cloud", installed: true, auth: "apiKey" },
      { id: "ollama", name: "Ollama", kind: "local", installed: false, auth: "none" },
    ],
    recordAction: (principalId, entry) => recorded.push({ principalId, entry }),
    console: [
      { method: "GET", path: "echo/{id}", min: "manager", handle: (ctx) => ok({ id: ctx.params.id, q: ctx.url.searchParams.get("q"), locale: ctx.locale, admin: ctx.reach === null }) },
      { method: "POST", path: "echo/{id}", min: "admin", handle: (ctx) => {
        ctx.record({ category: "bot", action: "echo.post", target: { kind: "bot", id: ctx.params.id } });
        return ok({ body: ctx.body });
      } },
      { method: "GET", path: "boom", min: "employee", handle: () => { throw new Error("secret detail /data/x"); } },
      { method: "GET", path: "refused", min: "employee", handle: () => fail(409, "self", "Not on yourself.") },
      { method: "GET", path: "approvals?scope=org", min: "admin", handle: () => ok({ approvals: ["org"] }) },
    ],
    audit: (input) => (auditCalls.push(input), { rows: [{ id: "2026-09-1", at: "2026-09-01T00:00:00.000Z", category: "rights", action: "grant.set", target: { kind: "bot", id: "x" }, actor: { kind: "person", principalId: ALICE, via: "sagax" } }], next: input.limit === 1 ? "2026-09-1" : null }),
  };
  const handler = createOrgAdminRoutes(deps);
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handler(req, res, new URL(req.url ?? "/", "http://127.0.0.1")).then((handled) => {
      if (!handled) {
        res.writeHead(418);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(path: string, token?: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const body = await response.json().catch(() => null) as any;
  return { status: response.status, body, admin: response.headers.get("x-sagax-admin-api"), cache: response.headers.get("cache-control") };
}

describe("org admin API: the assertion gate", () => {
  it("answers only its own paths", async () => {
    expect((await fetch(`${base}/api/org/approvals`)).status).toBe(418);
  });

  it("refuses without, with a bad, or with a replayed assertion; every answer is marked", async () => {
    const missing = await call("/api/org/admin/bots");
    expect(missing).toMatchObject({ status: 401, body: { code: "assertion_missing" }, admin: "1", cache: "no-store" });
    expect(missing.body.message).toBe(missing.body.error);
    // a cookie is no credential here
    expect((await call("/api/org/admin/bots", undefined, { headers: { cookie: "omb_session=abc" } })).body.code).toBe("assertion_missing");
    expect((await call("/api/org/admin/bots", undefined, { headers: { authorization: "Basic abc" } })).body.code).toBe("assertion_missing");
    const bad = await call("/api/org/admin/bots", "forged");
    expect(bad).toMatchObject({ status: 401, body: { code: "assertion_invalid" }, admin: "1" });
    expect(bad.body.message).not.toContain("forged");
    expect((await call("/api/org/admin/bots", "x".repeat(9000))).body.code).toBe("assertion_invalid");
    const token = assertion("alice", "admin");
    expect((await call("/api/org/admin/bots", token)).status).toBe(200);
    expect(await call("/api/org/admin/bots", token)).toMatchObject({ status: 401, body: { code: "assertion_replayed" }, admin: "1" });
  });

  it("refuses an unknown or disabled person, and every path on a solo server", async () => {
    expect(await call("/api/org/admin/approvals", assertion("nobody", "admin"))).toMatchObject({ status: 403, body: { code: "unknown_person" } });
    expect(await call("/api/org/admin/approvals", assertion("gone", "admin"))).toMatchObject({ status: 403, body: { code: "person_disabled" } });
    identity = "solo";
    try {
      expect(await call("/api/org/admin/bots", assertion("alice", "admin"))).toMatchObject({ status: 403, body: { code: "identity_perspicax" }, admin: "1" });
    } finally {
      identity = "perspicax";
    }
  });

  it("404 for an unknown path, 405 for a wrong method, 403 below the role", async () => {
    expect(await call("/api/org/admin/nope", assertion("alice", "admin"))).toMatchObject({ status: 404, body: { code: "not_found" } });
    expect(await call("/api/org/admin/approvals/a/b/c", assertion("alice", "admin"))).toMatchObject({ status: 404 });
    expect(await call("/api/org/admin/approvals/a%2Fb/c", assertion("alice", "admin"), { method: "POST", body: "{}" })).toMatchObject({ status: 404 });
    expect(await call("/api/org/admin/bots", assertion("alice", "admin"), { method: "POST", body: "{}" })).toMatchObject({ status: 405, body: { code: "method_not_allowed" } });
    expect(await call("/api/org/admin/approvals/t/r", assertion("alice", "admin"))).toMatchObject({ status: 405 });
    for (const path of ["bots", "usage", "audit"]) {
      expect(await call(`/api/org/admin/${path}`, assertion("bob", "employee"))).toMatchObject({ status: 403, body: { code: "forbidden_role" } });
    }
    expect(await call("/api/org/admin/audit", assertion("mona", "manager", [{ id: "T", name: "T", manager: true }]))).toMatchObject({ status: 403, body: { code: "forbidden_role" } });
    expect((await call("/api/org/admin/approvals", assertion("bob", "employee"))).status).toBe(200);
  });
});

describe("org admin API: answers", () => {
  it("bots: an admin sees all, sorted; a manager sees the bots their reach touches", async () => {
    const all = await call("/api/org/admin/bots", assertion("alice", "admin"));
    expect(all.body.truncated).toBe(false);
    expect(all.body.bots.map((b: AdminBot) => b.id)).toEqual(["x", "v", "y", "z", "w"]);
    const mona = await call("/api/org/admin/bots", assertion("mona", "manager", [{ id: "T", name: "T", manager: true }]));
    // x granted to T, z owned by carol (in T), v in a section with carol; never w (dave, U) or y
    expect(mona.body.bots.map((b: AdminBot) => b.id).sort()).toEqual(["v", "x", "z"]);
    // a manager of no team reaches only their own bots
    expect((await call("/api/org/admin/bots", assertion("mona", "manager", [{ id: "T", name: "T", manager: false }]))).body.bots).toEqual([]);
  });

  it("usage: admins see every row, managers their reach, never unattributed", async () => {
    const all = await call("/api/org/admin/usage?from=2026-09-01&to=2026-09-30", assertion("alice", "admin"));
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ from: "2026-09-01", to: "2026-09-30", truncated: false });
    expect(all.body.rows.map((row: { speaker: { kind: string; name?: string } }) => row.speaker.name ?? row.speaker.kind).sort()).toEqual(["Bob", "Carol", "unattributed"]);
    expect(all.body.rows.find((row: { speaker: { name?: string } }) => row.speaker.name === "Carol")).toMatchObject({ owner: { principalId: ALICE, name: "Alice" }, speaker: { kind: "person", principalId: CAROL, sub: "carol" }, access: { "owner-key": 1 } });
    const mona = await call("/api/org/admin/usage?from=2026-09-01&to=2026-09-30", assertion("mona", "manager", [{ id: "T", name: "T", manager: true }]));
    expect(mona.body.rows.map((row: { speaker: { name?: string } }) => row.speaker.name)).toEqual(["Carol"]);
    expect(await call("/api/org/admin/usage?from=2026-01-01&to=2026-09-30", assertion("alice", "admin"))).toMatchObject({ status: 400, body: { code: "bad_request" } });
  });

  it("approvals: oldest first; POST answers allow or deny once, nothing else", async () => {
    const list = await call("/api/org/admin/approvals", assertion("alice", "admin"));
    expect(list.body.approvals.map((a: AdminApproval) => a.requestId)).toEqual(["r1", "r2"]);
    const post = (body: string, request = "r2") => call(`/api/org/admin/approvals/t2/${request}`, assertion("alice", "admin"), { method: "POST", body, headers: { "content-type": "application/json" } });
    expect(await post(JSON.stringify({ decision: "allow" }))).toMatchObject({ status: 200, body: { answered: true, decision: "allow" } });
    expect(answers.at(-1)).toMatchObject({ threadId: "t2", requestId: "r2", decision: "allow", viewer: { principalId: ALICE, orgAdmin: true, role: "admin" } });
    for (const bad of [JSON.stringify({ decision: "always" }), JSON.stringify({ decision: "allow", always: true }), JSON.stringify({ decision: "allow", rememberCommand: true }), "not json", "", JSON.stringify(["allow"]), JSON.stringify({ decision: "allow", pad: "x".repeat(20_000) })]) {
      expect(await post(bad)).toMatchObject({ status: 400, body: { code: "bad_request" } });
    }
    expect(await post(JSON.stringify({ decision: "deny" }), "gone")).toMatchObject({ status: 404, body: { code: "not_found" }, admin: "1" });
  });

  it("audit: admin only, bounded parameters, rows and a cursor", async () => {
    const page = await call("/api/org/admin/audit?limit=1", assertion("alice", "admin"));
    expect(page).toMatchObject({ status: 200, body: { next: "2026-09-1", rows: [{ id: "2026-09-1", category: "rights", action: "grant.set", actor: { kind: "person", principalId: ALICE, name: "Alice", via: "sagax" }, target: { kind: "bot", id: "x" } }] } });
    expect(typeof page.body.rows[0].at).toBe("number");
    for (const query of ["limit=0", "limit=501", "limit=x", "from=abc", "before=bad", "from=10&to=5"]) {
      expect(await call(`/api/org/admin/audit?${query}`, assertion("alice", "admin"))).toMatchObject({ status: 400, body: { code: "bad_request" } });
    }
  });
});

describe("org admin API: pure pieces", () => {
  it("an audit actor never carries an email: a session row names the principal or the device (S7-8)", () => {
    const person = (id: string) => (id === CAROL ? { principalId: CAROL, sub: "S3", name: "Carol" } : { principalId: id, sub: null, name: id });
    const row = (actor: Record<string, unknown>) => ({ id: "2026-10-1", at: "2026-10-01T00:00:00.000Z", category: "bot", action: "bot.update", actor }) as unknown as Parameters<typeof wireAuditRow>[0];
    const byPrincipal = wireAuditRow(row({ kind: "session", sessionId: "s", label: "Chrome", email: "carol@example.test", userId: CAROL }), person);
    expect(byPrincipal.actor).toEqual({ kind: "person", principalId: CAROL, sub: "S3", name: "Carol", via: "sagax" });
    const byLabel = wireAuditRow(row({ kind: "session", sessionId: "s", label: "Chrome", email: "dave@example.test", userId: "google:42" }), person);
    expect(byLabel.actor).toEqual({ kind: "person", principalId: "", sub: null, name: "Chrome", via: "sagax" });
    const emailLabel = wireAuditRow(row({ kind: "session", sessionId: "s", label: "dave@example.test", email: "dave@example.test" }), person);
    expect(JSON.stringify([byPrincipal, byLabel, emailLabel])).not.toContain("@example.test");
    expect(wireAuditRow(row({ kind: "person", principalId: CAROL, via: "sagax" }), person).actor).toMatchObject({ name: "Carol", via: "sagax" });
  });

  it("the replay cache keeps ids until exp plus a minute, at most its cap", () => {
    const cache = new AssertionReplayCache(3);
    expect(cache.admit("a", 1_000, 0)).toBe(true);
    expect(cache.admit("a", 1_000, 500)).toBe(false);
    // pruned once exp + 60 s passed
    expect(cache.admit("a", 100_000, 61_000)).toBe(true);
    cache.admit("b", 100_000, 61_000);
    cache.admit("c", 100_000, 61_000);
    cache.admit("d", 100_000, 61_000);
    expect(cache.size()).toBe(3);
    // the oldest went first
    expect(cache.admit("a", 100_000, 61_000)).toBe(true);
  });

  it("a manager's reach is themselves and the people of the teams they manage", () => {
    const viewer: OrgAdminViewer = { principalId: MONA, sub: "mona", name: "Mona", role: "manager", orgAdmin: false, teams: [{ id: "T", name: "T", manager: true }, { id: "U", name: "U", manager: false }] };
    const reach = managedReach(viewer, (ids) => (ids.includes("T") ? [CAROL, MONA] : []))!;
    expect([...reach].sort()).toEqual([MONA, CAROL].sort());
    expect(managedReach({ ...viewer, orgAdmin: true, role: "admin" }, () => [])).toBeNull();
    const teams = new Set(["T"]);
    expect(botInReach(reach, teams, { ownerPrincipalId: DAVE, grantTargets: ["team:U"], sectionMemberTargets: [`user:${DAVE}`] })).toBe(false);
    expect(botInReach(reach, teams, { ownerPrincipalId: DAVE, grantTargets: [`user:${CAROL}`], sectionMemberTargets: [] })).toBe(true);
    expect(botInReach(null, teams, { ownerPrincipalId: DAVE, grantTargets: [], sectionMemberTargets: [] })).toBe(true);
  });

  it("sorts by owner then bot name and caps", () => {
    const list = [bot("b", BOB).bot, bot("a", BOB).bot, bot("c", ALICE).bot];
    expect(sortAdminBots(list).bots.map((b) => b.id)).toEqual(["c", "a", "b"]);
    expect(sortAdminBots(list, 2)).toMatchObject({ truncated: true, bots: [{ id: "c" }, { id: "a" }] });
  });
});

describe("org admin API: the console routes (2026-10-08)", () => {
  const T_MANAGER = [{ id: "T", name: "T", manager: true }];
  it("capabilities: any role, the release version and every route", async () => {
    const got = await call("/api/org/admin/capabilities", assertion("bob", "employee"));
    expect(got).toMatchObject({ status: 200, body: { version: "0.4.14", api: 6, mascotFamilies: ["classics", "shapes", "animals"] } });
    expect(got.body.mascots.map((entry: { id: string; family: string }) => `${entry.id}:${entry.family}`)).toEqual(["owl:classics", "crab:animals", "shape:shapes", "trombi:classics", "bunbu:animals", "shiba:animals", "grump:animals", "ogre:animals", "frog:animals"]);
    // api 4: the engines, grouped Cloud and Local by the server
    expect(got.body.engines).toEqual([
      { id: "claude", name: "Claude", kind: "cloud", installed: true, auth: "oauth" },
      { id: "openai", name: "OpenAI", kind: "cloud", installed: true, auth: "apiKey" },
      { id: "ollama", name: "Ollama", kind: "local", installed: false, auth: "none" },
    ]);
    expect(got.body.routes).toEqual(expect.arrayContaining(["GET bots", "GET capabilities", "GET echo/{id}", "POST echo/{id}", "POST approvals/{thread}/{request}", "GET files/{bot}/read"]));
    // 2026-10-09: the permission catalogue the Perspicax console draws from
    expect(got.body.permissionsVersion).toBe(1);
    expect(got.body.permissionGroups.map((group: { id: string }) => group.id)).toContain("bots");
    const keys = got.body.permissions.map((row: { key: string }) => row.key);
    expect(keys).toEqual(expect.arrayContaining(["bots.create", "usage.view", "host.shell"]));
    expect(got.body.permissions.find((row: { key: string }) => row.key === "server.link")).toMatchObject({ adminOnly: true, memberDefault: false, adminOnlyReason: { en: expect.any(String), fr: expect.any(String) } });
    // 2026-10-19: delegable in Perspicax
    expect(got.body.permissions.find((row: { key: string }) => row.key === "host.shell")).toMatchObject({ adminOnly: false, memberDefault: false });
    expect(got.body.permissions.find((row: { key: string }) => row.key === "bots.create")).toMatchObject({ adminOnly: false, memberDefault: true, label: { en: "Create and own bots" } });
  });

  it("dispatches by template, method and role; the body, the locale and the audit row reach the handler", async () => {
    expect(await call("/api/org/admin/echo/abc?q=x", assertion("mona", "manager", T_MANAGER, "fr-CA"))).toMatchObject({ status: 200, body: { id: "abc", q: "x", locale: "fr", admin: false } });
    expect((await call("/api/org/admin/echo/abc", assertion("alice", "admin"))).body).toMatchObject({ locale: "en", admin: true });
    expect(await call("/api/org/admin/echo/abc", assertion("bob", "employee"))).toMatchObject({ status: 403, body: { code: "forbidden_role", reason: expect.any(String) } });
    expect(await call("/api/org/admin/echo/abc", assertion("mona", "manager", T_MANAGER), { method: "POST", body: "{}" })).toMatchObject({ status: 403 });
    const posted = await call("/api/org/admin/echo/abc", assertion("alice", "admin"), { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(posted).toMatchObject({ status: 200, body: { body: { a: 1 } } });
    expect(recorded.at(-1)).toEqual({ principalId: ALICE, entry: { category: "bot", action: "echo.post", target: { kind: "bot", id: "abc" } } });
    expect(await call("/api/org/admin/echo/abc", assertion("alice", "admin"), { method: "POST", body: "nope" })).toMatchObject({ status: 400, body: { code: "bad_request" } });
    expect(await call("/api/org/admin/echo/abc", assertion("alice", "admin"), { method: "POST", body: JSON.stringify({ pad: "x".repeat(20_000) }) })).toMatchObject({ status: 413, body: { code: "too_large" } });
    // a parameter that is not a plain id, a wrong method
    expect((await call("/api/org/admin/echo/a%20b", assertion("alice", "admin"))).status).toBe(404);
    expect(await call("/api/org/admin/boom", assertion("alice", "admin"), { method: "POST", body: "{}" })).toMatchObject({ status: 405, body: { code: "method_not_allowed" } });
  });

  it("a thrown error is a readable 500 without its detail; a refusal keeps its code and reason", async () => {
    const boom = await call("/api/org/admin/boom", assertion("alice", "admin"));
    expect(boom).toMatchObject({ status: 500, body: { code: "server_error" }, admin: "1" });
    expect(JSON.stringify(boom.body)).not.toContain("/data/x");
    expect(await call("/api/org/admin/refused", assertion("alice", "admin"))).toMatchObject({ status: 409, body: { code: "self", message: "Not on yourself.", reason: "Not on yourself." } });
  });

  it("approvals?scope=org goes to the console route; plain approvals stays the caller's own", async () => {
    expect((await call("/api/org/admin/approvals?scope=org", assertion("alice", "admin"))).body).toEqual({ approvals: ["org"] });
    expect((await call("/api/org/admin/approvals?scope=org", assertion("bob", "employee"))).status).toBe(403);
    expect((await call("/api/org/admin/approvals", assertion("alice", "admin"))).body.approvals).toHaveLength(2);
  });

  it("bots: paged and filtered when asked, the whole list otherwise", async () => {
    const admin = () => assertion("alice", "admin");
    const first = await call("/api/org/admin/bots?limit=2", admin());
    expect(first.body.items.map((b: AdminBot) => b.id)).toEqual(["x", "v"]);
    expect(first.body.next).toEqual(expect.any(String));
    const second = await call(`/api/org/admin/bots?limit=2&cursor=${first.body.next}`, admin());
    expect(second.body.items.map((b: AdminBot) => b.id)).toEqual(["y", "z"]);
    const last = await call(`/api/org/admin/bots?limit=2&cursor=${second.body.next}`, admin());
    expect(last.body).toMatchObject({ items: [{ id: "w" }], next: null });
    expect((await call(`/api/org/admin/bots?owner=${BOB}`, admin())).body.items.map((b: AdminBot) => b.id)).toEqual(["v", "y"]);
    expect((await call("/api/org/admin/bots?q=dave", admin())).body.items.map((b: AdminBot) => b.id)).toEqual(["w"]);
    expect((await call("/api/org/admin/bots?status=archived", admin())).body.items).toEqual([]);
    for (const query of ["status=gone", "limit=0", "limit=201", "cursor=zz", `q=${"x".repeat(201)}`]) {
      expect(await call(`/api/org/admin/bots?${query}`, admin())).toMatchObject({ status: 400, body: { code: "bad_request" } });
    }
    // a manager's page is their reach
    expect((await call("/api/org/admin/bots?limit=50", assertion("mona", "manager", T_MANAGER))).body.items.map((b: AdminBot) => b.id).sort()).toEqual(["v", "x", "z"]);
  });

  it("usage rows carry their engine; audit filters by category and target", async () => {
    const usage = await call("/api/org/admin/usage?from=2026-09-01&to=2026-09-30", assertion("alice", "admin"));
    expect(usage.body.rows.every((row: { engine: string | null }) => row.engine === "claude")).toBe(true);
    expect((await call("/api/org/admin/audit?category=bot&target=x", assertion("alice", "admin"))).status).toBe(200);
    expect(auditCalls.at(-1)).toMatchObject({ categories: ["bot"], target: "x" });
    expect(await call("/api/org/admin/audit?category=nope", assertion("alice", "admin"))).toMatchObject({ status: 400, body: { code: "bad_request" } });
  });
});
