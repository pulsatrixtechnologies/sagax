// The live voice call, window-wide: one engine runs it (LiveCallEngine, mounted
// once by CallEngineHost for the bot on a call), and every surface that shows
// it reads it here: the app's pill (VoiceCallDock) and the desktop mascot's
// (the floating bots' brain sends it to the mascot's window). So a call
// started from the mascot and one started in the app are the same call, and
// there is never a second microphone or a second voice.
import { useSyncExternalStore } from "react";

import type { CallState } from "./call-machine";

/** What the pill and the mascot drive on a call, whichever engine runs it
 * (the realtime voice, realtime-call.ts, or the older pipeline, call.ts). */
export interface CallControls {
  readonly current: CallState;
  readonly analysers: { mic: AnalyserNode | null; bot: AnalyserNode | null };
  readonly enrolled: boolean;
  enroll(progress: (share: number) => void): Promise<boolean>;
  forgetVoice(): void;
  interrupt(): void;
  hold(): void;
  resume(): void;
  pushToTalk(down: boolean): void;
  setMuted(muted: boolean): void;
  /** the pipeline's endpoint and on-device models (absent on the realtime voice) */
  readonly endpointMs?: number;
  readonly modelsReady?: boolean;
}
import type { stageDurations } from "./latency";

export interface LiveCallTranscriptLine {
  id: string;
  who: "you" | "bot";
  text: string;
  interrupted?: boolean;
  /** the words of a cut answer the person never heard */
  unheard?: string;
}

export interface LiveCallMetrics {
  firstAudioMs?: number;
  sentMs?: number;
  duckMs?: number;
  bargeInMs?: number;
  /** the last answered turn's stages (latency.ts stageDurations) */
  stages?: ReturnType<typeof stageDurations>;
  utteranceId?: string;
}

export interface LiveCallData {
  botId: string;
  call: CallControls;
  state: CallState;
  /** the call runs on the realtime voice (no voiceprint, no pipeline settings) */
  realtime?: boolean;
  /** when the call started (Date.now()) */
  startedAt: number;
  heard: string;
  caption: string;
  note: string | null;
  /** the note's "Try again" means something (the microphone); absent: shown */
  noteRetry?: boolean;
  notice: string | null;
  /** no key serves this person any more: the access card, as before the call */
  refusal?: { cause: import("../../../shared/voice-mode").VoiceModeRefusalCause; admin: boolean; keysUrl?: string } | null;
  transcript: LiveCallTranscriptLine[];
  metrics: LiveCallMetrics;
  retry(): void;
}

let current: LiveCallData | null = null;
const watchers = new Set<() => void>();

/** The engine publishes what it has; null once its call is over. */
export function publishLiveCall(data: LiveCallData | null): void {
  if (data === current) return;
  current = data;
  for (const watcher of Array.from(watchers)) watcher();
}

/** Ownership-safe: an engine going away never clears a newer engine's call. */
export function retractLiveCall(call: CallControls): void {
  if (current?.call === call) publishLiveCall(null);
}

export function liveCallNow(): LiveCallData | null {
  return current;
}

export function subscribeLiveCall(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

export function useLiveCall(): LiveCallData | null {
  return useSyncExternalStore(subscribeLiveCall, liveCallNow, liveCallNow);
}
