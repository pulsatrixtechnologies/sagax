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
  MAX_CUSTOM_ANSWER,
  NOTHING_PICKED,
  questionAnswersByQuestion,
  type AskQuestion,
} from "../../shared/ask-question";
import { ExpandableText } from "./ExpandableText";
import { picksInAnswer, QuestionSheet, SheetChoices, SheetNote } from "./QuestionSheet";

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

const CHOICE_ROW = (question: AskQuestion) => question.kind === "choice" || question.kind === "multi" || question.kind === "yes_no";

const FIELD = "w-full rounded-[10px] border border-ink/[0.12] bg-ink/[0.04] px-3 py-1.5 text-[13.5px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus:border-ink/[0.28] focus-visible:ring-2 focus-visible:ring-accent/60";
const PRIMARY = "h-8 rounded-full bg-ink px-3.5 text-[13px] font-medium text-app transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const QUIET = "h-8 rounded-full px-3.5 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-ink/[0.07] hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** A choice row's answers as pills: one tap picks (several for multi). */
function ChoicePills({ question, picked, onPick }: { question: AskQuestion; picked: readonly string[]; onPick: (key: string) => void }) {
  const multi = question.kind === "multi";
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={question.question} className="flex flex-wrap gap-1.5">
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
            className={cn(
              "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              on ? "border-ink/[0.3] bg-ink/[0.12] font-medium text-ink" : "border-ink/[0.14] text-ink-secondary hover:bg-ink/[0.05] hover:text-ink",
            )}
          >
            {on && <Check size={13} strokeWidth={2.6} aria-hidden="true" className="shrink-0" />}
            <span className="truncate">{optionLabel(question, option)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The control one row draws for its kind. */
function RowControl({ question, draft, onChange }: { question: AskQuestion; draft: RowDraft; onChange: (next: Partial<RowDraft>) => void }) {
  const label = question.question;
  switch (question.kind) {
    case "choice": case "yes_no":
      return <ChoicePills question={question} picked={draft.picked} onPick={(key) => onChange({ picked: draft.picked.includes(key) ? [] : [key] })} />;
    case "multi":
      return <ChoicePills question={question} picked={draft.picked} onPick={(key) => onChange({ picked: draft.picked.includes(key) ? draft.picked.filter((entry) => entry !== key) : [...draft.picked, key] })} />;
    case "duration":
      return (
        <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <input type="number" inputMode="numeric" min={0} step={1} value={draft.hours} aria-label={t("question.form.hoursAria", { question: label })} onChange={(event) => onChange({ hours: event.target.value })} className={cn(FIELD, "w-16 tabular-nums")} />
          <span>{t("question.form.hours")}</span>
          <input type="number" inputMode="numeric" min={0} max={59} step={5} value={draft.minutes} aria-label={t("question.form.minutesAria", { question: label })} onChange={(event) => onChange({ minutes: event.target.value })} className={cn(FIELD, "w-16 tabular-nums")} />
          <span>{t("question.form.minutes")}</span>
        </div>
      );
    case "time": case "date": case "number":
      return <input type={question.kind} {...(question.kind === "number" ? { inputMode: "decimal" as const } : {})} value={draft.value} aria-label={label} onChange={(event) => onChange({ value: event.target.value })} className={cn(FIELD, question.kind === "number" ? "w-32 tabular-nums" : "w-40")} />;
    case "long_text":
      return <textarea dir="auto" rows={3} maxLength={MAX_CUSTOM_ANSWER} value={draft.value} aria-label={label} placeholder={t("question.answerPlaceholder")} onChange={(event) => onChange({ value: event.target.value })} className={cn(FIELD, "resize-y")} />;
    default:
      return <input type="text" dir="auto" maxLength={MAX_CUSTOM_ANSWER} value={draft.value} aria-label={label} placeholder={t("question.answerPlaceholder")} onChange={(event) => onChange({ value: event.target.value })} className={FIELD} />;
  }
}

/** A row's label: the question, and "Optional" when it may stay empty. */
function RowLabel({ question, id }: { question: AskQuestion; id: string }) {
  return (
    <div id={id} className="mb-1.5 flex min-w-0 items-baseline gap-2">
      <span dir="auto" className="min-w-0 break-words text-[13.5px] font-medium leading-5 text-ink">{question.question}</span>
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
          <div data-form-list="" className="-mx-2 max-h-[360px] overflow-y-auto px-2">
            <SheetChoices
              choices={questions[0]!.options}
              picked={picksInAnswer(byQuestion[questions[0]!.question] === NOTHING_PICKED ? "" : byQuestion[questions[0]!.question] ?? "", questions[0]!.options.map(optionKey)).picked}
              multi settled quietPicked ariaLabel={questions[0]!.question} onPick={() => {}}
            />
          </div>
        ) : (
          <div className="flex flex-col">
            {questions.map((question, index) => {
              const value = byQuestion[question.question]?.trim() ?? "";
              return (
                <div key={`${index}-${question.question}`} data-form-row="" className={cn("flex min-w-0 items-baseline justify-between gap-3 py-1.5", index > 0 && "border-t border-ink/[0.06]")}>
                  <span dir="auto" className="min-w-0 break-words text-[13px] leading-5 text-ink-secondary">{question.question}</span>
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
        <div data-form-list="" className="-mx-2 max-h-[360px] overflow-y-auto px-2">
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
        {!readOnly && (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
            {/* the main action last, where the eye ends, the way the reference's Submit sits */}
            {[...actions.slice(1), actions[0]!].map((action, index, all) => (
              <button key={action} type="button" data-form-action="" onClick={() => send(action)} className={index === all.length - 1 ? PRIMARY : QUIET}>
                {action}
              </button>
            ))}
          </div>
        )}
      </QuestionSheet>
    );
  }

  const answers = questions.map((question, index) => rowAnswer(question, draftOf(index)));
  const owed = questions.filter((question, index) => !question.optional && !answers[index]!.length).length;
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
          <div key={`${index}-${question.question}`} data-form-row="" role="group" aria-labelledby={`${cardId}-row-${index}`} className={cn("py-2.5", index > 0 && "border-t border-ink/[0.06]")}>
            <RowLabel question={question} id={`${cardId}-row-${index}`} />
            {readOnly ? null : <RowControl question={question} draft={draftOf(index)} onChange={(next) => update(index, next)} />}
          </div>
        ))}
      </div>
      {failed && <div role="alert" className="mt-2 text-[12.5px] leading-snug text-danger">{t("question.answerFailed")}</div>}
      {!readOnly && (
        <div className="mt-2 flex justify-end">
          <button type="button" data-form-submit="" disabled={owed > 0} onClick={() => onSend(formatQuestionAnswers(questions as AskQuestion[], answers))} className={PRIMARY}>
            {t("question.form.submit")}
          </button>
        </div>
      )}
    </QuestionSheet>
  );
}
