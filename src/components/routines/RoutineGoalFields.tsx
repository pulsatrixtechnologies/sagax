// #2696: a goal routine's objective. The person writes the goal in plain
// words (and an optional deadline); the bot decides at each run when to check
// again and stops the routine once the goal is reached. View mode shows the
// goal with where it stands; a routine without a goal shows nothing.
import type { RoutineGoal } from "../../../shared/routine-goal";
import { cachedDateFormat } from "@/lib/schedule-label";
import { t } from "@/lib/i18n";
import { PANEL_INPUT, PANEL_LABEL, PanelRow, PanelRows, PanelValue } from "./PanelRows";
import { cn } from "@/lib/cn";

export interface RoutineGoalDraft {
  text: string;
  /** datetime-local value, or "" for none. */
  deadline: string;
}

export function goalDraftOf(goal: RoutineGoal | undefined): RoutineGoalDraft {
  return { text: goal?.text ?? "", deadline: goal?.deadline ? toLocalInput(goal.deadline) : "" };
}

/** The PATCH/POST value: null clears it. */
export function goalPayload(draft: RoutineGoalDraft): { text: string; deadline?: number } | null {
  const text = draft.text.trim();
  if (!text) return null;
  const at = draft.deadline ? new Date(draft.deadline).getTime() : Number.NaN;
  return { text, ...(Number.isFinite(at) && at > 0 ? { deadline: at } : {}) };
}

function toLocalInput(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(at: number): string {
  return cachedDateFormat({ dateStyle: "medium", timeStyle: "short" }).format(at);
}

function statusLabel(goal: RoutineGoal): string {
  if (goal.status === "achieved") return t("routineEditor.goal.achieved");
  if (goal.status === "expired") return t("routineEditor.goal.expired");
  return t("routineEditor.goal.active");
}

export function RoutineGoalFields({ goal, draft, onChange, viewing }: {
  goal?: RoutineGoal;
  draft: RoutineGoalDraft;
  onChange: (draft: RoutineGoalDraft) => void;
  viewing: boolean;
}) {
  if (viewing && !goal) return null;
  return <section data-routine-editor-section="goal" className="min-w-0 space-y-1">
    <h3 className={PANEL_LABEL}>{t("routineEditor.goal.label")}</h3>
    {viewing
      ? <p data-routine-goal-text className="whitespace-pre-wrap text-[13.5px] leading-5 text-ink">{goal!.text}</p>
      : <textarea
        data-routine-goal=""
        value={draft.text}
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
        rows={2}
        maxLength={2000}
        aria-label={t("routineEditor.goal.label")}
        placeholder={t("routineEditor.goal.placeholder")}
        className={cn(PANEL_INPUT, "h-auto w-full resize-y py-1.5")}
      />}
    <PanelRows>
      {(viewing ? goal?.deadline : draft.text.trim()) ? <PanelRow data-routine-goal-deadline="" label={t("routineEditor.goal.deadline")} hint={viewing ? undefined : t("routineEditor.goal.deadlineHint")}>
        {viewing
          ? <PanelValue>{formatDateTime(goal!.deadline!)}</PanelValue>
          : <input type="datetime-local" value={draft.deadline} onChange={(event) => onChange({ ...draft, deadline: event.target.value })} aria-label={t("routineEditor.goal.deadline")} className={PANEL_INPUT} />}
      </PanelRow> : null}
      {goal && <PanelRow data-routine-goal-status="" label={t("routineEditor.goal.status")} hint={goal.progress}>
        <PanelValue muted={goal.status !== "active"}>{statusLabel(goal)}{goal.checks ? ` · ${t("routineEditor.goal.checks", { count: goal.checks })}` : ""}</PanelValue>
      </PanelRow>}
      {goal?.status === "active" && goal.nextCheckAt ? <PanelRow data-routine-goal-next="" label={t("routineEditor.goal.nextCheck")}>
        <PanelValue>{formatDateTime(goal.nextCheckAt)}</PanelValue>
      </PanelRow> : null}
    </PanelRows>
  </section>;
}
