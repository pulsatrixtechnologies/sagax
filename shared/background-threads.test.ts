import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { backgroundOrigin, backgroundThreads, isBackgroundThread, personThreads, type BackgroundTaskFacts } from "./background-threads.ts";

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
    const all = [own, handoff, pair, self, run, results, client, hidden];

    it("off (the default) keeps them out of the list and in Show background", () => {
      expect(personThreads(all).map((task) => task.threadId)).toEqual(["own"]);
      expect(personThreads(all, undefined, { botThreads: false }).map((task) => task.threadId)).toEqual(["own"]);
      expect(backgroundThreads(all, { botThreads: false }).map((task) => task.threadId)).toEqual(["ticket", "pair", "self", "res", "client", "hidden"]);
    });

    it("on lists the threads bots opened beside the person's own, in place", () => {
      expect(personThreads(all, undefined, { botThreads: true }).map((task) => task.threadId)).toEqual(["own", "ticket", "pair", "self"]);
    });

    it("on never lists a routine run, a results thread or an AI client's conversation", () => {
      const listed = personThreads(all, undefined, { botThreads: true }).map((task) => task.threadId);
      for (const id of ["run", "res", "client", "hidden"]) expect(listed).not.toContain(id);
    });

    it("on, a listed thread is not repeated under Show background", () => {
      expect(backgroundThreads(all, { botThreads: true }).map((task) => task.threadId)).toEqual(["res", "client", "hidden"]);
    });
  });
});
