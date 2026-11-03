// Slice 4: a bot's grants (server/bot-grants.ts) with levels, teams and the
// team manager's anchor rule.
import { describe, expect, it } from "vitest";

import type { BotGrant, TeamRef, Viewer } from "./auth/authz.ts";
import { createBotGrantRoutes, type GrantAuditRow } from "./bot-grants.ts";
import { requiredScope } from "./auth/request-auth.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1);
const BOB = pid(2);
const CAROL = pid(3);
const DAVE = pid(4);
const MIA = pid(5);
const ADMIN = pid(6);
const GONE = pid(7);
const teams: Record<string, TeamRef[]> = { [CAROL]: [{ id: "T", manager: false }], [DAVE]: [{ id: "U", manager: false }], [MIA]: [{ id: "T", manager: true }] };
const active = new Set([ALICE, BOB, CAROL, DAVE, MIA, ADMIN]);

function harness() {
  const bots: Record<string, { id: string; grants: BotGrant[] }> = { x: { id: "x", grants: [] }, y: { id: "y", grants: [] } };
  const changed: string[] = [];
  const audits: Array<GrantAuditRow & { actor?: string }> = [];
  let clock = 100;
  const route = createBotGrantRoutes({
    bot: (id) => bots[id],
    facts: (id) => ({ ownerPrincipalId: ALICE, grants: bots[id]!.grants }),
    viewer: (auth) => {
      const id = (auth as unknown as { actor?: string }).actor;
      if (!id) return undefined;
      return { principalId: id, orgAdmin: id === ADMIN, teams: teams[id] ?? [], disabled: false } satisfies Viewer;
    },
    teamsOf: (id) => teams[id] ?? [],
    resolvePerson: (ref) => (active.has(ref) ? { ok: true, id: ref } : { ok: false, code: "unknown_person" }),
    teamKnown: (id) => id === "T" || id === "U",
    describe: (target) => (target === `user:${GONE}` ? { label: "Gone", disabled: true } : { label: target.startsWith("team:") ? `Team ${target.slice(5)}` : target.slice(5, 12) }),
    setGrants: (id, grants) => { bots[id]!.grants = grants; },
    onChanged: (id) => changed.push(id),
    audit: (auth, row) => { audits.push({ ...row, actor: (auth as unknown as { actor?: string }).actor }); },
    now: () => ++clock,
  });
  const call = async (actor: string | undefined, method: string, path: string, body?: unknown) => {
    let answer: { status: number; body: any } | undefined;
    await route({
      req: {} as never,
      res: { setHeader: () => {} } as never,
      url: new URL(`http://x${path}`),
      path,
      method,
      auth: { actor } as never,
      json: ((_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload }; }) as never,
      readBody: (async () => body) as never,
    });
    return answer!;
  };
  const put = (actor: string, bot: string, target: string, level: string) => call(actor, "PUT", `/api/bots/${bot}/grants`, { target, level });
  const del = (actor: string, bot: string, target: string) => call(actor, "DELETE", `/api/bots/${bot}/grants/${encodeURIComponent(target)}`);
  return { bots, changed, call, put, del, audits };
}

