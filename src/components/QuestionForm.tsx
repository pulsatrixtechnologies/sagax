// #4490: a card a bot asks as a form or a checklist (ask_choice questions,
// or items with actions). Same sheet as every question card: a short title
// that says what is asked and by which routine, one line of context, then
// the rows, each with its own control, then the actions. A checklist is one
// row per item with its checkbox and its text, pre-checked as the bot
// proposed, and the bot's buttons ("Post selected", "Skip tonight"). A long
// list scrolls inside the card. Once answered the card stays, each row with
// what was answered.
import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  answeredAction,
  formatQuestionAnswers,
  LEFT_EMPTY,
  MAX_CUSTOM_ANSWER,
  NOTHING_PICKED,
  questionAnswersByQuestion,
  type AskQuestion,
} from "../../shared/ask-question";
import { ASK_SMALL_PILL } from "./AskCard";
import { ExpandableText } from "./ExpandableText";
import { picksInAnswer, QuestionSheet, SHEET_FIELD, SheetChoices, SheetField, SheetNote, SheetSend } from "./QuestionSheet";

/** One row's draft: the picks of a choice, or the words or numbers typed. */
interface RowDraft {
  picked: string[];
  value: string;
  hours: string;
  minutes: string;
}
const EMPTY: RowDraft = { picked: [], value: "", hours: "", minutes: "" };

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
    case "choice": case "multi": case "yes_no": return draft.picked;
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
  if (CHOICE_ROW(question)) {
    const { picked, rest } = picksInAnswer(value, question.options.map(optionKey));
    const labels = picked.map((key) => optionLabel(question, question.options.find((option) => optionKey(option) === key)!));
    return [...labels, ...(rest ? [rest] : [])].join(", ");
  }
  return value;
}

/** One row of the form, live or settled: the same height when its control is
 * one line (a 38px field plus 8px above and below), the question centred on it. */
const FORM_ROW = "flex min-h-[54px] min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2";

const CHOICE_ROW = (question: AskQuestion) => question.kind === "choice" || question.kind === "multi" || question.kind === "yes_no";

