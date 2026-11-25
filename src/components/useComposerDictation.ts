// The composer's dictation (src/lib/composer-dictation.ts): one recording at
// a time, its timer and level bars, written into the field. Native: the macOS
// helper streams partials into the field. xai: the audio streams to xAI's
// streaming speech to text while the person speaks (the call's listen
// socket, lib/voice-mode/stt-stream.ts), the words appear in the field as
// they are recognized, and stopping only asks for the last ones
// ("processing" for a few hundred ms). Until 0.8.17 the whole clip was
// uploaded after the stop, the field stayed empty meanwhile and the wait
// grew with the length of the recording. Without the socket (an old server,
// a proxy without WebSockets) the clip is still uploaded whole.
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { dictationLevels, frameLevel, joinDictated, type DictationEngine } from "@/lib/composer-dictation";
import { dictationFrame, DICTATION_RATE } from "@/lib/composer-dictation";
import { attachVoiceCapture, type CaptureContext, type CaptureSource, type VoiceCapture } from "@/lib/voice-mode/capture-worklet";
import { voiceFailureKind } from "@/lib/voice-mode/api";
import { LiveTranscriber } from "@/lib/voice-mode/stt-stream";
import { voiceErrorNote } from "@/lib/voice-mode/failure";
import { openPreferredMicrophone } from "@/lib/audio-input";
import { readDictationLanguage } from "@/lib/composer-voice";

export type DictationPhase = "idle" | "recording" | "processing";

/** After the stop, how long xAI's last words may take before the words
 * already streamed are kept as they are. */
export const DICTATION_FINAL_TIMEOUT_MS = 1_500;

interface Microphone {
  stop: () => void;
}

/** Opens the microphone: 16 kHz frames for xAI (`onFrame`), loudness for the bars. */
export async function openMicrophone(onLevel: (level: number) => void, onFrame: ((frame: Float32Array) => void) | null, onWaiting?: () => void): Promise<Microphone> {
  // the microphone chosen in Settings (lib/audio-input), else the default
  const stream = await openPreferredMicrophone({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, undefined, onWaiting);
  // 16 kHz straight from the browser when it can (what xAI hears); else
  // each frame is brought down to it here
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: DICTATION_RATE, latencyHint: "interactive" });
  } catch {
    context = new AudioContext({ latencyHint: "interactive" });
  }
  const rate = context.sampleRate;
  const source = context.createMediaStreamSource(stream);
  let capture: VoiceCapture | null = null;
  try {
    capture = await attachVoiceCapture(context as unknown as CaptureContext, source as unknown as CaptureSource, (frame) => {
      onFrame?.(dictationFrame(frame, rate));
      onLevel(frameLevel(frame));
    }, { frameSize: 1024, bufferSize: 1024 });
  } catch {
    // no capture node: the bars stay at rest, the native helper still hears
  }
  return {
    stop: () => {
      capture?.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => undefined);
    },
  };
}

