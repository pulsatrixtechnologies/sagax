import { describe, expect, it } from "vitest";

import {
  VOICE_CACHE_PRIME_MARKER,
  VOICE_FIRST_SENTENCE_SYSTEM,
  VoiceFirstSentenceJobs,
  beginVoiceFirstSentence,
  cachePrimePrompt,
  clipFirstSentence,
  joinCachePrime,
  pickFastSentenceModel,
  voiceOpenerFrameAllowed,
} from "./voice-first-sentence.ts";

describe("pickFastSentenceModel", () => {
  it("prefers grok-3-mini over a larger fast row", () => {
    expect(pickFastSentenceModel(["grok-4.7", "grok-4-fast", "grok-3-mini"])).toBe("grok-3-mini");
  });

  it("skips a reasoning row and a model the engine does not list", () => {
    expect(pickFastSentenceModel(["grok-4.7", "grok-4-fast-reasoning"])).toBeNull();
    expect(pickFastSentenceModel(["claude-haiku-4-5", "grok-4.7"])).toBe("claude-haiku-4-5");
  });
});

describe("clipFirstSentence", () => {
  it("speaks the first punctuated sentence of at least two words", () => {
    expect(clipFirstSentence("Sure thing. The rest of the answer is longer.")).toBe("Sure thing.");
  });

  it("waits for punctuation while the model is still writing", () => {
    expect(clipFirstSentence("Let me check that")).toBeNull();
    expect(clipFirstSentence("Let me check that", { finished: true })).toBe("Let me check that.");
  });

  it("drops a one-word clip", () => {
    expect(clipFirstSentence("Sure.", { finished: true })).toBeNull();
  });
});

describe("VoiceFirstSentenceJobs", () => {
  it("runs one opener per utterance and aborts it when the utterance changes", async () => {
    const jobs = new VoiceFirstSentenceJobs();
    let firstAborted = false;
    const first = new Promise<void>((resolve) => {
      jobs.begin("t", "utt-11111111", async (signal) => {
        await new Promise((done) => setTimeout(done, 30));
        firstAborted = signal.aborted;
        resolve();
      });
    });
    jobs.begin("t", "utt-11111111", async () => { throw new Error("same utterance"); });
    jobs.begin("t", "utt-22222222", async () => {});
    await first;
    expect(firstAborted).toBe(true);
    expect(jobs.isCurrent("t", "utt-11111111")).toBe(false);
  });

  it("emits one clip from the fast model and ignores a stale delta", async () => {
    const jobs = new VoiceFirstSentenceJobs();
    const emitted: string[] = [];
    beginVoiceFirstSentence({
      jobs,
      threadId: "t",
      callId: "call-0123456789",
      utteranceId: "utt-0123456789",
      text: "What is the weather?",
      driverKind: "grok",
      modelIds: ["grok-4.7", "grok-3-mini"],
      emit: (text) => emitted.push(text),
      generate: async (_prompt, options) => {
        expect(options.model).toBe("grok-3-mini");
        expect(options.system).toBe(VOICE_FIRST_SENTENCE_SYSTEM);
        expect(options.maxTokens).toBe(40);
        options.onDelta?.("Let me check. ");
        options.onDelta?.("It is sunny.");
        return "Let me check. It is sunny.";
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emitted).toEqual(["Let me check."]);
  });

  // Claude (a cold one-shot CLI, no streaming), Codex (no one-shot text) and
  // ACP (one prompt per session): their quick first line is the call's
  // progress line from the turn's first tool (src/lib/voice-mode/progress.ts)
  it.each(["grokAgent", "claudeAgent", "codex"])("does not call a %s engine", async (driverKind) => {
    const jobs = new VoiceFirstSentenceJobs();
    let called = false;
    beginVoiceFirstSentence({
      jobs,
      threadId: "t",
      callId: "call-0123456789",
      utteranceId: "utt-0123456789",
      text: "Hello there",
      driverKind,
      modelIds: ["grok-3-mini"],
      emit: () => {},
      generate: async () => { called = true; return ""; },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(called).toBe(false);
  });
});

describe("joinCachePrime", () => {
  it("returns none without a prime and joined when the prime is already done", async () => {
    expect(await joinCachePrime(undefined, () => {})).toBe("none");
    expect(await joinCachePrime(Promise.resolve(), () => {}, 50)).toBe("joined");
  });

  it("cancels a prime that is still running", async () => {
    let cancelled = false;
    const outcome = await joinCachePrime(new Promise(() => {}), () => { cancelled = true; }, 15);
    expect(outcome).toBe("cancelled");
    expect(cancelled).toBe(true);
  });
});

describe("cache prime prompt and opener audience", () => {
  it("keeps the system bytes as the prefix", () => {
    const prompt = cachePrimePrompt("You are Sage.");
    expect(prompt.startsWith("You are Sage.\n\n")).toBe(true);
    expect(prompt).toContain(VOICE_CACHE_PRIME_MARKER);
  });

  it("reaches only the person the turn speaks for", () => {
    const frame = { kind: "voice.opener", audience: "Ada" };
    expect(voiceOpenerFrameAllowed(frame, "ada", "operator")).toBe(true);
    expect(voiceOpenerFrameAllowed(frame, undefined, "ada")).toBe(true);
    expect(voiceOpenerFrameAllowed(frame, "bob", "operator")).toBe(false);
    expect(voiceOpenerFrameAllowed({ kind: "message" }, "bob", "operator")).toBe(true);
    const ended = { kind: "voice.call.ended", audience: "Ada" };
    expect(voiceOpenerFrameAllowed(ended, "ada", "operator")).toBe(true);
    expect(voiceOpenerFrameAllowed(ended, "bob", "operator")).toBe(false);
    expect(voiceOpenerFrameAllowed({ kind: "voice.call.ended" }, "ada", "operator")).toBe(false);
  });
});