describe("bot grants routes", () => {
  it("the owner adds people and teams at any level; bad input answers its code", async () => {
    const h = harness();
    expect((await put(h, ALICE, "x", `user:${BOB}`, "use")).status).toBe(200);
    const team = await h.put(ALICE, "x", "team:T", "run");
    expect(team).toMatchObject({ status: 200, body: { grants: [{ target: `user:${BOB}`, level: "use", kind: "user" }, { target: "team:T", level: "run", kind: "team", label: "Team T", by: ALICE }] } });
    expect(h.changed).toEqual(["x", "x"]);
    expect((await h.put(ALICE, "x", "bob@example.test", "use")).body.code).toBe("bad_target");
    expect((await h.put(ALICE, "x", `user:${BOB}`, "owner")).body.code).toBe("bad_level");
    expect((await h.put(ALICE, "x", `user:${ALICE}`, "use")).body.code).toBe("self");
    expect((await h.put(ALICE, "x", `user:${GONE}`, "use")).body.code).toBe("unknown_person");
    expect((await h.put(ALICE, "x", "team:ZZ", "use")).body.code).toBe("unknown_team");
    expect((await h.put(ALICE, "nobot", "team:T", "use")).status).toBe(404);
    // the same level again changes nothing
    await h.put(ALICE, "x", "team:T", "run");
    expect(h.changed).toEqual(["x", "x"]);
  });

  it("GET says what the caller may administer", async () => {
    const h = harness();
    h.bots.x!.grants = [{ target: "team:T", level: "use", by: ALICE, at: 1 }, { target: `user:${BOB}`, level: "run", by: ALICE, at: 1 }];
    expect(await h.call(ALICE, "GET", "/api/bots/x/grants")).toMatchObject({ status: 200, body: { administer: { any: true, maxLevel: "manage" }, grants: [{ target: "team:T" }, { target: `user:${BOB}` }] } });
    expect(await h.call(ADMIN, "GET", "/api/bots/x/grants")).toMatchObject({ status: 200, body: { administer: { any: true } } });
    // a manager sees only the grants reaching their teams
    const mia = await h.call(MIA, "GET", "/api/bots/x/grants");
    expect(mia).toMatchObject({ status: 200, body: { administer: { any: false, teamIds: ["T"], maxLevel: "use", canAdd: true } } });
    expect(mia.body.grants.map((g: BotGrant) => g.target)).toEqual(["team:T"]);
    // a use holder, and someone with nothing, may not
    expect((await h.call(BOB, "GET", "/api/bots/x/grants")).body.code).toBe("not_allowed");
    expect((await h.call(DAVE, "GET", "/api/bots/x/grants")).status).toBe(403);
    // a manager of a team the bot never reached learns nothing
    expect((await h.call(MIA, "GET", "/api/bots/y/grants")).status).toBe(403);
  });

  it("levels: manage holders give up to edit; use holders give nothing", async () => {
    const h = harness();
    await h.put(ALICE, "x", `user:${BOB}`, "use");
    expect((await h.put(BOB, "x", `user:${DAVE}`, "use")).body.code).toBe("not_allowed");
    await h.put(ALICE, "x", `user:${BOB}`, "manage");
    expect((await h.put(BOB, "x", `user:${DAVE}`, "use")).status).toBe(200);
    expect((await h.put(BOB, "x", `user:${DAVE}`, "edit")).status).toBe(200);
    expect((await h.put(BOB, "x", `user:${DAVE}`, "manage")).status).toBe(403);
    expect(h.bots.x!.grants.find((g) => g.target === `user:${DAVE}`)).toMatchObject({ level: "edit", by: BOB });
  });

  it("the manager anchor: add up to the anchor, lower and remove always, never outside their teams", async () => {
    const h = harness();
    await h.put(ALICE, "x", "team:T", "use");
    expect((await h.put(MIA, "x", "team:T", "run")).status).toBe(403);
    expect((await h.put(MIA, "x", `user:${CAROL}`, "use")).status).toBe(200);
    expect((await h.put(MIA, "x", `user:${DAVE}`, "use")).status).toBe(403);
    expect((await h.del(MIA, "x", "team:T")).status).toBe(200);
    expect(h.bots.x!.grants.map((g) => g.target)).toEqual([`user:${CAROL}`]);
    // no anchor now: carol's grant can be removed, not re-raised
    expect((await h.put(MIA, "x", `user:${CAROL}`, "run")).status).toBe(403);
    expect((await h.del(MIA, "x", `user:${CAROL}`)).status).toBe(200);
    expect((await h.put(MIA, "y", "team:T", "use")).body).toMatchObject({ code: "not_allowed" });
  });

  it("an admin administers without a grant; DELETE answers 404 for an absent grant and 400 for a bad target", async () => {
    const h = harness();
    expect((await h.put(ADMIN, "x", `user:${BOB}`, "manage")).status).toBe(200);
    expect((await h.del(ADMIN, "x", `user:${BOB}`)).status).toBe(200);
    expect((await h.del(ADMIN, "x", `user:${BOB}`)).status).toBe(404);
    expect((await h.del(ADMIN, "x", "nobody")).status).toBe(400);
    expect((await h.del(DAVE, "x", `user:${BOB}`)).status).toBe(403);
  });

  it("lists disabled grantees for the record", async () => {
    const h = harness();
    h.bots.x!.grants = [{ target: `user:${GONE}`, level: "use", by: ALICE, at: 1 }];
    expect((await h.call(ALICE, "GET", "/api/bots/x/grants")).body.grants).toEqual([{ target: `user:${GONE}`, level: "use", by: ALICE, at: 1, kind: "user", label: "Gone", disabled: true }]);
  });

  it("the client routes are listed only on an organization server", () => {
    const org = { orgDirectory: true };
    expect(requiredScope("GET", "/api/bots/x/grants", org)).toBe("client");
    expect(requiredScope("PUT", "/api/bots/x/grants", org)).toBe("client");
    expect(requiredScope("DELETE", `/api/bots/x/grants/user%3A${BOB}`, org)).toBe("client");
    expect(requiredScope("DELETE", "/api/bots/x/grants/team:01J9TEAM", org)).toBe("client");
    expect(requiredScope("DELETE", "/api/bots/x/grants/team:bad%20id", org)).toBe("admin");
    expect(requiredScope("GET", "/api/org/bots", org)).toBe("client");
    expect(requiredScope("GET", "/api/bots/x/grants")).toBe("admin");
    expect(requiredScope("GET", "/api/me/engines", org)).toBe("client");
    expect(requiredScope("POST", "/api/me/engines/codex/login/start", org)).toBe("client");
    expect(requiredScope("GET", "/api/me/engines/codex/login/status", org)).toBe("client");
    expect(requiredScope("PUT", "/api/org/sections/sec_00000000-0000-4000-8000-000000000001/members", org)).toBe("client");
    expect(requiredScope("POST", "/api/org/sections", org)).toBe("client");
    expect(requiredScope("POST", "/api/org/sections")).toBe("admin");
  });
});

