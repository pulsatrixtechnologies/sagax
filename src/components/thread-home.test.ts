import { describe, expect, it } from "vitest";
import type { Bot, Task } from "@/state/store";
import { isUntouchedThread, latestConversation, openBotConversationActions, threadsOffOpenTarget, threadsOffReturnTarget } from "./thread-home";

const main: Task = { threadId: "main", title: "Main", createdAt: 2, updatedAt: 50 };
const older: Task = { threadId: "older", title: "Older", createdAt: 1, updatedAt: 10 };
const extra: Task = { threadId: "extra", title: "Untitled", createdAt: 60, updatedAt: 60 };
const bot = (threadId: string, tasks: Task[], messages: Bot["messages"] = []) => ({ id: "vega", threadId, tasks, messages });

describe("thread home while threads are hidden", () => {
  it("treats a thread as untouched only while nothing was written and nothing runs", () => {
    expect(isUntouchedThread(extra)).toBe(true);
    expect(isUntouchedThread({ ...extra, updatedAt: undefined })).toBe(false);
    expect(isUntouchedThread(main)).toBe(false);
    expect(isUntouchedThread({ ...extra, busy: true })).toBe(false);
    expect(isUntouchedThread({ ...extra, activity: "waiting-on-you" })).toBe(false);
    expect(isUntouchedThread({ ...extra, unread: true })).toBe(false);
    expect(isUntouchedThread(extra, bot("extra", [extra], [{ id: "m", role: "user", text: "hi", at: 60 } as Bot["messages"][number]]))).toBe(false);
  });

  it("finds the latest conversation with content, routine runs excluded", () => {
    expect(latestConversation(bot("extra", [older, main, extra, { threadId: "run", title: "Run", createdAt: 3, updatedAt: 99, routineRunId: "r" }]))).toBe("main");
    expect(latestConversation(bot("extra", [extra]))).toBeUndefined();
  });

  it("opens the newest topic of the single stream from an earlier one", () => {
    expect(threadsOffOpenTarget(bot("older", [older, main]))).toBe("main");
    expect(openBotConversationActions(bot("older", [older, main]), false)).toEqual([
      { type: "select", id: "vega" },
      { type: "switchTask", botId: "vega", threadId: "main" },
      // coming back to a topic quiet for ages (stamps from 1970): a fresh
      // topic over it (src/lib/fresh-topic.ts)
      { type: "freshTopic", botId: "vega", threadId: "main", auto: true },
    ]);
    expect(threadsOffReturnTarget(bot("older", [older, main]))).toBe("main");
    // a topic written in a moment ago stays as it is
    const recent = { ...main, updatedAt: Date.now() };
    // (an asked-for New chat over it stays, 2026-11-02)
    expect(openBotConversationActions(bot("older", [older, recent]), false).at(-1)).toEqual({ type: "freshTopic", botId: "vega", threadId: null, keepAsked: true });
  });

  // 2026-10-28: the newest topic is the conversation on every device, empty
  // or not (shared/single-stream.ts): the timeline above it is drawn from
  // the earlier topics, so an empty one never strands anybody.
  it("opens at the newest topic, started here or left by another device", () => {
    // selected: the fresh topic is the end of the stream
    expect(threadsOffOpenTarget(bot("extra", [main, older, extra]))).toBeUndefined();
    // another device left it: still the end of the stream
    expect(threadsOffOpenTarget(bot("older", [main, older, extra]))).toBe("extra");
    expect(threadsOffReturnTarget(bot("older", [main, older, extra]))).toBe("extra");
  });

  it("keeps the older rule for threads outside the stream", () => {
    const job: Task = { threadId: "job", title: "Job", createdAt: 3, updatedAt: 40, openedBy: { botId: "x", name: "X", at: 3 } };
    expect(threadsOffOpenTarget(bot("job", [job]))).toBeUndefined();
    expect(threadsOffReturnTarget(bot("job", [main, job]))).toBe("main");
  });

  it("leaves the threads-on row alone and never offers a return when already home", () => {
    expect(openBotConversationActions(bot("extra", [main, extra]), true)).toEqual([{ type: "select", id: "vega" }]);
    expect(threadsOffReturnTarget(bot("main", [main, older]))).toBeUndefined();
    expect(threadsOffOpenTarget(bot("extra", [extra]))).toBeUndefined();
    expect(threadsOffOpenTarget({ threadId: "solo" })).toBeUndefined();
  });
});
