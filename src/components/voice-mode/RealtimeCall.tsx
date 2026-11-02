// A voice call on the realtime voice (the maintainer, 2026-11-02: never text to speech).
// The engine runs once, window-wide (CallEngineHost), and publishes the call
// (live-call-store.ts); the app's pill (LiveCall) and the desktop mascot
// show it and drive it, as they do the older pipeline's call.
import { useEffect, useMemo, useState } from "react";

import type { Bot } from "@/state/store";
import { endCall } from "@/lib/call";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { readCallSettings } from "@/lib/voice-mode/call-settings";
import { readVoiceModeSettings } from "@/lib/voice-mode/settings";
import { voiceModeRealtimeUrl } from "@/lib/voice-mode/api";
import { publishLiveCall, retractLiveCall, type LiveCallData, type LiveCallMetrics, type LiveCallTranscriptLine } from "@/lib/voice-mode/live-call-store";
import { RealtimeVoiceCall } from "@/lib/voice-mode/realtime-call";
import { noteVoiceCallEnded, noteVoiceCallRunning } from "@/lib/voice-call-clock";
import { preferredAudioInputId } from "@/lib/audio-input";

/** The transcript lines the pill keeps. */
const TRANSCRIPT_LINES = 60;

export function RealtimeCallEngine({ bot }: { bot: Bot }) {
  const [call, setCall] = useState<RealtimeVoiceCall | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<LiveCallTranscriptLine[]>([]);
  const [metrics, setMetrics] = useState<LiveCallMetrics>({});
  const [startedAt] = useState(() => Date.now());
  const callId = useMemo(() => `rt-${startedAt}`, [startedAt]);

  useEffect(() => {
    const engine = new RealtimeVoiceCall({
      url: voiceModeRealtimeUrl(bot.id, readVoiceModeSettings(), bot.threadId),
      deviceId: () => preferredAudioInputId() ?? undefined,
      pushToTalk: () => readCallSettings().input === "push",
    });
    const offs = [
      engine.on("state", (next) => setState(next)),
      engine.on("note", (text) => setNote(text)),
      engine.on("firstAudio", (ms) => setMetrics((previous) => ({ ...previous, firstAudioMs: ms }))),
      engine.on("transcript", (line) => setTranscript((previous) => {
        const at = previous.findIndex((entry) => entry.id === line.id && entry.who === line.who);
        const next = at >= 0 ? previous.map((entry, index) => (index === at ? { ...entry, ...line } : entry)) : [...previous, line];
        return next.slice(-TRANSCRIPT_LINES);
      })),
      // the bot hung up (its goodbye said), or the server ended the call
      engine.on("ended", () => endCall(bot.id)),
    ];
    setCall(engine);
    setState(engine.current);
    void engine.start();
    return () => {
      for (const off of offs) off();
      engine.hangUp();
    };
    // one engine per call: the bot and thread it started on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  const heard = [...transcript].reverse().find((line) => line.who === "you")?.text ?? "";
  const caption = [...transcript].reverse().find((line) => line.who === "bot")?.text ?? "";
  const data = useMemo<LiveCallData | null>(
    () => call && state
      ? {
        botId: bot.id, call, state, startedAt, heard, caption, note, notice: null, transcript, metrics, realtime: true,
        // a refusal (no realtime voice, a refused key) is said and stays: no retry pretends otherwise
        noteRetry: !call.refused,
        retry: () => { setNote(null); call.retry(); },
      }
      : null,
    [bot.id, call, state, startedAt, heard, caption, note, transcript, metrics],
  );
  useEffect(() => {
    noteVoiceCallRunning({ botId: bot.id, callId, startedAt });
    return () => noteVoiceCallEnded(callId);
  }, [bot.id, callId, startedAt]);
  useEffect(() => {
    if (data) publishLiveCall(data);
  }, [data]);
  useEffect(() => {
    if (!call) return;
    return () => retractLiveCall(call);
  }, [call]);
  return null;
}
