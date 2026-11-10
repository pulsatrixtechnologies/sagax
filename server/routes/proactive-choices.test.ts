import { describe, expect, it } from "vitest";

import { CLIENT_ALLOW } from "../auth/client-allow.ts";
import { PROACTIVE_CHOICES_PATH } from "../../shared/proactive-choices.ts";
import type { OfferedDomain, OfferedListing } from "../proactive/flow-watches.ts";
import { ProactiveChoices } from "../proactive/proactive-choices.ts";
import { createProactiveChoicesRoutes } from "./proactive-choices.ts";
import { PASS } from "./table.ts";

function call(route: ReturnType<typeof createProactiveChoicesRoutes>, input: { method: string; body?: unknown; path?: string; person?: string; query?: string }) {
  let answer: { status: number; body: unknown } | null = null;
  const path = input.path ?? PROACTIVE_CHOICES_PATH;
  return route({
    req: { headers: { "content-type": "application/json" } } as never,
    res: {} as never, url: new URL(`http://x${path}${input.query ?? ""}`), path, method: input.method,
    auth: { kind: "session", scopes: ["client"], session: { principalId: input.person ?? "person-1" } } as never,
    json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
    readBody: (async () => input.body) as never,
  }).then((out) => (out === PASS ? "PASS" : answer));
}

