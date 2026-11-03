// Private threads (server/threads/thread-privacy.ts): a bot thread is its owner's
// only; group chats are the only conversations several people share.
import { describe, expect, it } from "vitest";

import { canInChannel, type BotFacts, type BotGrant, type SectionAccess, type TeamRef, type Viewer } from "../authz.ts";
import {
  canOnThread,
  migrationLogLine,
  narrowBotForViewer,
  ownThreads,
  planThreadOwners,
  threadOwner,
  viewerThread,
  type ThreadAction,
} from "./thread-privacy.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1); // bot owner
const BOB = pid(2); // shared at use
const CAROL = pid(3); // shared at manage
const ADMIN = pid(4); // organization admin, with a grant
const MIA = pid(5); // manager of team T, which holds a grant
const TOM = pid(6); // in team T
const GUS = pid(7); // in the group chat only

const teams: Record<string, TeamRef[]> = { [MIA]: [{ id: "T", manager: true }], [TOM]: [{ id: "T", manager: false }] };
const viewer = (id: string, patch: Partial<Viewer> = {}): Viewer => ({ principalId: id, orgAdmin: false, teams: teams[id] ?? [], disabled: false, ...patch });
const grant = (target: string, level: BotGrant["level"]): BotGrant => ({ target, level, by: ALICE, at: 1 });
const bot: BotFacts = {
  ownerPrincipalId: ALICE,
  grants: [grant(`user:${BOB}`, "use"), grant(`user:${CAROL}`, "manage"), grant(`user:${ADMIN}`, "use"), grant("team:T", "run")],
};
const ACTIONS: ThreadAction[] = ["thread.list", "thread.read", "thread.post", "thread.stream", "thread.search", "thread.attachments", "thread.answer"];
const thread = (owner?: string) => ({ ownerPrincipalId: owner });

describe("canOnThread: owner, other, admin, manager, group member", () => {
  const people: Array<[string, Viewer]> = [
    ["owner", viewer(ALICE)],
    ["shared at use", viewer(BOB)],
    ["shared at manage", viewer(CAROL)],
    ["organization admin", viewer(ADMIN, { orgAdmin: true })],
    ["team manager", viewer(MIA)],
    ["team member", viewer(TOM)],
    ["group chat member", viewer(GUS)],
  ];

  it("the owner's thread: only the owner, for every action", () => {
    for (const action of ACTIONS) {
      const allowed = people.filter(([, who]) => canOnThread(who, action, { bot, task: thread(ALICE) })).map(([name]) => name);
      expect(allowed, action).toEqual(["owner"]);
    }
  });

  it("a shared person's thread: only them, never the bot owner, an admin or a manager", () => {
    for (const action of ACTIONS) {
      expect(people.filter(([, who]) => canOnThread(who, action, { bot, task: thread(BOB) })).map(([name]) => name), action).toEqual(["shared at use"]);
      expect(people.filter(([, who]) => canOnThread(who, action, { bot, task: thread(TOM) })).map(([name]) => name), action).toEqual(["team member"]);
    }
  });

  it("a thread from before the rule is the bot owner's", () => {
    expect(threadOwner(undefined, ALICE)).toBe(ALICE);
    expect(threadOwner(thread(""), ALICE)).toBe(ALICE);
    expect(canOnThread(viewer(BOB), "thread.read", { bot, task: undefined })).toBe(false);
    expect(canOnThread(viewer(ALICE), "thread.read", { bot, task: undefined })).toBe(true);
  });

  it("losing bot.use, or being disabled, closes even your own thread", () => {
    const revoked: BotFacts = { ...bot, grants: bot.grants.filter((entry) => entry.target !== `user:${BOB}`) };
    expect(canOnThread(viewer(BOB), "thread.read", { bot: revoked, task: thread(BOB) })).toBe(false);
    expect(canOnThread(viewer(BOB, { disabled: true }), "thread.read", { bot, task: thread(BOB) })).toBe(false);
  });

  it("the operator at this computer (no viewer) is unfiltered, as everywhere in authz", () => {
    expect(canOnThread(undefined, "thread.read", { bot, task: thread(BOB) })).toBe(true);
  });

  it("ids compare without case or spaces", () => {
    expect(canOnThread(viewer(BOB.toUpperCase()), "thread.post", { bot, task: thread(` ${BOB} `) })).toBe(true);
  });

  it("a group chat is shared by its people, whatever they hold on its bots", () => {
    const room = { humanIds: [ALICE, BOB, GUS] };
    for (const id of [ALICE, BOB, GUS]) {
      expect(canInChannel(viewer(id), "channel.read", room), id).toBe(true);
      expect(canInChannel(viewer(id), "channel.post", room), id).toBe(true);
    }
    for (const id of [CAROL, MIA, TOM]) expect(canInChannel(viewer(id), "channel.read", room), id).toBe(false);
    // an admin reads a group chat only as one of its people
    expect(canInChannel(viewer(ADMIN, { orgAdmin: true }), "channel.read", room)).toBe(false);
    // a person removed from the group loses it at once
    expect(canInChannel(viewer(GUS), "channel.read", { humanIds: [ALICE, BOB] })).toBe(false);
    // a read-only section member reads but does not post
    const section: SectionAccess = { members: [{ target: `user:${GUS}`, role: "readonly" }], defaultLevel: "use" };
    expect(canInChannel(viewer(GUS), "channel.read", { humanIds: [], section })).toBe(true);
    expect(canInChannel(viewer(GUS), "channel.post", { humanIds: [], section })).toBe(false);
  });
});

