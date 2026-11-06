// Group panel > Details > Routines (2026-11-03, JC): the group's team goals
// and the routines that post in its conversations, in the bot panel's
// Routines card (one grouped card, a row per routine with its bot's face,
// the switch at the right). A row opens the routine's page in place, edited
// in place, with the bar [Run now] [Check] [Disable or Enable] [Delete].
// 2026-11-06 (JC): drawn as the bot panel's Upcoming (RoutinesSection
// upcoming): the grey "Upcoming" label with its "..." menu (here: a new team
// goal for this group, led by its lead), one flat card with the clock on each
// row, five rows then Show more, the same row menu. Each row keeps its bot.
// data-panel-bot gives it the bot panel's card tones (styles.css).
import { MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { openRoutineRun, useStore, type Bot, type Group } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { RoutineEditor } from "../RoutinesPage";
import { RoutineList } from "../routines/RoutineList";
import { ROUTINE_MENU_ITEM, RoutineMenuPortal, RoutineRowMenuItems, routineRowActions } from "../routines/RoutineRowMenu";
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
  const [menu, setMenu] = useState<{ x: number; y: number; trigger: HTMLElement; routine?: Routine } | null>(null);
  const closeMenu = (focus = true) => { const trigger = menu?.trigger; setMenu(null); if (focus) trigger?.focus(); };
  const sectionMenuLabel = t("routineFolders.sectionMenu");
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

  return <section data-bot-settings-section="routines" data-group-routines="" data-panel-bot="" className="relative flex flex-col gap-2">
    <div className="flex items-center gap-2">
      {/* The bot panel's Upcoming label: plain grey, like Suggested and Computer */}
      <h2 className="min-w-0 flex-1 px-0.5 text-[13px] font-normal leading-[18px] text-ink-tertiary">{t("routines.upcoming.title")}</h2>
      {canCreate && <button type="button" data-routines-section-more="" aria-haspopup="menu" aria-label={sectionMenuLabel} title={sectionMenuLabel}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4, trigger: event.currentTarget }); }}
        className="ui-icon-button"><MoreHorizontal size={15} /></button>}
    </div>
    {routines.length === 0 && state.routinesLoadState !== "loading"
      ? <p data-routines-hint="" className="px-2 text-center text-[12px] leading-[17px] text-ink-tertiary">{t("groupPanel.routines.hint")}</p>
      : <div className="flex flex-col gap-1" data-routine-upcoming-flat="">
        <RoutineList
          routines={routines}
          viewerPrincipalId={state.config?.viewer?.principalId ?? null}
          runs={runs}
          bots={members}
          loading={state.routinesLoadState === "loading" && routines.length === 0}
          error={state.routinesLoadState === "error"}
          grouped
          showBot
          leadingClock
          collapseAfter={5}
          label={t("routines.upcoming.title")}
          onOpen={(routine) => setDetailId(routine.id)}
          onToggle={toggle}
          onRowMenu={(routine, at, trigger) => setMenu({ x: at.x, y: at.y, trigger, routine })}
          onOpenRunning={(routine, run) => openRoutineRun(dispatch, { runId: run.id, routineId: routine.id, botId: run.botId ?? routine.botId })}
        />
      </div>}
    {menu && <RoutineMenuPortal x={menu.x} y={menu.y} kind={menu.routine ? "row" : "section"} label={menu.routine ? menu.routine.name : t("routines.upcoming.title")} onClose={closeMenu}>
      {menu.routine
        ? <RoutineRowMenuItems routine={menu.routine} actions={routineRowActions({
          routine: menu.routine, bot: botOf(menu.routine), state, dispatch, close: closeMenu,
          onOpen: () => setDetailId(menu.routine!.id),
          onDuplicate: () => setEditing({ copyOf: menu.routine! }),
        })} />
        : <button type="button" role="menuitem" autoFocus data-group-routine-new="" className={ROUTINE_MENU_ITEM} onClick={() => { closeMenu(false); setEditing("new"); }}>
          <Plus size={14} aria-hidden="true" />{t("groupPanel.routines.create")}
        </button>}
    </RoutineMenuPortal>}
    {editing && typeof editing === "object" && (
      <div className="absolute inset-0 z-30 min-h-[24rem]">
        <RoutineEditor key={`${editing.copyOf.id}-copy`} copyOf={editing.copyOf} bots={(() => { const bot = botOf(editing.copyOf); return bot ? [bot] : []; })()} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} page={{ onCreated: opened }} />
      </div>
    )}
    {editing === "new" && (
      <div className="absolute inset-0 z-30 min-h-[24rem]">
        <RoutineEditor key={`${group.id}-new`} bots={ownBots} group={{ id: group.id, ...(lead ? { leadBotId: lead } : {}) }} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} page={{ onCreated: opened }} />
      </div>
    )}
  </section>;
}
