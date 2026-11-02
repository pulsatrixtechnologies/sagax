// POST /api/me/memory-sync-token: the session's own memory sync token,
// asked through the link (Settings > Memory sets itself up, 2026-10-14).
import { describe, expect, it, vi } from "vitest";

import type { LinkPostResult } from "../perspicax-link.ts";
import { createMemorySyncTokenRoute, MEMORY_SYNC_TOKEN_ROUTE, MINT_PER_MINUTE, ownSubject } from "./perspicax-memory-sync-token.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import type { SessionRecord } from "../sessions.ts";

const ISSUER = "https://px.example.test/";
const TOKEN = "pxat1.abcdefghijklmnopqrstuvwxyz012345";

const session = (overrides: Partial<SessionRecord> = {}): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, ...overrides } as SessionRecord,
});
const alice = session({ principalId: "pr_alice", idp: { iss: "https://px.example.test", sub: "A1", grantRef: "g1" } } as Partial<SessionRecord>);

function setup(answer: LinkPostResult | null, now = () => 1_000) {
  const linkPost = answer ? vi.fn(async () => answer) : null;
  const log = vi.fn();
  const route = createMemorySyncTokenRoute({ issuer: ISSUER, linkPost, log, now });
  const call = async (auth: RequestAuth, { method = "POST", path = MEMORY_SYNC_TOKEN_ROUTE, body = {} as unknown } = {}) => {
    const out: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const res = { setHeader: (k: string, v: string) => { out.headers[k] = v; }, headersSent: false, writableEnded: false };
    const ctx = {
      req: {}, res, url: new URL(`http://127.0.0.1${path}`), path, method, auth,
      json: (_res: unknown, status: number, value: unknown) => { out.status = status; out.body = value; },
      readBody: async () => body,
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { call, linkPost, log };
}

describe("POST /api/me/memory-sync-token", () => {
  it("passes other paths", async () => {
    const { call } = setup(null);
    expect((await call(alice, { path: "/api/me/connections" })).passed).toBe(true);
  });

  it("mints the session's own token only, whatever the body names", async () => {
    const { call, linkPost } = setup({ ok: true, status: 200, body: { token: TOKEN, info: { id: "s9", expires_at: "2027-01-12T00:00:00Z" } } });
    const out = await call(alice, { body: { sub: "B2", principalId: "pr_bob" } });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ server: "https://px.example.test", token: TOKEN, expiresAt: "2027-01-12T00:00:00.000Z" });
    expect(out.headers["cache-control"]).toBe("no-store");
    expect(linkPost).toHaveBeenCalledTimes(1);
    // 2026-10-28: the person's own token goes with the link token
    expect(linkPost!.mock.calls[0]).toEqual(["/api/v1/pulsabot/people/A1/memory-sync-token", {}, expect.objectContaining({ subject: "A1" })]);
  });

  it("refuses a local request, a session without a provider account and another issuer's session", async () => {
    const { call, linkPost } = setup({ ok: true, status: 200, body: { token: TOKEN } });
    expect(await call({ kind: "loopback", scopes: ["admin", "client"] } as RequestAuth)).toMatchObject({ status: 401, body: { code: "session_required" } });
    expect(await call(session({ principalId: "pr_x" }))).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    expect(await call(session({ principalId: "pr_x", idp: { iss: "https://other.example", sub: "A1" } } as Partial<SessionRecord>))).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    expect(await call(session({ idp: { iss: "https://px.example.test", sub: "A1" } } as Partial<SessionRecord>))).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    expect(linkPost).not.toHaveBeenCalled();
    expect(ownSubject(alice, ISSUER)).toBe("A1");
  });

  it("tells who the token would be for on GET, without minting one", async () => {
    const { call, linkPost } = setup({ ok: true, status: 200, body: { token: TOKEN } });
    expect(await call(alice, { method: "GET" })).toMatchObject({ status: 200, body: { person: "pr_alice" } });
    expect(await call(session({ principalId: "pr_x" }), { method: "GET" })).toMatchObject({ status: 403, body: { code: "identity_perspicax" } });
    expect(await call(alice, { method: "DELETE" })).toMatchObject({ status: 405 });
    expect(linkPost).not.toHaveBeenCalled();
  });

  it("tells a person who left, an older Perspicax and an unreachable one apart, never with the token", async () => {
    expect(await setup({ ok: false, error: "refused", status: 404, body: { error: "no_person" } }).call(alice)).toMatchObject({ status: 403, body: { code: "not_member" } });
    expect(await setup({ ok: false, error: "refused", status: 409, body: { error: "user_inactive" } }).call(alice)).toMatchObject({ status: 403, body: { code: "not_member" } });
    expect(await setup({ ok: false, error: "refused", status: 404, body: null }).call(alice)).toMatchObject({ status: 404, body: { code: "unsupported" } });
    expect(await setup({ ok: false, error: "link", status: 401 }).call(alice)).toMatchObject({ status: 503, body: { code: "link" } });
    expect(await setup({ ok: false, error: "unreachable" }).call(alice)).toMatchObject({ status: 502, body: { code: "unreachable" } });
    expect(await setup(null).call(alice)).toMatchObject({ status: 503, body: { code: "link" } });
    const bad = setup({ ok: true, status: 200, body: { token: "not-a-token" } });
    const out = await bad.call(alice);
    expect(out).toMatchObject({ status: 502, body: { code: "unreachable" } });
    expect(JSON.stringify(out.body)).not.toContain("not-a-token");
  });

  it("never logs the token", async () => {
    const { call, log } = setup({ ok: true, status: 200, body: { token: TOKEN, info: {} } });
    await call(alice);
    for (const [line] of log.mock.calls) expect(String(line)).not.toContain(TOKEN);
  });

  it("limits the mints per person per minute", async () => {
    let clock = 0;
    const { call } = setup({ ok: true, status: 200, body: { token: TOKEN } }, () => clock);
    for (let i = 0; i < MINT_PER_MINUTE; i++) expect((await call(alice)).status).toBe(200);
    expect(await call(alice)).toMatchObject({ status: 429, body: { code: "rate_limited" } });
    clock = 61_000;
    expect((await call(alice)).status).toBe(200);
  });
});
