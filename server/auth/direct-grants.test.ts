import { describe, expect, it } from "vitest";
import { createDirectGrantRoutes, grantDirect, grantDirectRoute, revokeDirectRoute, type DirectGrantRouteDeps } from "./direct-grants.ts";
import { requiredScope } from "./request-auth.ts";

describe("direct grants", () => {
  it("lets the owner open a direct and refuses anyone else", () => {
    const opened = grantDirect({ actorId: "owner", ownerUserId: "owner", botId: "aurora", userId: "morgan@example.test", grants: [] });
    expect(opened.ok).toBe(true);
    expect(grantDirect({ actorId: "ada@example.test", ownerUserId: "owner", botId: "aurora", userId: "morgan@example.test", grants: [] })).toEqual({
      ok: false,
      error: "not-owner",
    });
  });

  it("does not duplicate the same pair", () => {
    const first = grantDirect({ actorId: "owner", ownerUserId: "owner", botId: "aurora", userId: "morgan@example.test", grants: [] });
    expect(first).toEqual({
      ok: true,
      grants: [{ botId: "aurora", userId: "morgan@example.test" }],
    });
    expect(grantDirect({
      actorId: "owner",
      ownerUserId: "owner",
      botId: "aurora",
      userId: "morgan@example.test",
      grants: first.ok ? first.grants : [],
    })).toEqual(first);
  });

  it("maps stored user ids and refuses a bot with no owner", () => {
    expect(grantDirectRoute({
      actorId: "owner",
      bot: { id: "aurora", ownerUserId: "owner", directGrants: [] },
      userId: "morgan@example.test",
    })).toEqual({ status: 200, directGrants: ["morgan@example.test"] });
    expect(grantDirectRoute({
      actorId: "owner",
      bot: { id: "aurora", ownerUserId: "owner", directGrants: ["morgan@example.test"] },
      userId: "morgan@example.test",
    })).toEqual({ status: 200, directGrants: ["morgan@example.test"] });
    expect(grantDirectRoute({
      actorId: "owner",
      bot: { id: "aurora" },
      userId: "morgan@example.test",
    })).toEqual({ status: 403, error: "not-owner" });
    expect(grantDirectRoute({
      actorId: "ada@example.test",
      bot: { id: "aurora", ownerUserId: "owner" },
      userId: "morgan@example.test",
    })).toEqual({ status: 403, error: "not-owner" });
    expect(grantDirectRoute({ actorId: "owner", userId: "morgan@example.test" })).toEqual({ status: 404 });
  });

  it("lets a member owner post a grant at client scope", () => {
    expect(requiredScope("POST", "/api/bots/aurora/direct-grants")).toBe("client");
  });

  it("authorizes the owner before resolving the grantee", async () => {
    const resolved: string[] = [];
    const patched: unknown[] = [];
    const route = createDirectGrantRoutes({
      bot: (id) => (id === "aurora" ? { id, ownerUserId: "pr_owner", directGrants: [] } : undefined),
      patchBot: (id, patch) => patched.push({ id, ...patch }),
      actorId: (auth) => (auth as unknown as { actor: string }).actor,
      resolveUserId: (ref) => { resolved.push(ref); return ref.includes("@") && ref.length <= 320 ? "pr_morgan" : null; },
    });
    const call = async (actor: string, userId: string) => {
      let answer: { status: number; body: unknown } | undefined;
      await route({
        req: {} as never,
        res: {} as never,
        url: new URL("http://x/api/bots/aurora/direct-grants"),
        path: "/api/bots/aurora/direct-grants",
        method: "POST",
        auth: { actor } as never,
        json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
        readBody: (async () => ({ userId })) as never,
      });
      return answer!;
    };
    const huge = `${"a".repeat(400)}@example.com`;
    expect(await call("", huge)).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(await call("pr_other", "morgan@example.com")).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(resolved).toEqual([]);
    expect((await call("pr_owner", huge)).status).toBe(400);
    expect((await call("pr_owner", "bob")).status).toBe(400);
    expect(await call("pr_owner", "morgan@example.com")).toEqual({ status: 200, body: { directGrants: ["pr_morgan"] } });
    expect(patched).toEqual([{ id: "aurora", directGrants: ["pr_morgan"] }]);
  });

  it("removes a grant: owner only, 404 when absent", () => {
    const bot = { id: "aurora", ownerUserId: "pr_owner", directGrants: ["pr_bob", "pr_dave"] };
    expect(revokeDirectRoute({ actorId: "pr_owner", bot, userId: "pr_bob" })).toEqual({ status: 200, directGrants: ["pr_dave"] });
    expect(revokeDirectRoute({ actorId: "pr_bob", bot, userId: "pr_bob" })).toEqual({ status: 403, error: "not-owner" });
    expect(revokeDirectRoute({ actorId: "pr_owner", bot, userId: "pr_erin" })).toMatchObject({ status: 404 });
    expect(revokeDirectRoute({ actorId: "pr_owner", bot: null, userId: "pr_bob" })).toMatchObject({ status: 404 });
    expect(revokeDirectRoute({ actorId: "pr_owner", bot: { id: "x" }, userId: "pr_bob" })).toEqual({ status: 403, error: "not-owner" });
  });

  it("serves DELETE at client scope for the owner and tells the server to narrow at once", () => {
    expect(requiredScope("DELETE", "/api/bots/aurora/direct-grants/pr_00000000-0000-4000-8000-000000000001")).toBe("client");
    expect(requiredScope("DELETE", "/api/bots/aurora/direct-grants/bob@example.test")).toBe("admin");
  });
});

