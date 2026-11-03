// Runs the voice call latency bench (scripts/voice-latency-bench.ts) when
// SAGAX_VOICE_BENCH=1; skipped otherwise (about a minute and a half of real
// time per engine). Runs each engine of BENCH_ENGINES (claude,grok) and
// writes the turns and their p50/p90 to BENCH_OUT, with Grok's ACP session
// establishments per turn.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { parseVoiceCallMeta } from "../server/voice/voice-call-prompt.ts";
import { VOICE_BENCH_THRESHOLDS } from "./voice-benchmark/model.ts";
import {
  BENCH_SAY_VOICE_FR,
  REAL_QUESTIONS,
  ClockPlayer,
  applyBenchRuntimeEvent,
  holdVoiceUntilTail,
  shouldSendBenchUtterance,
  mergeBenchMetrics,
  stampClockPlayback,
  benchInterruptBody,
  defaultBenchTurns,
  realVoiceBench,
  runVoiceLatencyBench,
  summarize,
  voiceCallMarkLanguage,
  type BenchEngine,
  type BenchReplyState,
} from "./voice-latency-bench.ts";
import type { Sentence } from "../src/lib/voice-mode/player.ts";

it("real bench is 20 turns mixing English and Québec French, short and long", () => {
  expect(defaultBenchTurns(true)).toBe(20);
  expect(defaultBenchTurns(false)).toBe(12);
  expect(REAL_QUESTIONS).toHaveLength(20);
  const fr = REAL_QUESTIONS.filter((q) => q.lang === "fr");
  const en = REAL_QUESTIONS.filter((q) => q.lang === "en");
  expect(fr.length).toBeGreaterThanOrEqual(8);
  expect(en.length).toBeGreaterThanOrEqual(8);
  const words = (q: { text: string }) => q.text.trim().split(/\s+/).length;
  expect(REAL_QUESTIONS.some((q) => q.lang === "en" && words(q) <= 5)).toBe(true);
  expect(REAL_QUESTIONS.some((q) => q.lang === "en" && words(q) >= 10)).toBe(true);
  expect(REAL_QUESTIONS.some((q) => q.lang === "fr" && words(q) <= 5)).toBe(true);
  expect(REAL_QUESTIONS.some((q) => q.lang === "fr" && words(q) >= 10)).toBe(true);
  expect(BENCH_SAY_VOICE_FR).toMatch(/Amélie|Amelie/);
});

it("voice-call marks use en or fr, never auto (parseVoiceCallMeta rejects auto)", () => {
  expect(parseVoiceCallMeta({ callId: "call-0123456789", language: "auto" })).toHaveProperty("error");
  expect(voiceCallMarkLanguage("auto")).toBe("en");
  for (const q of REAL_QUESTIONS) {
    const language = voiceCallMarkLanguage(q.lang);
    expect(language === "en" || language === "fr").toBe(true);
    expect(parseVoiceCallMeta({ callId: "call-0123456789", language })).toMatchObject({ language });
  }
});

it("spoken bench frames stay voiced until the tail so say pauses do not false-cut", () => {
  const voiced = new Float32Array(512);
  voiced[0] = 0.92 / 1000;
  const quiet = new Float32Array(512);
  quiet[0] = 0.03 / 1000;
  const frames = [...Array(10).fill(voiced), ...Array(12).fill(quiet), ...Array(10).fill(voiced), ...Array(4).fill(quiet)].map((f) => new Float32Array(f));
  const held = holdVoiceUntilTail(frames, 128);
  const p = (frame: Float32Array) => (frame[0] ?? 0) * 1000;
  expect(held.slice(0, -4).every((frame) => p(frame) >= 0.9)).toBe(true);
  expect(held.slice(-4).every((frame) => p(frame) < 0.2)).toBe(true);
});

it("plays a sentence enqueued after cancel while the previous pump is still finishing", async () => {
  const player = new ClockPlayer();
  const started: string[] = [];
  player.events.onSentenceStart = (text) => started.push(text);
  const oldAudio = new ReadableStream<Uint8Array>({
    start() {},
  });
  player.enqueue({
    text: "old",
    audio: Promise.resolve({ body: oldAudio, sampleRate: 24_000 }),
    abort() {},
  });
  for (let i = 0; i < 40 && !player.busy; i++) await new Promise((r) => setTimeout(r, 5));
  expect(player.busy).toBe(true);
  await new Promise((r) => setTimeout(r, 15));
  await player.cancel();
  for (let i = 0; i < 40 && player.busy; i++) await new Promise((r) => setTimeout(r, 5));
  expect(player.busy).toBe(false);
  const newAudio = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2 * 240));
      controller.close();
    },
  });
  player.enqueue({
    text: "new",
    audio: Promise.resolve({ body: newAudio, sampleRate: 24_000 }),
    abort() {},
  } as Sentence);
  for (let i = 0; i < 40 && started.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  expect(started).toEqual(["new"]);
});

