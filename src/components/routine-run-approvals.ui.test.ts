// 2026-11-04 (a person: approval cards of a routine run only on the phone,
// none on the desktop). The phone's dock reads every waiting task; the
// desktop chat's approval box read only the open conversation, its parallel
// tasks and the bot-to-bot ones. A routine run's hidden task that waits on
// the person now joins the bot's conversation box, named by the run, and
// its answer goes to the run's own thread.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/org-engine-readiness", () => ({
  usePersonEngineReadiness: () => ({ organization: false, state: "ready", adminNames: [] }),
  openOrgEngineSetup: vi.fn(),
}));

import { setLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import { approvalSources, parallelPendings, routineRunsWaiting } from "./parallel-approvals";
import { PendingApprovalPanel } from "./PendingApproval";

afterEach(() => setLocale("en"));

const card = (id: string): Message => ({
  id, role: "bot", kind: "options", at: 1,
  card: { title: "Approval needed", subtitle: "https://example.com/report", options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "WebFetch" },
}) as never;

const bot = {
  threadId: "main",
  tasks: [
    // a run of the person's own routine, waiting on their Allow
    { threadId: "run-own", title: "Morning sweep · Nov 4, 9:00 AM", routineRunId: "run-1", activity: "waiting-on-you", updatedAt: 7 },
    // a run still working, and one finished: nothing to answer
    { threadId: "run-busy", title: "Hourly check", routineRunId: "run-2", activity: "working" },
    { threadId: "run-done", title: "Weekly report", routineRunId: "run-3", activity: "idle" },
    // a parallel task of the open conversation stays first
    { threadId: "par", title: "Draft", activity: "waiting-on-you", parallelOf: { threadId: "main", messageId: "m", at: 1 } },
  ],
  waitingApprovals: [{ threadId: "run-own", openedByName: "Mira" }, { threadId: "work", openedByName: "Mira", updatedAt: 5 }],
} as never as Bot;

describe("a routine run's cards in the bot's conversation", () => {
  it("joins the open conversation's box after its parallel tasks, before the bot-to-bot ones, once each", () => {
    expect(routineRunsWaiting(bot).map((task) => task.threadId)).toEqual(["run-own"]);
    expect(approvalSources(bot)).toEqual([
      { threadId: "par", title: "Draft", stamp: 0 },
      { threadId: "run-own", title: "Morning sweep · Nov 4, 9:00 AM", stamp: 7 },
      { threadId: "work", askedBy: "Mira", stamp: 5 },
    ]);
    // with threads hidden (one conversation) too
    expect(approvalSources(bot, true).map((source) => source.threadId)).toContain("run-own");
    expect(approvalSources({ threadId: "main", tasks: [] } as never)).toEqual([]);
  });

  it("names the run on the card and answers in the run's own thread", () => {
    const [pending] = parallelPendings([card("a")], { threadId: "run-own", title: "Morning sweep · Nov 4, 9:00 AM" });
    expect(pending).toMatchObject({ threadId: "run-own", requestId: "req-a", parallelTitle: "Morning sweep · Nov 4, 9:00 AM" });
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, bot: { id: "b", name: "Scout" } as never }));
    expect(html).toContain("Morning sweep");
  });
});
