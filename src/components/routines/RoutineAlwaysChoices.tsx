// #4558: the person's "always" answers on a routine's cards, kept as their
// preferences (server/proactive/answer-learning.ts), never in the routine's
// instructions. The routine page's Settings tab lists them like its other
// groups (a muted heading, then rows): the card's question in words, the
// options it offered and when it was chosen, the answer and Remove (for
// good). Never the card's key. Nothing shows when there is none.
import { useCallback, useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { routineDateTime } from "@/lib/routine-display";
import { api } from "@/state/store";
import { PANEL_LABEL, PANEL_TEXT_ACTION, PanelRow, PanelRows, PanelValue } from "./PanelRows";

export interface RoutineAlwaysChoice {
  /** What removes it (a hash of the card kind and options). */
  id: string;
  answer: string;
  question: string;
  options: string[];
  at: number;
}

export function useRoutineAlwaysChoices(routineId: string, refreshKey?: unknown): { choices: RoutineAlwaysChoice[]; remove: (id: string) => Promise<void> } {
  const [choices, setChoices] = useState<RoutineAlwaysChoice[]>([]);
  useEffect(() => {
    let live = true;
    api<{ choices?: RoutineAlwaysChoice[] }>(`/api/routines/${encodeURIComponent(routineId)}/always-choices`)
      .then((answer) => { if (live) setChoices(Array.isArray(answer.choices) ? answer.choices : []); })
      .catch(() => { if (live) setChoices([]); });
    return () => { live = false; };
  }, [routineId, refreshKey]);
  const remove = useCallback(async (id: string) => {
    await api(`/api/routines/${encodeURIComponent(routineId)}/always-choices/${encodeURIComponent(id)}`, { method: "DELETE" });
    setChoices((list) => list.filter((choice) => choice.id !== id));
  }, [routineId]);
  return { choices, remove };
}

export function RoutineAlwaysChoicesView({ choices, onRemove }: { choices: readonly RoutineAlwaysChoice[]; onRemove: (id: string) => Promise<void> }) {
  const [removing, setRemoving] = useState<string | null>(null);
  if (choices.length === 0) return null;
  return <section data-routine-settings-group="always" className="min-w-0 scroll-mt-14 space-y-1">
    <h3 className={PANEL_LABEL} title={t("routinePage.alwaysChoices.help")}>{t("routinePage.alwaysChoices.title")}</h3>
    <PanelRows data-routine-always-choices="">
      {choices.map((choice) => {
        const label = choice.question || choice.options.join(" / ") || choice.answer;
        const date = t("routinePage.alwaysChoices.chosen", { date: routineDateTime(choice.at) });
        return <PanelRow
          key={choice.id}
          data-routine-always-choice={choice.id}
          label={<span title={label} className="line-clamp-2">{label}</span>}
          hint={choice.options.length ? `${choice.options.join(" · ")} · ${date}` : date}
          help={t("routinePage.alwaysChoices.help")}
        >
          <PanelValue className="max-w-[60%]"><span title={choice.answer}>{choice.answer}</span></PanelValue>
          <button
            type="button"
            data-routine-always-remove=""
            disabled={removing === choice.id}
            aria-label={t("routinePage.alwaysChoices.removeAria", { question: label })}
            onClick={() => { setRemoving(choice.id); void onRemove(choice.id).catch(() => { /* the row stays listed */ }).finally(() => setRemoving(null)); }}
            className={PANEL_TEXT_ACTION}
          >{t("routinePage.alwaysChoices.remove")}</button>
        </PanelRow>;
      })}
    </PanelRows>
  </section>;
}

/** The routine page's group of "always" answers, fetched for the signed-in person. */
export function RoutineAlwaysChoices({ routineId, refreshKey }: { routineId: string; refreshKey?: unknown }) {
  const { choices, remove } = useRoutineAlwaysChoices(routineId, refreshKey);
  return <RoutineAlwaysChoicesView choices={choices} onRemove={remove} />;
}
