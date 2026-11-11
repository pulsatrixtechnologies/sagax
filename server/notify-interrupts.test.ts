import { afterEach, describe, expect, it, vi } from "vitest";

import type { Notification, NotifyKind } from "../shared/notification.ts";
import { NOTIFY_KIND_INTERRUPTS, notificationInterrupts, notifyLogLine, ruleNotifyFrame } from "./notify.ts";
import { markShuttingDown, resetShuttingDownForTests } from "./process/http-shutdown.ts";

// #3719: a notification interrupts (sound, banner, bounce, push) only when
// the person has something to do or asked to be told, or it answers a line
// the person wrote in that conversation. Everything else is kept silent: in
// the chat, Today and the badge, never a sound.

const note = (kind: NotifyKind, extra: Partial<Notification> = {}): Notification =>
  ({ kind, botId: "bot-1", botName: "Nova", threadId: "thread-1", title: "Title words", body: "Body words", ...extra });

const ASKS: NotifyKind[] = ["approval", "question", "sign-in", "takeover", "needs-you", "proposal", "wait", "admin-action", "report", "page-comment"];
const ANSWERS: NotifyKind[] = ["done", "turn-failed"];
const QUIET: NotifyKind[] = ["routine-failed", "routine-deferred", "incident", "delegation-settled", "notice", "spend"];

afterEach(() => { resetShuttingDownForTests(); vi.restoreAllMocks(); });

describe("which notification interrupts (#3719)", () => {
  it.each(ASKS)("%s interrupts whoever started the turn", (kind) => {
    expect(notificationInterrupts(note(kind))).toBe(true);
    expect(notificationInterrupts(note(kind, { personTurn: true }))).toBe(true);
  });

  it.each(ANSWERS)("%s interrupts only as the answer to the person's own line", (kind) => {
    expect(notificationInterrupts(note(kind))).toBe(false);
    expect(notificationInterrupts(note(kind, { personTurn: true }))).toBe(true);
  });

  it.each(QUIET)("%s never interrupts, even in a turn the person started", (kind) => {
    expect(notificationInterrupts(note(kind))).toBe(false);
    expect(notificationInterrupts(note(kind, { personTurn: true }))).toBe(false);
  });

  it("a person's direct message interrupts; a bot's message only answers the person's line", () => {
    expect(notificationInterrupts(note("message", { botId: "" }))).toBe(true);
    expect(notificationInterrupts(note("message"))).toBe(false);
    expect(notificationInterrupts(note("message", { personTurn: true }))).toBe(true);
  });

  it("a message the bot wrote with notify false stays silent, whatever its kind", () => {
    expect(notificationInterrupts(note("question", { notify: false }))).toBe(false);
  });

  it("every kind is classified (a new kind must say whether it is an ask)", () => {
    for (const kind of [...ASKS, ...ANSWERS, ...QUIET, "message"] as NotifyKind[]) expect(NOTIFY_KIND_INTERRUPTS[kind]).toBeDefined();
    expect(Object.keys(NOTIFY_KIND_INTERRUPTS).sort()).toEqual([...ASKS, ...ANSWERS, ...QUIET, "message"].sort());
  });
});

describe("a restart announces nothing (#3719)", () => {
  it("while the server stops, a cut turn's end or failure is silent even for the person's own line", () => {
    markShuttingDown();
    expect(notificationInterrupts(note("done", { personTurn: true }))).toBe(false);
    expect(notificationInterrupts(note("turn-failed", { personTurn: true }))).toBe(false);
  });

  it("an ask still reaches the person while the server stops", () => {
    markShuttingDown();
    expect(notificationInterrupts(note("approval"))).toBe(true);
  });
});

describe("the notify frame on the wire (#3719)", () => {
  it("a silent event keeps its frame, marked notify false, so the chat and badge keep it", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const frame = ruleNotifyFrame({ kind: "notify", notification: note("routine-failed") });
    expect((frame.notification as Notification).notify).toBe(false);
    expect((frame.notification as Notification).body).toBe("Body words");
  });

  it("an interrupting event goes as it was, without the server-only marker", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const frame = ruleNotifyFrame({ kind: "notify", notification: note("done", { personTurn: true }) });
    expect((frame.notification as Notification).notify).toBeUndefined();
    expect((frame.notification as Notification).personTurn).toBeUndefined();
  });

  it("writes one log line per notification, with ids and audience, never its words", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { lines.push(line); });
    ruleNotifyFrame({ kind: "notify", notification: note("approval", { audience: ["a", "b"] }) });
    ruleNotifyFrame({ kind: "notify", notification: note("incident") }, { adminOnly: true });
    expect(lines).toEqual([
      "[notify] kind=approval bot=bot-1 thread=thread-1 audience=2 interrupts=yes",
      "[notify] kind=incident bot=bot-1 thread=thread-1 audience=admins interrupts=no",
    ]);
    for (const line of lines) expect(line).not.toMatch(/Title words|Body words|Nova/);
  });

  it("the log line names an unset audience as everyone who sees the bot", () => {
    expect(notifyLogLine(note("question", { botId: "", threadId: "" }), {}, true)).toBe("[notify] kind=question bot=- thread=- audience=all interrupts=yes");
  });

  it("leaves every other frame alone", () => {
    const frame = { kind: "message", threadId: "t" };
    expect(ruleNotifyFrame(frame)).toBe(frame);
  });
});
