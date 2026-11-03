// A routine run opened like a bot-to-bot exchange (JC, 2026-11-01): the same
// ExchangeSheet shell (header pill, chat bubbles, Close Chat pill at the bottom), with the
// routine's instruction as the opening line, tool steps in the transcript,
// and one footer row: Continue (primary), Stop while the run is live, then the
// neutral Close Chat pill last (JC 2026-11-03: Run again and the ⋯ menu are
// gone; logs and configuration stay in the routine panel). Live runs poll activity and refresh the sheet.
import { useMemo } from "react";
import { Loader2, MessageSquareText, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { BotActivityDetail } from "@/lib/bot-activity";
import { routineRunToExchange, routineRunExchangeMeta } from "@/lib/routine-run-exchange";
import { continueRoutineRunInConversation, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { ExchangeSheet } from "../BotExchangeChip";
import { PRIMARY_PILL } from "../SettingsPrimitives";
import { RunActivityState as ConnectedRunActivity } from "./RunActivityState";

function RoutineRunExchangeSheet({
  run,
  routine,
  bot,
  bots,
  detail,
  detailError,
  reload,
  onClose,
  onStop,
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
  onStop?: () => void;
  onOpenRoom?: (id: string) => void;
  working: boolean;
}) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const live = ["queued", "running", "waiting"].includes(run.status);
  const canContinue = run.target === "bot";
  // A team goal ran in its group: Continue is the group's thread.
  const goalGroupId = run.target === "room-goal" ? run.groupId ?? routine?.groupId : undefined;
  const openGroupThread = () => {
    if (!goalGroupId) return;
    if (run.threadId) dispatch({ type: "switchGroupTask", groupId: goalGroupId, threadId: run.threadId });
    onOpenRoom?.(goalGroupId);
    onClose();
  };
  const exchange = useMemo(
    () => routineRunToExchange({ run, routine, bot, detail }),
    [run, run.output, run.status, run.error, routine, bot, detail],
  );

  const openContinue = () => {
    continueRoutineRunInConversation(dispatch, bot, run, showThreads);
    onClose();
  };
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
      {live && onStop && (
        <button type="button" data-run-stop onClick={onStop} disabled={working} className={quietStop}>
          {working ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square size={12} fill="currentColor" aria-hidden="true" />}
          {t("routineRun.stop")}
        </button>
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
  onStop,
  onOpenRoom,
  working = false,
}: {
  run: RoutineRun;
  routine: Routine | null;
  bots: readonly Bot[];
  onClose: () => void;
  onStop?: () => void;
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
        onStop={onStop}
        onOpenRoom={onOpenRoom}
        working={working}
      />
    )}</ConnectedRunActivity>
  );
}
