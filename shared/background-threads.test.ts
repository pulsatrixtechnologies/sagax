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
});
