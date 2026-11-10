// #2694: feedback on a proactive card or a brief item. Thumbs up or down,
// "Moins de ça" and "Ne plus proposer". The choice applies at the next cycle
// and goes to the person's memory (server/proactive/background-brief.ts).
// Same thumbs as the voice call card (VoiceCallCard).
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type SuggestionFeedbackChoice = "up" | "down" | "less" | "never";

/** The note under the row once a choice is kept. */
export function suggestionFeedbackNote(choice: SuggestionFeedbackChoice | undefined): string | null {
  if (!choice) return null;
  return t(`suggestionFeedback.noted.${choice}`);
}

const ALL_CHOICES: readonly SuggestionFeedbackChoice[] = ["up", "down", "less", "never"];

export function SuggestionFeedback({ value, onPick, className, choices = ALL_CHOICES }: {
  value?: SuggestionFeedbackChoice;
  onPick: (choice: SuggestionFeedbackChoice) => Promise<void>;
  className?: string;
  /** #3457: the answers this row offers. A choice card keeps only
   * « Ne plus proposer »; a watch alert drops it for its own two exits. */
  choices?: readonly SuggestionFeedbackChoice[];
}) {
  const [local, setLocal] = useState<SuggestionFeedbackChoice | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const choice = local ?? value;
  const pick = (next: SuggestionFeedbackChoice) => {
    if (busy || next === choice) return;
    setBusy(true);
    setFailed(false);
    const before = local;
    setLocal(next);
    onPick(next)
      .catch(() => { setLocal(before); setFailed(true); })
      .finally(() => setBusy(false));
  };
  const icon = "rounded p-1 text-ink-tertiary hover:bg-raised hover:text-ink";
  const text = "rounded px-1.5 py-0.5 text-[12px] leading-4 text-ink-tertiary hover:bg-raised hover:text-ink";
  const note = suggestionFeedbackNote(choice);
  return (
    <div data-suggestion-feedback={choice ?? ""} className={cn("flex flex-col gap-0.5", className)}>
      <div role="group" aria-label={t("suggestionFeedback.label")} className="flex flex-wrap items-center gap-0.5">
        {choices.includes("up") && <button type="button" aria-label={t("suggestionFeedback.up")} title={t("suggestionFeedback.up")} aria-pressed={choice === "up"} disabled={busy} onClick={() => pick("up")} className={cn(icon, choice === "up" && "text-accent-text")}>
          <ThumbsUp size={14} />
        </button>}
        {choices.includes("down") && <button type="button" aria-label={t("suggestionFeedback.down")} title={t("suggestionFeedback.down")} aria-pressed={choice === "down"} disabled={busy} onClick={() => pick("down")} className={cn(icon, choice === "down" && "text-accent-text")}>
          <ThumbsDown size={14} />
        </button>}
        {choices.includes("less") && <button type="button" aria-pressed={choice === "less"} disabled={busy} onClick={() => pick("less")} className={cn(text, choice === "less" && "text-accent-text")}>
          {t("suggestionFeedback.less")}
        </button>}
        {choices.includes("never") && <button type="button" aria-pressed={choice === "never"} disabled={busy} onClick={() => pick("never")} className={cn(text, choice === "never" && "text-accent-text")}>
          {t("suggestionFeedback.never")}
        </button>}
      </div>
      {note && !failed && <p role="status" className="px-1 text-[12px] leading-4 text-ink-tertiary">{note}</p>}
      {failed && <p role="alert" className="px-1 text-[12px] leading-4 text-danger">{t("suggestionFeedback.failed")}</p>}
    </div>
  );
}
