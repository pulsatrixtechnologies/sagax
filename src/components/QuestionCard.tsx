// The question box: what the bot actually asked, and its own answers.
//
// This is the card for a structured ask — Claude's AskUserQuestion. The
// provider routes it through the permission channel, so without this it
// arrived as "Deny / Always allow / Allow once" over a question like "which
// model should this bot run on?", which is not an answer to anything.
//
// The question itself is the title. Its options are the rows of the shared
// QuestionSheet, each keyed by a letter (A, B, C) that is also its keyboard
// shortcut, with an "Other" row that opens a field for a reply the model did
// not think of. A set of questions gets one tab each and a single send. Once
// answered the card stays, showing what was chosen.
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  answerWithoutPreamble,
  formatQuestionAnswers,
  MAX_CUSTOM_ANSWER,
  questionAnswersByQuestion,
  type AskQuestion,
} from "../../shared/ask-question";
import { ASK_SMALL_PILL, returnFocusToComposer } from "./AskCard";
import { ExpandableText } from "./ExpandableText";
import {
  picksInAnswer,
  QuestionSheet,
  SheetChoices,
  SheetField,
  SheetNote,
  SheetSend,
  sheetIndexForKey,
  sheetKey,
  sheetKeyHandler,
  type SheetChoice,
} from "./QuestionSheet";

/** What each question has been answered with so far. Option labels and the
 * free-text reply are kept apart so toggling "Other" off cannot silently
 * drop a choice the person already made. */
interface Draft {
  picked: string[];
  custom: string;
  /** the field holds an answer of their own. An empty field is not one. */
  other: boolean;
}

const EMPTY: Draft = { picked: [], custom: "", other: false };
/** A question with nothing to choose from is answered in words only. */
const OPEN: Draft = { picked: [], custom: "", other: true };

/** Where an untouched question's draft starts. */
export function initialDraft(question: AskQuestion): Draft {
  return question.options.length ? EMPTY : OPEN;
}

/** One question, one pick: choosing it is the whole answer, so the card
 * sends it right away rather than waiting for Submit. */
export function answersInOneTap(questions: readonly AskQuestion[]): boolean {
  return questions.length === 1 && !questions[0]!.multiSelect && questions[0]!.options.length > 0;
}

function answersOf(draft: Draft): string[] {
  const custom = draft.other ? draft.custom.trim() : "";
  return custom ? [...draft.picked, custom] : draft.picked;
}

/** The tab label: the model's own header, or a number when it gave none. */
function tabLabel(question: AskQuestion, index: number): string {
  return question.header ?? t("question.tab.numbered", { index: index + 1 });
}

/** The key that picks option `index`: A, B, C… Shown on the row and
 * pressed on the keyboard. Latin in every locale, since it is a key. */
export function choiceKey(index: number): string {
  return sheetKey(index);
}

/** Option index for a pressed key, or -1. Plain letters only: a shortcut
 * never fires while typing in a field or with a modifier held. */
export function choiceIndexForKey(key: string, count: number): number {
  return sheetIndexForKey(key, count);
}

/** The id of the "Other" row, never a label the bot could have written. */
const OTHER_ROW = "\u0000other";

/** Up to this length the question is the card's title. A longer one keeps
 * a short title and opens below it with its own "show full question". */
const TITLE_MAX = 160;

/**
 * The one line an answered card folds into: what was asked, then what was
 * answered. A single question names itself by its header (or its text); a
 * set lists each header beside its answer. The answer text the server kept
 * is read back per question, so the line never shows the model-facing
 * Q:/A: lead-in.
 */
export function settledQuestionLine(
  questions: readonly AskQuestion[],
  answer: string | null | undefined,
): { label: string; value: string } {
  if (!answer) return { label: t("question.status.answered"), value: "" };
  const byQuestion = questionAnswersByQuestion(answer, questions);
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  if (questions.length === 1) {
    const only = questions[0]!;
    const value = byQuestion[only.question] ?? answerWithoutPreamble(answer);
    return { label: only.header ?? only.question, value: flat(value) };
  }
  const parts = questions.flatMap((question, index) => {
    const value = byQuestion[question.question];
    return value ? [`${tabLabel(question, index)}: ${flat(value)}`] : [];
  });
  return {
    label: t("question.status.answered"),
    value: parts.length ? parts.join(" · ") : flat(answerWithoutPreamble(answer)),
  };
}

