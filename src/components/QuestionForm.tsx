// #4490: a card a bot asks as a form or a checklist (ask_choice questions,
// or items with actions). Same sheet as every question card: a short title
// that says what is asked and by which routine, one line of context, then
// the rows, each with its own control, then the actions. A checklist is one
// row per item with its checkbox and its text, pre-checked as the bot
// proposed, and the bot's buttons ("Post selected", "Skip tonight"). A long
// list scrolls inside the card. Once answered the card stays, each row with
// what was answered.
//
// #4910: a form is answered ONE QUESTION AT A TIME, the way Claude Code's
// AskUserQuestion is: a step bar of short chips, the question on top at full
// width, its answers as a numbered vertical list (1-9 pick, Enter goes on,
// Esc folds the card), "Other, specify" as the last row of the list, a
// follow-up field hung under the one answer that needs it, then a review
// step and the one Submit.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Calendar, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateFieldLocale, formatDateField, t } from "@/lib/i18n";
import {
  answeredAction,
  formatQuestionAnswers,
  formRowsShown,
  formSteps,
  LEFT_EMPTY,
  MAX_CUSTOM_ANSWER,
  NOTHING_PICKED,
  questionAnswersByQuestion,
  type AskFact,
  type AskQuestion,
} from "../../shared/ask-question";
import { otherChoiceIndex } from "../../shared/other-choice";
import { ASK_SMALL_PILL, returnFocusToComposer } from "./AskCard";
import { AskFactsTable } from "./AskFactsTable";
import { ExpandableText } from "./ExpandableText";
import { picksInAnswer, QuestionSheet, SHEET_FIELD, SheetChoices, SheetField, SheetNote, SheetSend, type SheetChoice } from "./QuestionSheet";

/** One row's draft: the picks of a choice, or the words or numbers typed. */
interface RowDraft {
  picked: string[];
  value: string;
  hours: string;
  minutes: string;
  /** a choice row's "Other, specify" is open: `value` is an answer of its own */
  other: boolean;
}
const EMPTY: RowDraft = { picked: [], value: "", hours: "", minutes: "", other: false };

const optionKey = (option: AskQuestion["options"][number]) => option.id ?? option.label;

/** The label an option shows: a yes / no row speaks the person's language. */
function optionLabel(question: AskQuestion, option: AskQuestion["options"][number]): string {
  if (question.kind === "yes_no" && option.id === "yes") return t("question.form.yes");
  if (question.kind === "yes_no" && option.id === "no") return t("question.form.no");
  return option.label;
}

/** A duration's total minutes, or null when nothing was typed. */
function durationMinutes(draft: RowDraft): number | null {
  const hours = Number(draft.hours || 0);
  const minutes = Number(draft.minutes || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) return null;
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : null;
}

/** What one row sends: picks, or the one value typed. */
export function rowAnswer(question: AskQuestion, draft: RowDraft): string[] {
  switch (question.kind) {
    case "choice": case "multi": case "yes_no": {
      const own = draft.other ? draft.value.trim() : "";
      return own ? [...draft.picked, own] : draft.picked;
    }
    case "duration": {
      const total = durationMinutes(draft);
      return total === null ? [] : [`${total} min`];
    }
    default: return draft.value.trim() ? [draft.value.trim()] : [];
  }
}

/** "90 min" read back as "1 h 30 min" on the settled card. */
export function durationLabel(value: string): string {
  const match = /^(\d+) min$/.exec(value.trim());
  if (!match) return value;
  const total = Number(match[1]);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return t("question.form.durationMinutes", { minutes });
  return minutes ? t("question.form.durationHoursMinutes", { hours, minutes }) : t("question.form.durationHours", { hours });
}

