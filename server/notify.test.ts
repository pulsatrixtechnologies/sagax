// What is worth interrupting someone for. The policy is small, so the
// tests are mostly about the cases where the answer is "stay quiet".
import { describe, expect, it, vi } from "vitest";

import { PersonSignalGate, type QuietHours } from "../shared/signal-levels.ts";
import type { Notification, NotifyKind } from "../shared/notification.ts";
import { buildNotification, buildSpendNotification, CALL_QUIET_MS, notifyHeldFor, quietForCall, routineIncidentTitle, routineRunTitle, ruleNotifyFrame, summarize } from "./notify.ts";
import { withItemLevel } from "./proactive/signal-ledger.ts";
import { type FramePushDeps, pushesForFrame } from "./push/frames.ts";

const bot = { id: "bot-1", name: "Scout", threadId: "thread-1" };

describe("buildNotification", () => {
  it("names the bot and carries the detail, per kind", () => {
    expect(buildNotification("approval", bot, "thread-1", "rm -rf ./build")).toMatchObject({
      kind: "approval",
      botId: "bot-1",
      threadId: "thread-1",
      title: "Scout needs approval",
      body: "rm -rf ./build",
    });
    expect(buildNotification("question", bot, "thread-1", "which branch?")?.title).toBe("Scout has a question");
    expect(buildNotification("done", bot, "thread-1", "pushed the branch")?.title).toBe("Scout finished");
    expect(buildNotification("routine-failed", bot, "thread-1", "boom")?.title).toBe("Scout's routine failed");
    expect(buildNotification("routine-deferred", bot, "thread-1", "target busy for 30 minutes")?.title)
      .toBe("Scout's routine is waiting");
    expect(buildNotification("incident", bot, "thread-1", "the run stopped: exit_before_result")?.title).toBe("Scout hit a problem");
    expect(buildNotification("turn-failed", bot, "thread-1", "the Local VM is not ready")?.title)
      .toBe("Scout couldn't start");
  });

  // 2026-11-02: a proactive wake or a webhook run is not "a routine", failed or waiting.
  it("names a proactive wake and a webhook run for what they are, failed or waiting", () => {
    expect(routineRunTitle("Scout", { proactive: { mode: "proactive" } }, "failed")).toBe("Scout's proactive wake failed");
    expect(routineRunTitle("Scout", { proactive: { mode: "proactive" } }, "waiting")).toBe("Scout's proactive wake is waiting");
    expect(routineRunTitle("Scout", { webhookId: "hook-1" }, "failed")).toBe("Scout's webhook run failed");
    expect(routineRunTitle("Scout", { webhookId: "hook-1" }, "waiting")).toBe("Scout's webhook run is waiting");
    // A routine's run keeps the kind's own title.
    expect(routineRunTitle("Scout", {}, "waiting")).toBeUndefined();
    const title = routineRunTitle("Scout", { webhookId: "hook-1" }, "waiting");
    expect(buildNotification("routine-deferred", bot, "thread-1", "New email: waiting for the reset", { title })?.title).toBe("Scout's webhook run is waiting");
  });

  // 2026-11-05: a routine that reported into the bot's main thread showed that
  // thread's last conversation title as the failed routine in the inbox.
  it("titles a failed run's incident by the run, never by the thread it reported into", () => {
    expect(routineIncidentTitle("Scout", { routineName: "Nightly check" })).toBe("Nightly check");
    expect(routineIncidentTitle("Scout", { routineName: "Nightly check", proactive: { mode: "proactive" } })).toBe("Scout's proactive wake failed");
    expect(routineIncidentTitle("Scout", { routineName: "New email", webhookId: "hook-1" })).toBe("Scout's webhook run failed");
    expect(routineIncidentTitle("Scout", { routineName: "  " })).toBe("Routine failed");
  });

  it("announces a delegation settle as a resume with results", () => {
    expect(buildNotification("delegation-settled", bot, "thread-1", "Results in from Atlas")).toMatchObject({
      kind: "delegation-settled",
      botId: "bot-1",
      threadId: "thread-1",
      title: "Scout resumed with results",
      body: "Results in from Atlas",
    });
    // the toggle rules this frame like every other
    expect(buildNotification("delegation-settled", { ...bot, notifications: false }, "thread-1", "Results in from Atlas")).toBeNull();
  });

  it("stays silent for a bot whose notifications are off", () => {
    const quiet = { ...bot, notifications: false };
    for (const kind of ["approval", "question", "done", "routine-failed", "turn-failed"] as const) {
      expect(buildNotification(kind, quiet, "thread-1", "anything")).toBeNull();
    }
    // absent means "not turned off" — older bot records predate the flag
    expect(buildNotification("approval", { ...bot, notifications: undefined }, "thread-1", "x")).not.toBeNull();
    expect(buildNotification("approval", { ...bot, notifications: true }, "thread-1", "x")).not.toBeNull();
  });

  it("does not buzz for a finish with nothing to say", () => {
    expect(buildNotification("done", bot, "thread-1", "   ")).toBeNull();
    expect(buildNotification("done", bot, "thread-1", "")).toBeNull();
    // ...but a blocked bot is worth knowing about even with a thin summary
    expect(buildNotification("approval", bot, "thread-1", "")).not.toBeNull();
    expect(buildNotification("turn-failed", bot, "thread-1", "")).not.toBeNull();
  });

  it("uses the thread it was raised on, not the bot's current one", () => {
    // a routine runs a bot in a detached task; the notification has to open
    // that conversation, not whatever the bot happens to be showing
    expect(buildNotification("done", bot, "other-thread", "done")?.threadId).toBe("other-thread");
  });

  it("keeps an approval on the card's thread, not a routine report thread (#1743)", () => {
    // Caller must pass the execution thread that holds the card. The results
    // conversation is for done/report pushes only; Allow on the phone posts
    // to notification.threadId.
    const cardThread = "exec-thread";
    const reportThread = "results-thread";
    const approval = buildNotification("approval", bot, cardThread, "rm -rf ./build", { requestId: "r1" });
    expect(approval?.threadId).toBe(cardThread);
    expect(approval?.threadId).not.toBe(reportThread);
    const question = buildNotification("question", bot, cardThread, "which branch?", { requestId: "q1" });
    expect(question?.threadId).toBe(cardThread);
  });

  it("carries the bot's avatar when one is given", () => {
    const avatarUrl = "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp";
    const frame = buildNotification("done", bot, "thread-1", "pushed the branch", { avatarUrl });
    expect(frame).toMatchObject({ botId: "bot-1", body: "pushed the branch", avatarUrl });

    // no profile image → the frame stays exactly as before
    expect(buildNotification("done", bot, "thread-1", "pushed")?.avatarUrl).toBeUndefined();
  });
});