async function put(h: ReturnType<typeof harness>, actor: string, bot: string, target: string, level: string) {
  return h.put(actor, bot, target, level);
}

describe("bot grants audit (slice 7)", () => {
  it("writes grant.set and grant.remove on success only, with before and after", async () => {
    const h = harness();
    await h.put(ALICE, "x", `user:${BOB}`, "use");
    await h.put(ALICE, "x", `user:${BOB}`, "edit");
    // unchanged level, refused caller, bad input: nothing written
    await h.put(ALICE, "x", `user:${BOB}`, "edit");
    expect((await h.put(DAVE, "x", "team:T", "use")).status).toBe(403);
    expect((await h.put(ALICE, "x", "bob@example.test", "use")).status).toBe(400);
    await h.del(ALICE, "x", `user:${BOB}`);
    expect((await h.del(ALICE, "x", `user:${BOB}`)).status).toBe(404);
    expect(h.audits).toEqual([
      { action: "grant.set", botId: "x", before: null, after: { target: `user:${BOB}`, level: "use" }, actor: ALICE },
      { action: "grant.set", botId: "x", before: { target: `user:${BOB}`, level: "use" }, after: { target: `user:${BOB}`, level: "edit" }, actor: ALICE },
      { action: "grant.remove", botId: "x", before: { target: `user:${BOB}`, level: "edit" }, after: null, actor: ALICE },
    ]);
  });
});
