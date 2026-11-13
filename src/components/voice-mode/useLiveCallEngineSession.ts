// Live call session: microphone mount, hang-up from the server, and what the
// person said (utterance, opener, busy / background work). Extracted from
// LiveCallEngine so each function stays under 400 lines (#1383).
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { getUserMediaWithFallback, preferredAudioInputId } from "@/lib/audio-input";
import { currentCall, endCall } from "@/lib/call";
import { spokenDecision } from "@/lib/voice-mode/answers";
import { VoiceCall, type BargeInMetrics, type TurnMetrics } from "@/lib/voice-mode/call";
import { readCallSettings } from "@/lib/voice-mode/call-settings";
import {
  cancelSpeech,
  interruptBot,
  noteUtteranceSent,
  type SpeechFence,
} from "@/lib/voice-mode/speech-fence";
import { clientTurnTiming, stageDurations } from "@/lib/voice-mode/latency";
import { acceptVoiceOpener, VOICE_OPENER_EVENT, type VoiceOpenerOwner } from "@/lib/voice-mode/voice-opener";
import { decideBotHangup, VOICE_CALL_ENDED_EVENT, type VoiceCallEndedDetail } from "@/lib/voice-mode/call-end";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { readVoiceModeSettings } from "@/lib/voice-mode/settings";
import type { LiveCallMetrics } from "@/lib/voice-mode/live-call-store";
import { CallProgress } from "@/lib/voice-mode/progress";
import { voiceErrorNote, voiceKeyFallbackNote } from "@/lib/voice-mode/failure";
import { onVoiceKeyEvent, voiceCallHeard, VoiceModeRefused, voiceFailureKind } from "@/lib/voice-mode/api";
import { callTimers } from "@/lib/voice-mode/call-alive";
import { callHasBackgroundWork, callSendWaitsForSlot } from "@/lib/voice-mode/voice-topics";
import type { SpeakItem } from "@/lib/voice-mode/voice-speak-queue";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { VoiceAccessCard } from "./VoiceModeBar";

export type CallMetrics = LiveCallMetrics;

type AskedApproval = { requestId: string; skill: boolean; routine: boolean; submitted: boolean };
type AskedQuestion = { requestId: string; messageId: string };

