// The composer's voice note (lib/voice-note.ts): one recording at a time,
// its timer and waveform, then the clip uploaded as an audio attachment and,
// when this bot has speech to text, its words transcribed for the bot. The
// recording is the window's own microphone (the one chosen in Settings),
// never the macOS dictation helper.
import { useCallback, useEffect, useRef, useState } from "react";

import { openPreferredMicrophone } from "@/lib/audio-input";
import { fileAttachmentFromFile, type FileAttachment } from "@/lib/composer-attachments";
import { frameLevel } from "@/lib/composer-dictation";
import { t } from "@/lib/i18n";
import { toPcm16, encodeWav, TARGET_RATE } from "@/lib/voice-mode/audio";
import { transcribeVoiceMode } from "@/lib/voice-mode/api";
import { attachVoiceCapture, type CaptureContext, type CaptureSource, type VoiceCapture } from "@/lib/voice-mode/capture-worklet";
import { transcriptionClips, voiceNoteFileName, waveformBars, VOICE_NOTE_MAX_SECONDS } from "@/lib/voice-note";

export type VoiceNotePhase = "idle" | "recording" | "sending";

/** Shorter than this is a slip of the finger, not a message. */
const MIN_SECONDS = 0.5;

interface Recording {
  stop: () => void;
  frames: Float32Array[];
  rate: number;
}

async function openRecording(onLevel: (level: number) => void, onWaiting?: () => void): Promise<Recording> {
  const stream = await openPreferredMicrophone({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, undefined, onWaiting);
  const context = new AudioContext({ latencyHint: "interactive" });
  const source = context.createMediaStreamSource(stream);
  const frames: Float32Array[] = [];
  let capture: VoiceCapture | null = null;
  const close = () => {
    capture?.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };
  try {
    capture = await attachVoiceCapture(context as unknown as CaptureContext, source as unknown as CaptureSource, (frame) => {
      frames.push(frame);
      onLevel(frameLevel(frame));
    }, { frameSize: 1024, bufferSize: 1024 });
  } catch (error) {
    close();
    throw error;
  }
  return { frames, rate: context.sampleRate, stop: close };
}

/** The words of the recording, clip by clip; "" when speech to text failed. */
async function transcribeRecording(samples: Int16Array, botId: string, threadId?: string): Promise<string> {
  const parts: string[] = [];
  for (const clip of transcriptionClips(samples)) {
    const heard = await transcribeVoiceMode(botId, new Blob([clip.buffer as ArrayBuffer], { type: "audio/wav" }), "auto", threadId);
    if (heard.trim()) parts.push(heard.trim());
  }
  return parts.join(" ");
}

export interface ReadyVoiceNote {
  attachment: FileAttachment;
  /** What was heard, for the bot; empty without speech to text. */
  transcript: string;
  durationMs: number;
}

export function useVoiceNoteRecorder({
  botId,
  threadId,
  transcribe,
  onReady,
}: {
  botId?: string;
  threadId?: string;
  /** This conversation has speech to text (the dictation engine is xAI's). */
  transcribe: boolean;
  onReady: (note: ReadyVoiceNote) => void;
}) {
  const [phase, setPhase] = useState<VoiceNotePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const recording = useRef<Recording | null>(null);
  const levels = useRef<number[]>([]);
  const gone = useRef(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  const close = () => {
    recording.current?.stop();
    recording.current = null;
  };

  // leaving the conversation drops the recording
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      close();
    };
  }, []);

  const finish = useCallback(async () => {
    const taken = recording.current;
    if (phase !== "recording" || !taken) return;
    recording.current = null;
    taken.stop();
    const samples = toPcm16(taken.frames, taken.rate);
    const durationMs = Math.round((samples.length / TARGET_RATE) * 1000);
    if (durationMs < MIN_SECONDS * 1000) {
      setError(t("composer.voiceNote.tooShort"));
      setPhase("idle");
      return;
    }
    setPhase("sending");
    try {
      const wav = encodeWav(samples);
      const file = new File([wav.buffer as ArrayBuffer], voiceNoteFileName(), { type: "audio/wav" });
      const [attachment, transcript] = await Promise.all([
        fileAttachmentFromFile(file),
        transcribe && botId
          ? transcribeRecording(samples, botId, threadId).catch(() => {
            // the clip still goes; the bot gets the file without its words
            setError(t("composer.voiceNote.noTranscript"));
            return "";
          })
          : Promise.resolve(""),
      ]);
      if (!attachment) throw new Error(t("composer.voiceNote.failed"));
      if (!gone.current) readyRef.current({ attachment, transcript, durationMs });
    } catch (failure) {
      if (!gone.current) setError(failure instanceof Error && failure.message ? failure.message : t("composer.voiceNote.failed"));
    } finally {
      if (!gone.current) setPhase("idle");
    }
  }, [phase, transcribe, botId, threadId]);

  // the timer and the waveform repaint at most every 80 ms; the cap sends
  useEffect(() => {
    if (phase !== "recording") return;
    const id = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      setHistory(levels.current.slice(-48));
      if ((at - startedAt) / 1000 >= VOICE_NOTE_MAX_SECONDS) void finish();
    }, 80);
    return () => window.clearInterval(id);
  }, [phase, startedAt, finish]);

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    setError(null);
    levels.current = [];
    setHistory([]);
    try {
      // A slow system prompt keeps waiting (a late "Allow" still records);
      // after a while the person is told what it waits for.
      recording.current = await openRecording((level) => {
        levels.current.push(level);
        if (levels.current.length > 512) levels.current.splice(0, levels.current.length - 256);
      }, () => setError(t("microphone.waitingForPermission")));
      setError(null);
    } catch {
      setError(t("composer.voiceNote.permission"));
      return;
    }
    if (gone.current) {
      close();
      return;
    }
    const at = Date.now();
    setStartedAt(at);
    setNow(at);
    setPhase("recording");
  }, [phase]);

  /** Stops and throws the recording away. */
  const cancel = useCallback(() => {
    if (phase !== "recording") return;
    close();
    setPhase("idle");
  }, [phase]);

  return {
    phase,
    error,
    clearError: () => setError(null),
    seconds: phase === "recording" ? (now - startedAt) / 1000 : 0,
    bars: waveformBars(history),
    start,
    cancel,
    finish,
  };
}
