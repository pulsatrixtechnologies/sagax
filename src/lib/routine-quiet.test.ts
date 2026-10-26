// Routine runs work in the background (JC 2026-10-22): a run that ends with
// nothing to report leaves no unread dot and no sidebar change on this
// client; Automations > Logs still lists it, as "Nothing to report".
import { describe, expect, it } from "vitest";

import { botShowsUnread, taskHiddenFromSidebar } from "@/lib/bot-unread";
import { streamHomeThread } from "@/lib/single-stream";
import { sidebarBotActivityTasks, threadsWhenTreeHidden } from "@/components/SidebarBotActivity";
import { routineRunLabel } from "@/lib/routine-display";
import { routineRunMatchesStatus, type RoutineRun } from "@/lib/routines";
import { initialState, reducer, type Bot } from "@/state/store";

const quiet: RoutineRun = {
  id: "run-quiet", routineId: "acme-invoices", routineName: "[Finance] Acme invoices without PO", target: "bot",
  botId: "scout", runOn: "maus", scheduledFor: 1, status: "completed", quiet: true, manual: false, createdAt: 1,
  threadId: "execution", output: "October 22 is outside days 1-5.",
};

const bot = {
  id: "scout", name: "Scout", threadId: "main",
  tasks: [
    { threadId: "main", title: "Scout", createdAt: 1, updatedAt: 5, unread: false },
    // the run's own task, as the server leaves it after a quiet run
    { threadId: "execution", title: "Acme invoices without PO · Oct 22, 8:40 AM", createdAt: 6, updatedAt: 9, routineRunId: "run-quiet", unread: false },
  ],
} as unknown as Bot;

describe("a quiet routine run on the client", () => {
  it("its frame changes the run list only: no bot, task or message is touched", () => {
    const before = { ...initialState, bots: [bot] };
    const after = reducer(before, { type: "routineRunPatched", run: quiet });
    expect(after.routineRuns).toContainEqual(quiet);
    expect(after.bots).toBe(before.bots);
    expect(after.groups).toBe(before.groups);
    expect(after.selectedId).toBe(before.selectedId);
  });

  it("lights no unread dot and adds no sidebar row", () => {
    expect(botShowsUnread(bot)).toBe(false);
    const rows = (bot.tasks ?? []).filter((task) => !taskHiddenFromSidebar(task, bot.id));
    expect(rows.map((task) => task.threadId)).toEqual(["main"]);
    // even a dot left on the run's own task never shows (an older server)
    const legacy = { ...bot, tasks: [bot.tasks![0]!, { ...bot.tasks![1]!, unread: true }] } as Bot;
    expect(botShowsUnread(legacy)).toBe(false);
  });

  it("reads as Nothing to report in the logs, under that filter, not under Completed", () => {
    expect(routineRunLabel(quiet)).toBe("Nothing to report");
    expect(routineRunMatchesStatus(quiet, "nothing_to_report")).toBe(true);
    expect(routineRunMatchesStatus(quiet, "completed")).toBe(false);
    expect(routineRunMatchesStatus(quiet, "all")).toBe(true);
    const reported = { ...quiet, quiet: undefined };
    expect(routineRunLabel(reported)).toBe("Completed");
    expect(routineRunMatchesStatus(reported, "completed")).toBe(true);
    expect(routineRunMatchesStatus({ ...quiet, status: "failed", quiet: undefined }, "problems")).toBe(true);
  });
});

// JC 2026-10-22: "I am not in thread mode, everything should be unified in a
// single chat page." An automatic "<routine> · Results" thread (routineResults)
// is no row under the bot, no dot, no preview, never the chat's home.
describe("a routine results thread with threads hidden", () => {
  const katarina = {
    id: "katarina", name: "Katarina", threadId: "chat",
    tasks: [
      { threadId: "chat", title: "Katarina", createdAt: 1, updatedAt: 5 },
      { threadId: "results", title: "[Finance] Acme invoices without PO · Results", createdAt: 7, updatedAt: 9, unread: true, routineResults: true },
    ],
  } as unknown as Bot;

  it("is not listed under the bot and lights no dot", () => {
    expect(sidebarBotActivityTasks(katarina, {}).map((task) => task.threadId)).toEqual([]);
    expect(taskHiddenFromSidebar(katarina.tasks![1]!, katarina.id)).toBe(true);
    expect(botShowsUnread(katarina)).toBe(false);
  });

  it("never becomes the single chat the bot opens to (its preview)", () => {
    expect(streamHomeThread(katarina.tasks, "chat")).toBe("chat");
  });

  it("stays out of the threads-hidden activity list even when pinned", () => {
    const pinned = {
      ...katarina,
      tasks: [katarina.tasks![0]!, { ...katarina.tasks![1]!, pinned: true as const, unread: false }],
    } as Bot;
    expect(threadsWhenTreeHidden(pinned, {}).map((task) => task.threadId)).toEqual([]);
  });
});