/** A choice row's answers as pills: one tap picks (several for multi). */
function ChoicePills({ question, picked, onPick }: { question: AskQuestion; picked: readonly string[]; onPick: (key: string) => void }) {
  const multi = question.kind === "multi";
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={question.question} className="flex flex-wrap justify-end gap-1.5">
      {question.options.map((option) => {
        const key = optionKey(option);
        const on = picked.includes(key);
        return (
          <button
            key={key}
            type="button"
            data-form-choice=""
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            title={option.description}
            onClick={() => onPick(key)}
            // the pills of a question set's tabs (QuestionCard): one look
            className={cn(ASK_SMALL_PILL, "max-w-full", on ? "bg-ink/[0.08] text-ink" : "bg-ink/[0.04] text-ink-secondary hover:bg-ink/[0.07] hover:text-ink")}
          >
            {on && <Check size={14} className="text-success" aria-hidden="true" />}
            <span className="truncate">{optionLabel(question, option)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The control one row draws for its kind. */
function RowControl({ question, draft, onChange, fieldId, canSend, onSend }: { question: AskQuestion; draft: RowDraft; onChange: (next: Partial<RowDraft>) => void; fieldId: string; canSend: boolean; onSend: () => void }) {
  const label = question.question;
  switch (question.kind) {
    case "choice": case "yes_no":
      return <ChoicePills question={question} picked={draft.picked} onPick={(key) => onChange({ picked: draft.picked.includes(key) ? [] : [key] })} />;
    case "multi":
      return <ChoicePills question={question} picked={draft.picked} onPick={(key) => onChange({ picked: draft.picked.includes(key) ? draft.picked.filter((entry) => entry !== key) : [...draft.picked, key] })} />;
    case "duration":
      return (
        <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <input type="number" inputMode="numeric" min={0} step={1} value={draft.hours} aria-label={t("question.form.hoursAria", { question: label })} onChange={(event) => onChange({ hours: event.target.value })} className={cn(SHEET_FIELD, "w-16 tabular-nums")} />
          <span>{t("question.form.hours")}</span>
          <input type="number" inputMode="numeric" min={0} max={59} step={5} value={draft.minutes} aria-label={t("question.form.minutesAria", { question: label })} onChange={(event) => onChange({ minutes: event.target.value })} className={cn(SHEET_FIELD, "w-16 tabular-nums")} />
          <span>{t("question.form.minutes")}</span>
        </div>
      );
    case "time": case "date": case "number":
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

/** How a row lays out (#4585): every control sits at the right of its
 * question on the same line, and a long text takes a line of its own. Where
 * the question and its control do not fit side by side the row wraps (CSS
 * only, so it follows the card's real width): the question on one line, the
 * control on the next, still at the right and never clipped. */
export type FormRowShape = "pills" | "fields" | "text" | "area";
export function formRowShape(question: AskQuestion): FormRowShape {
  switch (question.kind) {
    case "choice": case "multi": case "yes_no": return "pills";
    case "duration": case "time": case "date": case "number": return "fields";
    case "long_text": return "area";
    default: return "text";
  }
}

const ROW_CONTROL: Record<FormRowShape, string> = {
  pills: "ms-auto max-w-full min-w-0",
  fields: "ms-auto max-w-full",
  // a short text takes the width left, up to a sensible maximum
  text: "ms-auto min-w-0 max-w-[24rem] flex-[1_1_16rem]",
  // a long text: its own line, the area full width
  area: "w-full basis-full",
};

/** A row's label: the question, and "Optional" when it may stay empty. */
function RowLabel({ question, id }: { question: AskQuestion; id: string }) {
  return (
    <div id={id} className={cn("flex min-w-0 items-baseline gap-2", formRowShape(question) === "area" ? "basis-full" : "flex-[1_1_12rem]")}>
      <span dir="auto" className="min-w-0 break-words text-[13.5px] font-normal leading-5 text-ink">{question.question}</span>
      {question.optional && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t("question.form.optional")}</span>}
    </div>
  );
}

export function QuestionForm({
  cardId,
  title,
  context,
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
}: {
  cardId: string;
  title: string;
  context?: string;
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
              return (
                <div key={`${index}-${question.question}`} data-form-row="" data-form-shape={formRowShape(question)} className={cn("flex min-h-9 min-w-0 items-center justify-between gap-3 py-1.5", index > 0 && "border-t border-ink/[0.06]")}>
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

  const answers = questions.map((question, index) => rowAnswer(question, draftOf(index)));
  const owed = questions.filter((question, index) => !question.optional && !answers[index]!.length).length;
  // an optional row left empty says so, so the bot tells "left empty" from "not asked"
  const submit = () => {
    if (owed > 0) return;
    onSend(formatQuestionAnswers(questions as AskQuestion[], answers.map((entry) => (entry.length ? entry : [LEFT_EMPTY]))));
  };
  const required = questions.filter((question) => !question.optional).length;
  return (
    <QuestionSheet
      ariaLabel={t("question.aria.card")}
      title={title}
      meta={questions.length > 1 ? t("question.progress", { answered: required - owed, count: required }) : undefined}
      embedded={embedded}
      onDismiss={onDismiss}
      dismissLabel={dismissLabel}
    >
      {contextLine && <div data-form-context=""><ExpandableText text={contextLine} className="-mt-1 mb-2 text-[13px] leading-snug text-ink-secondary" /></div>}
      <div className="flex flex-col">
        {questions.map((question, index) => (
          <div key={`${index}-${question.question}`} data-form-row="" role="group" aria-labelledby={`${cardId}-row-${index}`} data-form-shape={formRowShape(question)} className={cn(FORM_ROW, index > 0 && "border-t border-ink/[0.06]")}>
            <RowLabel question={question} id={`${cardId}-row-${index}`} />
            {readOnly ? null : (
              <div data-form-control="" className={ROW_CONTROL[formRowShape(question)]}>
                <RowControl question={question} draft={draftOf(index)} onChange={(next) => update(index, next)} fieldId={`${cardId}-${index}`} canSend={owed === 0} onSend={submit} />
              </div>
            )}
          </div>
        ))}
      </div>
      {failed && <div role="alert" className="mt-2 text-[12.5px] leading-snug text-danger">{t("question.answerFailed")}</div>}
      {!readOnly && <SheetSend label={t("question.form.submit")} disabled={owed > 0} onClick={submit} />}
    </QuestionSheet>
  );
}