/** A settled row's answer as the person reads it. */
function shownAnswer(question: AskQuestion, value: string): string {
  if (question.kind === "duration") return durationLabel(value);
  if (question.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return formatDateField(value);
  if (CHOICE_ROW(question)) {
    const { picked, rest } = picksInAnswer(value, question.options.map(optionKey));
    const labels = picked.map((key) => optionLabel(question, question.options.find((option) => optionKey(option) === key)!));
    return [...labels, ...(rest ? [rest] : [])].join(", ");
  }
  return value;
}

const CHOICE_ROW = (question: AskQuestion) => question.kind === "choice" || question.kind === "multi" || question.kind === "yes_no";

/** A date in the interface language. The native control still holds the
 * yyyy-mm-dd value and opens the calendar. Its own painting follows the
 * operating system, so the visible text is ours. */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const empty = value.trim() === "";
  return (
    <span className="relative inline-flex w-44 focus-within:[&_[data-date-face]]:border-ink/[0.28] focus-within:[&_[data-date-face]]:ring-2 focus-within:[&_[data-date-face]]:ring-accent/60">
      <span data-date-face="" aria-hidden="true" className={cn(SHEET_FIELD, "flex w-full items-center justify-between gap-2", empty && "text-ink-tertiary")}>
        <span data-date-shown="" className="tabular-nums">{formatDateField(value)}</span>
        <Calendar size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
      </span>
      <input type="date" lang={dateFieldLocale()} value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </span>
  );
}

/** The control one row draws for its kind. */
function RowControl({ question, draft, onChange, fieldId, canSend, onSend }: { question: AskQuestion; draft: RowDraft; onChange: (next: Partial<RowDraft>) => void; fieldId: string; canSend: boolean; onSend: () => void }) {
  const label = question.question;
  switch (question.kind) {
    case "duration":
      return (
        <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <input type="number" inputMode="numeric" min={0} step={1} value={draft.hours} aria-label={t("question.form.hoursAria", { question: label })} onChange={(event) => onChange({ hours: event.target.value })} className={cn(SHEET_FIELD, "w-16 tabular-nums")} />
          <span>{t("question.form.hours")}</span>
          <input type="number" inputMode="numeric" min={0} max={59} step={5} value={draft.minutes} aria-label={t("question.form.minutesAria", { question: label })} onChange={(event) => onChange({ minutes: event.target.value })} className={cn(SHEET_FIELD, "w-16 tabular-nums")} />
          <span>{t("question.form.minutes")}</span>
        </div>
      );
    case "date":
      return <DateField label={label} value={draft.value} onChange={(value) => onChange({ value })} />;
    case "time": case "number":
      return <input type={question.kind} {...(question.kind === "number" ? { inputMode: "decimal" as const } : {})} value={draft.value} aria-label={label} onChange={(event) => onChange({ value: event.target.value })} className={cn(SHEET_FIELD, question.kind === "number" ? "w-32 tabular-nums" : "w-40")} />;
    default:
      // text and long_text: the answer-in-words field of every question card
      // (it grows with what is typed; Enter sends once the form is complete)
      return (
        <SheetField
          value={draft.value}
          maxLength={MAX_CUSTOM_ANSWER}
          ariaLabel={label}
          placeholder={t("question.answerPlaceholder")}
          canSend={canSend}
          sendLabel={t("question.form.submit")}
          onChange={(value) => onChange({ value })}
          onSend={onSend}
          fieldId={fieldId}
          showSend={false}
          className="w-full"
        />
      );
  }
}

/** The id of the "Other, specify" row, never a label the bot could have written. */
const OTHER_ROW = "\u0000other";

/** A step's chip: the bot's short header, or the step's number. */
function stepLabel(question: AskQuestion, step: number): string {
  return question.header ?? t("question.tab.numbered", { index: step + 1 });
}

/** A row's answers as the person reads them (the review, one line each). */
function readableAnswer(question: AskQuestion, answers: readonly string[]): string {
  return answers.map((value) => shownAnswer(question, value)).join(", ");
}

/**
 * #4910: the live form, one step per question. Everything the old stacked
 * card showed is still here: each question and its answers, its follow-ups,
 * the optional marks, the card's context line and its progress; a step only
 * shows what that step asks.
 */
