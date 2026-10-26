// The composer's dictation (src/lib/composer-dictation.ts): one recording at
// a time, its timer and level bars, written into the field. Native: the macOS
// helper streams partials into the field. xai: the clip is captured here and
// transcribed once it stops ("processing" meanwhile).
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { dictationLevels, frameLevel, joinDictated, type DictationEngine } from "@/lib/composer-dictation";
import { encodeWav, toPcm16 } from "@/lib/voice-mode/audio";
import { attachVoiceCapture, type CaptureContext, type CaptureSource, type VoiceCapture } from "@/lib/voice-mode/capture-worklet";
import { transcribeVoiceMode } from "@/lib/voice-mode/api";
import { openPreferredMicrophone } from "@/lib/audio-input";

export type DictationPhase = "idle" | "recording" | "processing";

interface Microphone {
  stop: () => void;
  frames: Float32Array[];
  rate: number;
}

/** Opens the microphone: frames for the xAI clip, loudness for the bars. */
async function openMicrophone(onLevel: (level: number) => void, keep: boolean, onWaiting?: () => void): Promise<Microphone> {
  // the microphone chosen in Settings (lib/audio-input), else the default
  const stream = await openPreferredMicrophone({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, undefined, onWaiting);
  const context = new AudioContext({ latencyHint: "interactive" });
  const source = context.createMediaStreamSource(stream);
  const frames: Float32Array[] = [];
  let capture: VoiceCapture | null = null;
  try {
    capture = await attachVoiceCapture(context as unknown as CaptureContext, source as unknown as CaptureSource, (frame) => {
      if (keep) frames.push(frame);
      onLevel(frameLevel(frame));
    }, { frameSize: 1024, bufferSize: 1024 });
  } catch {
    // no capture node: the bars stay at rest, the native helper still hears
  }
  return {
    frames,
    rate: context.sampleRate,
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

  const finishXai = useCallback(async (microphone: Microphone) => {
    if (discard.current || !botId) {
      setPhase("idle");
      return;
    }
    const samples = toPcm16(microphone.frames, microphone.rate);
    if (!samples.length) {
      setPhase("idle");
      return;
    }
    setPhase("processing");
    try {
      const wav = encodeWav(samples);
      const heard = await transcribeVoiceMode(botId, new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), "auto", threadId);
      editRef.current(joinDictated(base.current, heard));
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : t("composer.dictation.failed"));
    } finally {
      setPhase("idle");
    }
  }, [botId, threadId]);

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
      void openMicrophone((level) => levelRef.current.push(level), false)
        .then((opened) => {
          if (running.current === "native" && !discard.current) mic.current = opened;
          else opened.stop();
        })
        .catch(() => undefined);
      return;
    }
    try {
      mic.current = await openMicrophone((level) => levelRef.current.push(level), true, () => setError(t("microphone.waitingForPermission")));
      setError(null);
      setPhase("recording");
    } catch {
      setError(t("composer.dictation.permission"));
      running.current = null;
    }
  }, [engine, phase, text]);

  /** Stops listening; what was heard stays in the field. */
  const stop = useCallback(() => {
    if (phase !== "recording") return;
    const which = running.current;
    running.current = null;
    if (which === "xai" && mic.current) {
      const microphone = mic.current;
      mic.current = null;
      microphone.stop();
      void finishXai(microphone);
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
