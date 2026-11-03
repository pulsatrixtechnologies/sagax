import { describe, expect, it } from "vitest";

import {
  admitDuplexSend,
  continuesSameUtterance,
  dropCancelledVoiceEvent,
  DUPLEX_INTERRUPT_WAIT_MS,
  duplexEpoch,
  isStaleAssistantOutput,
  isThreadBusyError,
  lastOwnUserVoiceText,
  matchingVoiceSibling,
  pinVoiceInterrupt,
  waitForThreadIdle,
  voiceFullDuplexEnabled,
  withoutDuplexMarks,
} from "./voice-call-duplex.ts";
import {
  discardSteeredQueue,
  hasQueuedSteeredMessages,
  queueSteeredMessage,
} from "../steer-queue.ts";
import { classifyVoiceIntent } from "../../src/lib/voice-mode/voice-topics.ts";

describe("admitDuplexSend", () => {
  it("never replaces when the flag is off", () => {
    expect(admitDuplexSend({ duplex: false, botBusy: true, stopping: true, queued: true })).toEqual({ action: "steer" });
    expect(admitDuplexSend({ duplex: false, botBusy: false, stopping: false, queued: false })).toEqual({ action: "start" });
  });

  it("starts when duplex is on and the thread is idle", () => {
    expect(admitDuplexSend({ duplex: true, botBusy: false, stopping: false, queued: false })).toEqual({ action: "start" });
  });

  it("replaces a busy or stopping turn and discards the queue", () => {
    expect(admitDuplexSend({ duplex: true, botBusy: true, stopping: false, queued: false }))
      .toEqual({ action: "replace", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({ duplex: true, botBusy: false, stopping: true, queued: false }))
      .toEqual({ action: "replace", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({ duplex: true, botBusy: true, stopping: true, queued: true }))
      .toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("discards a leftover queue on an idle thread without interrupting", () => {
    expect(admitDuplexSend({ duplex: true, botBusy: false, stopping: false, queued: true }))
      .toEqual({ action: "replace", interrupt: false, discardQueue: true });
  });

  it("a new utterance while the call turn runs a tool joins that turn: the work survives, no parallel task", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, newTopic: true,
    })).toEqual({ action: "steer" });
  });

  it("a new utterance while the call thread is only thinking replaces it, it never forks a parallel task", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: false, newTopic: true,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, newTopic: true, speculative: true,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("an explicit stop or correction still replaces a thinking turn", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: false, newTopic: false,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("stop cancels the thinking turn and does not start a new one", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, intent: "stop",
    })).toEqual({ action: "stop", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, intent: "stop",
    })).toEqual({ action: "stop", interrupt: true, discardQueue: true });
  });

  it("a request that starts with stop is work, never swallowed as a stop (server/index.ts classifies the words)", () => {
    const admit = (text: string) => admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, intent: classifyVoiceIntent(text), newTopic: classifyVoiceIntent(text) === "new_topic",
    });
    expect(admit("Stop le service AcmeGuard sur SRV-01")).toEqual({ action: "replace", interrupt: true, discardQueue: true });
    expect(admit("ok stop")).toEqual({ action: "stop", interrupt: true, discardQueue: true });
  });

  it("a correction still replaces a thinking turn", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, intent: "correction",
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("stop or a correction still replaces, even with background work", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, newTopic: false,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("a continues reissue replaces the speculative turn, it does not fork", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, newTopic: true, continues: true,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, newTopic: true, continues: true, sameUtterance: true,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("a continues send of a different utterance joins A while A runs a tool, else replaces", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, newTopic: true, continues: true, sameUtterance: false,
    })).toEqual({ action: "steer" });
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, newTopic: true, continues: true, sameUtterance: false,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("a speculative send while a tool runs is admitted, not deferred", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, newTopic: true, speculative: true,
    })).toEqual({ action: "steer" });
    expect(admitDuplexSend({
      duplex: true, botBusy: false, stopping: false, queued: false, backgroundWork: true, newTopic: true, speculative: true,
    })).toEqual({ action: "start" });
  });
});

describe("voiceFullDuplexEnabled", () => {
  it("is off unless the server says SAGAX_VOICE_FULL_DUPLEX=1", () => {
    expect(voiceFullDuplexEnabled({})).toBe(false);
    expect(voiceFullDuplexEnabled({ SAGAX_VOICE_FULL_DUPLEX: "0" })).toBe(false);
    expect(voiceFullDuplexEnabled({ SAGAX_VOICE_FULL_DUPLEX: "1" })).toBe(true);
  });
});

describe("withoutDuplexMarks", () => {
  it("drops duplex and speculative, keeps the rest", () => {
    expect(withoutDuplexMarks({
      callId: "call-0123456789",
      duplex: true,
      speculative: true,
      utteranceId: "utt-1",
      language: "fr",
    })).toEqual({ callId: "call-0123456789", utteranceId: "utt-1", language: "fr" });
  });
});

