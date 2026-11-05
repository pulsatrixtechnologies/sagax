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
import { useEffect, useMemo, useRef, useState } from "react";

import { useStore, useStreaming, visibleMessages, type Bot } from "@/state/store";
import { endCall } from "@/lib/call";
import { useVoiceCallMark } from "@/lib/voice-mode/call-mark";
import { spokenAnswer } from "@/lib/voice-mode/answer-budget";
import { transcriptText } from "@/lib/voice-mode/spoken";
import { callTimers } from "@/lib/voice-mode/call-alive";
import { VoiceCall } from "@/lib/voice-mode/call";
import { readCallSettings } from "@/lib/voice-mode/call-settings";
import { createSpeechFence, type SpeechFence } from "@/lib/voice-mode/speech-fence";
import type { VoiceOpenerOwner } from "@/lib/voice-mode/voice-opener";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { publishLiveCall, retractLiveCall, useLiveCall, type LiveCallData } from "@/lib/voice-mode/live-call-store";
import { noteVoiceCallEnded, noteVoiceCallRunning } from "@/lib/voice-call-clock";
import { callBarLines } from "@/lib/voice-call-transcript";
import { CallProgress } from "@/lib/voice-mode/progress";
import { CallFailure } from "@/lib/voice-mode/failure";
import type { SpeakItem } from "@/lib/voice-mode/voice-speak-queue";
import { pendingApprovals } from "../PendingApproval";
import { VoiceModeBar, type VoiceAccessCard } from "./VoiceModeBar";
import { useLiveCallEngineSession, type CallMetrics } from "./useLiveCallEngineSession";
import { useLiveCallEngineTurns } from "./useLiveCallEngineTurns";

/**
 * firstAudioMs: the person stopped talking -> the first sample of the answer;
 * sentMs: -> the turn's words were sent; duckMs / bargeInMs: first voiced
 * frame over the bot -> the bot ducked / cancelled (all ms).
 */
export type { CallMetrics };

/** Runs the call with this bot and publishes it; draws nothing. */
export function LiveCallEngine({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const { streaming } = useStreaming();
  const [call, setCall] = useState<VoiceCall | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /** the note's "Try again" opens the microphone again: only for its errors */
  const [noteRetry, setNoteRetry] = useState(false);
  /** the note is about the voice or the speech to text: gone once the voice is heard */
  const noteClearsOnVoice = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** no key serves this person any more: the access card, as before the call */
  const [refusal, setRefusal] = useState<VoiceAccessCard | null>(null);
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
  const callIdRef = useRef(callId);
  callIdRef.current = callId;
  // A call is said in the conversation as it is: a fresh topic drafted over
  // it (src/lib/fresh-topic.ts) gives way, so the words typed after the
  // call stay in the same context as the call.
  useEffect(() => {
    dispatch({ type: "freshTopic", botId: bot.id, threadId: null });
  }, [bot.id, dispatch]);

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

  const live = streaming[bot.threadId];
  const streamingRef = useRef<string | undefined>(live);
  streamingRef.current = live;

  useLiveCallEngineSession({
    bot,
    dispatch: dispatch as (action: { type: string; [key: string]: unknown }) => void,
    call,
    setCall,
    setState,
    setHeard,
    setCaption,
    setNote,
    setNoteRetry,
    setNotice,
    setRefusal,
    setMetrics,
    noteClearsOnVoice,
    threadRef,
    botRef,
    callId,
    callIdRef,
    fence,
    openerOwner,
    progress,
    streamingRef,
    askedApproval,
    askedQuestion,
    lastCut,
    pendingSpeak,
    timers,
    messages,
  });

  useLiveCallEngineTurns({
    bot,
    call,
    state,
    messages,
    approval,
    question,
    live,
    fence,
    openerOwner,
    progress,
    askedApproval,
    askedQuestion,
    spokenIds,
    lastCut,
    pendingSpeak,
    failure,
    messagesRef,
    botRef,
    restSaidFor,
    callLineLocale,
    setInterrupted,
    setUnheard,
  });

  // ── what every surface shows ─────────────────────────────────────────
  const [startedAt] = useState(() => Date.now());
  const lines = callBarLines(messages);
  const transcriptKey = lines.map((m) => `${m.id}:${m.text!.length}:${interrupted.has(m.id) ? 1 : 0}:${unheard.get(m.id)?.length ?? 0}`).join("|");
  const transcript = useMemo(
    () => lines.map((m) => ({
      id: m.id,
      who: m.role === "user" ? ("you" as const) : ("bot" as const),
      // the bot's words as they are said: no raw markdown, only the part
      // the call speaks (spoken.ts); the full answer stays in the chat
      text: m.role === "user" ? m.text!.trim() : transcriptText(m.text!, spokenAnswer(m.text!)) || m.text!.trim(),
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
            noteRetry,
            notice,
            refusal,
            transcript,
            metrics,
            retry: () => {
              setNote(null);
              void call.retry();
            },
          }
        : null,
    [bot.id, call, state, startedAt, heard, caption, note, noteRetry, notice, refusal, transcript, metrics],
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
  return (
    <VoiceModeBar
      bot={bot}
      call={data.call}
      state={data.state}
      heard={data.heard}
      caption={data.caption}
      note={data.note}
      noteRetry={data.noteRetry}
      notice={data.notice}
      refusal={data.refusal ?? null}
      transcript={data.transcript}
      metrics={data.metrics}
      startedAt={data.startedAt}
      onRetry={data.retry}
      onEnd={() => endCall(bot.id)}
    />
  );
}
