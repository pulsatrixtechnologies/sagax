import { describe, expect, it } from "vitest";

import { createModelSwitchRoutes } from "./model-switches.ts";

function call(handler: ReturnType<typeof createModelSwitchRoutes>, method: string, body?: unknown, auth: unknown = { who: "p1" }) {
  let answer: { status: number; body: unknown } | null = null;
  const result = handler({
    req: { headers: { "content-type": "application/json" } } as never,
    res: { setHeader: () => {} } as never,
    path: "/api/me/models",
    method,
    auth: auth as never,
    json: ((_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; }) as never,
    readBody: (async () => body) as never,
  } as never);
  return Promise.resolve(result).then(() => answer);
}

describe("GET/PUT /api/me/models", () => {
  const setup = () => {
    const saved = new Map<string, string[]>();
    const stars = new Map<string, string[]>();
    const handler = createModelSwitchRoutes({
      org: () => ["claude/opus"],
      owner: (auth) => ((auth as { who?: string }).who ?? null),
      mine: (owner) => saved.get(owner) ?? [],
      save: (owner, list) => { saved.set(owner, list); },
      favorites: (owner) => stars.get(owner) ?? [],
      saveFavorites: (owner, list) => { stars.set(owner, list); },
    });
    return { handler, saved, stars };
  };

  it("reads both levels and saves the person's own list, cleaned", async () => {
    const { handler } = setup();
    expect(await call(handler, "GET")).toEqual({ status: 200, body: { org: ["claude/opus"], mine: [], favoriteModels: [] } });
    expect(await call(handler, "PUT", { disabledModels: ["grok/fast", "grok/fast", "bad"] })).toEqual({ status: 200, body: { org: ["claude/opus"], mine: ["grok/fast"], favoriteModels: [] } });
    expect((await call(handler, "PUT", { disabledModels: "grok/fast" }))?.status).toBe(400);
    expect((await call(handler, "GET", undefined, {}))?.status).toBe(403);
  });

  // #2050: the person's starred models ride the same route
  it("saves the person's favorites, cleaned and in star order, without touching the switches", async () => {
    const { handler, saved, stars } = setup();
    expect(await call(handler, "PUT", { favoriteModels: ["grok/fast", "claude/sonnet", "grok/fast", "bad", 7] }))
      .toEqual({ status: 200, body: { org: ["claude/opus"], mine: [], favoriteModels: ["grok/fast", "claude/sonnet"] } });
    expect(saved.has("p1"), "switches untouched").toBe(false);
    expect(stars.get("p1")).toEqual(["grok/fast", "claude/sonnet"]);
    // both lists in one call
    expect((await call(handler, "PUT", { disabledModels: ["claude/haiku"], favoriteModels: [] }))?.body)
      .toEqual({ org: ["claude/opus"], mine: ["claude/haiku"], favoriteModels: [] });
    expect((await call(handler, "PUT", { favoriteModels: "grok/fast" }))?.status).toBe(400);
    expect((await call(handler, "PUT", {}))?.status).toBe(400);
  });
});
