// Group panel > Details > Routines (2026-11-03, JC): the group's team goals
// and the routines that post in its conversations, in the bot panel's
// Routines card (one grouped card, a row per routine with its bot's face,
// the switch at the right). A row opens the routine's page in place, edited
// in place, with the bar [Run now] [Check] [Disable or Enable] [Delete]; + makes a
// new team goal for this group, led by its lead.
import { CalendarClock, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { openRoutineRun, useStore, type Bot, type Group } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { RoutineEditor } from "../RoutinesPage";
import { RoutineList } from "../routines/RoutineList";
import { RoutinePanelPage } from "../bot-settings/RoutinePanelPage";

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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | { copyOf: Routine } | null>(null);
  // 2026-11-05 (#2098): a run opens in the chat, at its message.
  const openRun = (run: RoutineRun) => openRoutineRun(dispatch, { runId: run.id, routineId: run.routineId, botId: run.botId });
  const runs = state.routineRuns ?? [];
  const detail = routines.find((routine) => routine.id === detailId) ?? null;
  const botOf = (routine: Routine) => members.find((bot) => bot.id === routine.botId) ?? state.bots?.find((bot) => bot.id === routine.botId);
  const lead = ownBots.find((bot) => bot.id === leadBotId)?.id ?? ownBots[0]?.id;
  const canCreate = ownBots.length > 0 && !group.dm;
  const toggle = (routine: Routine) => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });
  const closePanel = () => { setEditing(null); dispatch({ type: "toggleSettings", open: false }); };
  // A new or copied routine, once created, opens its own page.
  const opened = (routine: Routine) => { setEditing(null); setDetailId(routine.id); };

  useEffect(() => {
    if (newRequest > 0 && canCreate) { setDetailId(null); setEditing("new"); }
  }, [newRequest, canCreate]);

  if (detail) {
    const bot = botOf(detail);
    const bots = bot ? [bot] : [];
    // 2026-11-06 (JC, "one single pane"): the routine's page is its editor.
    return <div data-group-routine-detail={detail.id} className="absolute inset-0 z-20 flex flex-col bg-panel">
      <RoutinePanelPage
        routine={detail}
        bot={bot}
        bots={bots}
        runs={runs}
        onOpenRun={openRun}
        onBack={() => setDetailId(null)}
        onDismiss={closePanel}
        onDeleted={() => setDetailId(null)}
        onDuplicate={(routine) => setEditing({ copyOf: routine })}
      />
      {editing && typeof editing === "object" && <div className="absolute inset-0 z-40"><RoutineEditor key={`${detail.id}-copy`} copyOf={editing.copyOf} bots={bots} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} page={{ onCreated: opened }} /></div>}
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
        <RoutineEditor key={`${group.id}-new`} bots={ownBots} group={{ id: group.id, ...(lead ? { leadBotId: lead } : {}) }} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} page={{ onCreated: opened }} />
      </div>
    )}
  </section>;
}
