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

  // #4329 lot 5: what runs the person's bots, per provider, beside the switches
  it("reads and writes the default engine per provider, refusing a pair the matrix does not offer", async () => {
    const defaults = new Map<string, Record<string, string>>();
    const moved: string[] = [];
    const handler = createModelSwitchRoutes({
      org: () => [], owner: (auth) => ((auth as { who?: string }).who ?? null), mine: () => [], save: () => {},
      favorites: () => [], saveFavorites: () => {},
      harnessDefaults: {
        read: (owner) => defaults.get(owner) ?? {},
        refusal: async (_auth, provider, harness) => provider === "anthropic" && harness === "piAgent" ? "pi cannot run Claude here." : null,
        save: async (owner, map) => { defaults.set(owner, map); moved.push(owner); },
      },
    });
    expect((await call(handler, "GET"))?.body).toMatchObject({ harnessByProvider: {} });
    expect((await call(handler, "PUT", { harnessByProvider: { openai: "piAgent", openrouter: "openai-compat" } }))?.body)
      .toMatchObject({ harnessByProvider: { openai: "piAgent", openrouter: "openai-compat" } });
    expect(moved).toEqual(["p1"]);
    // null clears one provider, the others stay
    expect((await call(handler, "PUT", { harnessByProvider: { openai: null } }))?.body).toMatchObject({ harnessByProvider: { openrouter: "openai-compat" } });
    // refused by name, nothing saved
    expect(await call(handler, "PUT", { harnessByProvider: { anthropic: "piAgent" } })).toEqual({ status: 400, body: { error: "pi cannot run Claude here." } });
    expect(defaults.get("p1")).toEqual({ openrouter: "openai-compat" });
    expect((await call(handler, "PUT", { harnessByProvider: { openai: "not a kind!" } }))?.status).toBe(400);
  });
});
