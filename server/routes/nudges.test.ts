import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { NudgeCooldown } from "../nudge.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createNudgeRoutes } from "./nudges.ts";
import { dispatchRoutes } from "./table.ts";

describe("POST /api/nudges", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function serve(organization = true) {
    let now = 1_000_000;
    const delivered: Array<{ audience: string; id: string; fromId: string; fromName: string }> = [];
    const echoed: Array<{ audience: string; id: string; toId: string; toName: string; at: number }> = [];
    let ids = 0;
    const recorded: Array<{ fromId: string; fromName: string; toId: string; toName: string; at: number; groupId?: string }> = [];
    const people = [
      { id: "pr_alice" },
      { id: "pr_bob", teams: [{ id: "ops", manager: false }] },
      { id: "pr_cara" },
      { id: "pr_boss", teams: [{ id: "ops", manager: true }] },
      { id: "pr_robot", service: true },
      { id: "pr_out", disabled: true },
    ];
    const rooms = new Map<string, { name: string; humanIds: string[]; peopleDm?: boolean; dm?: boolean; post?: boolean; section?: { ownerPrincipalId?: string; members: { target: string }[] } | null }>([
      ["room-1", { name: "Launch", humanIds: ["pr_alice", "pr_bob", "pr_cara"] }],
      ["room-team", { name: "Ops", humanIds: ["team:ops"], section: { ownerPrincipalId: "pr_cara", members: [{ target: "user:pr_out" }] } }],
      ["room-self", { name: "Alone", humanIds: ["pr_alice", "pr_robot"] }],
      ["dm-people", { name: "Ada", humanIds: ["pr_alice", "pr_bob"], peopleDm: true }],
      ["dm-bots", { name: "Bots", humanIds: [], dm: true }],
      ["room-locked", { name: "Locked", humanIds: ["pr_bob"], post: false }],
    ]);
    const routes = [createNudgeRoutes({
      organization: () => organization,
      viewerId: (auth) => (auth as { session?: { principalId?: string } }).session?.principalId,
      person: (id) => id === "pr_robot" ? { ok: false, code: "service_account" } : id.startsWith("pr_") ? { ok: true, id, name: id.slice(3) } : { ok: false, code: "unknown_person" },
      group: (id) => {
        const room = rooms.get(id);
        if (!room) return { ok: false, code: "unknown_group" };
        if (room.peopleDm || room.dm) return { ok: false, code: "not_a_room" };
        if (room.post === false) return { ok: false, code: "forbidden" };
        return { ok: true, room: { id, name: room.name, humanIds: room.humanIds, section: room.section ?? null } };
      },
      people: () => people,
      displayName: (id) => id.slice(3),
      now: () => now,
      cooldown: new NudgeCooldown(),
      deliver: (frame) => { delivered.push(frame); },
      echo: (frame) => { echoed.push(frame); },
      newId: () => `nudge-${++ids}`,
      record: (line) => { recorded.push(line); },
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who ? { kind: "session", scopes: ["client"], session: { principalId: who } } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (who: string | undefined, body: unknown) =>
      fetch(`${base}/api/nudges`, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify(body) })
        .then(async (r) => ({ status: r.status, retryAfter: r.headers.get("retry-after"), body: await r.json() as { ok?: boolean; id?: string; at?: number; code?: string; error?: string; retryAfterMs?: number } }));
    return {
      delivered,
      echoed,
      recorded,
      advance: (ms: number) => { now += ms; },
      call: (who: string | undefined, principalId: string) => post(who, { principalId }),
      callGroup: (who: string | undefined, groupId: string) => post(who, { groupId }),
      post,
    };
  }

  it("sends once, then refuses until 5 minutes have passed", async () => {
    const fixture = await serve();
    const first = await fixture.call("pr_alice", "pr_bob");
    expect(first).toMatchObject({ status: 200, body: { ok: true, id: "nudge-1", at: 1_000_000 } });
    expect(fixture.delivered).toEqual([{ audience: "pr_bob", id: "nudge-1", fromId: "pr_alice", fromName: "alice", at: 1_000_000 }]);
    // the sender's own windows hear the same nudge, with the same id
    expect(fixture.echoed).toEqual([{ audience: "pr_alice", id: "nudge-1", toId: "pr_bob", toName: "bob", at: 1_000_000 }]);
    expect(fixture.recorded).toEqual([{ fromId: "pr_alice", fromName: "alice", toId: "pr_bob", toName: "bob", at: 1_000_000 }]);

    const second = await fixture.call("pr_alice", "pr_bob");
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("nudge_cooldown");
    expect(second.body.error).toMatch(/Wait/);
    expect(second.body.retryAfterMs).toBeGreaterThan(0);
    expect(second.retryAfter).toBeTruthy();
    expect(fixture.delivered).toHaveLength(1);
    expect(fixture.echoed).toHaveLength(1);
    expect(fixture.recorded).toHaveLength(1);

    fixture.advance(5 * 60 * 1000);
    expect(await fixture.call("pr_alice", "pr_bob")).toMatchObject({ status: 200, body: { ok: true } });
    expect(fixture.delivered).toHaveLength(2);
    expect(fixture.recorded).toHaveLength(2);
  });

  it("refuses a service account, oneself, an unknown person, no session and a solo server", async () => {
    const fixture = await serve();
    expect((await fixture.call("pr_alice", "pr_robot")).body.code).toBe("service_account");
    expect((await fixture.call("pr_alice", "pr_alice")).body.code).toBe("self");
    expect((await fixture.call("pr_alice", "nobody")).body.code).toBe("unknown_person");
    expect((await fixture.call(undefined, "pr_bob")).status).toBe(403);
    const solo = await serve(false);
    expect((await solo.call("pr_alice", "pr_bob")).status).toBe(404);
    expect(fixture.delivered).toHaveLength(0);
    expect(fixture.echoed).toHaveLength(0);
    expect(fixture.recorded).toHaveLength(0);
    expect(solo.recorded).toHaveLength(0);
  });

  it("shakes the other people of a group chat and writes one line there", async () => {
    const fixture = await serve();
    const sent = await fixture.callGroup("pr_alice", "room-1");
    expect(sent).toMatchObject({ status: 200, body: { ok: true } });
    expect(fixture.delivered.map((frame) => frame.audience).sort()).toEqual(["pr_bob", "pr_cara"]);
    expect(new Set(fixture.delivered.map((frame) => frame.id))).toEqual(new Set([sent.body.id]));
    expect(fixture.echoed).toEqual([{ audience: "pr_alice", id: sent.body.id, toId: "room-1", toName: "Launch", at: 1_000_000 }]);
    expect(fixture.recorded).toEqual([{
      fromId: "pr_alice", fromName: "alice", toId: "room-1", toName: "Launch", at: 1_000_000, groupId: "room-1",
    }]);

    const direct = await fixture.call("pr_alice", "pr_bob");
    expect(direct.status).toBe(200);
    expect(fixture.recorded).toHaveLength(2);

    const again = await fixture.callGroup("pr_bob", "room-1");
    expect(again.status).toBe(429);
    expect(again.body.code).toBe("nudge_cooldown");
    expect(fixture.delivered).toHaveLength(3);
    expect(fixture.recorded).toHaveLength(2);
  });

  it("expands a team and a section, and refuses an empty chat before the cooldown", async () => {
    const fixture = await serve();
    const team = await fixture.callGroup("pr_alice", "room-team");
    expect(team.status).toBe(200);
    expect(fixture.delivered.map((frame) => frame.audience).sort()).toEqual(["pr_bob", "pr_cara"]);

    const empty = await fixture.callGroup("pr_alice", "room-self");
    expect(empty.body.code).toBe("nobody");
    expect(await fixture.callGroup("pr_alice", "room-1")).toMatchObject({ status: 200, body: { ok: true } });

    expect((await fixture.callGroup("pr_alice", "dm-people")).body.code).toBe("not_a_room");
    expect((await fixture.callGroup("pr_alice", "dm-bots")).body.code).toBe("not_a_room");
    expect((await fixture.callGroup("pr_alice", "missing")).body.code).toBe("unknown_group");
    expect((await fixture.callGroup("pr_alice", "room-locked")).status).toBe(403);
    expect((await fixture.post("pr_alice", { principalId: "pr_bob", groupId: "room-1" })).status).toBe(400);
    expect(fixture.recorded.filter((line) => line.groupId).map((line) => line.groupId)).toEqual(["room-team", "room-1"]);
  });
});
