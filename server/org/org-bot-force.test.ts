import { describe, expect, it } from "vitest";

import { createOrgBotForceRoutes, type ForceBot, type OrgBotForceDeps } from "./org-bot-force.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import type { SessionRecord } from "../sessions.ts";

const ADMIN = "pr_11111111-1111-4111-8111-111111111111";
const OWNER = "pr_22222222-2222-4222-8222-222222222222";
const MEMBER = "pr_33333333-3333-4333-8333-333333333333";

const session = (principalId: string, scopes: ("admin" | "client")[]): RequestAuth => ({
  kind: "session", via: "cookie", scopes,
  session: { id: `s-${principalId}`, label: "web", scopes, createdAt: 1, lastSeenAt: 1, principalId, idp: { iss: "https://px.example.test", sub: principalId } } as SessionRecord,
});
const admin = session(ADMIN, ["admin"]);
const member = session(MEMBER, ["client"]);
const owner = session(OWNER, ["admin"]);

function harness(overrides: Partial<OrgBotForceDeps> = {}) {
  const bots: Record<string, ForceBot> = { b1: { id: "b1", name: "Atlas", ownerPrincipalId: OWNER } };
  const calls: string[] = [];
  const audits: string[] = [];
  const notices: string[] = [];
  const route = createOrgBotForceRoutes({
    organization: true,
    isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === ADMIN,
    bot: (id) => bots[id] ?? null,
    actorId: (auth) => (auth.kind === "session" ? auth.session.principalId ?? "" : "operator"),
    stop: async (id) => { calls.push(`stop:${id}`); },
    remove: async (id) => { calls.push(`remove:${id}`); delete bots[id]; return { status: 200, body: { ok: true } }; },
    audit: (_auth, action, bot) => audits.push(`${action}:${bot.id}`),
    notifyOwner: (bot, action) => notices.push(`${action}:${bot.ownerPrincipalId}`),
    ...overrides,
  });
  const call = async (path: string, auth: RequestAuth, body?: unknown, method = "POST") => {
    const out: { status?: number; body?: unknown } = {};
    const ctx = {
      req: {}, res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL(`http://localhost${path}`), path, method, auth,
      json: (_res: unknown, status: number, payload: unknown) => { out.status = status; out.body = payload; },
      readBody: async () => body ?? {},
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { call, calls, audits, notices, bots };
}

describe("admin force actions on a bot", () => {
  it("lets other paths through", async () => {
    const h = harness();
    expect((await h.call("/api/org/bots", admin)).passed).toBe(true);
    expect((await h.call("/api/bots/b1", admin)).passed).toBe(true);
  });

  it("an organization admin force-stops any bot; audited, the owner is told", async () => {
    const h = harness();
    const out = await h.call("/api/org/bots/b1/force-stop", admin);
    expect(out.status).toBe(200);
    expect(h.calls).toEqual(["stop:b1"]);
    expect(h.audits).toEqual(["bot.force_stop:b1"]);
    expect(h.notices).toEqual([`stop:${OWNER}`]);
  });

  it("a member, even the bot's owner without the admin role, is refused", async () => {
    const h = harness();
    for (const auth of [member, owner]) {
      const stop = await h.call("/api/org/bots/b1/force-stop", auth);
      const remove = await h.call("/api/org/bots/b1/force-delete", auth, { confirm: "Atlas" });
      expect(stop.status).toBe(403);
      expect(remove.status).toBe(403);
      expect((stop.body as { code: string }).code).toBe("not_org_admin");
    }
    expect(h.calls).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("a solo server answers identity_perspicax", async () => {
    const h = harness({ organization: false, isAdmin: () => true });
    const out = await h.call("/api/org/bots/b1/force-stop", admin);
    expect(out.status).toBe(403);
    expect((out.body as { code: string }).code).toBe("identity_perspicax");
    expect(h.calls).toEqual([]);
  });

  it("force delete needs the bot's name, stops first, then deletes; audited, the owner is told", async () => {
    const h = harness();
    const missing = await h.call("/api/org/bots/b1/force-delete", admin, {});
    expect(missing.status).toBe(400);
    const wrong = await h.call("/api/org/bots/b1/force-delete", admin, { confirm: "Bolt" });
    expect(wrong.status).toBe(400);
    expect(h.calls).toEqual([]);
    const out = await h.call("/api/org/bots/b1/force-delete", admin, { confirm: "Atlas" });
    expect(out.status).toBe(200);
    expect(h.calls).toEqual(["stop:b1", "remove:b1"]);
    expect(h.audits).toEqual(["bot.force_delete:b1"]);
    expect(h.notices).toEqual([`delete:${OWNER}`]);
  });

  it("a refused deletion is neither audited nor notified", async () => {
    const h = harness({ remove: async () => ({ status: 409, body: { error: "busy" } }) });
    const out = await h.call("/api/org/bots/b1/force-delete", admin, { confirm: "Atlas" });
    expect(out.status).toBe(409);
    expect(h.audits).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it("an admin acting on their own bot gets no notification", async () => {
    const h = harness({ bot: (id) => (id === "b2" ? { id: "b2", name: "Mine", ownerPrincipalId: ADMIN } : null) });
    await h.call("/api/org/bots/b2/force-stop", admin);
    expect(h.audits).toEqual(["bot.force_stop:b2"]);
    expect(h.notices).toEqual([]);
  });

  it("unknown bot 404, wrong method 405", async () => {
    const h = harness();
    expect((await h.call("/api/org/bots/zz/force-stop", admin)).status).toBe(404);
    expect((await h.call("/api/org/bots/b1/force-stop", admin, undefined, "GET")).status).toBe(405);
  });
});
