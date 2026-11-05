import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createPerspicaxRoleRoutes } from "./perspicax-roles.ts";
import { createHeldRolesRoute, perspicaxRoleOf, type HeldRolesRouteDeps } from "./perspicax-held-roles.ts";
import { PerspicaxMcp } from "../perspicax/perspicax-mcp.ts";
import { RoleJournal } from "../perspicax/role-journal.ts";
import { requiredScope } from "../auth/request-auth.ts";
import type { HeldRole } from "../../shared/perspicax-roles.ts";

// Visible roles, batch 3: the composer's role picker. No sockets, credentials
// or live data: neutral people ("alex", "sam") and roles.
const DESK: HeldRole = { slug: "service-desk", name: "Service Desk", id: "profile-desk", readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true } };
const FULL: HeldRole = { slug: "full-access", name: "Full Access", id: "profile-full", readOnly: false, explicitOnly: true, reachable: true, can: { read: true, write: true, routines_run: true } };

const authOf = (person: string) => ({ kind: "session", person } as unknown as RequestAuth);

function routeFixture(over: Partial<HeldRolesRouteDeps> = {}) {
  const heldRolesFor = vi.fn(async (principal: string) => principal === "alex" ? { roles: [DESK, FULL], current: "service-desk" } : { roles: [DESK] });
  const deps: HeldRolesRouteDeps = {
    principal: (auth) => (auth as unknown as { person: string }).person,
    thread: (_auth, _botId, threadId) => threadId === "other" ? undefined : threadId,
    mounts: () => true,
    heldRolesFor,
    ...over,
  };
  const route = createPerspicaxRoleRoutes({
    actor: (auth) => (auth as unknown as { person: string }).person,
    mayUseBot: () => true,
    answerTransition: () => ({ status: 500, body: null }),
    rules: () => ({ status: 500, body: null }),
    removeRule: () => ({ status: 500, body: null }),
    more: createHeldRolesRoute(deps),
  });
  const get = async (person: string, query: string) => {
    const answer: { status?: number; body?: unknown } = {};
    const url = new URL(`http://local/api/bots/nova/roles/held?${query}`);
    await route({
      req: {} as never, res: { setHeader: () => {} } as never, url, path: url.pathname, method: "GET", auth: authOf(person),
      json: ((_res: unknown, status: number, body: unknown) => { answer.status = status; answer.body = body; }) as never,
      readBody: (async () => null) as never,
    });
    return answer;
  };
  return { get, heldRolesFor };
}

describe("GET /api/bots/:id/roles/held", () => {
  it("answers the asking person only, whatever the query names, and never shows a profile id", async () => {
    const f = routeFixture();
    const alex = await f.get("alex", "threadId=t1&principal=sam");
    expect(f.heldRolesFor).toHaveBeenLastCalledWith("alex", "nova", "t1", expect.any(AbortSignal));
    expect(alex).toEqual({ status: 200, body: { available: true, current: "service-desk", roles: [
      { slug: "service-desk", name: "Service Desk", readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true } },
      { slug: "full-access", name: "Full Access", readOnly: false, explicitOnly: true, reachable: true, can: { read: true, write: true, routines_run: true } },
    ] } });
    expect(JSON.stringify(alex.body)).not.toContain("profile-");
    const sam = await f.get("sam", "threadId=t1");
    expect(f.heldRolesFor).toHaveBeenLastCalledWith("sam", "nova", "t1", expect.any(AbortSignal));
    expect((sam.body as { roles: unknown[] }).roles).toHaveLength(1);
  });

  it("is unavailable where Perspicax is not mounted, and refuses a thread the person cannot write in", async () => {
    const off = routeFixture({ mounts: () => false });
    expect(await off.get("alex", "threadId=t1")).toEqual({ status: 200, body: { available: false, roles: [] } });
    expect(off.heldRolesFor).not.toHaveBeenCalled();
    const f = routeFixture();
    expect((await f.get("alex", "threadId=other")).status).toBe(404);
    expect((await f.get("alex", "")).status).toBe(400);
    const none = routeFixture({ heldRolesFor: async () => null });
    expect((await none.get("alex", "threadId=t1")).body).toEqual({ available: false, roles: [] });
  });

  it("is a client route", () => {
    expect(requiredScope("GET", "/api/bots/nova/roles/held")).toBe("client");
  });
});

describe("perspicaxRole on a send", () => {
  it("reads a slug or Moi, and ignores anything else", () => {
    expect(perspicaxRoleOf({ perspicaxRole: "service-desk" })).toBe("service-desk");
    expect(perspicaxRoleOf({ perspicaxRole: "" })).toBe("");
    expect(perspicaxRoleOf({})).toBeUndefined();
    expect(perspicaxRoleOf({ perspicaxRole: 3 })).toBeUndefined();
    expect(perspicaxRoleOf({ perspicaxRole: "a b<script>" })).toBeUndefined();
  });
});

