import { describe, expect, it } from "vitest";

import { mainThread, oldestThread, wasOldestThread } from "./main-thread.ts";

const first = { threadId: "first", createdAt: 1 };
const later = { threadId: "later", createdAt: 2 };
const latest = { threadId: "latest", createdAt: 3 };

// 2026-10-28: the main thread is the person's one conversation
// (shared/single-stream.ts): its newest open segment, the same answer the
// desktop and the phone give, whatever was written in last or selected.
describe("a bot's main thread", () => {
  it("is the newest open conversation, wherever the selection is and whoever wrote last", () => {
    const tasks = [{ ...latest, askedAt: 10 }, { ...later, askedAt: 30 }, { ...first, askedAt: 20 }];
    expect(mainThread(tasks, "first")).toBe("latest");
    expect(mainThread(tasks)).toBe("latest");
  });

  it("is never a routine run, a results, hidden, confidential, parallel, bot-opened or archived thread, however recently written in", () => {
    const tasks = [
      { ...latest, askedAt: 50, routineRunId: "run" },
      { ...later, askedAt: 40, archivedAt: 41 },
      { ...first, askedAt: 10 },
    ];
    expect(mainThread(tasks, "later")).toBe("first");
    expect(mainThread([{ threadId: "job", createdAt: 9, openedBy: { botId: "b", name: "B", at: 1 } }, first])).toBe("first");
    expect(mainThread([{ threadId: "par", createdAt: 9, parallelOf: { threadId: "first" } }, first])).toBe("first");
    expect(mainThread([{ threadId: "hidden", createdAt: 9, hidden: true as const }, first])).toBe("first");
    expect(mainThread([{ threadId: "results", createdAt: 9, routineResults: true as const }, first])).toBe("first");
  });

  it("ignores the selection: the selection follows the conversation, never the reverse", () => {
    expect(mainThread([latest, later, first], "later")).toBe("latest");
    expect(mainThread([latest, { ...later, archivedAt: 5 }, first], "later")).toBe("latest");
    expect(mainThread([{ ...latest, routineRunId: "run" }, later, first], "latest")).toBe("later");
    expect(mainThread([latest, later, first], "deleted")).toBe("latest");
  });

  it("is nothing when every thread is archived or none is a conversation: one is started for the person then", () => {
    expect(mainThread([{ ...latest, archivedAt: 9, askedAt: 9 }, { ...later, archivedAt: 8 }], "latest")).toBeUndefined();
    expect(mainThread([{ ...first, routineRunId: "run" }])).toBeUndefined();
    expect(mainThread([])).toBeUndefined();
  });
});

describe("the oldest thread", () => {
  it("is the oldest open conversation, else the oldest archived one, never a routine run", () => {
    expect(oldestThread([latest, later, first])).toBe("first");
    expect(oldestThread([latest, { ...later, archivedAt: 5 }, { ...first, archivedAt: 4 }])).toBe("latest");
    expect(oldestThread([{ ...later, archivedAt: 5 }, { ...first, archivedAt: 4 }])).toBe("first");
    expect(oldestThread([{ ...first, routineRunId: "run" }, later])).toBe("later");
    expect(oldestThread([])).toBeUndefined();
  });
});

describe("a thread v0.1.98 to v0.1.107 may have saved on a routine", () => {
  it("is one no open thread is older than, archived since or not", () => {
    expect(wasOldestThread([latest, later, first], "first")).toBe(true);
    expect(wasOldestThread([latest, later, first], "later")).toBe(false);
    expect(wasOldestThread([latest, { ...first, archivedAt: 5 }], "first")).toBe(true);
    expect(wasOldestThread([{ ...first, routineRunId: "run" }, later], "first")).toBe(false);
    expect(wasOldestThread([later], "gone")).toBe(false);
  });
});
