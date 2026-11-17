import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { TeamMemoryEntry } from "../memory/team-memory.ts";
import { createTeamMemoryHttpRoutes, teamMemoryWriteRefusal, type TeamMemoryHttpDeps } from "./team-memory-http.ts";
import { PASS, type RouteContext } from "./table.ts";

const owner = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;
const service = { kind: "loopback", trust: "service", scopes: [] } as unknown as RequestAuth;

const entry = (over: Partial<TeamMemoryEntry> = {}): TeamMemoryEntry => ({
  id: "e1",
  kind: "term",
  name: "VPN",
  detail: "corp",
  aliases: [],
  status: "accepted",
  source: { botId: "", botName: "you", threadId: "t1", at: 1 },
  updatedAt: 1,
  ...over,
});

function deps(over: Partial<TeamMemoryHttpDeps> = {}): TeamMemoryHttpDeps {
  const rows = [entry()];
  return {
    list: () => rows,
    propose: () => ({ entry: entry({ status: "proposed", id: "e2" }), status: "proposed" }),
    resolve: () => ({ claimed: true, state: "accepted" }),
    remove: () => true,
    update: () => entry({ name: "patched" }),
    settleCards: () => undefined,
    ...over,
  };
}

function ctx(path: string, method: string, auth: RequestAuth, body: unknown = null, query = "?section=Ops") {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}${query}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("teamMemoryWriteRefusal", () => {
  it("blocks a local service write", () => {
    expect(teamMemoryWriteRefusal(service, "POST")).toMatch(/local service cannot change/);
    expect(teamMemoryWriteRefusal(service, "GET")).toBeNull();
    expect(teamMemoryWriteRefusal(owner, "POST")).toBeNull();
  });
});

describe("createTeamMemoryHttpRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createTeamMemoryHttpRoutes(deps());
    expect(await route(ctx("/api/section-context", "GET", owner).context)).toBe(PASS);
    expect(await route(ctx("/api/team-memory", "PUT", owner).context)).toBe(PASS);
  });

  it("requires section and refuses a service write", async () => {
    const route = createTeamMemoryHttpRoutes(deps());
    const missing = ctx("/api/team-memory", "GET", owner, null, "");
    await route(missing.context);
    expect(missing.sent).toEqual([{ status: 400, body: { error: "section is required" } }]);

    const refused = ctx("/api/team-memory", "POST", service, { kind: "term", name: "a", detail: "b" });
    await route(refused.context);
    expect(refused.sent[0]?.status).toBe(403);
  });

  it("lists and creates entries", async () => {
    const resolve = vi.fn(() => ({ claimed: true, state: "accepted" as const }));
    const route = createTeamMemoryHttpRoutes(deps({ resolve }));
    const listed = ctx("/api/team-memory", "GET", owner);
    await route(listed.context);
    expect(listed.sent[0]?.status).toBe(200);
    expect((listed.sent[0]?.body as { section: string } | undefined)?.section).toBe("Ops");

    const created = ctx("/api/team-memory", "POST", owner, { kind: "term", name: "VPN", detail: "corp" });
    await route(created.context);
    expect(resolve).toHaveBeenCalled();
    expect(created.sent[0]?.status).toBe(201);
  });

  it("deletes a proposal and settles its cards", async () => {
    const settleCards = vi.fn();
    const route = createTeamMemoryHttpRoutes(deps({
      list: () => [entry({ status: "proposed" })],
      settleCards,
    }));
    const call = ctx("/api/team-memory/e1", "DELETE", owner);
    await route(call.context);
    expect(settleCards).toHaveBeenCalledWith(owner, "Ops", "e1", "deny", "t1");
    expect(call.sent[0]?.status).toBe(200);
  });

  it("404s a missing entry on delete", async () => {
    const route = createTeamMemoryHttpRoutes(deps({ remove: () => false }));
    const call = ctx("/api/team-memory/missing", "DELETE", owner);
    await route(call.context);
    expect(call.sent).toEqual([{ status: 404, body: { error: "no such entry" } }]);
  });

  // #4460
  it("moves an entry of the person's own memory to a console tier, and keeps it when the console refuses", async () => {
    const publish = vi.fn(async () => ({ ok: true as const, status: 201, body: { state: "review", scope: "team:01J", id: "r1" } }));
    const remove = vi.fn(() => true);
    const route = createTeamMemoryHttpRoutes(deps({ publish, remove, storageKey: () => "person:p1" }));
    const moved = ctx("/api/team-memory/e1/publish", "POST", owner, { scope: "team:01J" });
    await route(moved.context);
    expect(publish).toHaveBeenCalledWith(owner, { scope: "team:01J", topic: "terms", title: "VPN", body: "corp", tags: [] });
    expect(remove).toHaveBeenCalledWith("person:p1", "e1");
    expect(moved.sent[0]).toMatchObject({ status: 201, body: { published: { state: "review", scope: "team:01J", id: "r1" } } });

    const refusedPublish = vi.fn(async () => ({ ok: false as const, error: "unauthorized" as const }));
    const kept = vi.fn(() => true);
    const refusing = createTeamMemoryHttpRoutes(deps({ publish: refusedPublish, remove: kept }));
    const refused = ctx("/api/team-memory/e1/publish", "POST", owner, { scope: "team:01J" });
    await refusing(refused.context);
    expect(refused.sent[0]).toMatchObject({ status: 409, body: { code: "memory_sign_in_again" } });
    expect(kept).not.toHaveBeenCalled();
  });

  it("answers no console on a server without one, and keeps the routes to who may use them", async () => {
    const solo = ctx("/api/team-memory/e1/publish", "POST", owner, { scope: "team:01J" });
    await createTeamMemoryHttpRoutes(deps())(solo.context);
    expect(solo.sent[0]?.status).toBe(404);
    const denied = ctx("/api/team-memory", "GET", owner);
    await createTeamMemoryHttpRoutes(deps({ mayUse: () => false }))(denied.context);
    expect(denied.sent[0]?.status).toBe(403);
  });
});
