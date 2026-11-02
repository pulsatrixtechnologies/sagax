import { describe, expect, it, vi } from "vitest";

import type { NotesCallResult } from "../memory/perspicax-memory-notes.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { SessionRecord } from "../sessions.ts";
import { PASS, type RouteContext } from "./table.ts";
import { createMeMemoryNotesRoutes, ME_MEMORY_PREFIX, memoryPrincipal, upstreamOf } from "./me-memory-notes.ts";

const ISSUER = "https://px.example.test/";

const session = (overrides: Partial<SessionRecord> = {}): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, ...overrides } as SessionRecord,
});
const alice = session({ principalId: "pr_alice", idp: { iss: "https://px.example.test", sub: "A1", grantRef: "g1" } } as Partial<SessionRecord>);

function setup(answer: NotesCallResult, linked = true) {
  const call = vi.fn(async () => answer);
  const route = createMeMemoryNotesRoutes({
    issuer: ISSUER,
    linked: () => linked,
    client: { call } as never,
  });
  const invoke = async (auth: RequestAuth, { method = "GET", path = `${ME_MEMORY_PREFIX}/tree`, body = undefined as unknown, query = "" } = {}) => {
    const out: { status?: number; body?: unknown } = {};
    const res = { setHeader: () => {}, headersSent: false, writableEnded: false };
    const ctx = {
      req: {},
      res,
      url: new URL(`http://127.0.0.1${path}${query}`),
      path,
      method,
      auth,
      json: (_res: unknown, status: number, value: unknown) => { out.status = status; out.body = value; },
      readBody: async () => body,
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { invoke, call };
}

describe("me-memory-notes routes", () => {
  it("maps Sagax paths onto Perspicax /memory/read paths", () => {
    const url = new URL("http://x/api/me/memory/entry?scope=me&id=n1");
    expect(upstreamOf("GET", "/api/me/memory/entry", url, undefined)).toEqual({
      method: "GET",
      path: "/api/v1/memory/read/entry?scope=me&id=n1",
    });
    expect(upstreamOf("POST", "/api/me/memory/bulk", url, { action: "delete" })).toEqual({
      method: "POST",
      path: "/api/v1/memory/read/bulk",
      body: { action: "delete" },
    });
    expect(upstreamOf("GET", "/api/me/connections", url, undefined)).toBeNull();
    expect(upstreamOf("DELETE", "/api/me/memory/tree", url, undefined)).toBe("method");
  });

  it("binds the session's own principal and refuses other callers", async () => {
    expect(memoryPrincipal(alice, ISSUER)).toEqual({ principalId: "pr_alice", sub: "A1" });
    expect(memoryPrincipal(session({ principalId: "pr_x" }), ISSUER)).toBeNull();
    const { invoke, call } = setup({ ok: true, status: 200, body: { tiers: [] } });
    expect(await invoke({ kind: "loopback", scopes: ["admin", "client"] } as RequestAuth)).toMatchObject({
      status: 401,
      body: { code: "session_required" },
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("proxies the tree as the person and maps an expired sign-in to 409", async () => {
    const ok = setup({ ok: true, status: 200, body: { own: "user:A1", tiers: [] } });
    expect(await ok.invoke(alice)).toMatchObject({ status: 200, body: { own: "user:A1", tiers: [] } });
    expect(ok.call).toHaveBeenCalledWith("pr_alice", "GET", "/api/v1/memory/read/tree", undefined);

    const expired = setup({ ok: false, error: "unauthorized", status: 401 });
    expect(await expired.invoke(alice)).toMatchObject({ status: 409, body: { code: "memory_sign_in_again" } });
  });

  it("refuses when Perspicax is not linked", async () => {
    const { invoke, call } = setup({ ok: true, status: 200, body: {} }, false);
    expect(await invoke(alice)).toMatchObject({ status: 503, body: { code: "link" } });
    expect(call).not.toHaveBeenCalled();
  });

  it("passes unrelated paths", async () => {
    const { invoke } = setup({ ok: true, status: 200, body: {} });
    expect((await invoke(alice, { path: "/api/me/memory-sync-token" })).passed).toBe(true);
  });
});