function FormWizard({
  cardId,
  title,
  context,
  facts,
  questions,
  embedded,
  failed,
  readOnly,
  onSend,
  onDismiss,
  dismissLabel,
  onCollapse,
}: {
  cardId: string;
  title: string;
  context?: string;
  facts?: readonly AskFact[];
  questions: readonly AskQuestion[];
  embedded: boolean;
  failed: boolean;
  readOnly: boolean;
  onSend: (answer: string) => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  onCollapse?: () => void;
}) {
  const steps = useMemo(() => formSteps(questions), [questions]);
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [at, setAt] = useState(0);
  const moved = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const draftOf = (index: number) => drafts[index] ?? EMPTY;
  const update = (index: number, next: Partial<RowDraft>) => setDrafts((previous) => ({ ...previous, [index]: { ...(previous[index] ?? EMPTY), ...next } }));

  const shown = formRowsShown(questions, (index) => draftOf(index).picked);
  const answers = questions.map((question, index) => (shown[index] ? rowAnswer(question, draftOf(index)) : []));
  const isOwed = (index: number) => shown[index]! && !questions[index]!.optional && answers[index]!.length === 0;
  const rowsOf = (step: { head: number; followUps: number[] }) => [step.head, ...step.followUps].filter((index) => shown[index]);
  const stepOwed = (step: { head: number; followUps: number[] }) => rowsOf(step).some(isOwed);
  const stepDone = (step: { head: number; followUps: number[] }) => !stepOwed(step) && rowsOf(step).some((index) => answers[index]!.length > 0);
  const owedCount = questions.filter((_, index) => isOwed(index)).length;
  const review = at >= steps.length;
  const step = steps[Math.min(at, steps.length - 1)]!;
  const head = questions[step.head]!;

  const go = (to: number) => {
    moved.current = true;
    setAt(Math.max(0, Math.min(steps.length, to)));
  };
  const next = () => {
    if (review) { submit(); return; }
    if (!stepOwed(step)) go(at + 1);
  };
  const submit = () => {
    if (owedCount > 0) return;
    // a row its parent answer never asked is not sent; an optional row left empty says so
    onSend(formatQuestionAnswers(questions as AskQuestion[], answers.map((entry, index) => (!shown[index] ? [] : entry.length ? entry : [LEFT_EMPTY]))));
  };

  // after a move, focus lands where the answer is typed, or on the card so
  // the number keys work; never on the first paint
  useEffect(() => {
    if (!moved.current) return;
    const body = bodyRef.current;
    if (!body) return;
    const inWords = !review && !CHOICE_ROW(head);
    ((inWords ? body.querySelector<HTMLElement>("textarea, input") : null) ?? body).focus();
  }, [at, review, head]);

  const focusOwnField = (index: number) => {
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-question-field="${cardId}-other-${index}"]`)?.focus());
  };

  const pick = (index: number, key: string, advance: boolean) => {
    const question = questions[index]!;
    const draft = draftOf(index);
    const multi = question.kind === "multi";
    if (key === OTHER_ROW) {
      const open = !draft.other;
      update(index, { other: open, ...(open && !multi ? { picked: [] } : {}), ...(open ? {} : { value: "" }) });
      if (open) focusOwnField(index);
      return;
    }
    if (multi) {
      update(index, { picked: draft.picked.includes(key) ? draft.picked.filter((entry) => entry !== key) : [...draft.picked, key] });
      return;
    }
    update(index, { picked: [key], other: false, value: "" });
    if (!advance) return;
    // a pick that reveals a follow-up stays on its step; the rest moves on
    const after = formRowsShown(questions, (row) => (row === index ? [key] : draftOf(row).picked));
    if (!step.followUps.some((row) => after[row])) go(at + 1);
  };

  /** The choice list of one row, with its follow-ups hung under the answer that needs them. */
  const choiceRow = (index: number, numbered: boolean, stepRows: readonly number[]) => {
    const question = questions[index]!;
    const draft = draftOf(index);
    const botOther = question.kind === "yes_no" ? -1 : otherChoiceIndex(question.options.map((option) => option.label));
    const choices: SheetChoice[] = [
      ...question.options.map((option, optionIndex) => ({
        label: optionLabel(question, option),
        ...(option.description ? { description: option.description } : {}),
        id: optionIndex === botOther ? OTHER_ROW : optionKey(option),
      })),
      ...(question.kind !== "yes_no" && botOther < 0 ? [{ label: t("question.wizard.other"), id: OTHER_ROW }] : []),
    ];
    const hung = (id: string) => stepRows.filter((row) => {
      const link = questions[row]!.when;
      if (!link || !shown[row]) return false;
      const parentOptions = question.options.filter((option) => optionKey(option) === link.option || option.label === link.option);
      return parentOptions.some((option) => optionKey(option) === id) && followUpParentIs(row, index);
    });
    const below = (id: string) => {
      if (id === OTHER_ROW) {
        return draft.other ? (
          <div className="ps-[34px] pe-1.5 pb-1" data-form-other="">
            <SheetField
              value={draft.value}
              maxLength={MAX_CUSTOM_ANSWER}
              ariaLabel={t("question.otherPlaceholder")}
              placeholder={t("question.otherPlaceholder")}
              canSend={!stepOwed(step)}
              sendLabel={t("question.wizard.next")}
              onChange={(value) => update(index, { value })}
              onSend={next}
              fieldId={`${cardId}-other-${index}`}
              showSend={false}
              className="w-full"
            />
          </div>
        ) : null;
      }
      const rows = hung(id);
      return rows.length ? <>{rows.map((row) => followUp(row, stepRows))}</> : null;
    };
    return (
      <SheetChoices
        choices={choices}
        picked={draft.other ? [...draft.picked, OTHER_ROW] : draft.picked}
        multi={question.kind === "multi"}
        keys={numbered ? "numbers" : "none"}
        after={below}
        ariaLabel={question.question}
        onPick={(key) => pick(index, key, numbered)}
      />
    );
  };

  const followUpParentIs = (row: number, parent: number) => {
    const link = questions[row]!.when;
    if (!link) return false;
    for (let candidate = 0; candidate < row; candidate += 1) {
      const asked = questions[candidate]!;
      if ((asked.question === link.question || asked.header === link.question) && asked.options.length) return candidate === parent;
    }
    return false;
  };

  /** A follow-up: its own question in small type and its control, indented under its answer. */
  const followUp = (row: number, stepRows: readonly number[]) => {
    const question = questions[row]!;
    return (
      <div key={`${row}-${question.question}`} data-form-row="" data-form-followup={question.when ? "when" : "after"} className="ps-[34px] pe-1.5 pb-1.5 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <span dir="auto" className="min-w-0 break-words text-[12.5px] leading-snug text-ink-secondary">{question.question}</span>
          {question.optional && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t("question.form.optional")}</span>}
        </div>
        <div data-form-control="">
          {CHOICE_ROW(question)
            ? choiceRow(row, false, stepRows)
            : <RowControl question={question} draft={draftOf(row)} onChange={(patch) => update(row, patch)} fieldId={`${cardId}-${row}`} canSend={!stepOwed(step)} onSend={next} />}
        </div>
      </div>
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (onCollapse) onCollapse(); else returnFocusToComposer();
      return;
    }
    if (target.closest("textarea, select, [contenteditable]")) return;
    if (target.closest("input")) {
      if (event.key === "Enter") { event.preventDefault(); next(); }
      return;
    }
    const onChoice = Boolean(target.closest("[data-ask-choice]"));
    if (target.closest("button, a") && !onChoice) return;
    if (!review && CHOICE_ROW(head) && /^[1-9]$/.test(event.key)) {
      const count = head.options.length + (head.kind === "yes_no" ? 0 : otherChoiceIndex(head.options.map((option) => option.label)) >= 0 ? 0 : 1);
      const choice = Number(event.key) - 1;
      if (choice >= count) return;
      event.preventDefault();
      const id = choice < head.options.length ? (otherChoiceIndex(head.options.map((option) => option.label)) === choice && head.kind !== "yes_no" ? OTHER_ROW : optionKey(head.options[choice]!)) : OTHER_ROW;
      pick(step.head, id, true);
      return;
    }
    if (event.key === "Enter" && !onChoice) { event.preventDefault(); next(); }
  };

  if (readOnly) {
    // a card addressed to someone else: the questions are shown, not answered here
    return (
      <QuestionSheet ariaLabel={t("question.aria.card")} title={title} embedded={embedded} onDismiss={onDismiss} dismissLabel={dismissLabel}>
        {context && <div data-form-context=""><ExpandableText text={context} className="-mt-1 mb-2 text-[13px] leading-snug text-ink-secondary" /></div>}
        <div className="flex flex-col">
          {questions.map((question, index) => (
            <div key={`${index}-${question.question}`} data-form-row="" className={cn("flex min-h-9 min-w-0 items-baseline gap-2 py-1.5", index > 0 && "border-t border-ink/[0.06]")}>
              <span dir="auto" className="min-w-0 break-words text-[13.5px] leading-5 text-ink">{question.question}</span>
              {question.optional && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t("question.form.optional")}</span>}
            </div>
          ))}
        </div>
      </QuestionSheet>
    );
  }

  const stepRows = rowsOf(step);
  const followUpRows = step.followUps.filter((row) => shown[row]);
  // follow-ups with no answer to hang under (a card written before `when`) sit below the list
  const loose = followUpRows.filter((row) => !questions[row]!.when || !followUpParentIs(row, step.head));
  const answeredCount = steps.filter(stepDone).length;
  const needs = stepOwed(step);
  const emptyOptional = !needs && rowsOf(step).every((row) => answers[row]!.length === 0);

  return (
    <QuestionSheet
      ariaLabel={t("question.aria.card")}
      title={title}
      meta={review ? t("question.progress", { answered: answeredCount, count: steps.length }) : t("question.wizard.step", { step: at + 1, count: steps.length })}
      embedded={embedded}
      onDismiss={onDismiss}
      dismissLabel={dismissLabel}
      onKeyDown={onKeyDown}
    >
      <AskFactsTable facts={facts} className="-mt-1" />
      {context && <div data-form-context=""><ExpandableText text={context} className="-mt-1 mb-2 text-[13px] leading-snug text-ink-secondary" /></div>}
      {steps.length > 1 && (
        <div role="tablist" aria-label={t("question.wizard.steps")} data-wizard-steps="" className="mb-2.5 flex flex-wrap items-center gap-1">
          {steps.map((entry, index) => (
            <button
              key={`${index}-${questions[entry.head]!.question}`}
              type="button"
              role="tab"
              data-wizard-chip=""
              aria-selected={index === at}
              title={questions[entry.head]!.question}
              onClick={() => go(index)}
              className={cn(ASK_SMALL_PILL, "max-w-[11rem]", index === at ? "bg-ink/[0.08] text-ink" : "text-ink-secondary hover:bg-ink/[0.07] hover:text-ink")}
            >
              {stepDone(entry) && <Check size={14} className="text-success" aria-hidden="true" />}
              <span className="truncate">{stepLabel(questions[entry.head]!, index)}</span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            data-wizard-chip="review"
            aria-selected={review}
            onClick={() => go(steps.length)}
            className={cn(ASK_SMALL_PILL, review ? "bg-ink/[0.08] text-ink" : "text-ink-secondary hover:bg-ink/[0.07] hover:text-ink")}
          >
            {t("question.wizard.review")}
          </button>
        </div>
      )}

      {review ? (
        <div ref={bodyRef} tabIndex={-1} data-wizard-body="review" className="max-h-[46vh] overflow-y-auto outline-none">
          <div className="mb-1.5 text-[13px] leading-snug text-ink-secondary">{t("question.wizard.reviewPrompt")}</div>
          <div className="flex flex-col">
            {steps.map((entry, index) => rowsOf(entry).map((row) => {
              const question = questions[row]!;
              const value = readableAnswer(question, answers[row]!);
              return (
                <button
                  key={`${index}-${row}`}
                  type="button"
                  data-form-row=""
                  data-review-row=""
                  onClick={() => go(index)}
                  title={t("question.wizard.change")}
                  className={cn("flex min-h-9 w-full min-w-0 items-start justify-between gap-3 rounded-[10px] px-2 py-1.5 text-start transition-colors hover:bg-ink/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", row !== entry.head && "ps-6")}
                >
                  <span dir="auto" className="min-w-0 break-words text-[13.5px] leading-5 text-ink">{question.question}</span>
                  <span data-form-answer="" dir="auto" className={cn("max-w-[55%] shrink-0 break-words text-end text-[13px] font-medium leading-5", value ? "text-ink" : isOwed(row) ? "text-danger" : "text-ink-tertiary")}>
                    {value || (isOwed(row) ? t("question.form.notAnswered") : t("question.form.optional"))}
                  </span>
                </button>
              );
            }))}
          </div>
        </div>
      ) : (
        <div ref={bodyRef} tabIndex={-1} data-wizard-body="step" data-wizard-step={at} className="-mx-1 max-h-[46vh] overflow-y-auto px-1 outline-none">
          <div className="mb-2 flex items-baseline gap-2">
            <div className="min-w-0 flex-1"><ExpandableText text={head.question} className="text-[14px] font-medium leading-5 text-ink" /></div>
            {head.optional && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t("question.form.optional")}</span>}
          </div>
          {head.kind === "multi" && <div className="-mt-1 mb-1.5 text-[12px] text-ink-tertiary">{t("question.multiHint")}</div>}
          <div data-form-control="" data-form-row="" data-form-head="">
            {CHOICE_ROW(head)
              ? choiceRow(step.head, true, stepRows)
              : <RowControl question={head} draft={draftOf(step.head)} onChange={(patch) => update(step.head, patch)} fieldId={`${cardId}-${step.head}`} canSend={!needs} onSend={next} />}
          </div>
          {loose.map((row) => followUp(row, stepRows))}
        </div>
      )}

      {failed && <div role="alert" className="mt-2 text-[12.5px] leading-snug text-danger">{t("question.answerFailed")}</div>}
      <div className="mt-2.5 flex items-center gap-2">
        <span data-wizard-hint="" className="min-w-0 flex-1 text-[11.5px] leading-4 text-ink-tertiary">{t("question.wizard.hint")}</span>
        <div className="-mt-2.5 shrink-0">
          <SheetSend
            actions={[
              ...(at > 0 ? [{ label: t("question.wizard.back"), id: "back", onClick: () => go(at - 1) }] : []),
              review
                ? { label: t("question.form.submit"), id: "submit", onClick: submit, disabled: owedCount > 0 }
                : { label: emptyOptional ? t("question.wizard.skip") : t("question.wizard.next"), id: "next", onClick: next, disabled: needs },
            ]}
          />
        </div>
      </div>
    </QuestionSheet>
  );
}

export function QuestionForm({
  cardId,
  title,
  context,
  facts,
  questions,
  settled,
  answer,
  closed = false,
  closedNote,
  answeredBy,
  embedded = false,
  failed = false,
  readOnly = false,
  onSend,
  onDismiss,
  dismissLabel,
  onCollapse,
}: {
  cardId: string;
  title: string;
  context?: string;
  facts?: readonly AskFact[];
  questions: readonly AskQuestion[];
  settled: boolean;
  answer?: string | null;
  closed?: boolean;
  closedNote?: string;
  answeredBy?: string;
  embedded?: boolean;
  failed?: boolean;
  /** a room card addressed to someone else: shown, not answered here */
  readOnly?: boolean;
  onSend: (answer: string) => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Esc folds the card (the pinned card collapses); absent: focus goes back to the composer */
  onCollapse?: () => void;
}) {
  const checklist = questions.length === 1 && Boolean(questions[0]!.actions?.length);
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>(() => {
    const start: Record<number, RowDraft> = {};
    if (checklist) start[0] = { ...EMPTY, picked: [...(questions[0]!.checked ?? [])] };
    return start;
  });
  const draftOf = (index: number) => drafts[index] ?? EMPTY;
  const update = (index: number, next: Partial<RowDraft>) => setDrafts((previous) => ({ ...previous, [index]: { ...(previous[index] ?? EMPTY), ...next } }));
  const contextLine = context?.trim() && context.trim() !== questions[0]?.question.trim() ? context.trim() : checklist ? questions[0]!.question : context?.trim();

  if (settled) {
    const byQuestion = answer ? questionAnswersByQuestion(answer, questions) : {};
    const pressed = answer ? answeredAction(answer) : undefined;
    return (
      <QuestionSheet ariaLabel={t("question.aria.card")} settled title={title} embedded={embedded}>
        {contextLine && <ExpandableText text={contextLine} className="-mt-1 mb-2.5 text-[13px] leading-snug text-ink-secondary" />}
        {checklist ? (
          <div data-form-list="" className="max-h-[360px] overflow-y-auto">
            <SheetChoices
              choices={questions[0]!.options}
              picked={picksInAnswer(byQuestion[questions[0]!.question] === NOTHING_PICKED ? "" : byQuestion[questions[0]!.question] ?? "", questions[0]!.options.map(optionKey)).picked}
              multi settled quietPicked ariaLabel={questions[0]!.question} onPick={() => {}}
            />
          </div>
        ) : (
          <div className="flex flex-col">
            {questions.map((question, index) => {
              const given = byQuestion[question.question]?.trim() ?? "";
              const value = given === LEFT_EMPTY ? "" : given;
              // #4910: a follow-up its answer never asked (absent from what was sent) was not shown
              if (answer && question.when && !given) return null;
              return (
                <div key={`${index}-${question.question}`} data-form-row="" className={cn("flex min-h-9 min-w-0 items-center justify-between gap-3 py-1.5", index > 0 && "border-t border-ink/[0.06]")}>
                  <span dir="auto" className="min-w-0 break-words text-[13.5px] leading-5 text-ink">{question.question}</span>
                  <span data-form-answer="" dir="auto" className={cn("max-w-[55%] shrink-0 break-words text-end text-[13px] font-medium leading-5", value ? "text-ink" : "text-ink-tertiary")}>
                    {value ? shownAnswer(question, value) : t("question.form.notAnswered")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {pressed && <div data-form-action-sent=""><SheetNote>{t("question.form.actionSent", { action: pressed })}</SheetNote></div>}
        {closed && <SheetNote closed>{closedNote ?? t("question.status.closed")}</SheetNote>}
        {answeredBy ? <SheetNote>{t("question.answeredBy", { name: answeredBy })}</SheetNote>
          : !closed && !answer && <SheetNote>{t("question.status.answered")}</SheetNote>}
      </QuestionSheet>
    );
  }

  if (checklist) {
    const only = questions[0]!;
    const picked = draftOf(0).picked;
    const actions = only.actions ?? [];
    const send = (action: string) => onSend(formatQuestionAnswers(questions as AskQuestion[], [picked], action));
    return (
      <QuestionSheet
        ariaLabel={t("question.aria.card")}
        title={title}
        meta={t("question.form.selected", { count: picked.length, total: only.options.length })}
        embedded={embedded}
        onDismiss={onDismiss}
        dismissLabel={dismissLabel}
      >
        <AskFactsTable facts={facts} className="-mt-1" />
        {contextLine && <div data-form-context=""><ExpandableText text={contextLine} className="-mt-1 mb-2.5 text-[13px] leading-snug text-ink-secondary" /></div>}
        <div data-form-list="" className="max-h-[360px] overflow-y-auto">
          <SheetChoices
            choices={only.options}
            picked={picked}
            multi
            quietPicked
            disabled={readOnly}
            ariaLabel={only.question}
            onPick={(key) => update(0, { picked: picked.includes(key) ? picked.filter((entry) => entry !== key) : [...picked, key] })}
          />
        </div>
        {failed && <div role="alert" className="mt-2 text-[12.5px] leading-snug text-danger">{t("question.answerFailed")}</div>}
        {/* the main action last, where the eye ends */}
        {!readOnly && <SheetSend actions={[...actions.slice(1), actions[0]!].map((action) => ({ label: action, onClick: () => send(action) }))} />}
      </QuestionSheet>
    );
  }

  return (
    <FormWizard
      cardId={cardId}
      title={title}
      context={contextLine}
      facts={facts}
      questions={questions}
      embedded={embedded}
      failed={failed}
      readOnly={readOnly}
      onSend={onSend}
      onDismiss={onDismiss}
      dismissLabel={dismissLabel}
      onCollapse={onCollapse}
    />
  );
}