// A fake Perspicax that lists each person's own roles and records the role
// every call ran under.
function mcpFixture() {
  const journal = new RoleJournal(null);
  const calls: Array<{ name?: string; args?: Record<string, unknown>; token: string; session: string | null; method?: string }> = [];
  const acting = new Map<string, string>();
  const profilesOf = (token: string) => token.endsWith("alex") ? [
    { slug: "service-desk", name: "Service Desk", id: "profile-desk", explicit_only: false, can: { read: true, write: true } },
    { slug: "full-access", name: "Full Access", id: "profile-full", explicit_only: true, can: { read: true, write: true } },
  ] : [{ slug: "service-desk", name: "Service Desk", id: "profile-desk", explicit_only: false, can: { read: true, write: false } }];
  let sessions = 0;
  const fetcher: typeof fetch = vi.fn(async (_url, init) => {
    const headers = new Headers(init!.headers);
    const token = (headers.get("authorization") ?? "").replace("Bearer ", "");
    const session = headers.get("mcp-session-id");
    if (init!.method === "DELETE") { calls.push({ token, session, method: "DELETE" }); return new Response(null, { status: 204 }); }
    const frame = JSON.parse(String(init!.body));
    if (frame.id === undefined) return new Response(null, { status: 202 });
    const name = frame.params?.name;
    const args = frame.params?.arguments ?? {};
    const key = session ?? `s${++sessions}`;
    calls.push({ name: name ?? frame.method, args, token, session });
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }), { headers: { "content-type": "application/json", "mcp-session-id": key } });
    if (frame.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {} });
    if (frame.method === "tools/list") return reply({ tools: [{ name: "identity_switch", annotations: { readOnlyHint: true } }, { name: "cw_psa_find_tickets", annotations: { readOnlyHint: true } }] });
    if (name === "identity_switch") {
      if (typeof args.profile === "string") acting.set(key, args.profile);
      if (args.clear) acting.delete(key);
      const now = acting.get(key);
      return reply({ structuredContent: { profiles: profilesOf(token), acting_as: now ? { slug: now, name: now, token: { scope: `profile:${now}`, expires_at: new Date(Date.now() + 900_000).toISOString() } } : null } });
    }
    return reply({ structuredContent: { ok: true, as: acting.get(key) ?? "me" } });
  });
  const revoke = vi.fn(async () => true);
  const mcp = new PerspicaxMcp({
    issuer: "https://fake.test", version: "test", now: Date.now, fetch: fetcher,
    link: () => ({ mcpEndpoint: () => "https://fake.test/mcp", exchangeToken: async (subject: string) => ({ ok: true, token: `mcp-${subject}`, expiresAt: Date.now() + 3_600_000 }), revokeExchanged: revoke }),
    subjectOf: (principal: string) => ({ iss: "https://fake.test", sub: principal, disabled: false }),
    subjectToken: async (subject: { sub: string }) => ({ ok: true, token: `signin-${subject.sub}`, expiresAt: Date.now() + 3_600_000 }),
    routineSubjectToken: async (principal: string) => ({ ok: true, token: `delegation-${principal}`, expiresAt: Date.now() + 3_600_000 }),
    botExists: () => true, routineRetryMs: [], sleep: async () => {}, log: () => {},
    turnRole: (turn) => { const slug = journal.takePick(turn.threadId, turn.principalId); return slug === undefined ? undefined : { slug, reason: "person" }; },
  } as ConstructorParameters<typeof PerspicaxMcp>[0]);
  return { mcp, journal, calls, revoke };
}

describe("PerspicaxMcp.heldRolesFor", () => {
  it("lists the person's own roles on a short-lived connection, then closes and revokes it", async () => {
    const f = mcpFixture();
    const alex = await f.mcp.heldRolesFor("alex", "nova", "t1", AbortSignal.timeout(5_000));
    expect(alex?.roles.map((role) => role.slug)).toEqual(["service-desk", "full-access"]);
    expect(alex?.current).toBeUndefined();
    const listing = f.calls.find((call) => call.name === "identity_switch")!;
    expect(listing).toMatchObject({ token: "mcp-signin-alex", args: {} });
    expect(f.calls.some((call) => call.method === "DELETE" && call.token === "mcp-signin-alex")).toBe(true);
    expect(f.revoke).toHaveBeenCalledWith("mcp-signin-alex");
    const sam = await f.mcp.heldRolesFor("sam", "nova", "t1", AbortSignal.timeout(5_000));
    expect(sam?.roles.map((role) => role.slug)).toEqual(["service-desk"]);
    expect(f.mcp.size()).toBe(0);
  });

  it("asks the live connection of that thread and person, with the role it acts as", async () => {
    const f = mcpFixture();
    f.journal.pick("t1", "alex", "full-access");
    await f.mcp.prepareTurn({ threadId: "t1", generation: "g", bot: { id: "nova" }, speakerPrincipalId: "alex", speakerOrigin: "person" });
    await f.mcp.ensureTurnSessions("t1", "g");
    const live = await f.mcp.heldRolesFor("alex", "nova", "t1", AbortSignal.timeout(5_000));
    expect(live?.current).toBe("full-access");
    expect(f.revoke).not.toHaveBeenCalled();
    // someone else asking about the same thread never reads that connection
    const sam = await f.mcp.heldRolesFor("sam", "nova", "t1", AbortSignal.timeout(5_000));
    expect(sam?.current).toBeUndefined();
    expect(sam?.roles.map((role) => role.slug)).toEqual(["service-desk"]);
  });

  it("never gives one person's pick to another person's turn", async () => {
    const f = mcpFixture();
    f.journal.pick("t1", "alex", "full-access");
    await f.mcp.prepareTurn({ threadId: "t1", generation: "g1", bot: { id: "nova" }, speakerPrincipalId: "sam", speakerOrigin: "person" });
    await f.mcp.ensureTurnSessions("t1", "g1");
    await f.mcp.relay({ threadId: "t1", generation: "g1", botId: "nova", frame: { jsonrpc: "2.0", id: "i", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } } });
    const answer = await f.mcp.relay({ threadId: "t1", generation: "g1", botId: "nova", frame: { jsonrpc: "2.0", id: "c", method: "tools/call", params: { name: "cw_psa_find_tickets", arguments: {} } } });
    expect(JSON.stringify(answer.body)).toContain('"as":"me"');
    expect(f.calls.some((call) => call.name === "identity_switch" && call.args?.profile === "full-access")).toBe(false);
    // and the pick stays Alex's: their next turn still uses it
    expect(f.journal.takePick("t1", "alex")).toBe("full-access");
  });
});
