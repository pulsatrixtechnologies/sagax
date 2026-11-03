// Voice timings for the Events lens (server/voice/voice-timing.ts): numbers only.
import { describe, expect, it } from "vitest";

import { audioTurnNotice, callTurnNotice, parseVoiceAudioTiming, parseVoiceClientTiming, streamedTranscriptNotice, uploadedTranscriptNotice } from "./voice-timing.ts";

describe("voice timing notices", () => {
  it("says how long the whole-recording upload took and for how much audio", () => {
    // 3 s of 16 kHz 16-bit mono WAV
    expect(uploadedTranscriptNotice({ bytes: 44 + 3 * 32_000, mime: "audio/wav", ms: 1_240 })).toBe("Voice: speech to text (whole recording) took 1.2 s for 3.0 s of audio");
    expect(uploadedTranscriptNotice({ bytes: 20_480, mime: "audio/webm", ms: 640 })).toBe("Voice: speech to text (whole recording) took 640 ms for 20 KB of audio");
  });

  it("says when the streamed final words came after the end of speech", () => {
    expect(streamedTranscriptNotice(312)).toBe("Voice: speech to text (streaming) gave the final words 312 ms after the end of speech");
  });

  it("keeps only sane page timings and never the words", () => {
    expect(parseVoiceClientTiming({ endpointMs: 560.4, sttMs: -1, dispatchMs: "20", text: "secret words" })).toEqual({ endpointMs: 560 });
    expect(parseVoiceClientTiming("nope")).toBeUndefined();
    expect(parseVoiceClientTiming({})).toBeUndefined();
  });

  it("reads a turn without the page's stages", () => {
    expect(callTurnNotice({ dispatchMs: 12, engineMs: 3, warm: true, firstTokenMs: 640 })).toBe("Voice turn: turn setup 12 ms, engine 3 ms (warm), first words 640 ms; 655 ms from the end of speech to the first words");
  });

  it("names the fast model, the context and the call session of a call turn", () => {
    expect(callTurnNotice({ dispatchMs: 40, engineMs: 5, warm: true, firstTokenMs: 620, run: { model: "Claude Haiku 4.5", contextBytes: 3_200, session: "new" } }))
      .toBe("Voice turn: turn setup 40 ms, engine 5 ms (warm), first words 620 ms; 665 ms from the end of speech to the first words (on Claude Haiku 4.5, 3.1 KB of context, new call session)");
  });

  it("says when the first words were heard, and keeps only sane numbers", () => {
    expect(audioTurnNotice({ firstSentenceMs: 120, ttsMs: 310, playbackMs: 70, totalMs: 1_480 }))
      .toBe("Voice audio: first sentence 120 ms, text to speech 310 ms, playback 70 ms; first words heard 1.5 s after the end of speech");
    expect(parseVoiceAudioTiming({ totalMs: -1, ttsMs: 12.4 })).toEqual({ ttsMs: 12 });
    expect(parseVoiceAudioTiming("x")).toBeUndefined();
  });
});
