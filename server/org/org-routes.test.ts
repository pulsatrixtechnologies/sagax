import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parseStoredConfig } from "../config.ts";
import { json, readBody } from "../harness/http.ts";
import { signInListWithOpenInvites } from "./org-directory.ts";
import {
  acceptInviteRoute, acceptOpenInvitesForEmail, createOrgRoute, createOrgRoutes, createPublicInviteRoutes, getOrgRoute, inviteLink, inviteLinkBase,
  inviteMailMessage, invitePreviewRoute, issueInviteRoute, joinInviteRoute, maskEmail, revokeInviteRoute, updateOrgHostRoute,
  type OrgRouteDeps, type OrgState, type PublicInviteRouteDeps,
} from "./org-routes.ts";
import { requiredScope } from "../request-auth.ts";
import { dispatchRoutes } from "../routes/table.ts";

const OWNER = "pr_00000000-0000-4000-8000-00000000000a";

function emptyOrgState(): OrgState {
  return { org: null, invites: [], signIn: { admins: [], members: [] } };
}

function orgStateWithOwner(): OrgState {
  const state = emptyOrgState();
  createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
  return state;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** Boots the real route table over an actual HTTP server, the way
 * bot-presets.test.ts and the running server do, so `req` is a genuine
 * IncomingMessage and `requestOrigin(req)` sees real headers. */
async function serveOrgRoutes(deps: Partial<OrgRouteDeps> & { state: OrgState }): Promise<string> {
  const routes = [createOrgRoutes({ actorId: () => OWNER, actorEmail: () => "owner@example.com", ...deps })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function postInvite(base: string, email = "morgan@example.test") {
  const res = await fetch(`${base}/api/org/invites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return { status: res.status, body: (await res.json()) as { invite?: { token: string; email: string }; mailed?: boolean } };
}

describe("org routes", () => {
  it("returns 404 when there is no organization", () => {
    expect(getOrgRoute(emptyOrgState())).toEqual({ status: 404 });
  });
  it("returns the stored org and people from signIn plus the owner", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    state.signIn.admins = ["ada@example.test"];
    state.signIn.members = ["morgan@example.test"];
    expect(getOrgRoute(state)).toEqual({
      status: 200,
      body: {
        org: { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } },
        people: [
          { id: OWNER, role: "owner" },
          { id: "ada@example.test", role: "admin", email: "ada@example.test" },
          { id: "morgan@example.test", role: "member", email: "morgan@example.test" },
        ],
        pendingInvites: [],
      },
    });
  });
  it("lists the owner once when their email is also in the sign-in lists", () => {
    const state = emptyOrgState();
    const owner = "pr_11111111-1111-4111-8111-111111111111";
    createOrgRoute(state, { name: "Example", ownerUserId: owner, host: { kind: "server", url: "https://server.example.com" } });
    state.signIn.admins = ["OWNER@example.com", "ada@example.test"];
    state.signIn.members = ["owner@example.com", "morgan@example.test"];
    expect(getOrgRoute(state, 1_000, "owner@example.com").body?.people).toEqual([
      { id: owner, role: "owner", email: "owner@example.com" },
      { id: "ada@example.test", role: "admin", email: "ada@example.test" },
      { id: "morgan@example.test", role: "member", email: "morgan@example.test" },
    ]);
  });
  it("lists an open invite without treating it as a member", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    issueInviteRoute(state, { actorId: OWNER, email: "morgan@example.test", now: 1_000, token: "tok" });
    const body = getOrgRoute(state, 2_000).body;
    expect(body?.people).toEqual([{ id: OWNER, role: "owner" }]);
    expect(body?.pendingInvites).toEqual([{ email: "morgan@example.test", expiresAt: 1_000 + 7 * 24 * 60 * 60 * 1000 }]);
  });
  it("joins once and reports already-member the second time", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    const issued = issueInviteRoute(state, { actorId: OWNER, email: "morgan@example.test", now: 1, token: "tok" });
    expect(issued.status).toBe(200);
    const joined = acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 2 });
    const used = acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 3 });
    expect(joined.body?.status ?? joined.status).toBe("joined");
    expect(used.body?.status ?? used.status).toBe("used");
  });
  it("forbids a member from issuing invites", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    issueInviteRoute(state, { actorId: OWNER, email: "morgan@example.test", now: 1, token: "tok" });
    acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 2 });
    expect(issueInviteRoute(state, { actorId: "morgan@example.test", email: "ada@example.test", now: 3, token: "tok-2" })).toEqual({ status: 403 });
  });
  it("refuses a mismatched userId and joins the invited email", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    issueInviteRoute(state, { actorId: OWNER, email: "morgan@example.test", now: 1, token: "tok" });
    expect(acceptInviteRoute(state, { token: "tok", userId: "stranger@example.test", now: 2 })).toEqual({ status: 403 });
    expect(state.signIn.members).toEqual([]);
    expect(state.invites[0]?.usedAt).toBeUndefined();
    const joined = acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 3 });
    expect(joined.body?.status ?? joined.status).toBe("joined");
    expect(state.signIn.members).toEqual(["morgan@example.test"]);
  });
  it("lets a non-member accept an invite at client scope", () => {
    expect(requiredScope("POST", "/api/org/invites/tok/accept")).toBe("client");
    expect(requiredScope("GET", "/api/org")).toBe("client");
    expect(requiredScope("POST", "/api/org")).toBe("admin");
    expect(requiredScope("POST", "/api/org/invites")).toBe("admin");
    expect(requiredScope("POST", "/api/org/invites/tok/revoke")).toBe("admin");
  });
  it("adds the invited address on accept when they are not yet a member", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    issueInviteRoute(state, { actorId: OWNER, email: "Morgan@Example.test", now: 1, token: "tok" });
    expect(state.signIn.members).toEqual([]);
    const joined = acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 2 });
    expect(joined.body?.status ?? joined.status).toBe("joined");
    expect(state.signIn.members).toEqual(["morgan@example.test"]);
    expect(signInListWithOpenInvites({
      admins: [],
      members: [],
      invites: state.invites,
      now: 3,
    }).members).toEqual([]);
  });
  it("lets an open invite sign in before accept adds the address", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    issueInviteRoute(state, { actorId: OWNER, email: "morgan@example.test", now: 1, token: "tok" });
    expect(state.signIn.members.includes("morgan@example.test")).toBe(false);
    expect(signInListWithOpenInvites({
      admins: state.signIn.admins,
      members: state.signIn.members,
      invites: state.invites,
      now: 1,
    }).members).toEqual(["morgan@example.test"]);
  });
  it("lets an owner or an admin revoke an open invite", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    issueInviteRoute(state, { actorId: OWNER, email: "morgan@example.test", now: 1, token: "tok" });
    state.signIn.admins = ["Ada@Example.test"];
    expect(revokeInviteRoute(state, { actorId: "morgan@example.test", token: "tok", now: 2 })).toEqual({ status: 403 });
    expect(state.invites[0]?.revokedAt).toBeUndefined();
    const revoked = revokeInviteRoute(state, { actorId: "ada@example.test", token: "tok", now: 3 });
    expect(revoked.status).toBe(200);
    if (revoked.status === 200) expect(revoked.body.status).toBe("revoked");
    expect(state.invites[0]?.revokedAt).toBe(3);
    issueInviteRoute(state, { actorId: OWNER, email: "ada@example.test", now: 5, token: "tok-2" });
    const byOwner = revokeInviteRoute(state, { actorId: OWNER.toUpperCase(), token: "tok-2", now: 6 });
    expect(byOwner.status).toBe(200);
    if (byOwner.status === 200) expect(byOwner.body.status).toBe("revoked");
    const again = acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 4 });
    expect(again.status).toBe(200);
    if (again.status === 200 && again.body) expect(again.body.status).toBe("revoked");
    expect(state.signIn.members).toEqual([]);
  });
  it("reloads the invitations and sign-in list from config, never an org (slice 8)", () => {
    const state = emptyOrgState();
    createOrgRoute(state, { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://server.example.com" } });
    issueInviteRoute(state, { actorId: OWNER, email: "morgan@example.test", now: 1, token: "tok" });
    acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 2 });
    const reloaded = parseStoredConfig(JSON.parse(JSON.stringify({
      org: state.org,
      invites: state.invites,
      signIn: state.signIn,
    })));
    expect(reloaded).not.toHaveProperty("org");
    expect(reloaded.invites).toEqual(state.invites);
    expect(reloaded.signIn?.members).toEqual(["morgan@example.test"]);
  });
  it("assigns the organization only once it is saved", () => {
    const state = emptyOrgState();
    const input = { name: "Example", ownerUserId: OWNER, host: { kind: "server" as const, url: "https://server.example.com" } };
    expect(() => createOrgRoute(state, input, () => { throw new Error("disk full"); })).toThrow(/disk full/);
    expect(state.org).toBeNull();
    const saved: unknown[] = [];
    createOrgRoute(state, input, (org) => { saved.push(org); expect(state.org).toBeNull(); });
    expect(saved).toEqual([state.org]);
  });
});

describe("invite mail", () => {
  it("reports mailed:true and persists when the hook sends", async () => {
    const state = orgStateWithOwner();
    let persisted = false;
    const base = await serveOrgRoutes({ state, persist: () => { persisted = true; }, mailInvite: async () => true });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(true);
    expect(persisted).toBe(true);
    expect(state.invites).toHaveLength(1);
    expect(state.invites[0]?.email).toBe("morgan@example.test");
  });

  it("still returns 200 with mailed:false, and keeps the invite, when the hook resolves false", async () => {
    const state = orgStateWithOwner();
    const base = await serveOrgRoutes({ state, mailInvite: async () => false });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(false);
    expect(state.invites).toHaveLength(1);
  });

  it("still returns 200 with mailed:false, and keeps the invite, when the hook throws", async () => {
    const state = orgStateWithOwner();
    const base = await serveOrgRoutes({ state, mailInvite: async () => { throw new Error("smtp exploded"); } });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(false);
    expect(state.invites).toHaveLength(1);
  });

  it("reports mailed:false and still keeps the invite with no mailInvite hook at all", async () => {
    const state = orgStateWithOwner();
    const base = await serveOrgRoutes({ state });
    const { status, body } = await postInvite(base);
    expect(status).toBe(200);
    expect(body.mailed).toBe(false);
    expect(state.invites).toHaveLength(1);
  });

  it("passes the request's origin, the invite, and the inviter's email to the hook", async () => {
    const state = orgStateWithOwner();
    const seen: unknown[] = [];
    const base = await serveOrgRoutes({
      state,
      mailInvite: async (input) => { seen.push(input); return true; },
    });
    await postInvite(base, "morgan@example.test");
    expect(seen).toEqual([{
      email: "morgan@example.test", token: expect.any(String), inviterEmail: "owner@example.com",
      origin: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      link: expect.stringMatching(/^https:\/\/server\.example\.com\/join#token=[0-9a-f]{32}$/),
    }]);
  });
});

describe("invite mail text (inviteMailMessage)", () => {
  it("names the inviter and gives the invite link when both are known", () => {
    expect(inviteMailMessage({ orgName: "Example", inviterEmail: "owner@example.com", link: "https://server.example.com/join#token=abc" })).toEqual({
      subject: "You are invited to Example on Sagax",
      text: "owner@example.com invited you to Example. Open https://server.example.com/join#token=abc within 7 days to join Example.",
    });
  });

  it("falls back to a generic greeting and drops the link clause when neither is known", () => {
    expect(inviteMailMessage({ orgName: "Example", link: null })).toEqual({
      subject: "You are invited to Example on Sagax",
      text: "You were invited to Example. Sign in with this address on this server's sign-in page within 7 days.",
    });
  });
});

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = "0123456789abcdef0123456789abcdef";

function invitedState(token = TOKEN, email = "Zara@Example.com"): OrgState {
  const state = orgStateWithOwner();
  issueInviteRoute(state, { actorId: OWNER, email, now: 1_000, token });
  return state;
}

describe("invite links", () => {
  it("builds <base>/join#token=<token> without a doubled slash", () => {
    expect(inviteLink("https://server.example.com", TOKEN)).toBe(`https://server.example.com/join#token=${TOKEN}`);
    expect(inviteLink("https://server.example.com/", TOKEN)).toBe(`https://server.example.com/join#token=${TOKEN}`);
  });

  it("points at the organization's server address, else the fallback", () => {
    const state = orgStateWithOwner();
    expect(inviteLinkBase(state, "http://127.0.0.1:8799")).toBe("https://server.example.com");
    state.org = { ...state.org!, host: { kind: "server", url: "http://10.0.0.5" } };
    expect(inviteLinkBase(state, "https://public.example.test")).toBe("https://public.example.test");
    state.org = { ...state.org!, host: { kind: "this-computer" } };
    expect(inviteLinkBase(state, null)).toBeNull();
  });

  it("returns the link when an invite is issued", () => {
    const state = orgStateWithOwner();
    const issued = issueInviteRoute(state, { actorId: OWNER, email: "zara@example.com", now: 1, token: TOKEN, linkBase: "https://server.example.com" });
    expect(issued.body).toMatchObject({ link: `https://server.example.com/join#token=${TOKEN}` });
  });

  it("gives owners and admins each pending invite's link, never members", () => {
    const state = invitedState();
    const owner = getOrgRoute(state, 2_000, undefined, { viewerRole: "owner", linkBase: "https://server.example.com" }).body!;
    expect(owner.pendingInvites).toEqual([{ email: "zara@example.com", expiresAt: 1_000 + 7 * DAY, token: TOKEN, link: `https://server.example.com/join#token=${TOKEN}` }]);
    const admin = getOrgRoute(state, 2_000, undefined, { viewerRole: "admin", linkBase: "https://server.example.com" }).body!;
    expect(admin.pendingInvites[0]).toHaveProperty("link");
    const member = getOrgRoute(state, 2_000, undefined, { viewerRole: "member", linkBase: "https://server.example.com" }).body!;
    expect(member.pendingInvites).toEqual([{ email: "zara@example.com", expiresAt: 1_000 + 7 * DAY }]);
    expect(JSON.stringify(member)).not.toContain(TOKEN);
  });

  it("serves links over HTTP only to a manager", async () => {
    const state = invitedState();
    const managerBase = await serveOrgRoutes({ state, now: () => 2_000 });
    const asOwner = await (await fetch(`${managerBase}/api/org`)).json() as { pendingInvites: { link?: string }[]; viewerRole: string };
    expect(asOwner.viewerRole).toBe("owner");
    expect(asOwner.pendingInvites[0]?.link).toBe(`https://server.example.com/join#token=${TOKEN}`);
    state.signIn.members = ["ada@example.test"];
    const memberBase = await serveOrgRoutes({ state, now: () => 2_000, actorId: () => "pr_00000000-0000-4000-8000-00000000000b", actorEmail: () => "ada@example.test" });
    const asMember = await (await fetch(`${memberBase}/api/org`)).json() as { pendingInvites: object[]; viewerRole: string };
    expect(asMember.viewerRole).toBe("member");
    expect(JSON.stringify(asMember)).not.toContain(TOKEN);
  });
});

describe("invite preview", () => {
  it("masks the address", () => {
    expect(maskEmail("zara@example.com")).toBe("z***@example.com");
    expect(maskEmail("Z@Example.com")).toBe("z***@example.com");
    expect(maskEmail("nobody")).toBe("***");
  });

  it("shows the org name and masked email for an open invite only", () => {
    const state = invitedState();
    expect(invitePreviewRoute(state, { token: TOKEN, now: 2_000 }).body).toEqual({ status: "open", orgName: "Example", email: "z***@example.com" });
    expect(invitePreviewRoute(state, { token: TOKEN, now: 1_000 + 7 * DAY }).body).toEqual({ status: "expired" });
    expect(invitePreviewRoute(state, { token: "ffffffffffffffffffffffffffffffff", now: 2_000 }).body).toEqual({ status: "unknown" });
    expect(invitePreviewRoute(state, { token: "../../etc", now: 2_000 }).body).toEqual({ status: "unknown" });
    joinInviteRoute(state, { token: TOKEN, now: 2_000 });
    expect(invitePreviewRoute(state, { token: TOKEN, now: 3_000 }).body).toEqual({ status: "used" });
    const revoked = invitedState("fedcba9876543210fedcba9876543210");
    revokeInviteRoute(revoked, { actorId: OWNER, token: "fedcba9876543210fedcba9876543210", now: 2_000 });
    expect(invitePreviewRoute(revoked, { token: "fedcba9876543210fedcba9876543210", now: 3_000 }).body).toEqual({ status: "revoked" });
  });

  it("never leaks the token, the full address or a principal", () => {
    const body = JSON.stringify(invitePreviewRoute(invitedState(), { token: TOKEN, now: 2_000 }).body);
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("zara@");
    expect(body).not.toContain("pr_");
  });
});

describe("joining by link", () => {
  it("joins once: marks the invite used and adds the address to members", () => {
    const state = invitedState();
    const joined = joinInviteRoute(state, { token: TOKEN, now: 2_000 });
    expect(joined).toEqual({ status: 200, body: { status: "joined", orgName: "Example" }, email: "zara@example.com" });
    expect(state.signIn.members).toEqual(["zara@example.com"]);
    expect(state.invites[0]?.usedAt).toBe(2_000);
    expect(joinInviteRoute(state, { token: TOKEN, now: 3_000 })).toEqual({ status: 410, body: { status: "used" } });
  });

  it("refuses an expired, revoked or unknown link", () => {
    expect(joinInviteRoute(invitedState(), { token: TOKEN, now: 1_000 + 7 * DAY })).toEqual({ status: 410, body: { status: "expired" } });
    const revoked = invitedState();
    revokeInviteRoute(revoked, { actorId: OWNER, token: TOKEN, now: 2_000 });
    expect(joinInviteRoute(revoked, { token: TOKEN, now: 3_000 })).toEqual({ status: 410, body: { status: "revoked" } });
    expect(revoked.signIn.members).toEqual([]);
    expect(joinInviteRoute(invitedState(), { token: "ffffffffffffffffffffffffffffffff", now: 2_000 })).toEqual({ status: 404, body: { status: "unknown" } });
  });

  it("tells an existing member to sign in instead, and keeps the lists as they were", () => {
    const state = invitedState();
    state.signIn.members = ["zara@example.com"];
    expect(joinInviteRoute(state, { token: TOKEN, now: 2_000 })).toEqual({ status: 409, body: { status: "already-member" } });
    const admin = invitedState();
    admin.signIn.admins = ["ZARA@example.com"];
    expect(joinInviteRoute(admin, { token: TOKEN, now: 2_000 }).status).toBe(409);
    expect(admin.signIn.members).toEqual([]);
    expect(joinInviteRoute(invitedState(TOKEN, "owner@example.com"), { token: TOKEN, now: 2_000, ownerEmail: "owner@example.com" }).status).toBe(409);
  });
});

describe("public invite routes over HTTP", () => {
  async function servePublic(state: OrgState, overrides: Partial<PublicInviteRouteDeps> = {}) {
    const failures: string[] = [];
    const signedIn: string[] = [];
    let locked = false;
    const handler = createPublicInviteRoutes({
      state,
      now: () => 2_000,
      limiter: {
        source: () => "203.0.113.9",
        allowed: () => (locked ? { ok: false, retryAfterMs: 5_000 } : { ok: true }),
        noteFailure: (source) => failures.push(source),
        clearFailures: () => {},
      },
      signIn: ({ res, email }) => { signedIn.push(email); res.setHeader("set-cookie", "omb_session=fixture; HttpOnly"); },
      ...overrides,
    });
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!(await handler({ req, res, path: url.pathname, method: req.method ?? "GET", json, readBody }))) json(res, 404, { from: "elsewhere" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, failures, signedIn, lock: () => { locked = true; } };
  }
  const join = (base: string, token: string, contentType = "application/json") =>
    fetch(`${base}/api/org/invites/${token}/join`, { method: "POST", headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.9" }, body: "{}" });

  it("previews, joins with a session cookie, then refuses the same link", async () => {
    const state = invitedState();
    let saved = 0;
    const { base, signedIn } = await servePublic(state, { persist: () => { saved += 1; } });
    const preview = await fetch(`${base}/api/org/invites/${TOKEN}/preview`);
    expect(await preview.json()).toEqual({ status: "open", orgName: "Example", email: "z***@example.com" });
    const first = await join(base, TOKEN);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "joined", orgName: "Example" });
    expect(first.headers.get("set-cookie")).toContain("omb_session=");
    expect(signedIn).toEqual(["zara@example.com"]);
    expect(saved).toBe(1);
    const second = await join(base, TOKEN);
    expect(second.status).toBe(410);
    expect(await second.json()).toEqual({ status: "used" });
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("counts an unknown link as a failed attempt and honours the lockout", async () => {
    const { base, failures, lock } = await servePublic(invitedState());
    const unknown = await join(base, "ffffffffffffffffffffffffffffffff");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ status: "unknown" });
    await fetch(`${base}/api/org/invites/ffffffffffffffffffffffffffffffff/preview`);
    expect(failures).toEqual(["203.0.113.9", "203.0.113.9"]);
    lock();
    expect((await join(base, TOKEN)).status).toBe(429);
    expect((await fetch(`${base}/api/org/invites/${TOKEN}/preview`)).status).toBe(429);
  });

  it("answers 409 for an existing member without a session, and refuses a form post", async () => {
    const state = invitedState();
    state.signIn.members = ["zara@example.com"];
    const { base, signedIn } = await servePublic(state);
    const res = await join(base, TOKEN);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "already-member" });
    expect(signedIn).toEqual([]);
    expect((await join(base, TOKEN, "application/x-www-form-urlencoded")).status).toBe(415);
  });

  it("rolls the join back when it cannot be saved", async () => {
    const state = invitedState();
    const { base, signedIn } = await servePublic(state, { persist: () => { throw new Error("disk full"); } });
    expect((await join(base, TOKEN)).status).toBe(500);
    expect(signedIn).toEqual([]);
    expect(state.signIn.members).toEqual([]);
    expect(state.invites[0]?.usedAt).toBeUndefined();
  });
});

