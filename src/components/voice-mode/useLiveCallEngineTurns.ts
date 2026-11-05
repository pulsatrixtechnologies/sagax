// Live call turn playback: stream the answer, settle replies, progress lines
// while the bot works in silence. Extracted from LiveCallEngine (#1383).
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { spokenAnswer } from "@/lib/voice-mode/answer-budget";
import { VoiceCall } from "@/lib/voice-mode/call";
import {
  settleReplies,
  streamText,
  type SpeechFence,
} from "@/lib/voice-mode/speech-fence";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { readVoiceModeSettings } from "@/lib/voice-mode/settings";
import { activeLocale, t, tIn } from "@/lib/i18n";
import { CallProgress, progressLocale, progressText, turnTools } from "@/lib/voice-mode/progress";
import { CallFailure, callFailureKey } from "@/lib/voice-mode/failure";
import { looksFrench } from "@/lib/voice-mode/turns";
import { announceTopic, howToSpeakTopicResult, sourceUserId, topicLabel } from "@/lib/voice-mode/voice-topics";
import { nextSpeakSlot, type SpeakItem, type SpeakPriority } from "@/lib/voice-mode/voice-speak-queue";
import type { VoiceOpenerOwner } from "@/lib/voice-mode/voice-opener";
import { isRoutineApproval, isSkillApproval, spokenApprovalPrompt, type Pending } from "../PendingApproval";
import type { Bot, Message } from "@/state/store";

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

type AskedApproval = { requestId: string; skill: boolean; routine: boolean; submitted: boolean };
type AskedQuestion = { requestId: string; messageId: string };

export function useLiveCallEngineTurns(args: {
  bot: Bot;
  call: VoiceCall | null;
  state: CallState | null;
  messages: Message[];
  approval: Pending | undefined;
  question: Message | undefined;
  live: string | undefined;
  fence: MutableRefObject<SpeechFence>;
  openerOwner: MutableRefObject<VoiceOpenerOwner | null>;
  progress: MutableRefObject<CallProgress>;
  askedApproval: MutableRefObject<AskedApproval | null>;
  askedQuestion: MutableRefObject<AskedQuestion | null>;
  spokenIds: MutableRefObject<Set<string>>;
  lastCut: MutableRefObject<{ unheard: string } | null>;
  pendingSpeak: MutableRefObject<Array<SpeakItem & { text: string; kind: "say" | "done" }>>;
  failure: MutableRefObject<CallFailure | null>;
  messagesRef: MutableRefObject<Message[]>;
  botRef: MutableRefObject<Bot>;
  restSaidFor: MutableRefObject<string | null | undefined>;
  callLineLocale: MutableRefObject<string | undefined>;
  setInterrupted: Dispatch<SetStateAction<Set<string>>>;
  setUnheard: Dispatch<SetStateAction<Map<string, string>>>;
}) {
  const {
    bot, call, state, messages, approval, question, live, fence, openerOwner,
    progress, askedApproval, askedQuestion, spokenIds, lastCut, pendingSpeak, failure,
    messagesRef, botRef, restSaidFor, callLineLocale, setInterrupted, setUnheard,
  } = args;

  const localeForCallLines = useCallback(() => {
    const resolved = callLocale(messagesRef.current, call?.language ?? readVoiceModeSettings().language, callLineLocale.current);
    if (resolved === "fr" || resolved === "en") callLineLocale.current = resolved;
    return resolved;
  }, [call, messagesRef, callLineLocale]);

  const drainSpeak = useCallback(() => {
    const liveCall = call;
    if (!liveCall) return;
    const slot = nextSpeakSlot({
      userSpeaking: liveCall.current.phase === "hearing",
      // an answer's open utterance plays until its replyDone: never wait on it
      botSpeaking: (liveCall.player.busy || liveCall.current.botAudible) && !liveCall.replyOpen,
      waiting: pendingSpeak.current,
    });
    if (slot.action === "hold") return;
    const item = pendingSpeak.current.find((row) => row.id === slot.id);
    if (!item) return;
    pendingSpeak.current = pendingSpeak.current.filter((row) => row.id !== slot.id);
    const played = item.kind === "done" ? liveCall.replyDone(item.text) : liveCall.say(item.text);
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
  }, [call, localeForCallLines, messagesRef, pendingSpeak, restSaidFor]);

  // ── the answer, sentence by sentence while it is written ──────────────
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
  }, [call, live, fence, openerOwner, progress]);

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
  }, [call, messages, approval, question, bot.name, drainSpeak, askedApproval, askedQuestion, spokenIds, fence, lastCut, pendingSpeak, setInterrupted, setUnheard]);

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
  }, [call, localeForCallLines, askedApproval, askedQuestion, failure, messagesRef, botRef, pendingSpeak, progress]);

  useEffect(() => {
    if (state && !state.botAudible) drainSpeak();
  }, [state, drainSpeak]);
}
