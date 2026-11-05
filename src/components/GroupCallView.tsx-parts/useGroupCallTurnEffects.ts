import { useEffect, type Dispatch, type MutableRefObject } from "react";
import { currentCall, endCall } from "@/lib/call";
import { routeSpokenGroupMessage } from "@/lib/group-call";
import { speaker } from "@/lib/tts";
import type { Action, Bot, Group, Message } from "@/state/store";
import { isRoutineApproval, isSkillApproval, spokenApprovalPrompt, type Pending } from "../PendingApproval";
import { spokenDecision } from "@/lib/voice-mode/answers";
import { spokenAnswer, spokenReply } from "@/lib/voice-mode/answer-budget";
import { activeLocale, t, tIn } from "@/lib/i18n";
import { progressLocale, progressText, turnToolAuthor, turnTools } from "@/lib/voice-mode/progress";
import { CallFailure, callFailureKey } from "@/lib/voice-mode/failure";
import { looksFrench } from "@/lib/voice-mode/turns";
import type { GroupCallSpeech } from "./useGroupCallSpeech";

/** How often the call asks whether a progress line is due. */
const PROGRESS_TICK_MS = 500;

type AskedApproval = {
  requestId: string;
  member?: Bot;
  routine: boolean;
  skill: boolean;
  submitted: boolean;
};

type AskedQuestion = { requestId: string; member?: Bot };

