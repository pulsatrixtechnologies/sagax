// The server's stages of a call turn, logged under its utterance id
// (server/voice/voice-latency.ts): ids and milliseconds, never the words.
import { describe, expect, it } from "vitest";

import { VoiceLatencyLog } from "./voice-latency.ts";

describe("VoiceLatencyLog", () => {
  it("logs one line per call turn at its first token: dispatch, engine (warm or cold) and the model", () => {
    let clock = 1_000;
    const lines: string[] = [];
    const log = new VoiceLatencyLog(() => clock, (line) => lines.push(line));
    log.received("t-1", "utt-00000001");
    clock += 12;
    log.mark("t-1", "dispatch");
    clock += 3;
    log.mark("t-1", "engine", { warm: true });
    clock += 640;
    log.mark("t-1", "firstToken");
    // a later delta of the same answer adds nothing
    log.mark("t-1", "firstToken");
    expect(lines).toEqual(["[voice-latency] utt=utt-00000001 received->dispatch 12ms dispatch->engine 3ms (warm) engine->first-token 640ms total 655ms"]);
    expect(log.current("t-1")).toBeUndefined();
  });

  it("names a cold start, times only call turns, and forgets a turn that never streamed", () => {
    let clock = 0;
    const lines: string[] = [];
    const log = new VoiceLatencyLog(() => clock, (line) => lines.push(line));
    // a turn that is not a call utterance: nothing is timed
    log.mark("t-2", "dispatch");
    log.mark("t-2", "firstToken");
    expect(lines).toEqual([]);
    log.received("t-1", "utt-00000002");
    log.mark("t-1", "dispatch");
    log.mark("t-1", "engine", { warm: false });
    clock += 2_600;
    log.mark("t-1", "firstToken");
    expect(lines[0]).toContain("(cold start)");
    log.received("t-1", "utt-00000003");
    log.settled("t-1");
    log.mark("t-1", "firstToken");
    expect(lines).toHaveLength(1);
  });

  it("puts the turn in the thread's Events lens with the page's stages first", () => {
    let clock = 0;
    const notices: Array<[string, string]> = [];
    const log = new VoiceLatencyLog(() => clock, () => {}, (threadId, message) => notices.push([threadId, message]));
    log.received("t-9", "utt-00000009", { endpointMs: 560, sttMs: 180, dispatchMs: 20 });
    clock += 1_891;
    log.mark("t-9", "dispatch");
    clock += 95;
    log.mark("t-9", "engine", { warm: false });
    clock += 3_824;
    log.mark("t-9", "firstToken");
    expect(notices).toEqual([["t-9", "Voice turn: end of speech 560 ms, speech to text 180 ms, send 20 ms, turn setup 1.9 s, engine 95 ms (cold start), first words 3.8 s; 6.6 s from the end of speech to the first words"]]);
  });
});
