// The rules of a direct conversation between two people, pure. The real
// server's behavior (privacy, live frames, search, notifications) is covered
// by server/people-dms.e2e.test.ts.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import {
  findPeopleDm,
  isPeopleDmParticipant,
  migratePeopleDmToThreads,
  otherPerson,
  PEOPLE_DM_GENERAL_TITLE,
  peopleDmCandidate,
  peopleDmForViewer,
  peopleDmPatchRefusal,
  peopleDmThreadUnreadPatch,
  peopleDmUnreadPatch,
  peopleDmRouteRefusal,
  PeopleDmSelections,
} from "./people-dms.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { createPeopleDmRoutes } from "./routes/people-dms.ts";
import { dispatchRoutes } from "./routes/table.ts";

const dm = { id: "g1", peopleDm: true, humanIds: ["pr_alice", "pr_bob"] };

describe("people dm unread, per person", () => {
  it("a new message is unread for the recipient only, and reading clears it for the reader only", () => {
    const sent = peopleDmUnreadPatch({}, "PR_Bob", true);
    expect(sent).toEqual({ unread: true, unreadFor: ["pr_bob"] });
    const dm = { peopleDm: true, unread: sent.unread, unreadFor: sent.unreadFor };
    expect(peopleDmForViewer(dm, "pr_bob")).toEqual({ peopleDm: true, unread: true });
    // the sender, reading the conversation, has nothing unread
    expect(peopleDmForViewer(dm, "pr_alice")).toEqual({ peopleDm: true, unread: false });
    expect(peopleDmUnreadPatch(dm, "pr_alice", false)).toEqual({ unread: true, unreadFor: ["pr_bob"] });
    expect(peopleDmUnreadPatch(dm, "pr_bob", false)).toEqual({ unread: false, unreadFor: [] });
    expect(peopleDmUnreadPatch({ unreadFor: ["pr_bob"] }, "pr_alice", true)).toEqual({ unread: true, unreadFor: ["pr_alice", "pr_bob"] });
  });

  it("an older conversation keeps its shared flag; a room keeps its own, plus a person's unread @ tag", () => {
    expect(peopleDmForViewer({ peopleDm: true, unread: true }, "pr_alice")).toEqual({ peopleDm: true, unread: true });
    expect(peopleDmForViewer({ unread: true }, "pr_alice")).toEqual({ unread: true });
    // a room's unreadFor is who was tagged with @ (server/rooms/room-mentions.ts): never sent, unread for them only
    expect(peopleDmForViewer({ unread: true, unreadFor: ["pr_bob"] }, "pr_alice")).toEqual({ unread: true });
    expect(peopleDmForViewer({ unread: false, unreadFor: ["pr_bob"] }, "pr_alice")).toEqual({ unread: false });
    expect(peopleDmForViewer({ unread: false, unreadFor: ["pr_bob"] }, "PR_BOB")).toEqual({ unread: true });
    expect(peopleDmForViewer({ peopleDm: true, unread: true, unreadFor: ["pr_bob"] }, undefined)).toEqual({ peopleDm: true, unread: false });
  });
});

