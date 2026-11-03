// A routine run opened like a bot-to-bot exchange (JC, 2026-11-01): the same
// ExchangeSheet shell (header pill, chat bubbles, Close Chat pill at the bottom), with the
// routine's instruction as the opening line, tool steps in the transcript,
// and one footer row (2026-11-02, as in Grok Bot): Continue (primary), Stop or
// Run again, the ⋯ menu (Run logs, Configuration as plain items), then the
// neutral Close Chat pill last. Live runs poll activity and refresh the sheet.
import { useMemo, useRef, useState } from "react";
import { History, Loader2, MessageSquareText, MoreHorizontal, RotateCcw, Settings2, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { BotActivityDetail } from "@/lib/bot-activity";
import { routineRunToExchange, routineRunExchangeMeta } from "@/lib/routine-run-exchange";
import { continueRoutineRunInConversation, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { ExchangeSheet } from "../BotExchangeChip";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { AnchoredPopover, enclosingWindowBounds, useAnchoredDismissRoot } from "../AnchoredPopover";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { ConnectedRunActivity } from "./RoutineRunDetail";
import { canRunRoutineNow, routineRunInFlight } from "./RunNowButton";

function RoutineRunExchangeSheet({
  run,
  routine,
  bot,
  bots,
  detail,
  detailError,
  reload,
  onClose,
  onRunAgain,
  onStop,
  onLogs,
  onOpenConfiguration,
  onOpenRoom,
  working,
}: {
  run: RoutineRun;
  routine: Routine | null;
  bot: Bot;
  bots: readonly Bot[];
  detail: BotActivityDetail | null;
  detailError: boolean;
  reload: () => Promise<void>;
  onClose: () => void;
  onRunAgain?: () => void;
  onStop?: () => void;
  onLogs?: () => void;
  onOpenConfiguration?: () => void;
  onOpenRoom?: (id: string) => void;
  working: boolean;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const live = ["queued", "running", "waiting"].includes(run.status);
  const canRunAgain = Boolean(routine && canRunRoutineNow(state.config, routine, bot));
  const inFlight = Boolean(routine && routineRunInFlight(state.routineRuns, routine.id));
  const canContinue = run.target === "bot";
  // A team goal ran in its group: Continue is the group's thread.
  const goalGroupId = run.target === "room-goal" ? run.groupId ?? routine?.groupId : undefined;
  const openGroupThread = () => {
    if (!goalGroupId) return;
    if (run.threadId) dispatch({ type: "switchGroupTask", groupId: goalGroupId, threadId: run.threadId });
    onOpenRoom?.(goalGroupId);
    onClose();
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const dismissRoot = useAnchoredDismissRoot(moreRef, menuRef);
  usePopoverDismiss(menuOpen, dismissRoot, () => setMenuOpen(false));
  const exchange = useMemo(
    () => routineRunToExchange({ run, routine, bot, detail }),
    [run, run.output, run.status, run.error, routine, bot, detail],
  );

  const openContinue = () => {
    continueRoutineRunInConversation(dispatch, bot, run, showThreads);
    onClose();
  };
  const openLogs = () => {
    setMenuOpen(false);
    onLogs?.();
    onClose();
  };
  // A routine is edited in the side panel (JC): Configuration opens it.
  const openConfig = () => {
    setMenuOpen(false);
    onOpenConfiguration?.();
    onClose();
  };
  const hasMenu = Boolean(onLogs || onOpenConfiguration);

  const meta = (
    <span data-routine-run-meta>
      {routineRunExchangeMeta(run)}
      {live && <Loader2 size={12} className="ml-1.5 inline animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" />}
    </span>
  );

  // The actions of the sheet's single footer row; ExchangeSheet adds the
  // neutral Close Chat pill at its end. Continue is the only filled pill,
  // Stop is a quiet destructive control. `contents`: the buttons are items
  // of that row, so narrow widths wrap them in order, centered.
  const quietStop =
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-50";
  const menuItem = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] text-ink hover:bg-raised";
  const footer = (
    <div data-routine-run-actions className="contents">
      {canContinue && (
        <button type="button" data-run-continue onClick={openContinue} className={cn(PRIMARY_PILL, "gap-1.5")}>
          <MessageSquareText size={13} aria-hidden="true" />
          {t("routineRun.continue")}
        </button>
      )}
      {goalGroupId && (
        <button type="button" data-run-continue onClick={openGroupThread} className={cn(PRIMARY_PILL, "gap-1.5")}>
          <MessageSquareText size={13} aria-hidden="true" />
          {t("routineCalendar.openGroupThread")}
        </button>
      )}
      {!live && canRunAgain && onRunAgain && (
        <button type="button" data-run-again onClick={onRunAgain} disabled={working || inFlight} title={inFlight ? t("routines.runNow.inFlight") : t("routineRun.runAgain")} className={cn(PILL, "gap-1.5")}>
          {working ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}
          {t("routineRun.runAgain")}
        </button>
      )}
      {live && onStop && (
        <button type="button" data-run-stop onClick={onStop} disabled={working} className={quietStop}>
          {working ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square size={12} fill="currentColor" aria-hidden="true" />}
          {t("routineRun.stop")}
        </button>
      )}
      {hasMenu && (
        <div ref={moreRef} className="flex">
          <button
            ref={moreButtonRef}
            type="button"
            data-run-more
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t("chat.moreMenu.aria")}
            onClick={() => setMenuOpen((value) => !value)}
            className={cn(PILL, "gap-1.5")}
          >
            <MoreHorizontal size={13} aria-hidden="true" />
          </button>
          {menuOpen && (
            <AnchoredPopover
              anchorRef={moreButtonRef}
              popoverRef={menuRef}
              side="top"
              align="end"
              gap={8}
              bounds={enclosingWindowBounds}
              role="menu"
              data-run-more-menu=""
              className="min-w-[11rem] rounded-xl border border-border bg-elevated p-1 shadow-lg"
            >
              {onLogs && (
                <button type="button" role="menuitem" data-run-logs onClick={openLogs} className={menuItem}>
                  <History size={13} aria-hidden="true" />{t("routines.logs")}
                </button>
              )}
              {onOpenConfiguration && (
                <button type="button" role="menuitem" data-run-configuration onClick={openConfig} className={menuItem}>
                  <Settings2 size={13} aria-hidden="true" />{t("routineRun.configuration")}
                </button>
              )}
            </AnchoredPopover>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ExchangeSheet
      run={exchange}
      bots={[...bots]}
      showToolCalls
      onClose={onClose}
      loadError={detailError && !detail}
      onRetry={() => { void reload(); }}
      meta={meta}
      footer={footer}
      testId="routine-run-exchange"
      ariaLabel={t("routines.executionDetails", { name: run.routineName })}
    />
  );
}

export function RoutineRunExchange({
  run,
  routine,
  bots,
  onClose,
  onRunAgain,
  onStop,
  onLogs,
  onOpenConfiguration,
  onOpenRoom,
  working = false,
}: {
  run: RoutineRun;
  routine: Routine | null;
  bots: readonly Bot[];
  onClose: () => void;
  onRunAgain?: () => void;
  onStop?: () => void;
  onLogs?: () => void;
  onOpenConfiguration?: () => void;
  onOpenRoom?: (id: string) => void;
  working?: boolean;
}) {
  const { state } = useStore();
  const bot = bots.find((candidate) => candidate.id === run.botId)
    ?? ({ id: run.botId, name: routine?.bot?.name ?? t("routines.unavailableBot"), color: "blue" } as Bot);
  const liveRun = state.routineRuns.find((candidate) => candidate.id === run.id) ?? run;

  return (
    <ConnectedRunActivity key={liveRun.id} run={liveRun}>{({ detail, error: detailError, reload }) => (
      <RoutineRunExchangeSheet
        run={liveRun}
        routine={routine}
        bot={bot}
        bots={bots}
        detail={detail}
        detailError={detailError}
        reload={reload}
        onClose={onClose}
        onRunAgain={onRunAgain}
        onStop={onStop}
        onLogs={onLogs}
        onOpenConfiguration={onOpenConfiguration}
        onOpenRoom={onOpenRoom}
        working={working}
      />
    )}</ConnectedRunActivity>
  );
}