describe("an approval notification", () => {
  it("takes the card's plain title and carries its request", () => {
    const n = buildNotification("approval", { id: "b", name: "Quasar", threadId: "t" }, "t", "Run echo hi.", { title: "Allow Quasar to run a command?", requestId: "r1", avatarUrl: "/api/bots/b/avatar" });
    expect(n).toMatchObject({ kind: "approval", title: "Allow Quasar to run a command?", body: "Run echo hi.", requestId: "r1", avatarUrl: "/api/bots/b/avatar" });
    expect(n?.needsKey).toBeUndefined();
    const keyed = buildNotification("approval", { id: "b", name: "Quasar", threadId: "t" }, "t", "rm x", { requestId: "r2", needsKey: true });
    expect(keyed?.needsKey).toBe(true);
  });
  it("names a finished routine so the phone can say which one", () => {
    const n = buildNotification("done", { id: "b", name: "Scout", threadId: "t" }, "t", "report ready", { routineRunId: "run-1", routineName: "Morning brief" });
    expect(n).toMatchObject({ kind: "done", routineRunId: "run-1", routineName: "Morning brief", body: "report ready" });
  });
  it("keeps the old title without one, and then asks nothing on its own line", () => {
    const n = buildNotification("approval", { id: "b", name: "Quasar", threadId: "t" }, "t", "x");
    expect(n?.title).toBe("Quasar needs approval");
    expect(n?.ask).toBeUndefined();
  });
  it("puts the plain question on its own line for the phone", () => {
    const n = buildNotification("approval", { id: "b", name: "Quasar", threadId: "t" }, "t", "Run echo hi.", { title: "Allow Quasar to run a command?", requestId: "r1" });
    expect(n?.ask).toBe("Allow Quasar to run a command?");
  });
  it("a question carries its choices, clean and bounded; an approval never does", () => {
    const q = buildNotification("question", { id: "b", name: "Scout", threadId: "t" }, "t", "Which color?", { requestId: "q1", choices: ["Red", "Red", " ", "Blue", ...Array.from({ length: 20 }, (_, i) => `c${i}`)] });
    expect(q?.choices?.slice(0, 2)).toEqual(["Red", "Blue"]);
    expect(q?.choices).toHaveLength(10);
    const a = buildNotification("approval", { id: "b", name: "Scout", threadId: "t" }, "t", "x", { requestId: "r", choices: ["Allow", "Deny"] });
    expect(a?.choices).toBeUndefined();
  });
});

