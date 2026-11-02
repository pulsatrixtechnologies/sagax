import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteContext } from "./table.ts";
import { createMemoryManagerRoutes, MEMORY_MANAGER_SOURCES } from "./memory-manager.ts";

const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

function setup(deps: Parameters<typeof createMemoryManagerRoutes>[0]) {
  const route = createMemoryManagerRoutes(deps);
  return async (auth: RequestAuth = loopback, { method = "GET", path = MEMORY_MANAGER_SOURCES } = {}) => {
    const out: { status?: number; body?: unknown } = {};
    const ctx = {
      req: {},
      res: { headersSent: false, writableEnded: false },
      url: new URL(`http://127.0.0.1${path}`),
      path,
      method,
      auth,
      json: (_res: unknown, status: number, value: unknown) => { out.status = status; out.body = value; },
      readBody: async () => ({}),
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
}

describe("GET /api/memory-manager/sources", () => {
  it("lists local bots and team sections, and marks Perspicax when available", async () => {
    const invoke = setup({
      bots: () => [{ id: "atlas", name: "Atlas", mayWrite: true }],
      teamSections: () => [{ section: "", label: "General", mayWrite: true, count: 2 }],
      perspicax: () => ({ available: true }),
    });
    const out = await invoke();
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      perspicax: { available: true },
      sources: [
        { id: "bot:atlas", kind: "bot", name: "Atlas", botId: "atlas", mayWrite: true },
        { id: "team:general", kind: "team", name: "General", section: "", mayWrite: true },
        { id: "perspicax", kind: "perspicax", name: "Perspicax", mayWrite: true },
      ],
    });
  });

  it("omits Perspicax when the install is solo and passes other paths", async () => {
    const invoke = setup({
      bots: () => [],
      teamSections: () => [],
      perspicax: () => ({ available: false, reason: "solo" }),
    });
    expect(await invoke()).toMatchObject({
      status: 200,
      body: { sources: [], perspicax: { available: false, reason: "solo" } },
    });
    expect((await invoke(loopback, { path: "/api/bots" })).passed).toBe(true);
    expect(await invoke(loopback, { method: "POST" })).toMatchObject({ status: 405 });
  });
});
