import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { backgroundOrigin, backgroundThreads, isBackgroundThread, isListedBotThread, listedRows, personThreads, type BackgroundTaskFacts } from "./background-threads.ts";

const vectors = JSON.parse(readFileSync(new URL("./background-threads.vectors.json", import.meta.url), "utf8")) as {
  cases: Array<{ name: string; task: BackgroundTaskFacts & { threadId: string }; origin: string | null; listed: boolean; background: boolean }>;
};

describe("background threads (shared vectors, also run by the phone)", () => {
  for (const item of vectors.cases) {
    it(item.name, () => {
      expect(backgroundOrigin(item.task)).toBe(item.origin);
      expect(isBackgroundThread(item.task)).toBe(item.origin !== null);
      expect(personThreads([item.task]).length === 1).toBe(item.listed);
      expect(backgroundThreads([item.task]).length === 1).toBe(item.background);
    });
  }

  it("keeps the thread on screen in the person's list, unless it is a routine run", () => {
    const work = { threadId: "work", openedBy: { botId: "m", kind: "work" } };
    const run = { threadId: "run", routineRunId: "r" };
    expect(personThreads([work, run], "work").map((task) => task.threadId)).toEqual(["work"]);
    expect(personThreads([work, run], "run")).toEqual([]);
  });

  // #5289: with "Show Bot threads" on, a thread a bot opened (a hand-off from
  // coordinate_bots, start_thread) is a row of the bot's normal thread list.
  describe("with the person's Show Bot threads choice", () => {
    const own = { threadId: "own" };
    const handoff = { threadId: "ticket", title: "#1234 - Order script", openedBy: { botId: "dispatch", name: "Dispatch", kind: "work" } };
    const pair = { threadId: "pair", openedBy: { botId: "dispatch", name: "Dispatch", kind: "pair" } };
    const self = { threadId: "self", title: "Thread Test", openedBy: { botId: "nimbus", name: "Nimbus" } };
    const run = { threadId: "run", routineRunId: "r" };
    const results = { threadId: "res", routineResults: true as const };
    const client = { threadId: "client", openedBy: { botId: "agent:acme", name: "Acme", kind: "agent" } };
    const hidden = { threadId: "hidden", hidden: true as const };
    const investigate = { threadId: "investigate", hidden: true as const, openedBy: { botId: "nimbus", name: "Nimbus", at: 1 } };
    const all = [own, handoff, pair, self, run, results, client, hidden, investigate];

    it("off (the default) keeps them out of the list and in Show background", () => {
      expect(personThreads(all).map((task) => task.threadId)).toEqual(["own"]);
      expect(personThreads(all, undefined, { botThreads: false }).map((task) => task.threadId)).toEqual(["own"]);
      expect(backgroundThreads(all, { botThreads: false }).map((task) => task.threadId)).toEqual(["ticket", "pair", "self", "res", "client", "hidden", "investigate"]);
    });

    it("on lists the threads bots opened beside the person's own, in place", () => {
      expect(personThreads(all, undefined, { botThreads: true }).map((task) => task.threadId)).toEqual(["own", "ticket", "pair", "self"]);
    });

    it("on never lists a routine run, a results thread, an AI client's conversation or a bot's hidden investigation", () => {
      const listed = personThreads(all, undefined, { botThreads: true }).map((task) => task.threadId);
      for (const id of ["run", "res", "client", "hidden", "investigate"]) expect(listed).not.toContain(id);
    });

    // The background sweep archives a finished bot thread after its idle
    // delay (server/threads/background-sweep.ts, autoArchived). With the
    // choice on that housekeeping must not fold the row away: only the
    // person's own Archive (which clears autoArchived) does.
    it("on shows a bot thread the sweep archived as an open row, never one the person archived", () => {
      const swept = { ...handoff, threadId: "swept", archivedAt: 5, autoArchived: true as const };
      const sweptSelf = { ...self, threadId: "swept-self", archivedAt: 6, autoArchived: true as const };
      const putAway = { ...handoff, threadId: "put-away", archivedAt: 7 };
      const ownSwept = { threadId: "own-archived", archivedAt: 8 };
      const sweptClient = { ...client, threadId: "swept-client", archivedAt: 9, autoArchived: true as const };
      const rows = [swept, sweptSelf, putAway, ownSwept, sweptClient];
      const archived = (list: Array<{ threadId: string; archivedAt?: number }>) => list.filter((task) => task.archivedAt !== undefined).map((task) => task.threadId);
      expect(archived(listedRows(rows, { botThreads: true }))).toEqual(["put-away", "own-archived", "swept-client"]);
      expect(archived(listedRows(rows, { botThreads: false }))).toEqual(["swept", "swept-self", "put-away", "own-archived", "swept-client"]);
      expect(listedRows(rows)).toEqual(rows);
      expect(isListedBotThread(swept, { botThreads: true })).toBe(true);
      expect(isListedBotThread(swept)).toBe(false);
      expect(isListedBotThread(own, { botThreads: true })).toBe(false);
      expect(isListedBotThread(client, { botThreads: true })).toBe(false);
    });

    it("on, a listed thread is not repeated under Show background", () => {
      expect(backgroundThreads(all, { botThreads: true }).map((task) => task.threadId)).toEqual(["res", "client", "hidden", "investigate"]);
    });
  });

  // #5289 D-20261127-040: Person-work threads lists hand-offs and bot-opened
  // threads as regular rows without turning on Show Bot threads.
  describe("with the person's Person-work threads choice", () => {
    const own = { threadId: "own" };
    const handoff = { threadId: "ticket", title: "#1234 - Order script", openedBy: { botId: "dispatch", name: "Dispatch", kind: "work" } };
    const pair = { threadId: "pair", openedBy: { botId: "dispatch", name: "Dispatch", kind: "pair" } };
    const self = { threadId: "self", title: "Thread Test", openedBy: { botId: "nimbus", name: "Nimbus" } };
    const run = { threadId: "run", routineRunId: "r" };
    const results = { threadId: "res", routineResults: true as const };
    const client = { threadId: "client", openedBy: { botId: "agent:acme", name: "Acme", kind: "agent" } };
    const hidden = { threadId: "hidden", hidden: true as const };
    const investigate = { threadId: "investigate", hidden: true as const, openedBy: { botId: "nimbus", name: "Nimbus", at: 1 } };
    const all = [own, handoff, pair, self, run, results, client, hidden, investigate];

    it("off (the default) keeps them out of the list, with Show Bot threads still off", () => {
      expect(personThreads(all, undefined, { personWorkThreads: false, botThreads: false }).map((task) => task.threadId)).toEqual(["own"]);
      expect(backgroundThreads(all, { personWorkThreads: false }).map((task) => task.threadId)).toEqual(["ticket", "pair", "self", "res", "client", "hidden", "investigate"]);
    });

    it("on lists hand-offs and bot-opened threads beside the person's own, with Show Bot threads still off", () => {
      expect(personThreads(all, undefined, { personWorkThreads: true, botThreads: false }).map((task) => task.threadId)).toEqual(["own", "ticket", "pair", "self"]);
    });

    it("on never lists a routine run, a results thread, an AI client's conversation or a bot's hidden investigation", () => {
      const listed = personThreads(all, undefined, { personWorkThreads: true }).map((task) => task.threadId);
      for (const id of ["run", "res", "client", "hidden", "investigate"]) expect(listed).not.toContain(id);
    });

    it("on shows a bot thread the sweep archived as an open row, never one the person archived", () => {
      const swept = { ...handoff, threadId: "swept", archivedAt: 5, autoArchived: true as const };
      const putAway = { ...handoff, threadId: "put-away", archivedAt: 7 };
      const ownSwept = { threadId: "own-archived", archivedAt: 8 };
      const sweptClient = { ...client, threadId: "swept-client", archivedAt: 9, autoArchived: true as const };
      const rows = [swept, putAway, ownSwept, sweptClient];
      const archived = (list: Array<{ threadId: string; archivedAt?: number }>) => list.filter((task) => task.archivedAt !== undefined).map((task) => task.threadId);
      expect(archived(listedRows(rows, { personWorkThreads: true, botThreads: false }))).toEqual(["put-away", "own-archived", "swept-client"]);
      expect(isListedBotThread(swept, { personWorkThreads: true })).toBe(true);
      expect(isListedBotThread(swept, { personWorkThreads: false, botThreads: false })).toBe(false);
      expect(isListedBotThread(client, { personWorkThreads: true })).toBe(false);
    });

    it("on, a listed thread is not repeated under Show background", () => {
      expect(backgroundThreads(all, { personWorkThreads: true, botThreads: false }).map((task) => task.threadId)).toEqual(["res", "client", "hidden", "investigate"]);
    });

    it("either choice alone is enough to list them", () => {
      expect(personThreads(all, undefined, { personWorkThreads: true }).map((task) => task.threadId)).toEqual(["own", "ticket", "pair", "self"]);
      expect(personThreads(all, undefined, { botThreads: true }).map((task) => task.threadId)).toEqual(["own", "ticket", "pair", "self"]);
    });
  });
});
