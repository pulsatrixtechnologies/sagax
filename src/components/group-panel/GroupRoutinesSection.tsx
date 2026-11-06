// Group panel > Details > Routines (2026-11-03, JC): the group's team goals
// and the routines that post in its conversations, in the bot panel's
// Routines card (one grouped card, a row per routine with its bot's face,
// the switch at the right). A row opens the routine's page in place, with the
// bot panel's bar [Run now] [Edit] [Disable or Enable] [Delete]; + makes a
// new team goal for this group, led by its lead.
import { CalendarClock, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { api, openRoutineRun, useStore, type Bot, type Group } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { RoutineEditor } from "../RoutinesPage";
import { RoutineList } from "../routines/RoutineList";
import { canRunRoutineNow, routineRunInFlight } from "../routines/RunNowButton";
import { clearRoutineRuns, RoutineDetail } from "../routines/RoutineDetail";
import { useConfirm } from "../ConfirmProvider";
import { RoutineDetailHeader, RoutinePanelActions } from "../bot-settings/RoutinesSection";

export function GroupRoutinesSection({ group, routines, members, ownBots, leadBotId, newRequest = 0 }: {
  group: Group;
  /** The group's routines (src/lib/group-panel.ts groupRoutines). */
  routines: Routine[];
  /** Every bot of the group: each row shows its bot's face. */
  members: Bot[];
  /** The viewer's bots in the group: the ones a new team goal may run on. */
  ownBots: Bot[];
  leadBotId?: string;
  /** Bumped by the Suggestions row "Give the team a goal": opens a new one. */
  newRequest?: number;
}) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | "edit" | { copyOf: Routine } | null>(null);
  // 2026-11-05 (#2098): a run opens in the chat, at its message.
  const openRun = (run: RoutineRun) => openRoutineRun(dispatch, { runId: run.id, routineId: run.routineId, botId: run.botId });
  const runs = state.routineRuns ?? [];
  const detail = routines.find((routine) => routine.id === detailId) ?? null;
  const botOf = (routine: Routine) => members.find((bot) => bot.id === routine.botId) ?? state.bots?.find((bot) => bot.id === routine.botId);
  const lead = ownBots.find((bot) => bot.id === leadBotId)?.id ?? ownBots[0]?.id;
  const canCreate = ownBots.length > 0 && !group.dm;
  const toggle = (routine: Routine) => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });
  const closePanel = () => { setEditing(null); dispatch({ type: "toggleSettings", open: false }); };

  useEffect(() => {
    if (newRequest > 0 && canCreate) { setDetailId(null); setEditing("new"); }
  }, [newRequest, canCreate]);

  if (detail) {
    const bot = botOf(detail);
    const bots = bot ? [bot] : [];
    return <div data-group-routine-detail={detail.id} className="absolute inset-0 z-20 flex flex-col bg-panel">
      <RoutineDetailHeader
        name={detail.name}
        onBack={() => setDetailId(null)}
        onClose={closePanel}
        onRename={detail.canEdit !== false ? (name) => { dispatch({ type: "routinePatched", routine: { ...detail, name } }); dispatch({ type: "updateRoutine", routineId: detail.id, patch: { name } }); } : undefined}
      />
      <RoutineDetail
        routine={detail}
        runs={runs}
        bots={bots}
        groups={state.groups ?? []}
        viewerPrincipalId={state.config?.viewer?.principalId ?? null}
        compact
        actions={false}
        editable={detail.canEdit !== false}
        canRun={canRunRoutineNow(state.config, detail, bot)}
        inFlight={Boolean(routineRunInFlight(runs, detail.id))}
        onOpenRun={(run) => { openRun(run); if (["failed", "missed"].includes(run.status) && !run.seenAt && !run.redacted) dispatch({ type: "markRoutineRunSeen", runId: run.id }); }}
        onToggle={() => toggle(detail)}
        onPatch={async (patch) => { const response = await api(`/api/routines/${detail.id}`, { method: "PATCH", body: JSON.stringify(patch) }); if (response.routine) dispatch({ type: "routinePatched", routine: response.routine }); }}
        onClearRuns={() => void clearRoutineRuns(detail, confirm, dispatch).catch(() => { /* the runs stay listed */ })}
      />
      <RoutinePanelActions
        routine={detail}
        bot={bot}
        onStarted={openRun}
        onToggle={() => toggle(detail)}
        onEdit={() => setEditing("edit")}
        onDelete={async () => {
          if (!(await confirm({ title: t("routineCalendar.deleteConfirm", { title: detail.name }), confirmLabel: t("common.delete"), tone: "danger" }))) return;
          dispatch({ type: "deleteRoutine", routineId: detail.id });
          setDetailId(null);
        }}
      />
      {editing === "edit" && <RoutineEditor key={detail.id} routine={detail} mode="edit" bots={bots} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} onDeleted={() => { setEditing(null); setDetailId(null); }} onDuplicate={(routine) => setEditing({ copyOf: routine })} />}
      {editing && typeof editing === "object" && <RoutineEditor key={`${detail.id}-copy`} copyOf={editing.copyOf} bots={bots} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} />}
    </div>;
  }

  return <section data-bot-settings-section="routines" data-group-routines="" className="relative flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <CalendarClock size={16} className="text-ink-secondary" />
      <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
      {canCreate && <button type="button" data-group-routine-new="" onClick={() => setEditing("new")} aria-label={t("groupPanel.routines.create")} title={t("groupPanel.routines.create")} className="ui-icon-button"><Plus size={15} /></button>}
    </div>
    {routines.length === 0 && state.routinesLoadState !== "loading"
      ? <p data-routines-hint="" className="px-2 text-center text-[12px] leading-[17px] text-ink-tertiary">{t("groupPanel.routines.hint")}</p>
      : <RoutineList
        routines={routines}
        viewerPrincipalId={state.config?.viewer?.principalId ?? null}
        runs={runs}
        bots={members}
        loading={state.routinesLoadState === "loading" && routines.length === 0}
        error={state.routinesLoadState === "error"}
        grouped
        showBot
        label={t("computer.tab.routines")}
        onOpen={(routine) => setDetailId(routine.id)}
        onToggle={toggle}
      />}
    {editing === "new" && (
      <div className="absolute inset-0 z-30 min-h-[24rem]">
        <RoutineEditor key={`${group.id}-new`} bots={ownBots} group={{ id: group.id, ...(lead ? { leadBotId: lead } : {}) }} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} />
      </div>
    )}
  </section>;
}
