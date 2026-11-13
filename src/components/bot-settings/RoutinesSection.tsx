// Shared by bot settings and the bot's side panel. The list keeps one action
// (New schedule); a row opens the routine's page, which holds Run now, Pause
// or Resume, Check, the run logs and Delete; everything else is edited in place.
import { CalendarClock, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFeature } from "@/lib/server-features";
import { openRoutineRun, type Bot } from "@/state/store";
import { shallowEqual, useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import type { Routine, RoutineRun, RoutineRunOn } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { RoutineEditor } from "../RoutinesPage";
import { canManageRoutineFolders, RoutineFolderList, type RoutineFolderControl } from "../routines/RoutineFolders";
import { RoutinePanelPage } from "./RoutinePanelPage";
import { PanelPageHeader as RoutineDetailHeader, PanelPageLayer } from "./PanelPage";
import { useSettingsSurface } from "../SettingsPrimitives";

export { RoutineDetailHeader };

export function RoutinesSection({ bot, routines, runs, defaultRunOn, grouped = false, upcoming = false, createRequest = 0, followFocus = true }: {
  bot: Bot; routines: Routine[]; runs: RoutineRun[]; defaultRunOn?: RoutineRunOn; grouped?: boolean;
  /** The bot panel's Activity tab (#2125 / #2174): titled Upcoming, one flat
   * card with `[Category]` title prefixes, five rows then Show more. */
  upcoming?: boolean;
  /** Each bump opens a new routine (Suggested > Add to meeting). */
  createRequest?: number;
  /** Whether a routine line or Add to meeting (state.routineFocus) opens
   * here. The bot side panel's list (#2941) leaves it to the bot page's
   * Routines sub-page, where openRoutine sends it (#2624). */
  followFocus?: boolean;
}) {
  // only what the list draws: another bot's frame renders nothing here (#3624)
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    routineFocus: current.routineFocus,
    routinesLoadState: current.routinesLoadState,
    viewerPrincipalId: current.config?.viewer?.principalId ?? null,
  }), shallowEqual);
  // The bot's profile page (#3400): the shared group, a grey label with its
  // actions at the right and one card of rows, as every card of the page.
  const plain = useSettingsSurface() === "plain";
  const [editing, setEditing] = useState<Routine | "new" | { copyOf: Routine } | null>(null);
  // A new or copied routine, once created, opens its own page.
  const opened = (routine: Routine) => { setEditing(null); setNewFolder(undefined); setDetailId(routine.id); };
  const closePanel = () => { setEditing(null); dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); };
  // 2026-11-05 (#2098, the operator): a run opens in the chat, at its message; no run
  // sheet beside the chat from here (or from anywhere).
  const openRun = (run: RoutineRun) => openRoutineRun(dispatch, { runId: run.id, routineId: run.routineId, botId: run.botId ?? bot.id });
  // 2026-10-28: a folder's + makes the new routine in that folder.
  const [newFolder, setNewFolder] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  const folderControl = useRef<RoutineFolderControl | null>(null);
  const sectionMenuLabel = t("routineFolders.sectionMenu");
  const foldersServed = useServerFeature("routineFolders") !== "no";
  const detail = routines.find((routine) => routine.id === detailId) ?? null;
  useEffect(() => {
    if (!createRequest) return;
    setNewFolder(undefined);
    setEditing("new");
  }, [createRequest]);
  // A routine line in the conversation asked for this routine's page.
  const focus = state.routineFocus;
  useEffect(() => {
    if (!followFocus || !focus || focus.botId !== bot.id) return;
    if ("create" in focus) {
      // Suggested > Add to meeting (#2624): a new routine, here.
      setNewFolder(undefined);
      setEditing("new");
    } else {
      if (!routines.some((routine) => routine.id === focus.routineId)) return;
      setDetailId(focus.routineId);
    }
    dispatch({ type: "routineFocused" });
  }, [followFocus, focus, bot.id, routines, dispatch]);

  if (detail) {
    // 2026-11-06 (JC, "one single pane"): the routine's page is its editor;
    // everything is edited in place, no separate Edit pane.
    return <PanelPageLayer><div data-routine-panel-page className="absolute inset-0 z-20 flex flex-col bg-panel">
      <RoutinePanelPage
        routine={detail}
        bot={bot}
        bots={[bot]}
        runs={runs}
        lockedBotId={bot.id}
        {...(defaultRunOn ? { defaultRunOn } : {})}
        onOpenRun={openRun}
        onBack={() => setDetailId(null)}
        onDismiss={closePanel}
        onDeleted={() => setDetailId(null)}
        onDuplicate={(routine) => setEditing({ copyOf: routine })}
      />
      {editing && editing !== "new" && "copyOf" in editing && <div className="absolute inset-0 z-40"><RoutineEditor key={`${detail.id}-copy`} copyOf={editing.copyOf} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} folder={detail.folder} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} page={{ onCreated: opened }} /></div>}
    </div></PanelPageLayer>;
  }

  // No routine and nothing pending: no section, one quiet line. Asking the bot
  // in chat is the way in (plain text, no underline, no "New routine").
  const editorLayer = (editing === "new" || (editing && "copyOf" in editing)) && (
    <PanelPageLayer><div className="absolute inset-0 z-30 min-h-[24rem]">
      {editing === "new"
        ? <RoutineEditor key={`${bot.id}-new-${newFolder ?? ""}`} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} folder={newFolder} presentation="panel" onClose={() => { setEditing(null); setNewFolder(undefined); }} onDismiss={() => { setNewFolder(undefined); closePanel(); }} page={{ onCreated: opened }} />
        : <RoutineEditor key={`${"copyOf" in editing ? editing.copyOf.id : ""}-copy`} copyOf={"copyOf" in editing ? editing.copyOf : undefined} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} presentation="panel" onClose={() => setEditing(null)} onDismiss={closePanel} page={{ onCreated: opened }} />}
    </div></PanelPageLayer>
  );
  const empty = routines.length === 0 && state.routinesLoadState === "ready" && !editing;
  if (empty && !plain) {
    const [before, after] = t("botPanel.routines.hint", { ask: "\u0000" }).split("\u0000");
    return <div data-routines-hint className="px-2 text-center text-[12px] leading-[17px] text-ink-tertiary">
      <p>
        {before}
        <button type="button" data-routines-ask onClick={() => { dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); }} className="rounded hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("botPanel.routines.hintAsk")}</button>
        {after}
      </p>
    </div>;
  }

  const createButton = <button type="button" onClick={() => { setNewFolder(undefined); setEditing("new"); }} aria-label={t("computer.routines.create")} title={t("computer.routines.create")} className="ui-icon-button"><Plus size={15} /></button>;
  if (plain && !upcoming) {
    return <section data-routines-group="" aria-label={t("computer.tab.routines")} className="relative flex min-w-0 flex-col gap-2">
      {/* no routine: no label and no + (the owner, 2026-10-27), the quiet line as the card's row */}
      {!empty && <div className="flex min-h-6 items-center gap-1.5 px-1">
        <h3 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h3>
        {canManageRoutineFolders(routines, foldersServed) && <button type="button" data-routines-section-more="" aria-haspopup="menu" aria-label={sectionMenuLabel} title={sectionMenuLabel}
          onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); folderControl.current?.openSectionMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
          className="ui-icon-button"><MoreHorizontal size={15} /></button>}
        {createButton}
      </div>}
      <div data-routines-card="" className="flex flex-col rounded-2xl bg-card px-1 py-1">
        {empty ? (
          <RoutinesAskHint onAsk={() => { dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); }} />
        ) : (
          <RoutineFolderList controlRef={folderControl} bot={bot} routines={routines} viewerPrincipalId={state.viewerPrincipalId} runs={runs} loading={state.routinesLoadState === "loading" && routines.length === 0} error={state.routinesLoadState === "error"} onOpen={(routine) => setDetailId(routine.id)} grouped={grouped}
            onCreateIn={(folder) => { setNewFolder(folder); setEditing("new"); }}
            onDuplicate={(routine) => setEditing({ copyOf: routine })} />
        )}
      </div>
      {editorLayer}
    </section>;
  }

  return <div className={upcoming ? "relative flex flex-col gap-2" : "relative flex flex-col gap-3"}>
    <div className="flex items-center gap-2">
      {/* Upcoming: a plain grey label, like Suggested, Computer and Voice chat (#2125) */}
      {!upcoming && <CalendarClock size={16} className="text-ink-secondary" />}
      <h2 className={upcoming ? "min-w-0 flex-1 px-0.5 text-[13px] font-normal leading-[18px] text-ink-tertiary" : "min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary"}>{upcoming ? t("routines.upcoming.title") : t("computer.tab.routines")}</h2>
      {canManageRoutineFolders(routines, foldersServed) && <button type="button" data-routines-section-more="" aria-haspopup="menu" aria-label={sectionMenuLabel} title={sectionMenuLabel}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); folderControl.current?.openSectionMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
        className="ui-icon-button"><MoreHorizontal size={15} /></button>}
      {/* Upcoming has no +, as the reference design: Suggested > Add to meeting
          and asking the bot create one there (#2125) */}
      {!upcoming && createButton}
    </div>
    <RoutineFolderList controlRef={folderControl} bot={bot} routines={routines} viewerPrincipalId={state.viewerPrincipalId} runs={runs} loading={state.routinesLoadState === "loading" && routines.length === 0} error={state.routinesLoadState === "error"} onOpen={(routine) => setDetailId(routine.id)} grouped={grouped}
      collapseAfter={upcoming ? 5 : undefined} leadingClock={upcoming}
      onCreateIn={(folder) => { setNewFolder(folder); setEditing("new"); }}
      onDuplicate={(routine) => setEditing({ copyOf: routine })} />
    {editorLayer}
  </div>;
}

/** No routine yet, as a card's one row: what routines are, and "Ask it in
 * chat", the way in (the bot page's Routines card and its Outcomes tab,
 * #4098: one sentence for one state). */
export function RoutinesAskHint({ onAsk }: { onAsk: () => void }) {
  const [before, after] = t("botPanel.routines.hint", { ask: "\u0000" }).split("\u0000");
  return (
    <p data-routines-hint className="flex min-h-[44px] items-center px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <span>
        {before}
        <button type="button" data-routines-ask onClick={onAsk} className="rounded hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("botPanel.routines.hintAsk")}</button>
        {after}
      </span>
    </p>
  );
}

export { RoutinePanelActions } from "./RoutinePanelPage";
