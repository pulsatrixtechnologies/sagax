// Voice mode's live call with a bot (src/lib/voice-mode/call.ts): a phone
// call. The microphone stays open, the person can talk over the bot, and the
// bot's answer is spoken sentence by sentence while it is written.
//
// The BOT answers, never xAI: every accepted turn is dispatched as an
// ordinary message through the normal send route (the bot's engine,
// instructions, memory, tools, approvals, payer rules, the speaker's
// attribution and private-thread rules, the transcript in the thread). xAI
// only hears (speech to text) and reads the bot's own words aloud.
//
// The engine (LiveCallEngine) runs once, window-wide (CallEngineHost), and
// publishes the call (live-call-store.ts); the app's pill (LiveCall) and the
// desktop mascot's only show it and drive it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUserMediaWithFallback, preferredAudioInputId } from "@/lib/audio-input";

import { useStore, useStreaming, visibleMessages, type Bot } from "@/state/store";
import { currentCall, endCall } from "@/lib/call";
import { useVoiceCallMark } from "@/lib/voice-mode/call-mark";
import { spokenAnswer } from "@/lib/voice-mode/answer-budget";
import { spokenDecision } from "@/lib/voice-mode/answers";
import { callTimers } from "@/lib/voice-mode/call-alive";
import { VoiceCall, type BargeInMetrics, type TurnMetrics } from "@/lib/voice-mode/call";
import { readCallSettings } from "@/lib/voice-mode/call-settings";
import {
  cancelSpeech,
  createSpeechFence,
  interruptBot,
  noteUtteranceSent,
  settleReplies,
  streamText,
  type SpeechFence,
} from "@/lib/voice-mode/speech-fence";
import { stageDurations } from "@/lib/voice-mode/latency";
import { acceptVoiceOpener, VOICE_OPENER_EVENT, type VoiceOpenerOwner } from "@/lib/voice-mode/voice-opener";
import { decideBotHangup, VOICE_CALL_ENDED_EVENT, type VoiceCallEndedDetail } from "@/lib/voice-mode/call-end";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { readVoiceModeSettings } from "@/lib/voice-mode/settings";
import { publishLiveCall, retractLiveCall, useLiveCall, type LiveCallData, type LiveCallMetrics } from "@/lib/voice-mode/live-call-store";
import { noteVoiceCallEnded, noteVoiceCallRunning } from "@/lib/voice-call-clock";
import { callBarLines } from "@/lib/voice-call-transcript";
import { activeLocale, t, tIn } from "@/lib/i18n";
import { CallProgress, progressLocale, progressText, turnTools } from "@/lib/voice-mode/progress";
import { CallFailure, callFailureKey } from "@/lib/voice-mode/failure";
import { looksFrench } from "@/lib/voice-mode/turns";
import { announceTopic, callHasBackgroundWork, howToSpeakTopicResult, sourceUserId, topicLabel } from "@/lib/voice-mode/voice-topics";
import { nextSpeakSlot, type SpeakItem, type SpeakPriority } from "@/lib/voice-mode/voice-speak-queue";
import { isRoutineApproval, isSkillApproval, pendingApprovals, spokenApprovalPrompt } from "../PendingApproval";
import { VoiceModeBar, type VoiceAccessCard } from "./VoiceModeBar";

/**
 * firstAudioMs: the person stopped talking -> the first sample of the answer;
 * sentMs: -> the turn's words were sent; duckMs / bargeInMs: first voiced
 * frame over the bot -> the bot ducked / cancelled (all ms).
 */
export type CallMetrics = LiveCallMetrics;

/** How often the call asks whether a progress line is due. */
const PROGRESS_TICK_MS = 500;

/** The person's newest words on the thread (one turn's answers share it). */
function lastUserId(messages: readonly { id: string; role: string; parallelTask?: unknown }[]): string | undefined {
  return [...messages].reverse().find((message) => message.role === "user" && !message.parallelTask)?.id;
}

