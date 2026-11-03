// Slice 5: the Perspicax MCP profiles a bot mounts (server/bot-perspicax.ts).
import { describe, expect, it } from "vitest";

import type { BotGrant, Viewer } from "./auth/authz.ts";
import { createBotPerspicaxRoutes } from "./bot-perspicax.ts";
import { requiredScope } from "./auth/request-auth.ts";
import { cleanBotPerspicax } from "./store.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1);
const BOB = pid(2);
const CAROL = pid(3);
const DAVE = pid(4);
const ADMIN = pid(5);
const EDITOR = pid(6);

const CATALOG = [
  { id: "P1", slug: "dispatch", name: "Dispatch", description: "Tickets" },
  { id: "P2", slug: "billing", name: "Billing", description: "" },
  { id: "P3", slug: "sales", name: "Sales", description: "" },
];

function harness(options: { linked?: boolean } = {}) {
  const profiles: Record<string, string[]> = { x: [] };
  const grants: BotGrant[] = [
    { target: `user:${BOB}`, level: "edit", by: ALICE, at: 1 },
    { target: `user:${CAROL}`, level: "use", by: ALICE, at: 1 },
    { target: `user:${EDITOR}`, level: "edit", by: ALICE, at: 1 },
  ];
  const held: Record<string, string[]> = { [ALICE]: ["P1", "P2"], [BOB]: ["P1"], [CAROL]: ["P1"], [EDITOR]: [] };
  const changed: string[] = [];
  const route = createBotPerspicaxRoutes({
    linked: () => options.linked ?? true,
    profilesOf: (id) => profiles[id] && [...profiles[id]!],
    facts: () => ({ ownerPrincipalId: ALICE, grants, sections: [] }),
    viewer: (auth) => {
      const id = (auth as unknown as { actor?: string }).actor;
      if (!id) return undefined;
      return { principalId: id, orgAdmin: id === ADMIN, teams: [], disabled: false } satisfies Viewer;
    },
    heldBy: (auth) => held[(auth as unknown as { actor?: string }).actor ?? ""] ?? [],
    catalog: () => CATALOG,
    setProfiles: (id, next) => { profiles[id] = next; },
    onChanged: (id) => changed.push(id),
  });
  const call = async (actor: string | undefined, method: string, path: string, body?: unknown) => {
    let answer: { status: number; body: any } | undefined;
    const handled = await route({
      req: {} as never,
      res: { setHeader: () => {} } as never,
      url: new URL(`http://x${path}`),
      path,
      method,
      auth: { actor } as never,
      json: ((_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload }; }) as never,
      readBody: (async () => body) as never,
    });
    return answer ?? { status: 0, body: handled };
  };
  const put = (actor: string | undefined, list: unknown) => call(actor, "PUT", "/api/bots/x/perspicax", { profiles: list });
  return { profiles, held, changed, call, put };
}

describe("bot Perspicax profiles routes", () => {
  it("the owner adds profiles she holds; GET shows selected, available and canEdit", async () => {
    const h = harness();
    expect(await h.put(ALICE, ["P1", "P2", "P1"])).toMatchObject({ status: 200 });
    expect(h.profiles.x).toEqual(["P1", "P2"]);
    expect(h.changed).toEqual(["x"]);
    const got = await h.call(ALICE, "GET", "/api/bots/x/perspicax");
    expect(got.status).toBe(200);
    expect(got.body).toEqual({
      selected: [
        { id: "P1", slug: "dispatch", name: "Dispatch", description: "Tickets", heldByMe: true },
        { id: "P2", slug: "billing", name: "Billing", description: "", heldByMe: true },
      ],
      available: [CATALOG[0], CATALOG[1]],
      canEdit: true,
    });
    // bob (edit) sees P2 as not held by him
    const bob = await h.call(BOB, "GET", "/api/bots/x/perspicax");
    expect(bob.body.selected[1]).toMatchObject({ id: "P2", heldByMe: false });
    expect(bob.body.available).toEqual([CATALOG[0]]);
  });

  it("adding needs holding the profile; ids already there may stay or go", async () => {
    const h = harness();
    await h.put(ALICE, ["P2"]);
    // bob holds P1, not P2: he may add P1 and keep P2
    expect(await h.put(BOB, ["P2", "P1"])).toMatchObject({ status: 200 });
    expect(h.profiles.x).toEqual(["P2", "P1"]);
    // the editor holds nothing: adding P3 is refused, removing is fine
    expect(await h.put(EDITOR, ["P2", "P1", "P3"])).toMatchObject({ status: 403, body: { code: "profile_not_held" } });
    expect(await h.put(EDITOR, [])).toMatchObject({ status: 200 });
    expect(h.profiles.x).toEqual([]);
  });

  it("use only reads; no grant reads nothing; bad input answers its code", async () => {
    const h = harness();
    expect(await h.call(CAROL, "GET", "/api/bots/x/perspicax")).toMatchObject({ status: 200, body: { canEdit: false } });
    expect(await h.put(CAROL, ["P1"])).toMatchObject({ status: 403, body: { code: "needs_edit" } });
    expect(await h.call(DAVE, "GET", "/api/bots/x/perspicax")).toMatchObject({ status: 404 });
    expect(await h.put(DAVE, ["P1"])).toMatchObject({ status: 404 });
    // an org admin without a grant opens no bot
    expect(await h.call(ADMIN, "GET", "/api/bots/x/perspicax")).toMatchObject({ status: 404 });
    expect(await h.call(ALICE, "GET", "/api/bots/nope/perspicax")).toMatchObject({ status: 404 });
    expect(await h.put(ALICE, ["NOPE"])).toMatchObject({ status: 400, body: { code: "unknown_profile" } });
    expect(await h.put(ALICE, ["bad id"])).toMatchObject({ status: 400, body: { code: "bad_profiles" } });
    expect(await h.put(ALICE, "P1")).toMatchObject({ status: 400 });
    expect(await h.put(ALICE, Array.from({ length: 9 }, (_, i) => `Q${i}`))).toMatchObject({ status: 400, body: { code: "too_many_profiles" } });
    expect(await h.call(ALICE, "DELETE", "/api/bots/x/perspicax")).toMatchObject({ status: 405 });
    expect(h.profiles.x).toEqual([]);
  });

  it("does not exist without a Perspicax link, and is a client route only in org mode", async () => {
    const h = harness({ linked: false });
    expect((await h.call(ALICE, "GET", "/api/bots/x/perspicax")).status).toBe(0);
    expect(requiredScope("GET", "/api/bots/x/perspicax", { orgDirectory: true })).toBe("client");
    expect(requiredScope("PUT", "/api/bots/x/perspicax", { orgDirectory: true })).toBe("client");
    expect(requiredScope("PUT", "/api/bots/x/perspicax", {})).toBe("admin");
  });

  it("the stored value keeps at most 8 valid ids, deduped", () => {
    expect(cleanBotPerspicax({ profiles: ["P1", "P1", "P2"] })).toEqual({ profiles: ["P1", "P2"] });
    expect(cleanBotPerspicax({ profiles: [] })).toBeUndefined();
    expect(cleanBotPerspicax({ profiles: ["bad id"] })).toBeUndefined();
    expect(cleanBotPerspicax({ profiles: Array.from({ length: 9 }, (_, i) => `Q${i}`) })).toBeUndefined();
    expect(cleanBotPerspicax("P1")).toBeUndefined();
  });
});