describe("GET and PUT /api/me/proactive (#3423)", () => {
  const bots: Record<string, string> = { b1: "person-1", main: "person-1", b9: "person-2" };
  const service: OfferedDomain = {
    domain: "service", label: { fr: "Service", en: "Service" },
    watches: [{ id: "w-open", summary: "Open tickets.", cadence: "15m", products: ["connectwise"], runs: true }], eligible: true,
  };
  const security: OfferedDomain = {
    domain: "security", label: { en: "Security" },
    watches: [{ id: "w-s1", summary: "Threats.", cadence: "1h", products: ["sentinelone"], runs: false, missing: "product" }], eligible: false,
  };
  const setup = (listing?: (botId: string) => OfferedListing, extra: Partial<Parameters<typeof createProactiveChoicesRoutes>[0]> = {}) => {
    const store = new ProactiveChoices();
    const asked: string[] = [];
    const route = createProactiveChoicesRoutes({
      store,
      person: (auth) => (auth as { session?: { principalId?: string } }).session?.principalId ?? "",
      ownBot: (person, botId) => bots[botId] === person,
      mainBot: (person) => (person === "person-1" ? "main" : undefined),
      offered: async (_person, botId) => {
        asked.push(botId);
        return listing ? listing(botId) : { ok: true, botId, domains: [security, service] };
      },
      ...extra,
    });
    return { store, route, asked };
  };

  it("reads nothing chosen at first, then the person's own choice only", async () => {
    const { route } = setup();
    expect(await call(route, { method: "GET", path: "/api/me/other" })).toBe("PASS");
    expect(await call(route, { method: "GET" })).toEqual({ status: 200, body: { domains: {}, available: [security, service], botId: "main" } });
    expect(await call(route, { method: "PUT", body: { domain: "service", state: "on", botId: "b1" } })).toMatchObject({ status: 200, body: { domains: { service: { state: "on", botId: "b1", coversReads: true, via: "settings", by: "person-1" } } } });
    expect(await call(route, { method: "GET", person: "person-2" })).toMatchObject({ status: 200, body: { domains: {}, available: [] } });
  });

  it("a yes without a bot goes to the person's main bot; another person's bot is refused", async () => {
    const { route, store } = setup();
    expect(await call(route, { method: "PUT", body: { domain: "service", state: "on" } })).toMatchObject({ status: 200 });
    expect(store.get("person-1").domains.service?.botId).toBe("main");
    expect(await call(route, { method: "PUT", body: { domain: "service", state: "on", botId: "b9" } })).toMatchObject({ status: 404 });
    expect(await call(route, { method: "PUT", person: "person-2", body: { domain: "service", state: "on" } })).toMatchObject({ status: 400 });
    expect(await call(route, { method: "PUT", body: { domain: "service", state: "sometimes" } })).toMatchObject({ status: 400 });
    expect(await call(route, { method: "DELETE" })).toMatchObject({ status: 405 });
  });

  it("lists what the person can choose on the bot they name; another person's bot is refused", async () => {
    const { route, asked } = setup();
    expect(await call(route, { method: "GET", query: "?botId=b1" })).toMatchObject({ status: 200, body: { botId: "b1", available: [{ domain: "security", eligible: false }, { domain: "service", eligible: true, watches: [{ summary: "Open tickets.", cadence: "15m" }] }] } });
    expect(asked).toEqual(["b1"]);
    expect(await call(route, { method: "GET", query: "?botId=b9" })).toMatchObject({ status: 404 });
  });

  it("a yes to an unknown domain, or to one that cannot run on the bot, is answered and never stored", async () => {
    const { route, store } = setup();
    const unknown = await call(route, { method: "PUT", body: { domain: "backups", state: "on", botId: "b1" } });
    expect(unknown).toMatchObject({ status: 404, body: { available: [{ domain: "security" }, { domain: "service" }] } });
    expect(String((unknown as { body: { error: string } }).body.error)).toContain("service (Service)");
    expect(await call(route, { method: "PUT", body: { domain: "security", state: "on", botId: "b1" } })).toMatchObject({ status: 409 });
    expect(await call(route, { method: "PUT", body: { domain: "service", watch: "w-nope", on: false } })).toMatchObject({ status: 404 });
    expect(await call(route, { method: "PUT", body: { domain: "backups", watch: "w-open", on: false } })).toMatchObject({ status: 404 });
    expect(store.get("person-1").domains).toEqual({});
    expect(await call(route, { method: "PUT", body: { domain: "service", watch: "w-open", on: false } })).toMatchObject({ status: 200 });
  });

  it("when the listing cannot be read, a yes is answered with why, and a no is still stored", async () => {
    const { route, store } = setup((botId) => ({ ok: false, botId, cause: "no-flow" }));
    expect(await call(route, { method: "PUT", body: { domain: "service", state: "on", botId: "b1" } })).toMatchObject({ status: 409, body: { unavailable: expect.stringContaining("Pulsatrix Flow") } });
    expect(await call(route, { method: "PUT", body: { domain: "service", state: "never" } })).toMatchObject({ status: 200 });
    expect(store.get("person-1").domains.service?.state).toBe("never");
  });

  it("#3432: ?view=all lists only eligible domains, with the bots that can carry each, its running watches and their last alert", async () => {
    const backups: OfferedDomain = {
      domain: "backups", label: { fr: "Sauvegardes", en: "Backups" },
      watches: [
        { id: "w-b1", summary: "Failed backups.", cadence: "1h", products: ["axcient"], runs: true },
        { id: "w-b2", summary: "Old backups.", cadence: "1d", products: ["axcient"], runs: false, missing: "skill" },
      ], eligible: true,
    };
    const { route, asked } = setup(
      (botId) => botId === "b1" ? { ok: true, botId, domains: [backups, security, service] } : { ok: true, botId, domains: [security, service] },
      {
        bots: () => [{ id: "main", brief: true, checklist: false }, { id: "b1", brief: false, screen: true }],
        lastAlert: (_person, watchId) => (watchId === "w-open" ? 1_700_000_000_000 : undefined),
      },
    );
    const answer = await call(route, { method: "GET", query: "?view=all" }) as { status: number; body: { receive: unknown; available: unknown } };
    expect(answer.status).toBe(200);
    expect(answer.body.available).toEqual([security, service]);
    expect(answer.body.receive).toEqual({
      bots: [{ id: "main", brief: true, checklist: false }, { id: "b1", brief: false, screen: true }],
      domains: [
        { domain: "backups", label: { fr: "Sauvegardes", en: "Backups" }, carriers: ["b1"], watches: [{ id: "w-b1", summary: "Failed backups.", cadence: "1h", runsOn: ["b1"] }] },
        { domain: "service", label: { fr: "Service", en: "Service" }, carriers: ["main", "b1"], lastAlertAt: 1_700_000_000_000,
          watches: [{ id: "w-open", summary: "Open tickets.", cadence: "15m", runsOn: ["main", "b1"], lastAlertAt: 1_700_000_000_000 }] },
      ],
    });
    // one listing per bot, one at a time; the main bot's, already read for `available`, is not read again
    expect(asked).toEqual(["main", "b1"]);
    // without the view, GET answers as before
    expect(await call(route, { method: "GET" })).toEqual({ status: 200, body: { domains: {}, available: [security, service], botId: "main" } });
  });

  it("#3432: ?view=all without a bot that can carry a watch, or when no listing answers, says why", async () => {
    const none = setup(undefined, { bots: () => [] });
    expect(await call(none.route, { method: "GET", query: "?view=all" })).toMatchObject({ status: 200, body: { receive: { bots: [], domains: [], unavailable: expect.stringContaining("no bot") } } });
    const down = setup((botId) => ({ ok: false, botId, cause: "flow-failed" }), { bots: () => [{ id: "main", brief: false }] });
    expect(await call(down.route, { method: "GET", query: "?view=all" })).toMatchObject({ status: 200, body: { receive: { domains: [], unavailable: expect.stringContaining("does not answer") } } });
  });

  it("is the person's own route (client scope), no admin", () => {
    expect(CLIENT_ALLOW.find((entry) => entry.path.test(PROACTIVE_CHOICES_PATH))?.methods).toEqual(["GET", "PUT"]);
  });
});