/** The language the call's own lines are said in: the call's, else the
 * person's last words (French or not) on an English or French page. `sticky`
 * is the locale already settled on this call, kept on auto so the spoken
 * lines do not flip French and English turn to turn. */
function callLocale(
  messages: readonly { role: string; text?: string; parallelTask?: unknown }[],
  callLanguage: string,
  sticky: string | undefined,
) {
  const lastUserText = [...messages].reverse().find((message) => message.role === "user" && !message.parallelTask)?.text;
  return progressLocale({ callLanguage, lastUserText, pageLocale: activeLocale(), looksFrench, sticky });
}

/** Runs the call with this bot and publishes it; draws nothing. */
export function LiveCallEngine({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const { streaming } = useStreaming();
  const [call, setCall] = useState<VoiceCall | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CallMetrics>({});
  const [interrupted, setInterrupted] = useState<Set<string>>(() => new Set());
  /** the cut answers' words the person never heard, by reply id (transcript) */
  const [unheard, setUnheard] = useState<Map<string, string>>(() => new Map());
  /** the last cut: its unheard words go on the reply it cut, once settled */
  const lastCut = useRef<{ unheard: string } | null>(null);
  const threadRef = useRef(bot.threadId);
  threadRef.current = bot.threadId;
  const botRef = useRef(bot);
  botRef.current = bot;
  // this call, for the server: every turn said on it is a phone turn
  // (Message.voiceCall), which gets the hidden phone-call instruction; the
  // server knows the thread is on a call: any send to it while the call
  // lasts is a call turn (typed words, a queued line, a retry), and the
  // call's tools stay the same from turn to turn (call-mark.ts, shared with
  // the older call in CallView)
  const callId = useVoiceCallMark(bot.id, bot.threadId);

  const messages = visibleMessages(bot);
  const approval = pendingApprovals(messages)[0];
  const question = messages.find(
    (message) => message.kind === "options" && message.card?.requestId && !message.card.tool && !message.card.answered && !message.card.dismissed,
  );

  // Everything on screen when the call starts has been read or ignored.
  const spokenIds = useRef<Set<string>>(new Set());
  const started = useRef(false);
  /** A failed turn: one sentence with what to do, then silence (failure.ts). */
  const failure = useRef<CallFailure | null>(null);
  if (!started.current) {
    started.current = true;
    for (const m of messages) spokenIds.current.add(m.id);
    failure.current = new CallFailure(messages);
  }
  const askedApproval = useRef<{ requestId: string; skill: boolean; routine: boolean; submitted: boolean } | null>(null);
  const askedQuestion = useRef<{ requestId: string; messageId: string } | null>(null);
  /** after a barge-in: the old turn's words are not spoken across the next send */
  const fence = useRef<SpeechFence>(createSpeechFence());
  /** The utterance the opener may speak for. Cleared when that turn is dropped. */
  const openerOwner = useRef<VoiceOpenerOwner | null>(null);
  /** Short progress lines from this turn's real tool events (progress.ts). */
  const progress = useRef(new CallProgress());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pendingSpeak = useRef<Array<SpeakItem & { text: string; kind: "say" | "done" }>>([]);
  /** the person's words the "rest is in the chat" line was said for */
  const restSaidFor = useRef<string | null | undefined>(null);
  /** a send's retry belongs to this call: it never fires after the hang-up */
  const timers = useRef(callTimers());
  useEffect(() => {
    const own = timers.current;
    return () => own.clear();
  }, []);
  /** the locale the call's own spoken lines settled on (auto: kept stable) */
  const callLineLocale = useRef<string | undefined>(undefined);
  const localeForCallLines = useCallback(() => {
    const resolved = callLocale(messagesRef.current, call?.language ?? readVoiceModeSettings().language, callLineLocale.current);
    if (resolved === "fr" || resolved === "en") callLineLocale.current = resolved;
    return resolved;
  }, [call]);
  const drainSpeak = useCallback(() => {
    const live = call;
    if (!live) return;
    const slot = nextSpeakSlot({
      userSpeaking: live.current.phase === "hearing",
      // an answer's open utterance plays until its replyDone: never wait on it
      botSpeaking: (live.player.busy || live.current.botAudible) && !live.replyOpen,
      waiting: pendingSpeak.current,
    });
    if (slot.action === "hold") return;
    const item = pendingSpeak.current.find((row) => row.id === slot.id);
    if (!item) return;
    pendingSpeak.current = pendingSpeak.current.filter((row) => row.id !== slot.id);
    const played = item.kind === "done" ? live.replyDone(item.text) : live.say(item.text);
    // an answer cut at the sentence cap says once per turn where the rest
    // is, through this same queue (never over the person); a cut answer
    // (barge-in) or one that stopped at its question says nothing more
    const words = lastUserId(messagesRef.current);
    const restInChat = item.kind === "done" && spokenAnswer(item.text).cut === "length" && restSaidFor.current !== words
      ? tIn(localeForCallLines(), "voiceMode.restInChat")
      : null;
    void Promise.resolve(played)
      .then((heard) => {
        if (!heard || !restInChat) return;
        restSaidFor.current = words;
        pendingSpeak.current.push({ id: `rest-${item.id}`, text: restInChat, priority: "user-reply", at: Date.now(), kind: "say" });
      })
      .finally(() => drainSpeak());
  }, [call, localeForCallLines]);

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
    // the real-Electron check (scripts/verify-voice-mode.ts) drives the call
    // through this handle; it exists only when that check turns it on
    try {
      if (localStorage.getItem("omb.voiceCall.debug") === "1") (window as unknown as { __sagaxVoiceCall?: VoiceCall }).__sagaxVoiceCall = live;
    } catch {
      /* no storage: no handle */
    }
    const offs = [
      live.on("state", (next) => setState(next)),
      live.on("partial", (text) => setHeard(text)),
      live.on("caption", (text) => setCaption(text)),
      live.on("rejected", (reason) => {
        if (reason === "other-voice") setNotice(t("voiceMode.otherVoice"));
      }),
      live.on("error", (reason) => {
        setNote(reason === "mic-denied" ? t("voiceMode.micDenied") : reason === "mic-unavailable" ? t("voiceMode.micUnavailable") : t("voiceMode.transcribeFailed"));
        // words that could not be heard: said aloud too, never a silent drop
        if (reason === "transcribe-failed") void live.say(t("voiceMode.sendFailed"));
      }),
      live.on("metrics", (turn: TurnMetrics | null, barge: BargeInMetrics | null) => {
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
  }, [bot.id, dispatch]);

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
  }, [call, callId]);

  // ── what the person said ───────────────────────────────────────────────
  const onUtterance = useCallback(
    (said: string, interrupted = false, cut?: { heard: string; unheard: string }, continues = false, spokenId?: string, speculative = false) => {
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
        onSent: () => call.accepted(utteranceId),
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
        },
      });
      send();
    },
    [call, callId, dispatch],
  );

  useEffect(() => {
    if (!call) return;
    return call.on("utterance", (text, _metrics, turn) => onUtterance(text, turn.interrupted, turn.cut, turn.continues === true, turn.utteranceId, turn.speculative === true));
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
  }, [call]);

  useEffect(() => {
    call?.setBotBusy(Boolean(bot.busy));
  }, [call, bot.busy]);

  useEffect(() => {
    call?.setBackgroundWork(callHasBackgroundWork(messages));
  }, [call, messages]);

  // ── the answer, sentence by sentence while it is written ──────────────
  const live = streaming[bot.threadId];
  const streamingRef = useRef<string | undefined>(live);
  streamingRef.current = live;
  useEffect(() => {
    if (!call) return;
    const accepted = streamText(fence.current, live);
    fence.current = accepted.fence;
    if (accepted.text === null) return;
    if (openerOwner.current && accepted.text.trim()) {
      openerOwner.current = { ...openerOwner.current, replyStarted: true };
    }
    if (accepted.text.trim()) progress.current.heard(Date.now());
    call.replyProgress(accepted.text);
  }, [call, live]);

  // ── settled messages: the rest of an answer, prompts, narration ───────
  useEffect(() => {
    if (!call) return;
    if (askedApproval.current && approval?.requestId !== askedApproval.current.requestId) askedApproval.current = null;
    if (askedQuestion.current && question?.card?.requestId !== askedQuestion.current.requestId) askedQuestion.current = null;
    if (approval && askedApproval.current?.requestId !== approval.requestId) {
      askedApproval.current = { requestId: approval.requestId, routine: isRoutineApproval(approval), skill: isSkillApproval(approval), submitted: false };
      spokenIds.current.add(approval.message.id);
      void call.say(isSkillApproval(approval) ? t("voiceMode.skillPrompt", { name: bot.name }) : spokenApprovalPrompt(approval, bot.name));
      return;
    }
    if (question?.card?.requestId && askedQuestion.current?.requestId !== question.card.requestId) {
      askedQuestion.current = { requestId: question.card.requestId, messageId: question.id };
      spokenIds.current.add(question.id);
      const detail = question.card.subtitle.trim();
      const choices = question.card.options.length ? ` ${question.card.options.join(", ")}.` : "";
      void call.say(`${detail}${/[.!?]$/.test(detail) ? "" : "."}${choices}`);
      return;
    }
    const fresh = messages.filter((m) => !spokenIds.current.has(m.id));
    if (!fresh.length) return;
    for (const m of fresh) spokenIds.current.add(m.id);
    const settled = settleReplies(fence.current, messages, fresh.map((m) => m.id));
    fence.current = settled.fence;
    for (const id of settled.skip) {
      setInterrupted((previous) => new Set(previous).add(id));
      const cut = lastCut.current;
      lastCut.current = null;
      if (cut?.unheard) setUnheard((previous) => new Map(previous).set(id, cut.unheard));
    }
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    for (const reply of settled.speak) {
      const row = messages.find((message) => message.id === reply.id);
      const idx = messages.findIndex((message) => message.id === reply.id);
      const replyUserId = sourceUserId(messages, idx, row);
      const mode = howToSpeakTopicResult({
        replyUserId,
        lastUserId: lastUser?.id,
        isParallelResult: row?.parallelTask?.role === "result",
      });
      const priority: SpeakPriority = mode === "announce" ? "topic-result" : "user-reply";
      const text = mode === "announce"
        ? announceTopic(topicLabel(messages.find((message) => message.id === replyUserId)?.text ?? row?.parallelTask?.title ?? "the other thing"), spokenAnswer(reply.text).text)
        : reply.text;
      if (!pendingSpeak.current.some((item) => item.id === reply.id)) {
        pendingSpeak.current.push({ id: reply.id, text, priority, at: Date.now(), kind: mode === "announce" ? "say" : "done" });
      }
    }
    for (const m of fresh) {
      if (m.parallelTask?.role === "card" && m.parallelTask.state === "queued") {
        const id = `queued-${m.id}`;
        if (!pendingSpeak.current.some((item) => item.id === id)) {
          pendingSpeak.current.push({
            id,
            text: t("voiceMode.call.taskQueued"),
            priority: "queued-notice",
            at: Date.now(),
            kind: "say",
          });
        }
      }
    }
    drainSpeak();
    // No canned filler and no tool-chip narration here: while the bot works
    // in silence, the progress tick below says a short line built from this
    // turn's real tool events, rate-limited (progress.ts).
  }, [call, messages, approval, question, bot.name, drainSpeak]);

  // ── progress while the bot works in silence (progress.ts) ─────────────
  useEffect(() => {
    if (!call) return;
    const timer = setInterval(() => {
      const asked = askedApproval.current;
      // a failed turn is said once, in one sentence, never its cause
      const failed = failure.current?.next({
        now: Date.now(),
        messages: messagesRef.current,
        botBusy: Boolean(botRef.current.busy),
        // the person talking counts too: never a line over them
        botSpeaking: call.player.busy || call.current.botAudible || pendingSpeak.current.length > 0 || call.current.phase === "hearing",
        awaitingAnswer: Boolean((asked && !asked.submitted) || askedQuestion.current),
      });
      if (failed) {
        const locale = localeForCallLines();
        void call.say(tIn(locale, callFailureKey(failed)) ?? t(callFailureKey(failed)));
        return;
      }
      const planner = progress.current;
      if (!planner.active) return;
      const line = planner.next({
        now: Date.now(),
        thinking: call.current.phase === "thinking",
        botBusy: Boolean(botRef.current.busy),
        botSpeaking: call.player.busy || call.current.botAudible,
        awaitingAnswer: Boolean((asked && !asked.submitted) || askedQuestion.current),
        queued: pendingSpeak.current.length > 0,
        tools: turnTools(messagesRef.current),
      });
      if (!line) return;
      const locale = localeForCallLines();
      const text = progressText(line, (key, params) => tIn(locale, key, params));
      // a filler: its own short clip, never the answer's utterance, never
      // its first audio, and a barge-in cuts it like any speech
      if (text) void call.sayFiller(text);
    }, PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, [call, localeForCallLines]);

  useEffect(() => {
    if (state && !state.botAudible) drainSpeak();
  }, [state, drainSpeak]);

  // ── what every surface shows ─────────────────────────────────────────
  const [startedAt] = useState(() => Date.now());
  const lines = callBarLines(messages);
  const transcriptKey = lines.map((m) => `${m.id}:${m.text!.length}:${interrupted.has(m.id) ? 1 : 0}:${unheard.get(m.id)?.length ?? 0}`).join("|");
  const transcript = useMemo(
    () => lines.map((m) => ({
      id: m.id,
      who: m.role === "user" ? ("you" as const) : ("bot" as const),
      text: m.text!.trim(),
      interrupted: interrupted.has(m.id),
      // the cut answer's words the person never heard, marked
      ...(unheard.has(m.id) ? { unheard: unheard.get(m.id) } : {}),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transcriptKey],
  );
  const data = useMemo<LiveCallData | null>(
    () =>
      call && state
        ? {
            botId: bot.id,
            call,
            state,
            startedAt,
            heard,
            caption,
            note,
            notice,
            transcript,
            metrics,
            retry: () => {
              setNote(null);
              void call.retry();
            },
          }
        : null,
    [bot.id, call, state, startedAt, heard, caption, note, notice, transcript, metrics],
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

/** The app's call pill for this bot, over the call the engine runs. */
export function LiveCall({ bot }: { bot: Bot }) {
  const live = useLiveCall();
  const data = live?.botId === bot.id ? live : null;
  const call = data?.call ?? null;

  // ── keys: Escape hangs up; Space interrupts, or talks in push-to-talk ─
  useEffect(() => {
    if (!call) return;
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        endCall(bot.id);
        return;
      }
      if (event.code !== "Space" || typing(event.target)) return;
      if (readCallSettings().input === "push") {
        event.preventDefault();
        if (!event.repeat) call.pushToTalk(true);
      } else if (call.current.botAudible) {
        event.preventDefault();
        call.interrupt();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || typing(event.target) || readCallSettings().input !== "push") return;
      event.preventDefault();
      call.pushToTalk(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [bot.id, call]);

  if (!data) return null;
  const refusal: VoiceAccessCard | null = null;
  return (
    <VoiceModeBar
      bot={bot}
      call={data.call}
      state={data.state}
      heard={data.heard}
      caption={data.caption}
      note={data.note}
      notice={data.notice}
      refusal={refusal}
      transcript={data.transcript}
      metrics={data.metrics}
      startedAt={data.startedAt}
      onRetry={data.retry}
      onEnd={() => endCall(bot.id)}
    />
  );
}