describe("accepting invites on email sign-in", () => {
  it("accepts the open invite for that exact address, once", () => {
    const state = invitedState();
    expect(acceptOpenInvitesForEmail(state, { email: "ZARA@example.com", now: 2_000 })).toBe(true);
    expect(state.signIn.members).toEqual(["zara@example.com"]);
    expect(state.invites[0]?.usedAt).toBe(2_000);
    expect(acceptOpenInvitesForEmail(state, { email: "zara@example.com", now: 3_000 })).toBe(false);
    expect(state.signIn.members).toEqual(["zara@example.com"]);
    expect(acceptOpenInvitesForEmail(invitedState(), { email: "other@example.com", now: 2_000 })).toBe(false);
    expect(acceptOpenInvitesForEmail(invitedState(), { email: "zara@example.com", now: 1_000 + 7 * DAY })).toBe(false);
  });
});

describe("editing the organization's address", () => {
  it("lets the owner change it to a valid server address", () => {
    const state = orgStateWithOwner();
    expect(updateOrgHostRoute(state, { actorId: OWNER, host: { kind: "server", url: " https://example.com " } })).toEqual({
      status: 200, body: { org: { name: "Example", ownerUserId: OWNER, host: { kind: "server", url: "https://example.com" } } },
    });
  });

  it("refuses a member (403) and an invalid address (400)", () => {
    const state = orgStateWithOwner();
    state.signIn.members = ["ada@example.test"];
    expect(updateOrgHostRoute(state, { actorId: "pr_00000000-0000-4000-8000-00000000000b", actorEmail: "ada@example.test", host: { kind: "server", url: "https://x.example.test" } }).status).toBe(403);
    expect(updateOrgHostRoute(state, { actorId: OWNER, host: { kind: "server", url: "http://10.0.0.5" } }).status).toBe(400);
    expect(updateOrgHostRoute(state, { actorId: OWNER, host: { kind: "this-computer" } }).status).toBe(400);
    expect(state.org?.host).toEqual({ kind: "server", url: "https://server.example.com" });
  });

  it("saves the change over PATCH /api/org", async () => {
    const state = orgStateWithOwner();
    let saved = 0;
    const base = await serveOrgRoutes({ state, persist: () => { saved += 1; } });
    const res = await fetch(`${base}/api/org`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: { kind: "server", url: "https://example.com" } }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { org: { host: unknown } }).org.host).toEqual({ kind: "server", url: "https://example.com" });
    expect(saved).toBe(1);
    const bad = await fetch(`${base}/api/org`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: { kind: "server", url: "ftp://x" } }) });
    expect(bad.status).toBe(400);
    expect(requiredScope("PATCH", "/api/org")).toBe("admin");
  });
});

describe("people by email", () => {
  it("shows each principal's email and each sign-in entry as its email", () => {
    const state = orgStateWithOwner();
    state.signIn.members = ["Zara@example.com"];
    const people = getOrgRoute(state, 1, undefined, { emailOf: (id) => (id === OWNER ? "owner@example.com" : undefined) }).body!.people;
    expect(people).toEqual([
      { id: OWNER, role: "owner", email: "owner@example.com" },
      { id: "Zara@example.com", role: "member", email: "zara@example.com" },
    ]);
  });

  it("falls back to the owner email when the principal has none", () => {
    const state = orgStateWithOwner();
    expect(getOrgRoute(state, 1, "owner@example.com", { emailOf: () => undefined }).body!.people).toEqual([{ id: OWNER, role: "owner", email: "owner@example.com" }]);
  });
});