describe("sign-in requests", () => {
  it("names the room in the title and carries its id for grouping", () => {
    // the card is in the room the bot asked from, so that is what opens
    expect(buildNotification("sign-in", bot, "room-thread", "the dashboard is behind a login", {
      group: { id: "room-1", name: "Launch" }, site: "example.com",
    })).toMatchObject({
      kind: "sign-in",
      threadId: "room-thread",
      groupId: "room-1",
      title: "Scout in Launch needs you to sign in to example.com",
      body: "the dashboard is behind a login",
    });
    // a 1:1 request is untouched — no room to name, nothing to group under
    const direct = buildNotification("sign-in", bot, bot.threadId, "the dashboard is behind a login", { site: "example.com" });
    expect(direct?.title).toBe("Scout needs you to sign in to example.com");
    expect(direct?.groupId).toBeUndefined();
  });
});

describe("summarize", () => {
  it("flattens a model's answer into one lock-screen line", () => {
    expect(summarize("line one\n\nline two")).toBe("line one line two");
    expect(summarize("before\n```js\nconst x = 1;\n```\nafter")).toBe("before after");
    expect(summarize("   padded   ")).toBe("padded");
  });

  it("reads a model's Markdown as plain words before flattening (2026-11-08 push)", () => {
    const body = "Cinq messages de Nova, tous dépassés. Rien à trancher.\n\n| Champ | Valeur |\n| --- | --- |\n| Source | Nova, 5 messages, tours expirés |";
    expect(summarize(body, 240)).toBe("Cinq messages de Nova, tous dépassés. Rien à trancher. Source : Nova, 5 messages, tours expirés");
    expect(summarize("## Bilan\n- **Trois** billets [fermés](https://example.com)\n- `ok`")).toBe("Bilan Trois billets fermés ok");
    expect(buildNotification("done", bot, "thread-1", "**Fait.** Voir [le lien](https://example.com).")?.body).toBe("Fait. Voir le lien.");
  });

  it("clamps long text with an ellipsis", () => {
    const long = summarize("x".repeat(400));
    expect(long).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
    expect(summarize("short")).toBe("short");
  });
});

describe("buildSpendNotification", () => {
  it("opens the thread whose turn crossed the line, and a bot's own toggle does not silence it", () => {
    const quiet = { ...bot, notifications: false };
    expect(buildSpendNotification(quiet, "thread-9", { title: "Monthly spend limit reached", body: "$100.00 of $100.00 spent this month (2026-09)." })).toEqual({
      kind: "spend", botId: "bot-1", botName: "Scout", threadId: "thread-9",
      title: "Monthly spend limit reached", body: "$100.00 of $100.00 spent this month (2026-09).",
    });
  });
});

