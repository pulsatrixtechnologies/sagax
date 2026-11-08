import { describe, expect, it } from "vitest";
import type { ServerResponse } from "node:http";
import { findBotPersonGroup, resolveReachablePerson } from "../people/bot-message-user.ts";
import { createInternalMessageUserRoutes, type MessageUserDeps, type MessageUserGroup, type MessageUserNotice } from "./internal-message-user.ts";
import type { InternalRouteContext } from "./internal-route.ts";

const OWNER = "p_ab";
const ZACH = "p_zach";
const BOT = { id: "b_ember", name: "Ember", color: "#f80" };
const PEOPLE = [
  { id: OWNER, names: ["AB", "ab", "ab@example.test"] },
  { id: ZACH, names: ["Zachary Roy", "zroy", "zachary@example.test"] },
  { id: "p_zoe", names: ["Zoé Tremblay", "ztremblay", ""] },
];

function harness(groups: MessageUserGroup[] = []) {
  const messages: Array<{ threadId: string; message: Record<string, unknown> }> = [];
  const notices: MessageUserNotice[] = [];
  let next = 0;
  const store: MessageUserDeps["store"] = {
    bot: (id) => (id === BOT.id ? BOT : null),
    get groups() { return groups; },
    createGroup: (name, memberIds, dm, _section, _setup, humanIds, extra) => {
      next += 1;
      const group: MessageUserGroup & { createdBy: string } = { id: `g_new${next}`, name, memberIds, dm, humanIds, threadId: `t_new${next}`, createdBy: extra.createdBy };
      groups.push(group);
      return group;
    },
    patchGroup: (id, patch) => {
      const group = groups.find((entry) => entry.id === id);
      if (group) Object.assign(group, patch);
      return group;
    },
    appendMessage: (threadId, message) => {
      messages.push({ threadId, message });
      return { id: `m${messages.length}` };
    },
  };
  const route = createInternalMessageUserRoutes({
    store,
    connectorThread: (botId, threadId) => (botId === BOT.id && threadId === "t_main" ? {} : null),
    ownerOf: () => OWNER,
    reachablePeople: () => PEOPLE,
    personName: (id) => PEOPLE.find((person) => person.id === id)?.names[0] ?? "",
    broadcastGroup: () => {},
    notifyMessage: (notice) => notices.push(notice),
  });
  const call = async (body: Record<string, unknown>) => {
    let answer: { status: number; body: Record<string, unknown> } | undefined;
    const ctx: InternalRouteContext = {
      res: {} as ServerResponse,
      path: "/api/internal/message-user",
      method: "POST",
      json: ((_res: ServerResponse, status: number, payload: Record<string, unknown>) => { answer = { status, body: payload }; }) as unknown as InternalRouteContext["json"],
      capability: { botId: BOT.id, threadId: "t_main", generation: "g1" },
      readBody: async () => body,
    };
    await route(ctx);
    return answer!;
  };
  return { call, groups, messages, notices };
}

describe("message_user (#2118)", () => {
  it("posts in the existing group of the owner, the person and the bot", async () => {
    const existing: MessageUserGroup = { id: "g_pair", name: "AB, Zachary Roy et Ember", memberIds: [BOT.id], humanIds: [OWNER, ZACH], threadId: "t_pair" };
    const t = harness([
      { id: "g_wider", name: "Équipe", memberIds: [BOT.id], humanIds: [OWNER, ZACH, "p_zoe"], threadId: "t_wider" },
      existing,
    ]);
    const answer = await t.call({ user: "Zachary", text: "Le serveur est revenu." });
    expect(answer.status).toBe(201);
    expect(answer.body).toMatchObject({ groupId: "g_pair", created: false });
    expect(t.groups).toHaveLength(2);
    expect(t.messages[0]).toMatchObject({ threadId: "t_pair", message: { role: "bot", text: "Le serveur est revenu.", from: { botId: BOT.id } } });
    expect(existing.unreadFor).toEqual([OWNER, ZACH].sort());
    expect(t.notices[0]?.audience).toEqual([ZACH, OWNER]);
    // the bot's own conversation shows where the message went
    expect(t.messages[1]).toMatchObject({ threadId: "t_main", message: { kind: "activity", comm: { groupId: "g_pair" } } });
  });

  it("creates the group when it is missing, with the bot in it and the owner as its owner", async () => {
    const t = harness([{ id: "g_dm", name: "AB et Zachary", memberIds: [], humanIds: [OWNER, ZACH], peopleDm: true, threadId: "t_dm" }]);
    const answer = await t.call({ user: "zroy", text: "Peux-tu prendre l'appel?" });
    expect(answer.status).toBe(201);
    expect(answer.body).toMatchObject({ created: true, groupName: "AB, Zachary Roy et Ember" });
    const created = t.groups.find((group) => group.id === answer.body.groupId) as MessageUserGroup & { createdBy?: string };
    expect(created).toMatchObject({ memberIds: [BOT.id], humanIds: [OWNER, ZACH], createdBy: OWNER });
    expect(t.messages[0]?.threadId).toBe(created.threadId);
  });

  it("makes one group when two calls arrive at once", async () => {
    const t = harness();
    const answers = await Promise.all([
      t.call({ user: "Zachary Roy", text: "Premier" }),
      t.call({ user: "zachary@example.test", text: "Second" }),
    ]);
    expect(t.groups).toHaveLength(1);
    expect(new Set(answers.map((answer) => answer.body.groupId))).toEqual(new Set([t.groups[0]!.id]));
    expect(answers.map((answer) => answer.body.created).sort()).toEqual([false, true]);
  });

  it("refuses a person nobody can find, and creates nothing", async () => {
    const t = harness();
    const answer = await t.call({ user: "Gaston", text: "Allô" });
    expect(answer.status).toBe(404);
    expect(answer.body).toMatchObject({ code: "unknown_person" });
    expect(String(answer.body.error)).toContain("Gaston");
    expect(t.groups).toHaveLength(0);
    expect(t.messages).toHaveLength(0);
  });

  it("asks which person when a name matches several", () => {
    expect(resolveReachablePerson("z", PEOPLE, OWNER)).toMatchObject({ ok: false, code: "ambiguous_person" });
    expect(resolveReachablePerson("ab", PEOPLE, OWNER)).toMatchObject({ ok: false, code: "self" });
  });

  it("prefers the group where this bot is the only bot", () => {
    const shared = { id: "g1", memberIds: ["b_other", BOT.id], humanIds: [ZACH, OWNER] };
    const own = { id: "g2", memberIds: [BOT.id], humanIds: [OWNER.toUpperCase(), ZACH] };
    expect(findBotPersonGroup([shared, own], BOT.id, OWNER, ZACH)?.id).toBe("g2");
    expect(findBotPersonGroup([{ ...own, archivedAt: 1 }], BOT.id, OWNER, ZACH)).toBeUndefined();
  });
});