it("ClockPlayer cancel aborts an in-flight reader so busy clears", async () => {
  const player = new ClockPlayer();
  const audio = new ReadableStream<Uint8Array>({
    start() {},
  });
  player.enqueue({
    text: "hung",
    audio: Promise.resolve({ body: audio, sampleRate: 24_000 }),
    abort() {},
  });
  for (let i = 0; i < 40 && !player.busy; i++) await new Promise((r) => setTimeout(r, 5));
  expect(player.busy).toBe(true);
  await player.cancel();
  for (let i = 0; i < 40 && player.busy; i++) await new Promise((r) => setTimeout(r, 5));
  expect(player.busy).toBe(false);
});

it("drops a duplicate utterance on the same bench turn so admit does not fork a sibling", () => {
  const turn: BenchReplyState = { text: "" };
  expect(shouldSendBenchUtterance(turn)).toBe(true);
  expect(shouldSendBenchUtterance(turn)).toBe(false);
  expect(shouldSendBenchUtterance(turn, { continues: true })).toBe(true);
  expect(shouldSendBenchUtterance({ text: "" })).toBe(true);
});

it("pins a bench interrupt to the cancelled utterance so a replacement send is not killed", () => {
  expect(benchInterruptBody("th-1", { utteranceId: "utt-1" })).toEqual({ threadId: "th-1", expectedUtteranceId: "utt-1" });
  expect(benchInterruptBody("th-1")).toEqual({ threadId: "th-1" });
});

it("a new turn.started drops leftover firstToken from the cancelled guess", () => {
  const state: BenchReplyState = { text: "old", firstToken: 10, sentAt: 1 };
  const busy: boolean[] = [];
  const progress: string[] = [];
  const sink = {
    progress: (text: string) => progress.push(text),
    done: () => {},
    setBusy: (value: boolean) => busy.push(value),
  };
  expect(applyBenchRuntimeEvent({ type: "turn.started", threadId: "t" }, "t", state, sink)).toBe(true);
  expect(state.firstToken).toBeUndefined();
  expect(state.text).toBe("");
  expect(busy).toEqual([true]);
  applyBenchRuntimeEvent({ type: "content.delta", streamKind: "assistant_text", delta: "Hi", threadId: "t" }, "t", state, sink, () => 50);
  expect(state.firstToken).toBe(50);
  expect(progress).toEqual(["Hi"]);
});

it("an interrupted turn.completed does not speak the cancelled guess", () => {
  const state: BenchReplyState = { text: "old guess", sentAt: 1, discard: true };
  const done: string[] = [];
  const sink = {
    progress: () => {},
    done: (text: string) => done.push(text),
    setBusy: () => {},
  };
  applyBenchRuntimeEvent({ type: "turn.completed", threadId: "t" }, "t", state, sink);
  expect(done).toEqual([]);
  expect(state.text).toBe("");
});

it("keeps a stamped firstAudio when a later metrics event omits it", () => {
  const prev = { firstAudioAt: 1015, ttsFirstByteAt: 1000, firstSentenceAt: 900 };
  const next = mergeBenchMetrics(prev, { ttsFirstByteAt: 1000, firstSentenceAt: 900, sentAt: 500 });
  expect(next.firstAudioAt).toBe(1015);
  expect(mergeBenchMetrics(prev, { firstAudioAt: 1080, ttsFirstByteAt: 1000 }).firstAudioAt).toBe(1080);
});

it("stamps ClockPlayer firstAudio 15 ms after TTS first byte when the player missed the start", () => {
  const missed = { ttsFirstByteAt: 1000, firstSentenceAt: 900 };
  stampClockPlayback(missed);
  expect(missed.firstAudioAt).toBe(1015);
  const kept = { ttsFirstByteAt: 1000, firstSentenceAt: 900, firstAudioAt: 1080 };
  stampClockPlayback(kept);
  expect(kept.firstAudioAt).toBe(1080);
  const silent = { firstSentenceAt: 900 };
  stampClockPlayback(silent);
  expect(silent.firstAudioAt).toBeUndefined();
});

it("does not stamp firstAudio from held speculative TTS before the endpoint", () => {
  const held = { ttsFirstByteAt: 1000, firstSentenceAt: 900, earlyStart: true, stoppedAt: 500, endedAt: 500 };
  stampClockPlayback(held);
  expect(held.firstAudioAt).toBeUndefined();
  const confirmed = { ttsFirstByteAt: 1000, firstSentenceAt: 900, earlyStart: true, stoppedAt: 500, endedAt: 800 };
  stampClockPlayback(confirmed);
  expect(confirmed.firstAudioAt).toBe(1015);
});

