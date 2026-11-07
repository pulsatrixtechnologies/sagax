import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { TeamDefaultsRecord } from "../rooms/section-context.ts";
import { createTeamDefaultsRoutes, type TeamDefaultsRouteDeps } from "./team-defaults.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;
const OPUS = { instanceId: "claude", model: "opus" };

function deps(store: Map<string, TeamDefaultsRecord>, over: Partial<TeamDefaultsRouteDeps> = {}): TeamDefaultsRouteDeps {
  return {
    sections: () => ["Dev"],
    bots: () => [],
    groups: () => [],
    sectionKey: (section) => section ?? "",
    read: (key) => store.get(key) ?? null,
    write: (key, value) => {
      if (!value.model && !value.computer) { store.delete(key); return null; }
      const record = { ...value, updatedAt: 5 };
      store.set(key, record);
      return record;
    },
    ...over,
  };
}

function ctx(method: string, body: unknown = null, query = "?section=Dev", path = "/api/team-defaults") {
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

describe("team defaults route (I2)", () => {
  it("passes foreign paths and 404s an unknown team", async () => {
    const route = createTeamDefaultsRoutes(deps(new Map()));
    expect(await route(ctx("GET", null, "?section=Dev", "/api/section-context").context)).toBe(PASS);
    const call = ctx("GET", null, "?section=Missing");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(404);
  });

  it("an org member reaches only their own teams", async () => {
    const route = createTeamDefaultsRoutes(deps(new Map(), { sectionsFor: () => ["Mine"] }));
    const call = ctx("GET");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(404);
  });

  it("PUT merges: a field left out keeps its value, null clears it", async () => {
    const store = new Map<string, TeamDefaultsRecord>();
    const route = createTeamDefaultsRoutes(deps(store));
    await route(ctx("PUT", { model: OPUS }).context);
    await route(ctx("PUT", { computer: "cloud" }).context);
    expect(store.get("Dev")).toMatchObject({ model: OPUS, computer: "cloud" });
    await route(ctx("PUT", { model: null }).context);
    const read = ctx("GET");
    await route(read.context);
    expect(read.sent[0]).toEqual({ status: 200, body: { section: "Dev", label: "Dev", model: null, computer: "cloud", updatedAt: 5 } });
  });

  it("refuses a bad computer or model", async () => {
    const route = createTeamDefaultsRoutes(deps(new Map()));
    const bad = ctx("PUT", { computer: "mars" });
    await route(bad.context);
    expect(bad.sent[0]?.status).toBe(400);
    const model = ctx("PUT", { model: { foo: 1 } });
    await route(model.context);
    expect(model.sent[0]?.status).toBe(400);
  });
});