describe("continuesSameUtterance", () => {
  it("a longer STT final of the same words is the same utterance", () => {
    expect(continuesSameUtterance("Please wait twelve seconds", "Please wait twelve seconds, then count to two hundred")).toBe(true);
    expect(continuesSameUtterance("what time is it in Tokyo", "what time is it in Tokyo right now")).toBe(true);
  });

  it("an STT final that revises a word of the partial is still the same utterance", () => {
    // 2026-10-13: the partial and the final of one sentence each forked a task
    expect(continuesSameUtterance(
      "And And Just wondering if you will be.",
      "And And Just wondering if you would be able to look at the ticket",
    )).toBe(true);
    expect(matchingVoiceSibling(
      [{ threadId: "b", text: "And And Just wondering if you will be." }],
      "And And Just wondering if you would be able to look at the ticket",
    )).toBe("b");
    // a short line has no room for a revised word
    expect(continuesSameUtterance("what time", "which time is it")).toBe(false);
  });

  it("a new topic is not a continuation of the live turn", () => {
    expect(continuesSameUtterance(
      "Please wait twelve seconds, then count to two hundred, saying each number.",
      "Please wait fifteen seconds, then what time is it in Tokyo?",
    )).toBe(false);
  });

  it("last own user line skips parallel request cards", () => {
    expect(lastOwnUserVoiceText([
      { role: "user", text: "wait twelve seconds" },
      { role: "user", text: "what time is it in Tokyo", parallelTask: { threadId: "b" } },
    ])).toBe("wait twelve seconds");
  });

  it("a continues of a forked speculative finds that sibling", () => {
    expect(matchingVoiceSibling(
      [{ threadId: "b", text: "what time is it in Tokyo" }],
      "what time is it in Tokyo right now",
    )).toBe("b");
    expect(matchingVoiceSibling(
      [{ threadId: "b", text: "what time is it in Tokyo" }],
      "How far is Quebec City from Montreal?",
    )).toBeUndefined();
  });
});

describe("pinVoiceInterrupt", () => {
  it("applies an unpinned Stop, and a pin that still owns the thread", () => {
    expect(pinVoiceInterrupt({})).toBe("apply");
    expect(pinVoiceInterrupt({ expectedUtteranceId: "utt-a" })).toBe("apply");
    expect(pinVoiceInterrupt({ expectedUtteranceId: "utt-a", liveUtteranceId: "utt-a" })).toBe("apply");
  });

  it("skips when a newer utterance already owns the thread", () => {
    expect(pinVoiceInterrupt({ expectedUtteranceId: "utt-a", liveUtteranceId: "utt-b" })).toBe("skip");
  });
});

describe("duplex replace slot", () => {
  it("only the latest claim is current, so a slower replace does not start", () => {
    const epoch = duplexEpoch();
    const first = epoch.claim();
    const second = epoch.claim();
    expect(epoch.isLatest(first)).toBe(false);
    expect(epoch.isLatest(second)).toBe(true);
  });

  it("a cancelled turn's assistant output is stale even after a new owner starts", () => {
    expect(isStaleAssistantOutput({ eventTurnId: "turn-a", cancelledTurnIds: ["turn-a"], ownerTurnId: "turn-b" })).toBe(true);
    expect(isStaleAssistantOutput({ eventTurnId: "turn-b", cancelledTurnIds: ["turn-a"], ownerTurnId: "turn-b" })).toBe(false);
    expect(isStaleAssistantOutput({ ownerStopped: true, eventTurnId: "turn-a" })).toBe(true);
    expect(isStaleAssistantOutput({ eventTurnId: "turn-a", ownerTurnId: "turn-b" })).toBe(true);
  });

  it("a cancelled turn drops the LLM stream, completed text, and in-flight tool events", () => {
    expect(dropCancelledVoiceEvent(true, { type: "content.delta", streamKind: "assistant_text" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "item.completed", itemType: "assistant_text" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "item.started", itemType: "tool" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "item.completed", itemType: "tool" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "turn.completed" })).toBe(false);
    expect(dropCancelledVoiceEvent(false, { type: "item.completed", itemType: "assistant_text" })).toBe(false);
    expect(dropCancelledVoiceEvent(false, { type: "item.completed", itemType: "tool" })).toBe(false);
  });

  it("thread_busy is retried until idle, then a timeout is reported", async () => {
    expect(isThreadBusyError(Object.assign(new Error("busy"), { code: "thread_busy" }))).toBe(true);
    expect(isThreadBusyError(new Error("nope"))).toBe(false);
    let busy = true;
    let now = 0;
    const sleeps: number[] = [];
    const idle = waitForThreadIdle(() => busy, {
      capMs: 100,
      stepMs: 40,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
        busy = false;
      },
    });
    await expect(idle).resolves.toBe("idle");
    expect(sleeps).toEqual([40]);
    const timed = waitForThreadIdle(() => true, {
      capMs: 80,
      stepMs: 40,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await expect(timed).resolves.toBe("timeout");
  });

  it("default waitForThreadIdle times out at 300 ms after abort, not 2500", async () => {
    expect(DUPLEX_INTERRUPT_WAIT_MS).toBe(300);
    let now = 0;
    const timed = waitForThreadIdle(() => true, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await expect(timed).resolves.toBe("timeout");
    expect(now).toBeGreaterThanOrEqual(300);
    expect(now).toBeLessThan(400);
  });
});

describe("discardSteeredQueue", () => {
  it("empties a thread's queued follow-ups and leaves other threads", () => {
    queueSteeredMessage("bot-a", "thread-a", "stale A");
    queueSteeredMessage("bot-a", "thread-a", "stale B");
    queueSteeredMessage("bot-a", "thread-b", "keep me");
    expect(discardSteeredQueue("bot-a", "thread-a")).toBe(2);
    expect(hasQueuedSteeredMessages("bot-a", "thread-a")).toBe(false);
    expect(hasQueuedSteeredMessages("bot-a", "thread-b")).toBe(true);
    expect(discardSteeredQueue("bot-a", "thread-a")).toBe(0);
    expect(discardSteeredQueue("other", "thread-b")).toBe(0);
    expect(discardSteeredQueue("bot-a", "thread-b")).toBe(1);
  });
});
