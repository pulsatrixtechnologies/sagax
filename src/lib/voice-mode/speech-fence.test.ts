// A barge-in while the bot thinks, then a send: the dying turn's text must
// not be spoken after the new user line (issue #292).
import { describe, expect, it } from "vitest";

import {
  cancelSpeech,
  createSpeechFence,
  interruptBot,
  noteUtteranceSent,
  settleReplies,
  shouldNarrateToolChip,
  streamText,
} from "./speech-fence";

const userA = { id: "uA", role: "user" as const, kind: "text", text: "tell me a story" };
const userB = { id: "uB", role: "user" as const, kind: "text", text: "what about the weather" };
const dyingA = { id: "bA", role: "bot" as const, kind: "text", text: "Once upon a time." };
const replyB = { id: "bB", role: "bot" as const, kind: "text", text: "It is sunny.", requestMessageId: "uB" };

describe("speech fence after barge-in", () => {
  it("a send does not reopen a cut answer, so a late A after user B is silent", () => {
    let fence = cancelSpeech(createSpeechFence(), "Once upon a time");
    fence = noteUtteranceSent(fence);
    expect(streamText(fence, "Once upon a time, there was a llama").text).toBeNull();
    const late = settleReplies(fence, [userA, userB, dyingA], ["bA"]);
    expect(late.speak).toEqual([]);
    expect(late.skip).toEqual(["bA"]);
    const next = settleReplies(late.fence, [userA, userB, dyingA, replyB], ["bB"]);
    expect(next.speak).toEqual([{ id: "bB", text: "It is sunny." }]);
  });

  it("an empty live after the cut does not clear the drop, so a late burst of A stays silent", () => {
    let fence = cancelSpeech(createSpeechFence(), "Once upon a time");
    fence = noteUtteranceSent(fence);
    const paused = streamText(fence, "");
    expect(paused.text).toBeNull();
    expect(streamText(paused.fence, "Once upon a time, there was a llama").text).toBeNull();
  });

  it("a new stream that is not the cut block is spoken", () => {
    let fence = cancelSpeech(createSpeechFence(), "Once upon a time");
    fence = noteUtteranceSent(fence);
    const live = streamText(fence, "It is sunny.");
    expect(live.text).toBe("It is sunny.");
    expect(live.fence.dropOldReply).toBe(false);
  });

  it("a reply proven to belong to the latest user is spoken even if drop was still set", () => {
    let fence = cancelSpeech(createSpeechFence(), "");
    fence = noteUtteranceSent(fence);
    const out = settleReplies(fence, [userA, userB, replyB], ["bB"]);
    expect(out.speak).toEqual([{ id: "bB", text: "It is sunny." }]);
  });

  it("interruptBot keeps the drop on the current stream", () => {
    const fence = interruptBot(createSpeechFence(), "partial");
    expect(fence.dropOldReply).toBe(true);
    expect(streamText(fence, "partial more").text).toBeNull();
  });

  it("a send without barge-in still speaks the next reply", () => {
    const fence = noteUtteranceSent(createSpeechFence());
    expect(fence.dropOldReply).toBe(false);
    const out = settleReplies(fence, [userB, { id: "b", role: "bot", kind: "text", text: "Hi" }], ["b"]);
    expect(out.speak).toEqual([{ id: "b", text: "Hi" }]);
  });

  it("duplex still narrates a tool chip while the thinking cue is playing", () => {
    expect(shouldNarrateToolChip({ duplex: true, playerBusy: true })).toBe(true);
    expect(shouldNarrateToolChip({ duplex: false, playerBusy: true })).toBe(false);
    expect(shouldNarrateToolChip({ duplex: false, playerBusy: false })).toBe(true);
  });

  it("an older topic's result still speaks after a speech-only barge-in", () => {
    let fence = cancelSpeech(createSpeechFence(), "It is morning in Tokyo");
    fence = noteUtteranceSent(fence);
    const montreal = { id: "bA", role: "bot" as const, kind: "text", text: "It is 12 and sunny in Montreal." };
    const out = settleReplies(fence, [userA, userB, montreal], ["bA"]);
    expect(out.speak).toEqual([{ id: "bA", text: "It is 12 and sunny in Montreal." }]);
  });

  it("a parallel result for an older request still speaks", () => {
    const older = {
      id: "bA", role: "bot" as const, kind: "text", text: "Montreal is sunny.",
      parallelTask: { role: "result", requestMessageId: "uA" },
    };
    const out = settleReplies(createSpeechFence(), [userA, userB, older], ["bA"]);
    expect(out.speak).toEqual([{ id: "bA", text: "Montreal is sunny." }]);
  });

  it("a thinking interrupt still drops a dying turn that is not the latest user", () => {
    let fence = cancelSpeech(createSpeechFence(), "");
    fence = noteUtteranceSent(fence);
    const late = settleReplies(fence, [userA, userB, dyingA], ["bA"]);
    expect(late.speak).toEqual([]);
    expect(late.skip).toEqual(["bA"]);
  });

  it("thinking barge-in with an empty stream ignores a late delta of the cut turn", () => {
    let fence = interruptBot(createSpeechFence(), "");
    fence = noteUtteranceSent(fence);
    const late = streamText(fence, "Once upon a time, there was a llama");
    expect(late.text).toBeNull();
    expect(late.fence.dropOldReply).toBe(true);
  });

  it("thinking barge-in speaks a new stream only after the live buffer has cleared", () => {
    let fence = interruptBot(createSpeechFence(), "");
    fence = noteUtteranceSent(fence);
    expect(streamText(fence, "Once upon a time").text).toBeNull();
    const cleared = streamText(fence, "");
    expect(cleared.text).toBeNull();
    const next = streamText(cleared.fence, "It is sunny.");
    expect(next.text).toBe("It is sunny.");
    expect(next.fence.dropOldReply).toBe(false);
  });

  it("#4216: a request started beside the running turn does not silence that turn's answer", () => {
    // the first answer's row was opened before the second request was said
    const asked = { id: "u1", role: "user" as const, kind: "text", text: "check my unread mail" };
    const answer = { id: "b1", role: "bot" as const, kind: "text", text: "Two new emails.", requestMessageId: "u1" };
    const beside = { id: "u2", role: "user" as const, kind: "text", text: "check the new posts", parallelTask: { role: "request", requestMessageId: "u2" } };
    const result = { id: "r2", role: "bot" as const, kind: "text", text: "Three new posts.", parallelTask: { role: "result", requestMessageId: "u2" } };
    const settled = settleReplies(createSpeechFence(), [asked, answer, beside, result], ["b1", "r2"]);
    expect(settled.speak.map((reply) => reply.id)).toEqual(["b1", "r2"]);
    expect(settled.skip).toEqual([]);
  });
});