export function QuestionCard({
  threadId,
  bot,
  message,
  onAnswered,
  onAnswerFailed,
}: {
  /** answered by THREAD, so a question raised inside a room settles the
   * same way as one in a 1:1 chat */
  threadId: string;
  /** who is asking, for the "Name has a question" line */
  bot?: Pick<Bot, "name">;
  message: Message;
  /** told once the answer was sent (the Approvals screen shows what follows) */
  onAnswered?: () => void;
  /** the answer did not reach the bot: undo what onAnswered showed */
  onAnswerFailed?: () => void;
}) {
  const { dispatch } = useStore();
  const card = message.card;
  const questions = card?.questionRequest?.questions ?? [];
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [active, setActive] = useState(0);
  /** the questions whose "Other" field is open */
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  // The server settles the card, but only after a round trip. Holding the
  // sent answer here closes the window where the buttons are still live.
  const [sent, setSent] = useState<string | null>(null);
  // the last answer did not reach the bot: said on the card until the next try
  const [failed, setFailed] = useState(false);

  const answered = useMemo(
    () => questions.map((question, index) => answersOf(drafts[index] ?? initialDraft(question)).length > 0),
    [questions, drafts],
  );

  if (!card || !questions.length) return null;
  const settled = Boolean(card.answered) || sent !== null;
  const single = questions.length === 1;

  if (settled) {
    const answer = card.answeredText ?? sent;
    // A question nobody answered (the run ended, or it was closed) is not
    // "answered": say so, the rows dimmed.
    const closed = !answer && Boolean(card.answered) && card.answered !== "answer";
    return <SettledQuestion questions={questions} answer={answer} closed={closed} title={bot ? t("question.card.named", { name: bot.name }) : t("question.card.title")} />;
  }

  const currentIndex = Math.min(active, questions.length - 1);
  const current = questions[currentIndex]!;
  const draft = drafts[currentIndex] ?? initialDraft(current);
  const oneTap = answersInOneTap(questions);
  const answeredCount = answered.filter(Boolean).length;
  const complete = answeredCount === questions.length;
  const multi = Boolean(current.multiSelect);
  const freeText = current.custom !== false;
  const fieldOpen = current.options.length === 0 || Boolean(opened[currentIndex]);

  const update = (index: number, next: Partial<Draft>) =>
    setDrafts((previous) => ({ ...previous, [index]: { ...(previous[index] ?? initialDraft(questions[index]!)), ...next } }));

  const toggleOther = () => {
    const open = !opened[currentIndex];
    setOpened((previous) => ({ ...previous, [currentIndex]: open }));
    // single-select: the field is the answer now, so no row stays picked
    if (open && !multi) update(currentIndex, { picked: [] });
    if (!open) update(currentIndex, { custom: "", other: false });
    if (open && typeof requestAnimationFrame === "function") requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-question-field="${message.id}"]`)?.focus());
  };

  const choose = (label: string) => {
    setFailed(false);
    if (label === OTHER_ROW) { toggleOther(); return; }
    if (current.multiSelect) {
      const picked = draft.picked.includes(label)
        ? draft.picked.filter((entry) => entry !== label)
        : [...draft.picked, label];
      update(currentIndex, { picked });
      return;
    }
    // Single-select is a radio group: picking replaces, and picking an
    // option means the free-text answer was not the one they wanted.
    update(currentIndex, { picked: [label], other: false, custom: "" });
    setOpened((previous) => ({ ...previous, [currentIndex]: false }));
    if (oneTap) {
      send({ ...drafts, [currentIndex]: { picked: [label], other: false, custom: "" } });
      return;
    }
    // Move to the next question they still owe an answer to, the way the
    // tabs would have been clicked anyway.
    const next = questions.findIndex((_, index) => index !== currentIndex && !answered[index]);
    if (next >= 0) setActive(next);
  };

  // Typing an answer of their own replaces a single pick: the field is the
  // answer now. A multi-select keeps its picks beside the typed one.
  const type = (value: string) => {
    update(currentIndex, {
      custom: value,
      other: value.trim().length > 0,
      ...(current.multiSelect || !value.trim() ? {} : { picked: [] }),
    });
  };

  const submit = () => {
    if (complete) send(drafts);
  };

  function send(final: Record<number, Draft>) {
    if (settled || !card?.requestId) return;
    const answers = questions.map((question, index) => answersOf(final[index] ?? initialDraft(question)));
    if (answers.some((entry) => !entry.length)) return;
    const answer = formatQuestionAnswers(questions, answers);
    if (!answer) return;
    setSent(answer);
    setFailed(false);
    returnFocusToComposer();
    onAnswered?.();
    dispatch({
      type: "decideRequest",
      threadId,
      requestId: card.requestId,
      behavior: "answer",
      message: answer,
      // The answer never reached the bot, so the card must go back to
      // being answerable rather than sitting there looking settled.
      onError: () => { setSent(null); setFailed(true); onAnswerFailed?.(); },
    });
  }

  const named = bot ? t("question.card.named", { name: bot.name }) : t("question.card.title");
  // The question is the title, the way a person would ask it. A long one,
  // or a set of them, keeps a short title and shows the text below.
  const questionIsTitle = single && current.question.length <= TITLE_MAX;
  const title = questionIsTitle ? current.question : single && current.header ? current.header : named;
  const meta = !single ? t("question.progress", { answered: answeredCount, count: questions.length }) : undefined;

  const choices: SheetChoice[] = [
    ...current.options,
    // an options-only question (an ACP engine answers with an option id,
    // never text) has no free-text answer it could send
    ...(freeText && current.options.length ? [{ label: t("question.other"), id: OTHER_ROW }] : []),
  ];
  const picked = opened[currentIndex] && current.options.length ? [...draft.picked, OTHER_ROW] : draft.picked;
  // a send of its own only where one tap is not the answer: several picks,
  // several questions; a typed answer sends from its field
  const showSend = !oneTap && (multi || !single);

  return (
    <QuestionSheet
      ariaLabel={t("question.aria.card")}
      title={title}
      meta={meta}
      onKeyDown={sheetKeyHandler(choices.length, (index) => choose(choices[index]!.id ?? choices[index]!.label))}
    >
      {card.questionRequest?.origin === "output" && (
        <div className="-mt-1.5 mb-2 text-[12px] text-ink-secondary">{t("question.origin.badge")}</div>
      )}

      {!single && (
        <div role="tablist" aria-label={t("question.aria.tabs")} className="-mt-0.5 mb-2 flex flex-wrap items-center gap-1.5">
          {questions.map((question, index) => (
            <button
              key={`${index}-${question.question}`}
              type="button"
              role="tab"
              aria-selected={index === currentIndex}
              onClick={() => setActive(index)}
              className={cn(
                ASK_SMALL_PILL,
                index === currentIndex
                  ? "bg-ink/[0.08] text-ink"
                  : "text-ink-secondary hover:bg-ink/[0.07] hover:text-ink",
              )}
            >
              {answered[index] && <Check size={14} className="text-success" />}
              {tabLabel(question, index)}
            </button>
          ))}
        </div>
      )}

      {!questionIsTitle && (
        <ExpandableText text={current.question} className="mb-2 text-[13.5px] leading-relaxed text-ink" />
      )}
      {multi && <div className="-mt-1 mb-2 text-[12px] text-ink-tertiary">{t("question.multiHint")}</div>}

      <SheetChoices choices={choices} picked={picked} multi={multi} ariaLabel={current.question} onPick={choose} />

      {freeText && fieldOpen && (
        <SheetField
          value={draft.custom}
          maxLength={MAX_CUSTOM_ANSWER}
          ariaLabel={current.options.length ? t("question.otherPlaceholder") : current.question}
          placeholder={current.options.length ? t("question.otherPlaceholder") : t("question.answerPlaceholder")}
          canSend={complete}
          sendLabel={single ? t("question.submit") : t("question.submitAll")}
          onChange={type}
          onSend={submit}
          className={cn(current.options.length > 0 && "mt-2")}
          fieldId={message.id}
        />
      )}
      {failed && (
        <div role="alert" className="mt-2 text-[12.5px] leading-snug text-danger">{t("question.answerFailed")}</div>
      )}
      {showSend && (
        <SheetSend label={single ? t("question.submit") : t("question.submitAll")} disabled={!complete} onClick={submit} />
      )}
    </QuestionSheet>
  );
}

/** The answered card: the same card, each question with what was chosen
 * marked and the rest dimmed, and an answer in words under its rows. */
function SettledQuestion({ questions, answer, closed, title }: { questions: readonly AskQuestion[]; answer: string | null; closed: boolean; title: string }) {
  const byQuestion = answer ? questionAnswersByQuestion(answer, questions) : {};
  const single = questions.length === 1;
  const fallback = answer ? answerWithoutPreamble(answer) : "";
  const parts = questions.map((question) => {
    const value = byQuestion[question.question] ?? (single ? fallback : "");
    return { question, ...picksInAnswer(value, question.options.map((option) => option.label)) };
  });
  const firstIsTitle = single && questions[0]!.question.length <= TITLE_MAX;
  return (
    <QuestionSheet ariaLabel={t("question.aria.card")} settled title={firstIsTitle ? questions[0]!.question : single && questions[0]!.header ? questions[0]!.header : title}>
      {parts.map(({ question, picked, rest }, index) => (
        <div key={`${index}-${question.question}`} className={cn(index > 0 && "mt-3")}>
          {!firstIsTitle && <ExpandableText text={question.question} className="mb-1.5 text-[13.5px] font-medium leading-relaxed text-ink" />}
          <SheetChoices choices={question.options} picked={picked} multi={Boolean(question.multiSelect)} settled ariaLabel={question.question} onPick={() => {}} />
          {rest && <SheetNote>{rest}</SheetNote>}
        </div>
      ))}
      {/* an answer the questions cannot be read back from is shown whole */}
      {fallback && parts.every((part) => !part.picked.length && !part.rest) && <SheetNote>{fallback}</SheetNote>}
      {closed && <SheetNote closed>{t("question.status.closed")}</SheetNote>}
      {!closed && !answer && <SheetNote>{t("question.status.answered")}</SheetNote>}
    </QuestionSheet>
  );
}
