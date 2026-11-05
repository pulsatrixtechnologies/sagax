import { useCallback, useEffect, useRef, useState } from "react";
import { currentCall, deferCallCleanup } from "@/lib/call";
import { speaker } from "@/lib/tts";
import { CallProgress } from "@/lib/voice-mode/progress";
import type { Dispatch } from "react";
import type { Action, Bot } from "@/state/store";
import type { Phase } from "./types";

const CALL_ENDPOINT_MS = 850;

export function useGroupCallSpeech(args: {
  groupId: string;
  initialPhase: Phase;
  dispatch: Dispatch<Action>;
}) {
  const { groupId, initialPhase, dispatch } = args;

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [heard, setHeard] = useState("");
  /** the words the person is saying now: a failure line never cuts them */
  const heardRef = useRef("");
  heardRef.current = heard;
  const [note, setNote] = useState<string | null>(null);
  const [speakingMemberId, setSpeakingMemberId] = useState<string | null>(null);

  const busyRef = useRef(false);
  const phaseRef = useRef<Phase>(initialPhase);
  const alive = useRef(true);
  const sayGeneration = useRef(0);
  const queueGeneration = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queuedJobs = useRef(new Set<number>());
  const nextJobId = useRef(0);
  const listenWhenDrained = useRef(false);
  const listenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowBargeIn = useRef(false);
  /** Short progress lines from this turn's real tool events (progress.ts). */
  const progress = useRef(new CallProgress());

  const move = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (alive.current) setPhase(next);
  }, []);

  const hush = useCallback(() => {
    void window.ogb?.speechStop?.();
  }, []);

  const listen = useCallback(() => {
    if (!alive.current || currentCall() !== groupId) return;
    move("listening");
    setSpeakingMemberId(null);
    setHeard("");
    setNote(null);
    void window.ogb?.speechStart?.({ endpointMs: CALL_ENDPOINT_MS }).catch(() => {
      if (alive.current && currentCall() === groupId) {
        setNote("The microphone couldn't start. Check Microphone and Speech Recognition access.");
      }
    });
  }, [groupId, move]);

  const scheduleListen = useCallback(
    (force = false, delay = 140) => {
      if (listenTimer.current) clearTimeout(listenTimer.current);
      listenTimer.current = setTimeout(() => {
        listenTimer.current = null;
        if (!alive.current || currentCall() !== groupId || queuedJobs.current.size) return;
        if (force || allowBargeIn.current || !busyRef.current) listen();
      }, delay);
    },
    [groupId, listen],
  );

  const say = useCallback(
    async (text: string, member?: Bot) => {
      if (!alive.current || currentCall() !== groupId) return false;
      const mine = ++sayGeneration.current;
      move("speaking");
      setSpeakingMemberId(member?.id ?? null);
      hush();
      await speaker.speak(text, { botId: member?.id, voiceId: member?.voice });
      return alive.current && currentCall() === groupId && sayGeneration.current === mine;
    },
    [groupId, hush, move],
  );

  const enqueueSpeech = useCallback(
    (text: string, member?: Bot, answerAfter = false) => {
      const generation = queueGeneration.current;
      const jobId = ++nextJobId.current;
      queuedJobs.current.add(jobId);
      if (answerAfter) listenWhenDrained.current = true;
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          if (generation !== queueGeneration.current) return;
          await say(text, member);
        })
        .finally(() => {
          if (generation !== queueGeneration.current) return;
          queuedJobs.current.delete(jobId);
          if (queuedJobs.current.size) return;
          setSpeakingMemberId(null);
          const force = listenWhenDrained.current;
          listenWhenDrained.current = false;
          scheduleListen(force);
        });
    },
    [say, scheduleListen],
  );

  const interruptSpeech = useCallback(() => {
    const wasBusy = busyRef.current;
    queueGeneration.current += 1;
    queue.current = Promise.resolve();
    queuedJobs.current.clear();
    listenWhenDrained.current = false;
    sayGeneration.current += 1;
    speaker.stop();
    setSpeakingMemberId(null);
    progress.current.stop();
    allowBargeIn.current = true;
    if (wasBusy) dispatch({ type: "interruptGroup", groupId });
    listen();
  }, [dispatch, groupId, listen]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueGeneration.current += 1;
      sayGeneration.current += 1;
      if (listenTimer.current) clearTimeout(listenTimer.current);
      deferCallCleanup(groupId, () => alive.current);
    };
  }, [groupId]);

  return {
    phase,
    heard,
    setHeard,
    heardRef,
    note,
    setNote,
    speakingMemberId,
    setSpeakingMemberId,
    busyRef,
    phaseRef,
    alive,
    sayGeneration,
    queueGeneration,
    queuedJobs,
    allowBargeIn,
    progress,
    move,
    hush,
    listen,
    scheduleListen,
    say,
    enqueueSpeech,
    interruptSpeech,
  };
}

export type GroupCallSpeech = ReturnType<typeof useGroupCallSpeech>;
