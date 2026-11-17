// A routine's page in the side panel. One header (< name ×, a state badge
// when it fails), then three tabs (#4357, the owner's design C, 2026-11-14):
// Overview (the instruction folded, When with every trigger, Next run, Last
// run), Runs (every run, grouped by day) and Settings (every option, under
// short headings, and the person's "always" answers on its cards, #4558). No Active toggle, Pause is in the bar; no This week
// (2026-11-06). A change shows Cancel and Save in the bar; otherwise the bar
// is the routine's own: Run now, Check, Pause, Delete. Shared by the bot
// panel and the group panel.
import { api, useStore, type Bot } from "@/state/store";
import type { Routine, RoutineRun, RoutineRunOn } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { RoutineEditor } from "../RoutinesPage";
import { ClipboardCheck, CirclePlay, Pause, Trash2 } from "lucide-react";
import { ACTION_LABEL_MAIN, ActionBar, ActionButton, actionButtonClass } from "../ActionBar";
import { canRunRoutineNow, RunNowButton } from "../routines/RunNowButton";
import { clearRoutineRuns, type RoutinePatch, routineHistory, RoutineLastRun, RoutineRunAsRow, RoutineRunsByDay, RoutineStateBadge, RoutineStatusRows } from "../routines/RoutineDetail";
import { useRoutineReadiness, type RoutineReadinessControl } from "../routines/RoutineReadiness";
import { useConfirm } from "../ConfirmProvider";
import { RoutineAlwaysChoices } from "../routines/RoutineAlwaysChoices";

export function RoutinePanelPage({ routine, bot, bots, runs, lockedBotId, defaultRunOn, focusInstruction = false, onOpenRun, onBack, onDismiss, onDeleted, onDuplicate }: {
  routine: Routine;
  /** The routine's bot (Run now, Check). */
  bot: Bot | undefined;
  bots: Bot[];
  runs: RoutineRun[];
  lockedBotId?: string;
  defaultRunOn?: RoutineRunOn;
  /** An old Edit entry: the instruction opens in its editor, focused. */
  focusInstruction?: boolean;
  /** A run opens in the chat, at its message (#2098). */
  onOpenRun: (run: RoutineRun) => void;
  onBack: () => void;
  onDismiss: () => void;
  onDeleted: () => void;
  onDuplicate?: (routine: Routine) => void;
}) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const readiness = useRoutineReadiness(routine.id);
  const editable = routine.canEdit !== false;
  const canRun = canRunRoutineNow(state.config, routine, bot);
  const toggle = () => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });
  const openRun = (run: RoutineRun) => {
    onOpenRun(run);
    if (["failed", "missed"].includes(run.status) && !run.seenAt && !run.redacted) dispatch({ type: "markRoutineRunSeen", runId: run.id });
  };
  const patch = async (change: RoutinePatch) => { const response = await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify(change) }); if (response.routine) dispatch({ type: "routinePatched", routine: response.routine }); };
  const remove = async () => {
    if (!(await confirm({ title: t("routineCalendar.deleteConfirm", { title: routine.name }), confirmLabel: t("common.delete"), tone: "danger" }))) return;
    dispatch({ type: "deleteRoutine", routineId: routine.id });
    onDeleted();
  };
  return <RoutineEditor
    key={routine.id}
    routine={routine}
    bots={bots}
    {...(lockedBotId ? { lockedBotId } : {})}
    {...(defaultRunOn ? { defaultRunOn } : {})}
    presentation="panel"
    onClose={onBack}
    onDismiss={onDismiss}
    onDeleted={onDeleted}
    {...(onDuplicate ? { onDuplicate } : {})}
    page={{
      focusInstruction,
      status: <RoutineStatusRows
        routine={routine}
        runs={runs}
        editable={editable}
        canRun={canRun}
        readiness={readiness}
        onToggle={toggle}
        onPatch={patch}
        runAs={false}
        actAs={false}
        active={false}
        week={false}
      />,
      runAs: <RoutineRunAsRow routine={routine} editable={editable} onPatch={patch} />,
      alwaysChoices: <RoutineAlwaysChoices routineId={routine.id} refreshKey={`${routine.updatedAt}:${runs.length}`} />,
      badge: <RoutineStateBadge routine={routine} runs={runs} />,
      lastRun: <RoutineLastRun routine={routine} runs={runs} onOpenRun={openRun} />,
      runCount: routineHistory(routine, runs).length,
      runs: <RoutineRunsByDay
        routine={routine}
        runs={runs}
        onOpenRun={openRun}
        onClearRuns={() => void clearRoutineRuns(routine, confirm, dispatch).catch(() => { /* the runs stay listed */ })}
      />,
      actions: <RoutinePanelActions readiness={readiness} routine={routine} bot={bot} onStarted={onOpenRun} onToggle={toggle} onDelete={() => void remove()} />,
    }}
  />;
}

/** The bar under a routine's page in the side panel (2026-11-03, JC):
 * [Run now] [Check routine] [Disable or Enable] [Delete]; Delete asks first.
 * 2026-11-06 (JC, one pane): no Edit, the page itself is editable. */
export function RoutinePanelActions({ routine, bot, onStarted, onToggle, onDelete, readiness: externalReadiness }: {
  routine: Routine;
  readiness?: RoutineReadinessControl;
  bot: Bot | undefined;
  onStarted: (run: RoutineRun) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const ownReadiness = useRoutineReadiness(routine.id);
  const readiness = externalReadiness ?? ownReadiness;
  const { state } = useStore();
  return <ActionBar data-routine-detail-actions="">
    <RunNowButton routine={routine} bot={bot} className={actionButtonClass("primary", "main")} labelClassName={ACTION_LABEL_MAIN} onStarted={onStarted} />
    {canRunRoutineNow(state.config, routine, bot) && <ActionButton icon={<ClipboardCheck size={15} />} label={t(readiness.checking ? "routineReadiness.checking" : "routineReadiness.action")} disabled={readiness.checking} onClick={() => void readiness.check()} data-routine-check="" />}
    <ActionButton icon={routine.enabled ? <Pause size={15} /> : <CirclePlay size={15} />} label={routine.enabled ? t("routines.disable") : t("routines.enable")} onClick={onToggle} data-routine-toggle="" />
    <ActionButton icon={<Trash2 size={15} />} label={t("common.delete")} danger onClick={onDelete} data-routine-delete="" />
  </ActionBar>;
}