describe("listing and landing", () => {
  const tasks = [
    { threadId: "a1", ownerPrincipalId: ALICE, createdAt: 1, updatedAt: 10 },
    { threadId: "b1", ownerPrincipalId: BOB, createdAt: 2, updatedAt: 5 },
    { threadId: "b2", ownerPrincipalId: BOB, createdAt: 3, updatedAt: 20 },
    { threadId: "b3", ownerPrincipalId: BOB, createdAt: 4, updatedAt: 99, archivedAt: 50 },
    { threadId: "old", createdAt: 0, updatedAt: 1 },
  ];

  it("lists each person's own threads; an unowned one is the bot owner's", () => {
    expect(ownThreads(tasks, BOB, ALICE).map((task) => task.threadId)).toEqual(["b1", "b2", "b3"]);
    expect(ownThreads(tasks, ALICE, ALICE).map((task) => task.threadId)).toEqual(["a1", "old"]);
    expect(ownThreads(tasks, GUS, ALICE)).toEqual([]);
  });

  it("lands on the chosen thread, else the bot's own when it is theirs, else their newest open one", () => {
    expect(viewerThread({ tasks, viewerId: BOB, botOwnerPrincipalId: ALICE, selected: "b1", current: "a1" })).toBe("b1");
    expect(viewerThread({ tasks, viewerId: BOB, botOwnerPrincipalId: ALICE, selected: "a1", current: "a1" })).toBe("b2");
    expect(viewerThread({ tasks, viewerId: BOB, botOwnerPrincipalId: ALICE, current: "b1" })).toBe("b1");
    expect(viewerThread({ tasks, viewerId: ALICE, botOwnerPrincipalId: ALICE, current: "a1" })).toBe("a1");
    expect(viewerThread({ tasks, viewerId: GUS, botOwnerPrincipalId: ALICE, current: "a1" })).toBeUndefined();
  });

  it("never lands on an outside agent's conversation with the bot (2026-10-29), even the newest", () => {
    const agent = { threadId: "g1", ownerPrincipalId: GUS, createdAt: 5, updatedAt: 500, openedBy: { botId: "agent:voice", name: "Voice", kind: "agent", at: 5 } };
    expect(viewerThread({ tasks: [...tasks, agent], viewerId: GUS, botOwnerPrincipalId: ALICE, current: "a1" })).toBeUndefined();
    const own = { threadId: "g0", ownerPrincipalId: GUS, createdAt: 1, updatedAt: 2 };
    expect(viewerThread({ tasks: [...tasks, agent, own], viewerId: GUS, botOwnerPrincipalId: ALICE, current: "a1" })).toBe("g0");
  });

  it("picks the newest open thread without sorting the whole list (#1750)", () => {
    const many = Array.from({ length: 5_000 }, (_, i) => ({
      threadId: `t${i}`,
      ownerPrincipalId: BOB,
      createdAt: i,
      updatedAt: i === 4_200 ? 50_000 : i,
      ...(i % 17 === 0 ? { archivedAt: i } : {}),
      ...(i % 23 === 0 ? { routineRunId: `r${i}` } : {}),
    }));
    const started = performance.now();
    let last: string | undefined;
    for (let n = 0; n < 200; n++) {
      last = viewerThread({ tasks: many, viewerId: BOB, botOwnerPrincipalId: ALICE });
    }
    const elapsed = performance.now() - started;
    expect(last).toBe("t4200");
    // 200 passes over 5k threads must stay well under a blocking second.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("narrowBotForViewer", () => {
  const wire = {
    id: "bot1",
    threadId: "a1",
    busy: true,
    activity: "thinking",
    approvalMode: "full",
    messages: [{ id: "m1", text: "alice's secret" }],
    activeLeafId: "m1",
    hasMore: false,
    tasks: [
      { threadId: "a1", ownerPrincipalId: ALICE, title: "Alice's plans" },
      { threadId: "b1", ownerPrincipalId: BOB, title: "Bob's draft" },
    ],
  };

  it("keeps the owner's view as it is", () => {
    const own = narrowBotForViewer(wire, { viewerId: ALICE, botOwnerPrincipalId: ALICE, mine: "a1" });
    expect(own.tasks.map((task) => task.threadId)).toEqual(["a1"]);
    expect(own.messages).toEqual(wire.messages);
  });

  it("gives another person their thread, their settings, and never the transcript or title of someone else's", () => {
    const bobs = narrowBotForViewer(wire, {
      viewerId: BOB, botOwnerPrincipalId: ALICE, mine: "b1",
      mineTask: { threadId: "b1", approvalMode: "ask", busy: false, activity: "idle" },
    });
    expect(bobs.threadId).toBe("b1");
    expect(bobs.tasks.map((task) => task.threadId)).toEqual(["b1"]);
    expect(bobs).not.toHaveProperty("messages");
    expect(bobs).not.toHaveProperty("activeLeafId");
    expect(bobs.approvalMode).toBe("ask");
    expect(bobs.busy).toBe(false);
    expect(JSON.stringify(bobs)).not.toContain("alice's secret");
    expect(JSON.stringify(bobs)).not.toContain("Alice's plans");
  });

  it("reads busy over the viewer's own threads, not only the one shown, and never over someone else's", () => {
    // alice's routine works in another of her threads: her bot reads busy
    const alices = narrowBotForViewer(wire, {
      viewerId: ALICE, botOwnerPrincipalId: ALICE, mine: "a1",
      activity: { activity: "working", busy: true },
    });
    expect(alices.busy).toBe(true);
    expect(alices.activity).toBe("working");
    // bob's own threads are idle while alice's thread works
    const bobs = narrowBotForViewer(wire, {
      viewerId: BOB, botOwnerPrincipalId: ALICE, mine: "b1",
      mineTask: { threadId: "b1", busy: false, activity: "idle" },
      activity: { activity: "idle", busy: false },
    });
    expect(bobs.busy).toBe(false);
    expect(bobs.activity).toBe("idle");
  });

  it("someone with no thread yet gets none, and nothing of others'", () => {
    const none = narrowBotForViewer(wire, { viewerId: GUS, botOwnerPrincipalId: ALICE });
    expect(none.threadId).toBe("");
    expect(none.tasks).toEqual([]);
    expect(none.busy).toBe(false);
    expect(JSON.stringify(none)).not.toContain("a1");
  });

  it("2026-10-17: the thread a viewer is given is always in their tasks (an opened hidden thread)", () => {
    // bob opened his AI client's hidden thread: the wire list left it out
    const bobs = narrowBotForViewer(wire, {
      viewerId: BOB, botOwnerPrincipalId: ALICE, mine: "h1",
      // mineTask carries the projected bot: every person's threads, never sent
      mineTask: { threadId: "h1", ownerPrincipalId: BOB, hidden: true, busy: false, activity: "idle", tasks: wire.tasks, mcpAccounts: { x: "secret-account" } },
      mineWireTask: { threadId: "h1", ownerPrincipalId: BOB, hidden: true },
    });
    expect(bobs.threadId).toBe("h1");
    expect(bobs.tasks.map((task) => task.threadId)).toEqual(["b1", "h1"]);
    expect(bobs.tasks.at(-1)).toEqual({ threadId: "h1", ownerPrincipalId: BOB, hidden: true });
    expect(JSON.stringify(bobs)).not.toContain("Alice's plans");
    expect(JSON.stringify(bobs)).not.toContain("secret-account");
    // without a wire task nothing is added (mineTask alone never is)
    const bare = narrowBotForViewer(wire, {
      viewerId: BOB, botOwnerPrincipalId: ALICE, mine: "h1",
      mineTask: { threadId: "h1", ownerPrincipalId: BOB, tasks: wire.tasks },
    });
    expect(bare.tasks.map((task) => task.threadId)).toEqual(["b1"]);
    expect(JSON.stringify(bare)).not.toContain("Alice's plans");
    // the owner's view of their own hidden thread too
    const alices = narrowBotForViewer({ ...wire, threadId: "h2" }, {
      viewerId: ALICE, botOwnerPrincipalId: ALICE, mine: "h2",
      mineWireTask: { threadId: "h2", ownerPrincipalId: ALICE, hidden: true },
    });
    expect(alices.tasks.map((task) => task.threadId)).toEqual(["a1", "h2"]);
    // never a record that is not the viewer's, nor one for another thread
    const forged = narrowBotForViewer(wire, {
      viewerId: BOB, botOwnerPrincipalId: ALICE, mine: "x1",
      mineWireTask: { threadId: "x1", ownerPrincipalId: ALICE, title: "Alice's other" },
    });
    expect(forged.tasks.map((task) => task.threadId)).toEqual(["b1"]);
    expect(JSON.stringify(forged)).not.toContain("Alice's other");
    const mismatched = narrowBotForViewer(wire, {
      viewerId: BOB, botOwnerPrincipalId: ALICE, mine: "y1",
      mineWireTask: { threadId: "b1", ownerPrincipalId: BOB },
    });
    expect(mismatched.tasks.map((task) => task.threadId)).toEqual(["b1"]);
  });

  it("a frame without tasks keeps its transcript only when the thread is the viewer's", () => {
    const frame = { id: "bot1", threadId: "b1", messages: [{ id: "x", text: "bob's words" }] };
    expect(narrowBotForViewer(frame, { viewerId: BOB, botOwnerPrincipalId: ALICE, mine: "b1" })).toBe(frame);
    const alicesView = narrowBotForViewer(frame, { viewerId: ALICE, botOwnerPrincipalId: ALICE, mine: "a1" });
    expect(alicesView.threadId).toBe("a1");
    expect(alicesView).not.toHaveProperty("messages");
  });
});

describe("migration", () => {
  const senders: Record<string, string[]> = {
    solo: [BOB, BOB],
    mixed: [BOB, ALICE, CAROL],
    later: ["p_legacyhashlegacyhash00", CAROL],
    none: [],
    routine: [BOB],
  };
  const isPrincipal = (id: string) => id.startsWith("pr_");

  it("gives each unowned thread its creator, else the bot owner, and counts the mixed ones", () => {
    const plan = planThreadOwners([
      {
        id: "bot1", ownerPrincipalId: ALICE, tasks: [
          { threadId: "solo" }, { threadId: "mixed" }, { threadId: "later" }, { threadId: "none" },
          { threadId: "routine", routineRunId: "run1" }, { threadId: "kept", ownerPrincipalId: CAROL },
        ],
      },
    ], (id) => senders[id] ?? [], isPrincipal);
    expect(plan.assignments.map((entry) => [entry.threadId, entry.ownerPrincipalId, entry.source])).toEqual([
      ["solo", BOB, "creator"],
      ["mixed", BOB, "creator"],
      ["later", CAROL, "creator"],
      ["none", ALICE, "bot_owner"],
      ["routine", ALICE, "bot_owner"],
    ]);
    expect(plan.report).toEqual({ threads: 6, toCreator: 3, toBotOwner: 2, mixed: 1, alreadyOwned: 1 });
    const line = migrationLogLine(plan.report);
    expect(line).toBe("[private-threads] migration: 6 bot thread(s), 3 assigned to their creator, 2 to the bot owner, 1 mixed thread(s) now private to their creator, 1 already owned");
    expect(line).not.toContain("pr_");
  });

  it("is idempotent: a second pass over migrated threads assigns nothing", () => {
    const plan = planThreadOwners([{ id: "bot1", ownerPrincipalId: ALICE, tasks: [{ threadId: "solo", ownerPrincipalId: BOB }] }], () => [ALICE], isPrincipal);
    expect(plan.assignments).toEqual([]);
    expect(plan.report.alreadyOwned).toBe(1);
  });
});