export function useGroupCallTurnEffects(args: {
  group: Group;
  members: Bot[];
  messages: Message[];
  approval: Pending | undefined;
  question: Message | undefined;
  dispatch: Dispatch<Action>;
  speech: GroupCallSpeech;
  membersRef: MutableRefObject<Bot[]>;
  defaultResponderRef: MutableRefObject<Group["defaultResponder"]>;
  messagesRef: MutableRefObject<Message[]>;
  spokenIds: MutableRefObject<Set<string>>;
  failure: MutableRefObject<CallFailure | null>;
  askedApproval: MutableRefObject<AskedApproval | null>;
  askedQuestion: MutableRefObject<AskedQuestion | null>;
}) {
  const {
    group,
    members,
    messages,
    approval,
    question,
    dispatch,
    speech,
    membersRef,
    defaultResponderRef,
    messagesRef,
    spokenIds,
    failure,
    askedApproval,
    askedQuestion,
  } = args;

  const {
    setHeard,
    setNote,
    heardRef,
    busyRef,
    phaseRef,
    alive,
    queuedJobs,
    allowBargeIn,
    progress,
    move,
    hush,
    listen,
    scheduleListen,
    enqueueSpeech,
    interruptSpeech,
  } = speech;

  useEffect(() => {
    const bridge = window.ogb;
    if (!bridge) return;
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (!alive.current || currentCall() !== group.id || phaseRef.current !== "listening") return;
      if (line.error) {
        setNote("Dictation stopped unexpectedly. Check Microphone and Speech Recognition access.");
        return;
      }
      if (typeof line.text !== "string") return;
      setHeard(line.text);
      if (line.partial !== false) return;
      const said = line.text.trim();
      if (!said) return listen();

      const openApproval = askedApproval.current;
      if (openApproval) {
        if (openApproval.submitted) {
          move("working");
          hush();
          return;
        }
        const decision = spokenDecision(said);
        if (decision) {
          const allow = decision === "allow";
          if (allow && openApproval.skill) {
            setHeard("");
            enqueueSpeech(
              "Open the group thread to review the complete skill before enabling it. You can say no now to deny it.",
              openApproval.member,
              true,
            );
            return;
          }
          // Hold this approval in-flight until its server patch arrives so a
          // slow response cannot reopen the microphone and submit it twice.
          openApproval.submitted = true;
          allowBargeIn.current = false;
          move("working");
          hush();
          setHeard("");
          dispatch({
            type: "decideRequest",
            threadId: group.threadId,
            requestId: openApproval.requestId,
            behavior: allow ? "allow" : "deny",
            message: allow ? undefined : "Denied by the user, on a group call.",
            onError: (error: string) => {
              const pending = askedApproval.current;
              if (
                !alive.current ||
                currentCall() !== group.id ||
                pending?.requestId !== openApproval.requestId ||
                !pending.submitted
              ) return;
              pending.submitted = false;
              const detail = error.trim().slice(0, 240);
              const decision = openApproval.routine ? "routine decision" : "approval";
              enqueueSpeech(
                `I couldn't save that ${decision}${detail ? `: ${detail}` : "."} Please try again.`,
                openApproval.member,
                true,
              );
            },
          });
          return;
        }
        enqueueSpeech(t("voiceMode.allowOnceOrDeny"), openApproval.member, true);
        return;
      }

      const openQuestion = askedQuestion.current;
      if (openQuestion) {
        askedQuestion.current = null;
        allowBargeIn.current = false;
        dispatch({
          type: "decideRequest",
          threadId: group.threadId,
          requestId: openQuestion.requestId,
          behavior: "answer",
          message: said,
        });
        move("working");
        return;
      }

      const routed = routeSpokenGroupMessage(said, membersRef.current);
      if (defaultResponderRef.current.kind === "mentions" && !routed.addressed) {
        listen();
        const names = membersRef.current.map((member) => member.name).join(", ");
        setNote("Say a member's name" + (names ? " — " + names : "") + " — or say everyone.");
        return;
      }

      allowBargeIn.current = false;
      move(busyRef.current ? "working" : "sending");
      progress.current.turnSent(Date.now());
      dispatch({ type: "sendGroup", groupId: group.id, text: routed.text, threadId: group.threadId });
      scheduleListen(false, 600);
    });
    const offEnd = bridge.onSpeechEnd(({ code, reason }) => {
      if (!alive.current || currentCall() !== group.id) return;
      if (code === 2) {
        setNote("Calls need macOS dictation, which isn't available here yet.");
        return;
      }
      if (code === 1) {
        setNote(
          reason === "helper-build-failed"
            ? "The dictation helper couldn't be built. Install Apple's Command Line Tools and try again."
            : reason === "dictation-disabled"
              ? "Turn on Dictation in System Settings → Keyboard, then try again."
              : reason === "speech-not-authorized"
                ? "Allow Speech Recognition in System Settings → Privacy & Security, then try again."
                : "Dictation couldn't start. Try again.",
        );
        return;
      }
      if (phaseRef.current === "listening") listen();
    });
    if ((group.working || group.busyBotId) && !approval && !question) move("working");
    else listen();
    return () => {
      offTranscript();
      offEnd();
      void window.ogb?.speechStop?.();
    };
    // Live busy/card changes are handled below without restarting native capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, enqueueSpeech, group.id, group.threadId, hush, listen, move, scheduleListen]);

  useEffect(() => {
    let resumeAfterRoutine = false;
    if (askedApproval.current && approval?.requestId !== askedApproval.current.requestId) {
      resumeAfterRoutine = askedApproval.current.routine && askedApproval.current.submitted;
      askedApproval.current = null;
    }
    if (askedQuestion.current && question?.card?.requestId !== askedQuestion.current.requestId) {
      askedQuestion.current = null;
    }

    if (resumeAfterRoutine && !approval && !question && !group.working && !group.busyBotId) {
      scheduleListen(true);
      return;
    }
    // Keep the voice queue and microphone closed until this exact decision
    // is settled or its request reports an error.
    if (askedApproval.current?.submitted) return;

    if (approval && askedApproval.current?.requestId !== approval.requestId) {
      const member = members.find((candidate) => candidate.id === approval.message.from?.botId);
      askedApproval.current = {
        requestId: approval.requestId,
        member,
        routine: isRoutineApproval(approval),
        skill: isSkillApproval(approval),
        submitted: false,
      };
      spokenIds.current.add(approval.message.id);
      const name = member?.name ?? approval.message.from?.name ?? "A group member";
      const skillPrompt = approval.message.card?.skillRequest?.action === "update"
        ? `${name} wants to update a learned skill. Open the group thread to review the complete skill before replacing the current version. You can say no to deny it.`
        : `${name} wants to enable a new learned skill. Open the group thread to review the complete skill before enabling it. You can say no to deny it.`;
      enqueueSpeech(isSkillApproval(approval) ? skillPrompt : spokenApprovalPrompt(approval, name), member, true);
    }

    if (question?.card?.requestId && askedQuestion.current?.requestId !== question.card.requestId) {
      const member = members.find((candidate) => candidate.id === question.from?.botId);
      askedQuestion.current = { requestId: question.card.requestId, member };
      spokenIds.current.add(question.id);
      const name = member?.name ?? question.from?.name ?? "A group member";
      const detail = question.card.subtitle.trim();
      const choices = question.card.options.length
        ? " The options are " + question.card.options.join(", ") + "."
        : "";
      enqueueSpeech(
        name + " asks: " + detail + (/[.!?]$/.test(detail) ? "" : ".") + choices,
        member,
        true,
      );
    }

    const fresh = messages.filter((message) => !spokenIds.current.has(message.id));
    if (!fresh.length) return;
    for (const message of fresh) spokenIds.current.add(message.id);

    const replies = fresh.filter(
      (message) => message.role === "bot" && message.kind === "text" && message.text?.trim(),
    );
    // each member's answer: at most four sentences, up to a question
    // (answer-budget.ts), the follow-up below --- never said
    const lastUserText = [...messages].reverse().find((message) => message.role === "user" && !message.parallelTask)?.text;
    const restInChat = tIn(progressLocale({ lastUserText, pageLocale: activeLocale(), looksFrench }), "voiceMode.restInChat");
    // the "rest is in the chat" line once, after the last answer that was cut
    const lastCut = replies.map((reply) => spokenAnswer(reply.text!).cut).lastIndexOf("length");
    replies.forEach((reply, index) => {
      const member = members.find((candidate) => candidate.id === reply.from?.botId);
      const said = spokenReply(reply.text!, index === lastCut ? restInChat : null);
      if (said) enqueueSpeech(said, member);
    });
    if (replies.length) progress.current.heard(Date.now());
    // No tool-chip narration: the progress tick below says the turn's lines.
  }, [approval, enqueueSpeech, group.busyBotId, group.working, members, messages, question, scheduleListen, askedApproval, askedQuestion, spokenIds, progress]);

  // ── progress while the room works in silence (progress.ts) ────────────
  useEffect(() => {
    const timer = setInterval(() => {
      if (!alive.current || currentCall() !== group.id) return;
      // a failed turn is said once, in one sentence, never its cause
      const failed = failure.current?.next({
        now: Date.now(),
        messages: messagesRef.current,
        botBusy: busyRef.current,
        // the bot talking, or the person (words coming in, or being sent)
        botSpeaking: phaseRef.current === "speaking" || phaseRef.current === "sending" || Boolean(heardRef.current) || speaker.isSpeaking() || queuedJobs.current.size > 0,
        awaitingAnswer: Boolean(askedApproval.current || askedQuestion.current),
      });
      if (failed) {
        const lastUserText = [...messagesRef.current].reverse().find((message) => message.role === "user" && !message.parallelTask)?.text;
        const locale = progressLocale({ lastUserText, pageLocale: activeLocale(), looksFrench });
        // in the call's voice, then the room listens again
        enqueueSpeech(tIn(locale, callFailureKey(failed)) ?? t(callFailureKey(failed)), undefined, true);
        return;
      }
      const planner = progress.current;
      if (!planner.active) return;
      const line = planner.next({
        now: Date.now(),
        thinking: phaseRef.current === "working",
        botBusy: busyRef.current,
        botSpeaking: phaseRef.current === "speaking" || speaker.isSpeaking(),
        // an approval being settled keeps the call quiet too (see above)
        awaitingAnswer: Boolean(askedApproval.current || askedQuestion.current),
        queued: queuedJobs.current.size > 0,
        tools: turnTools(messagesRef.current),
      });
      if (!line) return;
      // this call has no language of its own: the person's last words
      // (French or not) on an English or French page, else the page's
      const lastUserText = [...messagesRef.current].reverse().find((message) => message.role === "user" && !message.parallelTask)?.text;
      const locale = progressLocale({ lastUserText, pageLocale: activeLocale(), looksFrench });
      const text = progressText(line, (key, params) => tIn(locale, key, params));
      if (!text) return;
      const author = turnToolAuthor(messagesRef.current);
      const member = author ? membersRef.current.find((candidate) => candidate.id === author) : undefined;
      enqueueSpeech(text, member);
    }, PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, [enqueueSpeech, group.id, alive, failure, messagesRef, busyRef, phaseRef, heardRef, queuedJobs, askedApproval, askedQuestion, progress, membersRef]);

  useEffect(() => {
    const busy = Boolean(group.working || group.busyBotId);
    busyRef.current = busy;
    if (busy) {
      if (
        (phaseRef.current === "listening" || phaseRef.current === "sending") &&
        !askedApproval.current &&
        !askedQuestion.current &&
        !allowBargeIn.current
      ) {
        move("working");
        hush();
      }
      return;
    }
    allowBargeIn.current = false;
    if (
      (phaseRef.current === "working" || phaseRef.current === "sending") &&
      !askedApproval.current &&
      !askedQuestion.current
    ) {
      scheduleListen();
    }
  }, [group.busyBotId, group.working, hush, move, scheduleListen, busyRef, phaseRef, askedApproval, askedQuestion, allowBargeIn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        endCall(group.id);
      } else if (event.code === "Space" && speaker.isSpeaking()) {
        event.preventDefault();
        interruptSpeech();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group.id, interruptSpeech]);
}

export type { AskedApproval, AskedQuestion };