describe("direct grants on an organization server", () => {
  const BOB = "pr_00000000-0000-4000-8000-0000000000b0";
  const DAVE = "pr_00000000-0000-4000-8000-0000000000d0";
  const OWNER = "pr_00000000-0000-4000-8000-0000000000a0";
  function orgRoute() {
    const bot = { id: "aurora", ownerUserId: OWNER, directGrants: [] as string[] };
    const changed: string[] = [];
    const deps: DirectGrantRouteDeps = {
      bot: (id) => (id === "aurora" ? bot : undefined),
      patchBot: (_id, patch) => { bot.directGrants = patch.directGrants; },
      actorId: (auth) => (auth as unknown as { actor: string }).actor,
      // the directory lists bob as active; dave is disabled; nobody else exists
      resolveOrgPerson: (ref) => (ref === BOB || ref === OWNER ? { ok: true, id: ref } : { ok: false, code: "unknown_person" }),
      onChanged: (id) => changed.push(id),
    };
    const route = createDirectGrantRoutes(deps);
    const call = async (actor: string, method: "POST" | "DELETE", path: string, userId?: string) => {
      let answer: { status: number; body: unknown } | undefined;
      await route({
        req: {} as never,
        res: {} as never,
        url: new URL(`http://x${path}`),
        path,
        method,
        auth: { actor } as never,
        json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
        readBody: (async () => ({ userId })) as never,
      });
      return answer!;
    };
    return { bot, changed, call };
  }

  it("adds only an active person from the directory, never an email, never the owner", async () => {
    const { bot, changed, call } = orgRoute();
    const post = (userId: string, actor = OWNER) => call(actor, "POST", "/api/bots/aurora/direct-grants", userId);
    expect(await post("bob@example.test")).toMatchObject({ status: 400, body: { code: "unknown_person" } });
    expect(await post(DAVE)).toMatchObject({ status: 400, body: { code: "unknown_person" } });
    expect(await post("pr_00000000-0000-4000-8000-00000000ffff")).toMatchObject({ status: 400, body: { code: "unknown_person" } });
    expect(await post(OWNER)).toMatchObject({ status: 400, body: { code: "self" } });
    expect(await post(BOB, BOB)).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(changed).toEqual([]);
    expect(await post(BOB)).toEqual({ status: 200, body: { directGrants: [BOB] } });
    expect(bot.directGrants).toEqual([BOB]);
    expect(changed).toEqual(["aurora"]);
  });

  it("refuses a read-only owner before resolving or saving a grant", async () => {
    const bot = { id: "aurora", ownerUserId: OWNER, directGrants: [BOB] };
    const resolved: string[] = [];
    const changed: string[] = [];
    const route = createDirectGrantRoutes({
      bot: (id) => (id === "aurora" ? bot : undefined),
      patchBot: (_id, patch) => { bot.directGrants = patch.directGrants; },
      actorId: (auth) => (auth as unknown as { actor: string }).actor,
      resolveOrgPerson: (ref) => { resolved.push(ref); return { ok: true, id: ref }; },
      onChanged: (id) => changed.push(id),
      botsReadOnly: (actorId) => actorId === OWNER,
    });
    const call = async (method: "POST" | "DELETE", path: string, userId?: string) => {
      let answer: { status: number; body: unknown } | undefined;
      await route({
        req: {} as never,
        res: {} as never,
        url: new URL(`http://x${path}`),
        path,
        method,
        auth: { actor: OWNER } as never,
        json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
        readBody: (async () => ({ userId })) as never,
      });
      return answer!;
    };
    const refused = { error: "org_bots_read_only", message: "Your administrator lets you use shared bots only." };
    expect(await call("POST", "/api/bots/aurora/direct-grants", BOB)).toEqual({ status: 403, body: refused });
    expect(await call("DELETE", `/api/bots/aurora/direct-grants/${BOB}`)).toEqual({ status: 403, body: refused });
    expect(bot.directGrants).toEqual([BOB]);
    expect(resolved).toEqual([]);
    expect(changed).toEqual([]);
  });

  it("removes a grant through DELETE and says so, 404 the second time", async () => {
    const { bot, changed, call } = orgRoute();
    bot.directGrants = [BOB];
    const path = `/api/bots/aurora/direct-grants/${BOB}`;
    expect(await call(BOB, "DELETE", path)).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(await call(OWNER, "DELETE", path)).toEqual({ status: 200, body: { directGrants: [] } });
    expect(changed).toEqual(["aurora"]);
    expect(await call(OWNER, "DELETE", path)).toMatchObject({ status: 404 });
    expect(await call(OWNER, "DELETE", `/api/bots/nobot/direct-grants/${BOB}`)).toMatchObject({ status: 404 });
  });
});