it("does not keep firstAudio across a new utterance id", () => {
  const prev = { utteranceId: "utt-1", firstAudioAt: 1015, ttsFirstByteAt: 1000 };
  const next = mergeBenchMetrics(prev, { utteranceId: "utt-2", ttsFirstByteAt: 2000, firstSentenceAt: 1900 });
  expect(next.firstAudioAt).toBeUndefined();
  expect(mergeBenchMetrics(prev, { utteranceId: "utt-1", ttsFirstByteAt: 1000 }).firstAudioAt).toBe(1015);
});

it("ClockPlayer ignores a scheduled sentence start after cancel", async () => {
  const player = new ClockPlayer();
  const started: string[] = [];
  player.events.onSentenceStart = (text) => started.push(text);
  let send: ((chunk: Uint8Array) => void) | undefined;
  const audio = new ReadableStream<Uint8Array>({
    start(controller) {
      send = (chunk) => controller.enqueue(chunk);
    },
  });
  player.enqueue({
    text: "old",
    audio: Promise.resolve({ body: audio, sampleRate: 24_000 }),
    abort() {},
  });
  for (let i = 0; i < 20 && !send; i++) await new Promise((r) => setTimeout(r, 5));
  expect(send).toBeTypeOf("function");
  send!(new Uint8Array(2 * 240));
  await new Promise((r) => setTimeout(r, 5));
  expect(started, "start must still be pending when we cancel").toEqual([]);
  await player.cancel();
  await new Promise((r) => setTimeout(r, 40));
  expect(started).toEqual([]);
});

it("opens /api/events after spoken PCM so say spawnSync cannot starve the SSE reader", () => {
  const src = readFileSync(fileURLToPath(new URL("./voice-latency-bench.ts", import.meta.url)), "utf8");
  const spoken = src.indexOf("pcmFrames(spokenPcm(");
  const events = src.indexOf("fetch(`${origin}/api/events`");
  expect(spoken).toBeGreaterThan(-1);
  expect(events).toBeGreaterThan(spoken);
});

it("speaks item.completed when content.delta was missed, and does not replace deltas", () => {
  const progress: string[] = [];
  const done: string[] = [];
  let busy = false;
  const sink = {
    progress: (text: string) => progress.push(text),
    done: (text: string) => done.push(text),
    setBusy: (value: boolean) => { busy = value; },
  };
  const missed: BenchReplyState = { text: "", sentAt: 1 };
  applyBenchRuntimeEvent({ type: "turn.started", threadId: "t1" }, "t1", missed, sink);
  expect(busy).toBe(true);
  applyBenchRuntimeEvent({ type: "item.completed", itemType: "assistant_text", text: "Two plus two is four.", threadId: "t1" }, "t1", missed, sink);
  expect(progress.at(-1)).toBe("Two plus two is four.");
  applyBenchRuntimeEvent({ type: "turn.completed", threadId: "t1" }, "t1", missed, sink);
  expect(done).toEqual(["Two plus two is four."]);
  expect(busy).toBe(false);

  const streamed: BenchReplyState = { text: "", sentAt: 1 };
  applyBenchRuntimeEvent({ type: "content.delta", streamKind: "assistant_text", delta: "Two ", threadId: "t1" }, "t1", streamed, sink);
  applyBenchRuntimeEvent({ type: "content.delta", streamKind: "assistant_text", delta: "plus two.", threadId: "t1" }, "t1", streamed, sink);
  applyBenchRuntimeEvent({ type: "item.completed", itemType: "assistant_text", text: "Two plus two is four.", threadId: "t1" }, "t1", streamed, sink);
  expect(streamed.text).toBe("Two plus two.");
  expect(streamed.firstToken).toBeTypeOf("number");
});

const real = realVoiceBench();
const engines = real
  ? (["xai"] as BenchEngine[])
  : (process.env.BENCH_ENGINES ?? "claude,grok").split(",").map((engine) => engine.trim()).filter((engine): engine is BenchEngine => engine === "claude" || engine === "grok");

it.skipIf(process.env.SAGAX_VOICE_BENCH !== "1")("measures a call's latency stage by stage", async () => {
  const report: Record<string, unknown> = {};
  for (const engine of engines) {
    const { turns, serverLog, acp, diag } = await runVoiceLatencyBench(engine);
    const warm = summarize(turns.slice(1));
    report[engine] = {
      turns,
      first: turns[0],
      warm,
      all: summarize(turns),
      real,
      diag,
      ...(acp ? { establishPerTurn: turns.map((turn) => turn.establish), acp } : {}),
      server: serverLog.split("\n").filter((line) => /\[voice-latency\]|relaunch|error|Error|voice/.test(line)).map((line) => line.replace(/xai-[A-Za-z0-9_-]+/g, "xai-[redacted]")).slice(-40),
    };
    if (real && typeof warm.total?.p50 === "number") {
      report.targetMs = VOICE_BENCH_THRESHOLDS.p50Ms;
      report.warmP50 = warm.total.p50;
    }
    if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(report, null, 2));
    expect(turns.every((turn) => typeof turn.total === "number"), JSON.stringify(turns)).toBe(true);
  }
}, 1_800_000);