export function useLiveCallEngineSession(args: {
  bot: Bot;
  dispatch: Dispatch<{ type: string; [key: string]: unknown }>;
  call: VoiceCall | null;
  setCall: Dispatch<SetStateAction<VoiceCall | null>>;
  setState: Dispatch<SetStateAction<CallState | null>>;
  setHeard: Dispatch<SetStateAction<string>>;
  setCaption: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string | null>>;
  setNoteRetry: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setRefusal: Dispatch<SetStateAction<VoiceAccessCard | null>>;
  setMetrics: Dispatch<SetStateAction<CallMetrics>>;
  noteClearsOnVoice: MutableRefObject<boolean>;
  threadRef: MutableRefObject<string>;
  botRef: MutableRefObject<Bot>;
  callId: string;
  callIdRef: MutableRefObject<string>;
  fence: MutableRefObject<SpeechFence>;
  openerOwner: MutableRefObject<VoiceOpenerOwner | null>;
  progress: MutableRefObject<CallProgress>;
  streamingRef: MutableRefObject<string | undefined>;
  askedApproval: MutableRefObject<AskedApproval | null>;
  askedQuestion: MutableRefObject<AskedQuestion | null>;
  lastCut: MutableRefObject<{ unheard: string } | null>;
  pendingSpeak: MutableRefObject<Array<SpeakItem & { text: string; kind: "say" | "done" }>>;
  timers: MutableRefObject<ReturnType<typeof callTimers>>;
  messages: Array<{ id: string; role: string; kind?: string; tool?: { name?: string; ok?: boolean }; parallelTask?: { role?: string; state?: string } }>;
}) {
  const {
    bot, dispatch, call, setCall, setState, setHeard, setCaption, setNote, setNoteRetry,
    setNotice, setRefusal, setMetrics, noteClearsOnVoice, threadRef, botRef, callId, callIdRef,
    fence, openerOwner, progress, streamingRef, askedApproval, askedQuestion, lastCut,
    pendingSpeak, timers, messages,
  } = args;

  // ── the call itself (one per mount; StrictMode's probe gets its own) ──
  useEffect(() => {
    const live = new VoiceCall({
      botId: bot.id,
      threadId: () => threadRef.current,
      voice: readVoiceModeSettings,
      settings: readCallSettings,
      // the microphone chosen in Settings; gone, the call opens the default
      deviceId: preferredAudioInputId,
      getUserMedia: (constraints) => getUserMediaWithFallback(constraints),
    });
    setCall(live);
    // the real-Electron check (scripts/verify/dev/verify-voice-mode.ts) drives the call
    // through this handle; it exists only when that check turns it on
    try {
      if (localStorage.getItem("omb.voiceCall.debug") === "1") (window as unknown as { __sagaxVoiceCall?: VoiceCall }).__sagaxVoiceCall = live;
    } catch {
      /* no storage: no handle */
    }
    const offs = [
      live.on("state", (next) => setState(next)),
      live.on("partial", (text) => setHeard(text)),
      live.on("caption", (text) => {
        setCaption(text);
        // the voice is heard again: a voice failure is over
        if (noteClearsOnVoice.current) {
          noteClearsOnVoice.current = false;
          setNote(null);
        }
      }),
      live.on("rejected", (reason) => {
        if (reason === "other-voice") setNotice(t("voiceMode.otherVoice"));
      }),
      // the voice went on over another key (one was refused for credits or
      // for itself): said once, never a silent switch
      onVoiceKeyEvent((event) => {
        setRefusal(null);
        setNotice(voiceKeyFallbackNote(event, t));
      }),
      live.on("error", (reason, cause) => {
        // no key serves this person any more (a key removed mid-call): the
        // access card, as before the call
        if (cause instanceof VoiceModeRefused) {
          setRefusal({ cause: cause.cause, admin: cause.admin, ...(cause.keysUrl ? { keysUrl: cause.keysUrl } : {}) });
          return;
        }
        // what failed, said plainly: a rejected key, no credits, xAI busy
        // or down, which key it was, never a vague "didn't come through"
        // (failure.ts)
        const shown = voiceErrorNote(reason, voiceFailureKind(cause), cause, t);
        noteClearsOnVoice.current = shown.clearsOnVoice;
        setNoteRetry(shown.retry);
        setNote(t(shown.key, shown.params));
        // words that could not be heard: said aloud too, never a silent drop
        if (reason === "transcribe-failed") void live.say(t("voiceMode.sendFailed"));
      }),
      live.on("metrics", (turn: TurnMetrics | null, barge: BargeInMetrics | null) => {
        // the turn's audio stages go to the thread's Events lens
        if (turn?.firstAudioAt !== undefined && turn.utteranceId) {
          const stages = stageDurations(turn);
          void voiceCallHeard(bot.id, { callId: callIdRef.current, threadId: threadRef.current }, {
            ...(stages.firstSentence !== undefined ? { firstSentenceMs: stages.firstSentence } : {}),
            ...(stages.tts !== undefined ? { ttsMs: stages.tts } : {}),
            ...(stages.playback !== undefined ? { playbackMs: stages.playback } : {}),
            ...(stages.total !== undefined ? { totalMs: stages.total } : {}),
          });
        }
        setMetrics({
          ...(turn?.firstAudioAt !== undefined ? { firstAudioMs: Math.round(turn.firstAudioAt - turn.stoppedAt) } : {}),
          ...(turn?.sentAt !== undefined ? { sentMs: Math.round(turn.sentAt - turn.stoppedAt) } : {}),
          // the last turn's stages (ids and milliseconds only)
          ...(turn?.firstAudioAt !== undefined ? { stages: stageDurations(turn), ...(turn.utteranceId ? { utteranceId: turn.utteranceId } : {}) } : {}),
          ...(barge?.duckedAt !== undefined ? { duckMs: Math.round(barge.duckedAt - barge.candidateAt) } : {}),
          ...(barge?.cancelledAt !== undefined ? { bargeInMs: Math.round(barge.cancelledAt - barge.candidateAt) } : {}),
        });
      }),
      live.on("speech-cancelled", (cut) => {
        openerOwner.current = null;
        progress.current.stop();
        setCaption("");
        if (cut.unheard) lastCut.current = { unheard: cut.unheard };
        // what was being said is cut: the rest of that answer is not spoken
        fence.current = cancelSpeech(fence.current, streamingRef.current);
      }),
      live.on("interrupt-bot", (target) => {
        openerOwner.current = null;
        progress.current.stop();
        const current = botRef.current;
        // an approval or option card being answered by voice keeps its turn
        if (askedApproval.current || askedQuestion.current || !current.busy) return;
        // what the stopped turn still streams is never spoken
        fence.current = interruptBot(fence.current, streamingRef.current);
        dispatch({
          type: "interrupt",
          botId: current.id,
          threadId: current.threadId,
          ...(target?.utteranceId ? { expectedUtteranceId: target.utteranceId } : {}),
        });
      }),
    ];
    void live.start();
    return () => {
      for (const off of offs) off();
      live.end();
    };
  }, [bot.id, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps -- mount once per bot; refs hold the rest

  // The server said this call ended (the bot, or the person on another
  // device). Mute at once so nothing new is said, let a goodbye finish,
  // then leave the call. The button on this device does not wait.
  useEffect(() => {
    if (!call) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const onEnded = (event: Event) => {
      const detail = (event as CustomEvent<VoiceCallEndedDetail>).detail;
      if (!detail || detail.callId !== callId || detail.threadId !== threadRef.current) return;
      if (detail.by !== "bot" && detail.by !== "person") return;
      if (timer) clearTimeout(timer);
      call.setMuted(true);
      const started = Date.now();
      let heardSpeech = false;
      const tick = () => {
        if (stopped) return;
        const speaking = call.player.busy || call.current.botAudible || pendingSpeak.current.length > 0;
        if (speaking) heardSpeech = true;
        if (decideBotHangup({ speaking, heardSpeech, elapsedMs: Date.now() - started }) === "wait") {
          timer = setTimeout(tick, 80);
          return;
        }
        if (stopped) return;
        call.end();
        endCall(botRef.current.id);
      };
      tick();
    };
    window.addEventListener(VOICE_CALL_ENDED_EVENT, onEnded);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(VOICE_CALL_ENDED_EVENT, onEnded);
    };
  }, [call, callId, botRef, threadRef, pendingSpeak]);

  // ── what the person said ───────────────────────────────────────────────
  const onUtterance = useCallback(
    (said: string, interrupted = false, cut?: { heard: string; unheard: string }, continues = false, spokenId?: string, speculative = false, metrics?: TurnMetrics) => {
      const current = botRef.current;
      if (!call || currentCall() !== current.id) return;
      setHeard("");
      setNotice(null);
      const open = askedApproval.current;
      if (open && !open.submitted) {
        const decision = spokenDecision(said);
        if (decision) {
          const allow = decision === "allow";
          if (allow && open.skill) {
            void call.say(t("voiceMode.skillReview"));
            return;
          }
          open.submitted = true;
          dispatch({
            type: "decideRequest",
            threadId: current.threadId,
            requestId: open.requestId,
            behavior: allow ? "allow" : "deny",
            message: allow ? undefined : "Denied by the user, on a call.",
            onError: () => {
              if (askedApproval.current?.requestId === open.requestId) askedApproval.current.submitted = false;
              void call.say(t("voiceMode.approvalFailed"));
            },
          });
          return;
        }
        // not one of the two options: ask them again, never guess
        void call.say(t("voiceMode.allowOnceOrDeny"));
        return;
      }
      const openQuestion = askedQuestion.current;
      if (openQuestion) {
        askedQuestion.current = null;
        dispatch({ type: "answerCard", botId: current.id, threadId: current.threadId, messageId: openQuestion.messageId, answer: said });
        return;
      }
      // a new turn: a cut answer that settles after this send stays silent
      fence.current = noteUtteranceSent(fence.current);
      const language = readVoiceModeSettings().language;
      // one id per utterance: the server delivers it once, whatever retries,
      // and logs its stages under it (the call's timeline uses the same)
      const utteranceId = spokenId ?? crypto.randomUUID();
      openerOwner.current = { threadId: current.threadId, callId, utteranceId, replyStarted: false };
      progress.current.turnSent(Date.now());
      // a send that failed (a network blip, a turn that ended under it) is
      // tried again once with the same utterance; then the person is told,
      // never left waiting on silence
      let attempts = 0;
      const onError = () => {
        attempts += 1;
        if (attempts > 1 || currentCall() !== current.id) {
          void call.say(t("voiceMode.sendFailed"));
          return;
        }
        timers.current.later(() => {
          // the call ended meanwhile: its words are not sent under its id
          if (currentCall() === current.id) send();
        }, 800);
      };
      const send = () => dispatch({
        type: "send",
        botId: current.id,
        text: said,
        threadId: current.threadId,
        sendId: utteranceId,
        onError,
        onSent: (receipt?: unknown) => {
          call.accepted(utteranceId);
          // #4216: past the bot's parallel limit the request waits its turn
          if (callSendWaitsForSlot(receipt)) void call.say(t("voiceMode.call.taskQueued"));
        },
        voiceCall: {
          callId,
          utteranceId,
          // it completes the fragment sent just before (cut by a pause)
          ...(continues ? { continues: true } : {}),
          // a barge-in says how much of the cut answer the person heard
          ...(interrupted ? { interrupted: true, ...(cut ? { heard: cut.heard, unheard: cut.unheard } : {}) } : {}),
          ...(language && language !== "auto" ? { language } : {}),
          ...(readCallSettings().fullDuplex ? { duplex: true } : {}),
          ...(speculative ? { speculative: true } : {}),
          // where this turn's seconds went on the page (Events lens)
          ...(metrics ? { timing: clientTurnTiming(metrics, performance.now()) } : {}),
        },
      });
      send();
    },
    [call, callId, dispatch, botRef, setHeard, setNotice, askedApproval, askedQuestion, fence, openerOwner, progress, timers],
  );

  useEffect(() => {
    if (!call) return;
    return call.on("utterance", (text, metrics, turn) => onUtterance(text, turn.interrupted, turn.cut, turn.continues === true, turn.utteranceId, turn.speculative === true, metrics ?? undefined));
  }, [call, onUtterance]);

  useEffect(() => {
    if (!call) return;
    const onOpener = (event: Event) => {
      const text = acceptVoiceOpener(openerOwner.current, (event as CustomEvent<VoiceOpenerOwner & { text?: string }>).detail);
      if (!text) return;
      openerOwner.current = openerOwner.current ? { ...openerOwner.current, replyStarted: true } : null;
      progress.current.heard(Date.now());
      void call.say(text);
    };
    window.addEventListener(VOICE_OPENER_EVENT, onOpener);
    return () => window.removeEventListener(VOICE_OPENER_EVENT, onOpener);
  }, [call, openerOwner, progress]);

  useEffect(() => {
    call?.setBotBusy(Boolean(bot.busy));
  }, [call, bot.busy]);

  useEffect(() => {
    call?.setBackgroundWork(callHasBackgroundWork(messages));
  }, [call, messages]);
}