export function useComposerDictation({
  engine,
  botId,
  threadId,
  text,
  editText,
}: {
  engine: DictationEngine | null;
  botId?: string;
  threadId?: string;
  text: string;
  editText: (next: string) => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  // what the field held before the mic went on: what is heard joins it
  const base = useRef("");
  const mic = useRef<Microphone | null>(null);
  const ears = useRef<LiveTranscriber | null>(null);
  const running = useRef<DictationEngine | null>(null);
  const discard = useRef(false);
  const editRef = useRef(editText);
  editRef.current = editText;
  const levelRef = useRef<number[]>([]);

  // the timer and the bars repaint at most every 80 ms
  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      setHistory(levelRef.current.slice(-12));
    }, 80);
    return () => window.clearInterval(id);
  }, [phase]);

  const closeMic = () => {
    mic.current?.stop();
    mic.current = null;
  };

  const closeEars = () => {
    ears.current?.close();
    ears.current = null;
  };

  /** The person stopped: the last words only (the rest is already in the
   * field), then the field holds what was said. */
  const finishXai = useCallback(async (transcriber: LiveTranscriber) => {
    if (discard.current) {
      transcriber.close();
      setPhase("idle");
      return;
    }
    // nothing was heard (stopped at once): no request at all
    if (!transcriber.audio().length) {
      transcriber.close();
      if (ears.current === transcriber) ears.current = null;
      setPhase("idle");
      return;
    }
    setPhase("processing");
    const stoppedAt = performance.now();
    try {
      const heard = await transcriber.finishHeard();
      if (heard.failed) throw transcriber.uploadError ?? new Error(t("composer.dictation.failed"));
      if (!discard.current) editRef.current(joinDictated(base.current, heard.text));
      // ids and milliseconds only, never the words
      console.info(`[dictation] words ready ${Math.round(performance.now() - stoppedAt)} ms after the stop (${transcriber.streaming ? "streaming" : "whole recording"})`);
    } catch (failure) {
      // the reason and the key it is about (failure.ts), never a raw line
      const kind = voiceFailureKind(failure);
      if (kind) {
        const shown = voiceErrorNote("transcribe-failed", kind, failure, t);
        setError(t(shown.key, shown.params));
      } else setError(failure instanceof Error && failure.message ? failure.message : t("composer.dictation.failed"));
    } finally {
      transcriber.close();
      if (ears.current === transcriber) ears.current = null;
      setPhase("idle");
    }
  }, []);

  // the native helper: partials replace the dictated tail as they grow
  useEffect(() => {
    if (phase !== "recording" || running.current !== "native") return;
    const bridge = window.ogb;
    if (!bridge) {
      setPhase("idle");
      return;
    }
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.text === "string" && !discard.current) editRef.current(joinDictated(base.current, line.text));
    });
    const offEnd = bridge.onSpeechEnd(({ code, reason }) => {
      closeMic();
      setPhase("idle");
      if (code === 2) setError(t("composer.dictation.macOnly"));
      else if (code === 1) {
        setError(t(
          reason === "dictation-disabled"
            ? "composer.dictation.disabled"
            : reason === "speech-not-authorized"
              ? "composer.dictation.permission"
              : "composer.dictation.failed",
        ));
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [phase]);

  // leaving the conversation ends the recording without writing anything
  useEffect(() => () => {
    discard.current = true;
    closeMic();
    closeEars();
  }, []);

  const start = useCallback(async () => {
    if (!engine || phase !== "idle") return;
    setError(null);
    discard.current = false;
    base.current = text.trim();
    levelRef.current = [];
    setHistory([]);
    running.current = engine;
    const at = Date.now();
    setStartedAt(at);
    setNow(at);
    if (engine === "native") {
      setPhase("recording");
      // the bars only: a microphone refused here leaves them at rest
      void openMicrophone((level) => levelRef.current.push(level), null)
        .then((opened) => {
          if (running.current === "native" && !discard.current) mic.current = opened;
          else opened.stop();
        })
        .catch(() => undefined);
      return;
    }
    if (!botId) {
      running.current = null;
      return;
    }
    // the ears open while the microphone does: the frames heard before the
    // socket is ready wait in the utterance and go out once it is
    const transcriber = new LiveTranscriber({ botId, language: () => readDictationLanguage(), threadId: () => threadId, finalTimeoutMs: DICTATION_FINAL_TIMEOUT_MS });
    ears.current = transcriber;
    transcriber.onPartial((heard) => {
      if (!discard.current && ears.current === transcriber) editRef.current(joinDictated(base.current, heard));
    });
    void transcriber.connect();
    transcriber.begin([]);
    try {
      mic.current = await openMicrophone((level) => levelRef.current.push(level), (frame) => transcriber.push(frame), () => setError(t("microphone.waitingForPermission")));
      setError(null);
      setPhase("recording");
    } catch {
      setError(t("composer.dictation.permission"));
      running.current = null;
      transcriber.close();
      if (ears.current === transcriber) ears.current = null;
    }
  }, [engine, phase, text, botId, threadId]);

  /** Stops listening; what was heard stays in the field. */
  const stop = useCallback(() => {
    if (phase !== "recording") return;
    const which = running.current;
    running.current = null;
    if (which === "xai" && ears.current) {
      const transcriber = ears.current;
      closeMic();
      void finishXai(transcriber);
      return;
    }
    closeMic();
    setPhase("idle");
  }, [phase, finishXai]);

  /** Stops and puts the field back as it was before the mic went on. */
  const cancel = useCallback(() => {
    if (phase === "idle") return;
    discard.current = true;
    running.current = null;
    closeMic();
    closeEars();
    editRef.current(base.current);
    setPhase("idle");
  }, [phase]);

  return {
    phase,
    error,
    clearError: () => setError(null),
    seconds: phase === "recording" ? (now - startedAt) / 1000 : 0,
    levels: dictationLevels(history),
    start,
    stop,
    cancel,
  };
}