describe("a conversation on a live voice call", () => {
  const now = 1_800_000_000_000;
  const done = { kind: "done" as const };
  it("does not buzz while the person's latest words were said on the call", () => {
    expect(quietForCall(done, { at: now - 60_000, voiceCall: { callId: "call-12345678" } }, now)).toBe(true);
    expect(quietForCall({ kind: "approval" }, { at: now - 5_000, voiceCall: { callId: "call-12345678", interrupted: true } }, now)).toBe(true);
  });
  it("stays quiet while the page says the thread is on a call, whatever was sent", () => {
    expect(quietForCall(done, { at: now - 60_000 }, now, true)).toBe(true);
    expect(quietForCall(done, undefined, now, true)).toBe(true);
    expect(quietForCall({ kind: "spend" }, undefined, now, true)).toBe(false);
  });
  it("buzzes again after a written message, a call long over, or for spend", () => {
    expect(quietForCall(done, { at: now - 60_000 }, now)).toBe(false);
    expect(quietForCall(done, { at: now - CALL_QUIET_MS - 1, voiceCall: { callId: "call-12345678" } }, now)).toBe(false);
    expect(quietForCall({ kind: "spend" }, { at: now, voiceCall: { callId: "call-12345678" } }, now)).toBe(false);
    expect(quietForCall(done, undefined, now)).toBe(false);
    expect(quietForCall(null, { at: now, voiceCall: { callId: "call-12345678" } }, now)).toBe(false);
  });
});

