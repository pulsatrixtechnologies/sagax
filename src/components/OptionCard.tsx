import { useState } from "react";
import { api, useStore, visibleMessages, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { questionCardOptionLabel, questionCardSubtitle, questionCardTitle } from "@/lib/question-card-title";
import { isPersistentQuestionCard, parseChoices } from "../../shared/ask-question";
import { isFirstRunQuizCard } from "../../shared/options-card";
import { otherChoiceIndex } from "../../shared/other-choice";
import { returnFocusToComposer } from "./AskCard";
import { CardMarkdown, cardDraftId } from "./CardMarkdown";
import { ExpandableText } from "./ExpandableText";
import { SuggestionFeedback } from "./SuggestionFeedback";
import { ProactiveChoiceCard } from "./ProactiveChoiceCard";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { picksInAnswer, QuestionSheet, SheetChoices, SheetField, SheetNote, sheetKeyHandler, type SheetChoice } from "./QuestionSheet";
import { TerminalDestinationPicker, terminalAnswerPick, terminalDestinationKey, terminalDestinationLabel } from "./terminal/TerminalDestinationPicker";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
/** The id of the "Other" row, never a label the bot could have written. */
const OTHER_ROW = "\u0000other";

/** First-run quiz, not a live provider ask (those carry requestId). */
export function isOnboardingCard(message: Message): boolean {
  // a proactive proposal (2026-10-30) stays until answered, like a live ask;
  // #4475: so does a bot's question drawn in the chat (ask_choice)
  return message.kind === "options" && isFirstRunQuizCard(message.card);
}

/** #4475: a bot's question drawn in the chat (ask_choice), answered by a
 * click that becomes the person's next message: it waits until answered,
 * and once answered keeps its card with the pick marked, like a live ask. */
export function isChatAskCard(card: NonNullable<Message["card"]>): boolean {
  return !card.requestId && card.requestType === "question" && !card.proactiveProposal;
}

/** Hide the quiz once they have talked past it — picked an option, typed in
 * the composer, or dismissed it. Live asks are never this card. */
export function shouldHideOnboardingCard(message: Message, transcript: Message[]): boolean {
  if (!isOnboardingCard(message) || !message.card) return false;
  if (message.card.dismissed || message.card.answered) return true;
  const index = transcript.findIndex((entry) => entry.id === message.id);
  if (index < 0) return false;
  return transcript.slice(index + 1).some((later) => later.role === "user" && later.kind === "text");
}

export function canDismissOptionCard(card: NonNullable<Message["card"]>): boolean {
  if (card.requestId && isPersistentQuestionCard(card)) return card.answered === "answer" && !card.dismissed;
  return true;
}

export function OptionCard({
  botId,
  threadId,
  message,
  /** set when the card is in a room: the answer belongs to the room's thread */
  groupId,
  /** #3512: inside the pinned card over the composer: no frame of its own,
   * its skip sits on the pinned card's top row */
  embedded = false,
}: {
  botId: string;
  threadId?: string;
  message: Message;
  groupId?: string;
  embedded?: boolean;
}) {
  const { state, dispatch } = useStore();
  const [custom, setCustom] = useState("");
  /** the "Other" row's field is open */
  const [other, setOther] = useState(false);
  // A terminal card: the destination the person picked ("" = the bot's).
  const [terminalPick, setTerminalPick] = useState("");
  const card = message.card;
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const transcript = bot ? visibleMessages(bot) : [];
  // Full thread, not the mounted window: a search-focus slice can omit the
  // later user message that means they already talked past this quiz.
  if (!card || shouldHideOnboardingCard(message, transcript) || (card.requestId && card.dismissed && card.answered)) return null;
  // #4475: a chat question put away without an answer (its key retired)
  const chatAsk = isChatAskCard(card);
  if (chatAsk && card.dismissed && !card.answered) return null;
  // 2026-11-05 (JC): no "Agit comme" card in the chat (rows saved before stay hidden)
  if (card.roleTransition) return null;
  // #3457: a choice card (propose_proactive) is the compact card with its
  // folded watch switches; the switches go with its yes
  if (card.proactiveProposal && card.proactiveChoice) {
    return (
      <ProactiveChoiceCard
        card={card}
        showNever={!groupId || Boolean(bot && viewerOwnsBot(state.config, bot))}
        onAnswer={(accept, watches) => {
          const answer = (accept ? card.options[0] : card.options[1]) ?? "";
          if (!answer.trim()) return;
          dispatch({ type: "answerCard", botId, threadId, messageId: message.id, answer: answer.trim(), groupId, proactiveWatches: watches });
          returnFocusToComposer();
        }}
        onNever={async () => {
          await api(`/api/bots/${botId}/proactive/${card.proactiveProposal!.id}/feedback`, { method: "POST", body: JSON.stringify({ choice: "never" }) });
        }}
        onSkip={!embedded && (threadId ?? bot?.threadId) ? () => {
          dispatch({ type: "skipCard", threadId: (threadId ?? bot?.threadId)!, proposal: { botId, id: card.proactiveProposal!.id } });
          returnFocusToComposer();
        } : undefined}
      />
    );
  }

  const terminalPicked = card.terminalRequest && !card.answered
    ? (card.terminalRequest.destinations ?? []).find((choice) => terminalDestinationKey(choice) === (terminalPick || terminalDestinationKey(card.terminalRequest!)))
    : undefined;
  // A terminal card names the destination picked right now, in the app's language.
  const title = terminalPicked ? t("terminal.card.title", { destination: terminalDestinationLabel(terminalPicked) }) : questionCardTitle(card);
  // #3515: an old card's English body reads in the app's language
  const subtitle = questionCardSubtitle(card);
  // M-20261119-045: the bot's words are drawn as in its bubble; a record chip
  // in them asks in this conversation's composer
  const draftId = cardDraftId(state, botId, threadId ?? bot?.threadId, groupId);
  // Cards saved before the server flattened `ask_user` choices can still hold
  // `{ label }` rows; a label is drawable, an object as a React child is not.
  const options = parseChoices(card.options, LETTERS.length) ?? [];

  const terminal = card.terminalRequest;
  const terminalDestinations = terminal?.destinations ?? [];
  const terminalChoice = terminalPick || (terminal ? terminalDestinationKey(terminal) : "");
  const answer = (text: string) => {
    if (!text.trim()) return;
    // A flat request in an earlier topic may only be present in the waiting
    // response. Answer its own request without looking it up in the open topic.
    if (embedded && threadId && card.requestType === "question" && card.requestId) {
      dispatch({ type: "decideRequest", threadId, requestId: card.requestId, behavior: "answer",
        message: text.trim(), settle: { answered: "answer", answeredText: text.trim() } });
      returnFocusToComposer();
      return;
    }
    const picked = terminal ? terminalAnswerPick(terminal, terminalPick, text) : undefined;
    // #4489: the first-run quiz hides on the click. The pick is the person's
    // message, so it is drawn at once under this sendId.
    const sendId = isFirstRunQuizCard(card) ? crypto.randomUUID() : undefined;
    dispatch({
      type: "answerCard", botId, threadId, messageId: message.id, answer: text.trim(), groupId,
      ...(picked ? { terminalDestination: picked } : {}),
      ...(sendId ? { sendId } : {}),
    });
    if (card.requestId || card.proactiveProposal || chatAsk) returnFocusToComposer();
  };

  // #3471: a card that still waits (a live ask, a proposal) is skipped,
  // never denied; an answered one is put away as before
  const waiting = !card.answered && !card.expired && !card.dismissed && Boolean(card.requestId || card.proactiveProposal);
  const skipThread = threadId ?? bot?.threadId;
  const skip = waiting && skipThread && !embedded
    ? () => {
      dispatch({
        type: "skipCard",
        threadId: skipThread,
        ...(card.requestId ? { requestId: card.requestId, tool: Boolean(card.tool) } : {}),
        ...(card.proactiveProposal && !card.requestId ? { proposal: { botId, id: card.proactiveProposal.id } } : {}),
      });
      returnFocusToComposer();
    }
    : undefined;
  // #4475: an answered chat question keeps its card, like an answered live ask
  const dismiss = skip ?? (canDismissOptionCard(card) && !card.proactiveProposal && !(chatAsk && card.answered)
    ? () => dispatch({ type: "dismissCard", botId, threadId, messageId: message.id, groupId })
    : undefined);

  // A live ask that has been answered keeps its card: what was picked is
  // marked and the rest dimmed. The first-run quiz never gets here, it hides.
  const settled = Boolean((card.requestId || card.proactiveProposal || chatAsk) && (card.answered || card.expired));
  // `answered` is the verdict for a permission-shaped ask and the picked
  // label for a flat one; a deny or a run that ended is no answer at all.
  const closed = settled && !card.answeredText && (card.answered === "deny" || card.answered === "unavailable" || card.skipped === true || card.expired === true);
  const given = settled && !closed
    ? card.answeredText ?? (card.answered === "answer" || card.answered === "allow" ? "" : card.answered ?? "")
    : "";
  const reading = picksInAnswer(given, options);
  const freeText = !settled && !card.tool && !card.proactiveProposal;
  // a last option the bot wrote as "Other" / "Autre" becomes the card's own
  // Other row, so the card never shows two of them (#2804)
  const botOther = freeText ? otherChoiceIndex(options) : -1;
  const choices: SheetChoice[] = [
    // #3515: an old card's English options read in the app's language; it answers with its stored label
    ...options.map((label, index) => {
      if (index === botOther) return { label, id: OTHER_ROW };
      const shown = questionCardOptionLabel(card, label);
      return shown === label ? { label } : { label: shown, id: label };
    }),
    // a permission ask has no free-text answer: the broker only accepts
    // allow/deny, so typing here used to fail silently
    ...(freeText && botOther < 0 ? [{ label: t("question.other"), id: OTHER_ROW }] : []),
  ];
  const fieldOpen = !settled && !card.tool && !card.proactiveProposal && (other || options.length === 0);
  const pick = (id: string) => {
    if (id === OTHER_ROW) {
      setOther((open) => !open);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-question-field="${message.id}"]`)?.focus());
      return;
    }
    answer(id);
  };

  return (
    <QuestionSheet
      ariaLabel={title}
      title={terminalPicked ? title : <CardMarkdown text={title} draftId={draftId} />}
      settled={settled}
      embedded={embedded}
      onDismiss={embedded ? undefined : dismiss}
      dismissLabel={skip ? t("waitingCard.skipAria") : t("onboarding.card.dismiss")}
      onKeyDown={settled ? undefined : sheetKeyHandler(choices.length, (index) => pick(choices[index]!.id ?? choices[index]!.label))}
    >
      {subtitle && <ExpandableText text={subtitle} markdown draftId={draftId} className="-mt-1 mb-2.5 text-[13px] leading-snug text-ink-secondary" />}
      {terminal && !card.answered && (
        <div className="mb-2.5">
          <TerminalDestinationPicker destinations={terminalDestinations} value={terminalChoice} onChange={setTerminalPick} />
        </div>
      )}
      <SheetChoices
        choices={choices}
        picked={settled ? reading.picked : other ? [OTHER_ROW] : []}
        settled={settled}
        ariaLabel={title}
        onPick={pick}
      />
      {fieldOpen && (
        <SheetField
          value={custom}
          ariaLabel={t("onboarding.card.custom")}
          placeholder={t("onboarding.card.custom")}
          canSend={Boolean(custom.trim())}
          sendLabel={t("question.submit")}
          onChange={setCustom}
          onSend={() => answer(custom)}
          className={cn(options.length > 0 && "mt-2")}
          fieldId={message.id}
        />
      )}
      {settled && !closed && !card.autoApplied && (reading.rest || (!reading.picked.length && !given)) && (
        <SheetNote>{reading.rest || t("question.status.answered")}</SheetNote>
      )}
      {/* #4558: answered without the person: say by what, never silently */}
      {settled && !closed && card.autoApplied && (
        <SheetNote>
          {card.standingAnswer
            ? <>
              {t("question.standingAnswer", { answer: given })}{" "}
              <button type="button" data-standing-answer-settings="" className="font-medium text-accent-text hover:underline" onClick={() => dispatch({ type: "openRoutine", botId, routineId: card.standingAnswer!.routineId })}>{t("question.standingAnswer.settings")}</button>
            </>
            : t("question.fullAccessAnswer", { answer: given })}
        </SheetNote>
      )}
      {closed && <SheetNote closed>{card.skipped ? t("waitingCard.skipped") : card.answerNote || (card.expired ? t("waitingCard.expired") : t("question.status.closed"))}</SheetNote>}
      {card.proactiveProposal && (!groupId || (bot && viewerOwnsBot(state.config, bot))) && (
        <SuggestionFeedback
          className="mt-2"
          value={card.feedback}
          onPick={async (choice) => {
            await api(`/api/bots/${botId}/proactive/${card.proactiveProposal!.id}/feedback`, { method: "POST", body: JSON.stringify({ choice }) });
          }}
        />
      )}
    </QuestionSheet>
  );
}