describe("people dm rules", () => {
  it("lets only its two people in, never a viewer without an id", () => {
    expect(isPeopleDmParticipant(dm, "pr_alice")).toBe(true);
    expect(isPeopleDmParticipant(dm, "PR_BOB")).toBe(true);
    expect(isPeopleDmParticipant(dm, "pr_carol")).toBe(false);
    expect(isPeopleDmParticipant(dm, undefined)).toBe(false);
    expect(isPeopleDmParticipant({ humanIds: ["pr_alice"] }, "pr_alice")).toBe(false);
  });

  it("finds the pair in either order and names the other person", () => {
    const groups = [{ id: "room", humanIds: ["pr_alice", "pr_bob"] }, dm];
    expect(findPeopleDm(groups, "pr_bob", "pr_alice")?.id).toBe("g1");
    expect(findPeopleDm(groups, "pr_alice", "pr_carol")).toBeUndefined();
    expect(otherPerson(dm, "pr_alice")).toBe("pr_bob");
  });

  it("only marks read or the home pin, takes messages and threads like a bot's", () => {
    expect(peopleDmPatchRefusal({ unread: false })).toBeNull();
    expect(peopleDmPatchRefusal({ unread: true })).toBeNull();
    expect(peopleDmPatchRefusal({ pinned: false })).toBeNull();
    expect(peopleDmPatchRefusal({ pinned: true })).toBeNull();
    expect(peopleDmPatchRefusal({ unread: false, name: "x" })).toBe("name");
    expect(peopleDmPatchRefusal({ section: "Ops" })).toBe("section");
    expect(peopleDmRouteRefusal("GET", "/api/threads/t1/messages")).toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/messages")).toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/read")).toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/threads/t1/read")).toBeNull();
    expect(peopleDmRouteRefusal("GET", "/api/threads/t1/read")).toBeNull();
    // threads: create, switch, rename/pin/archive/snooze/move, delete
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/tasks")).toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/tasks/t2")).toBeNull();
    expect(peopleDmRouteRefusal("PATCH", "/api/groups/g1/tasks/t2")).toBeNull();
    expect(peopleDmRouteRefusal("DELETE", "/api/groups/g1/tasks/t2")).toBeNull();
    // folders: create, edit, order, delete
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/projects")).toBeNull();
    expect(peopleDmRouteRefusal("PATCH", "/api/groups/g1/projects/f1")).toBeNull();
    expect(peopleDmRouteRefusal("PATCH", "/api/groups/g1/projects/order")).toBeNull();
    expect(peopleDmRouteRefusal("DELETE", "/api/groups/g1/projects/f1")).toBeNull();
    // never a generated title (the pair's words would reach a model), never
    // the conversation itself, its memory, members, queue or a turn
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/tasks/t2/title")).not.toBeNull();
    expect(peopleDmRouteRefusal("DELETE", "/api/groups/g1")).not.toBeNull();
    expect(peopleDmRouteRefusal("PUT", "/api/groups/g1/memory")).not.toBeNull();
    expect(peopleDmRouteRefusal("POST", "/api/groups/g1/interrupt")).not.toBeNull();
    expect(peopleDmRouteRefusal("DELETE", "/api/groups/g1/queue/q1")).not.toBeNull();
  });

  it("offers active people only, never a service account or oneself", () => {
    expect(peopleDmCandidate({ principalId: "pr_bob" }, "pr_alice")).toBe(true);
    expect(peopleDmCandidate({ principalId: "pr_bob", service: true }, "pr_alice")).toBe(false);
    expect(peopleDmCandidate({ principalId: "pr_bob", disabled: true }, "pr_alice")).toBe(false);
    expect(peopleDmCandidate({ principalId: "PR_ALICE" }, "pr_alice")).toBe(false);
  });
});

