// @vitest-environment happy-dom
// 2026-11-04 (a person: a routine run's approval only on the phone). On the
// desktop the approval notification of a run's hidden task is shown even
// with the app in front (the run's thread is never the one on screen), its
// click opens the run's sheet (where the card is answered), and the
// Approvals dot of the profile row counts the run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { showNotification, type NotifyFrame } from "./notify";
import { waitingOnPersonCount } from "./bot-unread";
import { openNotificationTarget, visibleNotificationThread } from "@/state/store/model";

const shown: Array<{ title: string; body?: string; onclick: (() => void) | null }> = [];
class FixtureNotification {
  static permission = "granted";
  onclick: (() => void) | null = null;
  constructor(readonly title: string, options?: { body?: string }) { shown.push(Object.assign(this, { body: options?.body })); }
}

const bots = [
  { id: "scout", threadId: "main", hidden: false, tasks: [
    { threadId: "main", activity: "idle" },
    { threadId: "run-thread", routineRunId: "run-1", activity: "waiting-on-you" },
  ] },
  { id: "other", threadId: "other-main", tasks: [{ threadId: "other-main", activity: "waiting-on-you" }] },
  { id: "gone", threadId: "gone-main", hidden: true, tasks: [{ threadId: "gone-main", activity: "waiting-on-you" }] },
];
const state = {
  bots, groups: [], activeView: "chat", selectedId: "scout",
  routineRuns: [{ id: "run-1", routineId: "r1", botId: "scout", status: "waiting", threadId: "run-thread" }],
} as never;

beforeEach(() => {
  shown.length = 0;
  vi.stubGlobal("Notification", FixtureNotification);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a routine run's approval on the desktop", () => {
  it("is shown while the person reads the bot's chat, and its click opens the run's sheet", () => {
    const frame = { kind: "approval", botId: "scout", botName: "Scout", threadId: "run-thread", requestId: "req-1", title: "Allow Scout to fetch a web page?", body: "https://example.com/report" } as NotifyFrame;
    const opened: unknown[] = [];
    showNotification(frame, (target) => openNotificationTarget((action) => opened.push(action), target, state, true), null, visibleNotificationThread(state));
    expect(shown).toHaveLength(1);
    // native notifications (#2120): the title is the bot's name, the body the preview
    expect(shown[0]).toMatchObject({ title: "Scout", body: "https://example.com/report" });
    shown[0]!.onclick?.();
    expect(opened).toContainEqual(expect.objectContaining({ type: "openRoutineRunWindow", runId: "run-1" }));
  });

  it("counts on the Approvals dot with the other waiting conversations of visible bots", () => {
    expect(waitingOnPersonCount(bots)).toBe(2);
  });
});
