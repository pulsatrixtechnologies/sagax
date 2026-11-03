import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createTeamLibraryRoutes } from "./team-library.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;

function ctx(path: string, method = "GET", body: unknown = null) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createTeamLibraryRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createTeamLibraryRoutes({
      fetchCatalog: (async () => ({ teams: [] })) as never,
    });
    expect(await route(ctx("/api/team-map").context)).toBe(PASS);
    expect(await route(ctx("/api/team-library/grok", "POST").context)).toBe(PASS);
    expect(await route(ctx("/api/team-library/teams/Bad_Slug").context)).toBe(PASS);
  });

  it("returns the catalog", async () => {
    const fetchCatalog = vi.fn(async () => ({ teams: [{ slug: "ops" }] }));
    const route = createTeamLibraryRoutes({ fetchCatalog: fetchCatalog as never });
    const call = ctx("/api/team-library/catalog");
    await route(call.context);
    expect(call.sent).toEqual([{ status: 200, body: { teams: [{ slug: "ops" }] } }]);
  });

  it("maps catalog failures to 502", async () => {
    const route = createTeamLibraryRoutes({
      fetchCatalog: (async () => { throw new Error("down"); }) as never,
    });
    const call = ctx("/api/team-library/catalog");
    await route(call.context);
    expect(call.sent).toEqual([{ status: 502, body: { error: "down" } }]);
  });

  it("loads a library team by slug and maps 404", async () => {
    const fetchTeam = vi.fn(async (slug: string) => ({ slug, name: "Ops" }));
    const route = createTeamLibraryRoutes({ fetchTeam: fetchTeam as never });
    const ok = ctx("/api/team-library/teams/ops");
    await route(ok.context);
    expect(fetchTeam).toHaveBeenCalledWith("ops");
    expect(ok.sent[0]?.status).toBe(200);

    const missing = createTeamLibraryRoutes({
      fetchTeam: (async () => { throw Object.assign(new Error("gone"), { status: 404 }); }) as never,
    });
    const call = ctx("/api/team-library/teams/ops");
    await missing(call.context);
    expect(call.sent).toEqual([{ status: 404, body: { error: "gone" } }]);
  });

  it("refuses a GitHub import without a URL", async () => {
    const route = createTeamLibraryRoutes({
      fetchGithub: (async () => ({ name: "x" })) as never,
    });
    const call = ctx("/api/team-library/github", "POST", {});
    await route(call.context);
    expect(call.sent).toEqual([{ status: 400, body: { error: "A GitHub URL is required" } }]);
  });

  it("fetches a GitHub team", async () => {
    const fetchGithub = vi.fn(async (url: string) => ({ url, name: "from-gh" }));
    const route = createTeamLibraryRoutes({ fetchGithub: fetchGithub as never });
    const call = ctx("/api/team-library/github", "POST", { url: "https://github.com/a/b" });
    await route(call.context);
    expect(fetchGithub).toHaveBeenCalledWith("https://github.com/a/b");
    expect(call.sent[0]).toEqual({ status: 200, body: { url: "https://github.com/a/b", name: "from-gh" } });
  });
});