describe("people dm threads", () => {
  it("unread is per person and per thread; the conversation's flag stays while any thread is unread", () => {
    const group = { unreadFor: [] as string[], tasks: [{ threadId: "general" }, { threadId: "t2" }] };
    // bob writes in t2: unread for alice on t2, and on the conversation
    const sent = peopleDmThreadUnreadPatch(group, "pr_alice", true, "t2");
    expect(sent.unreadFor).toEqual(["pr_alice"]);
    expect(sent.tasks).toEqual([{ threadId: "general" }, { threadId: "t2", unreadFor: ["pr_alice"] }]);
    const both = peopleDmThreadUnreadPatch(sent, "pr_alice", true, "general");
    // alice reads general only: t2 keeps its dot and the conversation stays unread
    const readGeneral = peopleDmThreadUnreadPatch(both, "pr_alice", false, "general");
    expect(readGeneral.unreadFor).toEqual(["pr_alice"]);
    expect(readGeneral.tasks.find((task) => task.threadId === "general")).toEqual({ threadId: "general" });
    // bob reading clears nothing of alice's
    expect(peopleDmThreadUnreadPatch(readGeneral, "pr_bob", false, "t2").unreadFor).toEqual(["pr_alice"]);
    // a client from before threads reads the conversation: every thread
    const all = peopleDmThreadUnreadPatch(readGeneral, "pr_alice", false);
    expect(all).toEqual({ unread: false, unreadFor: [], tasks: [{ threadId: "general" }, { threadId: "t2" }] });
    // a conversation marked unread (no thread of its own) is read by reading any thread
    expect(peopleDmThreadUnreadPatch({ unreadFor: ["pr_alice"], tasks: [{ threadId: "general" }] }, "pr_alice", false, "general").unreadFor).toEqual([]);
  });

  it("a viewer sees their own unread per thread and their own open thread, never the other's state", () => {
    const group = {
      id: "g1", peopleDm: true, threadId: "general", unread: true, unreadFor: ["pr_alice"],
      tasks: [{ threadId: "general", title: "General" }, { threadId: "t2", title: "Budget", unreadFor: ["pr_alice"] }],
    };
    const alice = peopleDmForViewer(group, "PR_ALICE", "t2");
    expect(alice).toEqual({
      id: "g1", peopleDm: true, threadId: "t2", unread: true,
      tasks: [{ threadId: "general", title: "General", unread: false }, { threadId: "t2", title: "Budget", unread: true }],
    });
    const bob = peopleDmForViewer(group, "pr_bob");
    expect(bob.threadId).toBe("general");
    expect(bob.unread).toBe(false);
    expect(bob.tasks?.[1]).toEqual({ threadId: "t2", title: "Budget", unread: false });
    expect(JSON.stringify(bob)).not.toContain("unreadFor");
    // a selection that is not one of its threads opens the default one
    expect(peopleDmForViewer(group, "pr_alice", "gone").threadId).toBe("general");
  });

  it("keeps each person's open thread apart and forgets a deleted one", () => {
    const selections = new PeopleDmSelections();
    selections.set("g1", "PR_ALICE", "t2");
    selections.set("g1", "pr_bob", "t3");
    expect(selections.get("g1", "pr_alice")).toBe("t2");
    expect(selections.get("g1", "pr_bob")).toBe("t3");
    expect(selections.get("g2", "pr_alice")).toBeUndefined();
    expect(selections.get("g1", undefined)).toBeUndefined();
    selections.forgetThread("t2");
    expect(selections.get("g1", "pr_alice")).toBeUndefined();
    expect(selections.get("g1", "pr_bob")).toBe("t3");
  });

  it("migrates a conversation once: what it was becomes its General thread, nothing moves", () => {
    // a conversation stored by 0.4.16: one task, the default thread
    const legacy = { peopleDm: true as const, threadId: "conv", createdAt: 5, tasks: [{ threadId: "conv", title: "New task", createdAt: 5, updatedAt: 9 }] } as Parameters<typeof migratePeopleDmToThreads>[0];
    expect(migratePeopleDmToThreads(legacy)).toBe(true);
    expect(legacy).toMatchObject({ threadId: "conv", personThreads: 1, tasks: [{ threadId: "conv", title: PEOPLE_DM_GENERAL_TITLE, general: true, createdAt: 5, updatedAt: 9 }] });
    // idempotent, and a renamed General is never renamed back
    legacy.tasks![0]!.title = "Lunch";
    expect(migratePeopleDmToThreads(legacy)).toBe(false);
    expect(legacy.tasks![0]!.title).toBe("Lunch");
    // a record from before tasks existed at all
    const older = { peopleDm: true as const, threadId: "conv2", createdAt: 7 } as Parameters<typeof migratePeopleDmToThreads>[0];
    expect(migratePeopleDmToThreads(older)).toBe(true);
    expect(older.tasks).toEqual([{ threadId: "conv2", title: "General", createdAt: 7, updatedAt: 7, general: true }]);
    // a room is not a person conversation
    expect(migratePeopleDmToThreads({ threadId: "r", createdAt: 1, tasks: [] })).toBe(false);
  });
});

describe("POST /api/people-dms", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function serve(organization = true) {
    const groups: Array<{ id: string; peopleDm?: boolean; humanIds?: string[] }> = [];
    const routes = [createPeopleDmRoutes({
      organization: () => organization,
      viewerId: (auth) => (auth as { session?: { principalId?: string } }).session?.principalId,
      person: (id) => id === "pr_robot" ? { ok: false, code: "service_account" } : id.startsWith("pr_") ? { ok: true, id, name: id.slice(3) } : { ok: false, code: "unknown_person" },
      displayName: (id) => id.slice(3),
      groups: () => groups,
      create: ({ a, b }) => {
        const group = { id: `g${groups.length + 1}`, peopleDm: true, humanIds: [a, b] };
        groups.push(group);
        return group;
      },
      project: (group) => group,
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
    return (who: string | undefined, principalId: string) =>
      fetch(`${base}/api/people-dms`, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-who": who } : {}) }, body: JSON.stringify({ principalId }) })
        .then(async (r) => ({ status: r.status, body: (await r.json()) as { group?: { id: string }; code?: string; created?: boolean } }));
  }

  it("creates once, then answers the same conversation from either side", async () => {
    const call = await serve();
    const first = await call("pr_alice", "pr_bob");
    expect(first).toMatchObject({ status: 201, body: { created: true } });
    expect((await call("pr_bob", "pr_alice")).body).toMatchObject({ created: false, group: { id: first.body.group!.id } });
  });

  it("refuses a service account, oneself, an unknown person, no session and a solo server", async () => {
    const call = await serve();
    expect((await call("pr_alice", "pr_robot")).body.code).toBe("service_account");
    expect((await call("pr_alice", "pr_alice")).body.code).toBe("self");
    expect((await call("pr_alice", "nobody")).body.code).toBe("unknown_person");
    expect((await call(undefined, "pr_bob")).status).toBe(403);
    expect((await (await serve(false))("pr_alice", "pr_bob")).status).toBe(404);
  });
});