// #4233 Q6: one verdict for every device. The person's quiet hours and day
// budget (the signal gate the phone already obeyed) now mark the frame itself
// `notify: false`, so the desktop, its shell and the phone all stay quiet;
// what is urgent still rings, and the frame keeps its place in the chat.
describe("the desktop obeys the person's quiet hours and day budget (#4233)", () => {
  const at = Date.UTC(2026, 10, 13, 3, 0); // 03:00 UTC
  const night: QuietHours = { start: "22:00", end: "07:00", timeZone: "UTC" };
  const deps = (people: string[] = ["person-1"]): FramePushDeps => ({
    notificationPeople: () => people,
    muted: () => false,
    achievementNotifications: () => false,
    achievementName: () => undefined,
    now: () => at,
  });
  const frameOf = (kind: NotifyKind, extra: Partial<Notification> = {}) =>
    ({ kind: "notify", notification: { kind, botId: "bot-1", botName: "Scout", threadId: "thread-1", title: "Scout finished", body: "the words", ...extra } as Notification });
  // what the server does on its way out: the gate decides once per person
  const ruled = (gate: PersonSignalGate, frame: ReturnType<typeof frameOf>, people?: string[]) =>
    ruleNotifyFrame(frame, { signal: () => pushesForFrame(frame, deps(people)).map((message) => ({ person: message.personId, decision: gate.decide(message) })) });
  const flag = (frame: { notification: unknown }) => (frame.notification as { notify?: boolean }).notify;

  it("inside quiet hours an answer goes notify false, and its words wait for the brief", () => {
    const gate = new PersonSignalGate(() => ({ budget: 20, quiet: night }), () => at);
    const frame = ruled(gate, frameOf("done", { personTurn: true }));
    expect(flag(frame)).toBe(false);
    expect(frame.notification).toMatchObject({ kind: "done", threadId: "thread-1", title: "Scout finished" });
    expect(gate.takeHeld("person-1")).toEqual([expect.objectContaining({ title: "Scout finished", threadId: "thread-1" })]);
  });

  it("past the day budget a card goes notify false; the one within it still rings", () => {
    const gate = new PersonSignalGate(() => ({ budget: 1, quiet: null }), () => at);
    expect(flag(ruled(gate, frameOf("proposal", { proposalId: "p1" })))).toBeUndefined();
    expect(flag(ruled(gate, frameOf("proposal", { proposalId: "p2" })))).toBe(false);
    expect(gate.sentToday("person-1")).toBe(1);
  });

  it("an urgent ask still rings inside quiet hours and past the budget", () => {
    const gate = new PersonSignalGate(() => ({ budget: 5, quiet: night }), () => at);
    for (const kind of ["approval", "question", "needs-you", "sign-in", "takeover"] as NotifyKind[]) {
      expect(flag(ruled(gate, frameOf(kind)))).toBeUndefined();
    }
    expect(gate.takeHeld("person-1")).toEqual([]);
  });

  it("a frame that does not interrupt never reaches the gate", () => {
    const gate = new PersonSignalGate(() => ({ budget: 1, quiet: null }), () => at);
    let asked = 0;
    const frame = ruleNotifyFrame(frameOf("routine-failed"), { signal: () => { asked += 1; return [{ person: "person-1", decision: "hold" }]; } });
    expect(flag(frame)).toBe(false);
    ruleNotifyFrame(frameOf("done"), { signal: () => { asked += 1; return [{ person: "person-1", decision: "hold" }]; } });
    expect(asked).toBe(0);
    expect(gate.sentToday("person-1")).toBe(0);
  });

  it("a frame for two people goes quiet on the held person's streams only, and rings for the other", () => {
    const gate = new PersonSignalGate((person) => ({ budget: 20, quiet: person === "person-1" ? night : null }), () => at);
    const frame = ruled(gate, frameOf("proposal", { proposalId: "p3" }), ["person-1", "person-2"]);
    // the frame itself still rings for the person who may hear it
    expect(flag(frame)).toBeUndefined();
    expect(notifyHeldFor(frame, "person-1")).toBe(true);
    expect(notifyHeldFor(frame, "Person-1")).toBe(true);
    expect(notifyHeldFor(frame, "person-2")).toBe(false);
    expect(gate.takeHeld("person-1")).toHaveLength(1);
    expect(gate.sentToday("person-2")).toBe(1);
  });

  it("goes notify false for everyone when every person it is for is held", () => {
    const gate = new PersonSignalGate(() => ({ budget: 20, quiet: night }), () => at);
    expect(flag(ruled(gate, frameOf("proposal", { proposalId: "p4" }), ["person-1", "person-2"]))).toBe(false);
  });

  it("#4250 (S2): the writer's level rides the frame: an urgent wait passes quiet hours, a card one waits, and the one log line says why", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => { lines.push(line); });
    try {
      const gate = new PersonSignalGate(() => ({ budget: 20, quiet: night }), () => at);
      const ruledWithReason = (frame: ReturnType<typeof frameOf>) => ruleNotifyFrame(frame, { signal: () => pushesForFrame(frame, deps()).map((message) => {
        const decision = gate.verdict(message);
        return { person: message.personId, decision: decision.verdict === "hold" ? "hold" as const : "push" as const, reason: decision.reason };
      }) });
      expect(flag(ruledWithReason(frameOf("wait", { level: "urgent" })))).toBeUndefined();
      expect(flag(ruledWithReason(frameOf("wait")))).toBe(false);
      expect(lines).toEqual([
        "[notify] kind=wait bot=bot-1 thread=thread-1 audience=all interrupts=yes level=urgent reason=urgent",
        "[notify] kind=wait bot=bot-1 thread=thread-1 audience=all interrupts=no level=card reason=allowed held=signal held_by=quiet_hours",
      ]);
      // a proactive item's level reaches its frame (tellPerson), FYI stays FYI
      expect(withItemLevel(frameOf("needs-you").notification, "card").level).toBe("card");
      expect(withItemLevel({ ...frameOf("done").notification, notify: false, level: "fyi" as const }, "urgent").level).toBe("fyi");
      expect(withItemLevel(null, "urgent")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("rings when nobody's gate was asked", () => {
    let calls = 0;
    const frame = ruleNotifyFrame(frameOf("proposal"), { signal: () => { calls += 1; return []; } });
    expect(flag(frame)).toBeUndefined();
    expect(notifyHeldFor(frame, "person-1")).toBe(false);
    expect(calls).toBe(1);
  });
});
