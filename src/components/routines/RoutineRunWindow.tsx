// #2272 (JC, 2026-11-06): "open the details of a routine ... the equivalent
// of a bot to bot chat ... like it was before". A routine run opens as its
// own window over the bot's chat column: the ExchangeSheet shell of a
// bot-to-bot exchange (header pill, X to close, chat bubbles), the routine's
// instruction as the opening line, tool steps in the transcript, and what the
// run waits on pinned above. One conversation (#2081): no Continue, no group
// thread, no Open thread; Stop stays on the run's card in the chat (#2096).
// A run older than the app's window is loaded by id (GET /api/routines?run=).
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { BotActivityDetail } from "@/lib/bot-activity";
import { routineRunPendingExchange, routineRunToExchange, routineRunExchangeMeta } from "@/lib/routine-run-exchange";
import { api, useStore, type Bot } from "@/state/store";
import { ExchangeSheet } from "../BotExchangeChip";
import { RunActivityState } from "./RunActivityState";
import { WaitingOnYou } from "../task/WaitingOnYou";
import type { WaitingItem } from "@/lib/use-waiting-cards";

export type RoutineRunWindowTarget = { runId: string; routineId?: string; botId?: string };

function fallbackBot(botId: string, routine: Routine | null): Bot {
  return { id: botId, name: routine?.bot?.name ?? t("routines.unavailableBot"), color: "blue" } as Bot;
}

function RoutineRunWindowSheet({ run, routine, bot, bots, detail, detailError, reload, waiting, onClose, onStop }: {
  run: RoutineRun;
  routine: Routine | null;
  bot: Bot;
  bots: readonly Bot[];
  detail: BotActivityDetail | null;
  detailError: boolean;
  reload: () => Promise<void>;
  waiting: readonly WaitingItem[];
  onClose: () => void;
  onStop: (runId: string) => void;
}) {
  const live = ["queued", "running", "waiting"].includes(run.status);
  const exchange = useMemo(
    () => routineRunToExchange({ run, routine, bot, detail }),
    [run, run.output, run.status, run.error, routine, bot, detail],
  );
  const meta = (
    <span data-routine-run-meta>
      {routineRunExchangeMeta(run)}
      {live && <Loader2 size={12} className="ml-1.5 inline animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" />}
    </span>
  );
  // What the run waits on, answerable here as in the conversation.
  const items = run.redacted ? [] : waiting;
  const pinned = items.length > 0 ? (
    <div data-run-waiting>
      <WaitingOnYou
        items={items}
        threadId={run.threadId ?? ""}
        botFor={(id) => bots.find((candidate) => candidate.id === id) ?? (id === bot.id ? bot : undefined)}
        onCancel={() => onStop(run.id)}
      />
    </div>
  ) : undefined;
  return (
    <ExchangeSheet
      chrome="window"
      run={exchange}
      pinned={pinned}
      bots={[...bots]}
      showToolCalls
      onClose={onClose}
      loadError={detailError && !detail}
      onRetry={() => { void reload(); }}
      meta={meta}
      testId="routine-run-window"
      ariaLabel={run.routineName}
    />
  );
}

export function RoutineRunWindow({ target, bots, onClose, onStop }: {
  target: RoutineRunWindowTarget;
  bots: readonly Bot[];
  onClose: () => void;
  /** The approval card's "cancel the turn" (the chat owns the run's Stop). */
  onStop: (runId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const run = state.routineRuns.find((candidate) => candidate.id === target.runId);
  const routineId = target.routineId ?? run?.routineId;
  const routine = state.routines.find((candidate) => candidate.id === routineId) ?? null;
  const botId = run?.botId ?? target.botId ?? routine?.bot?.id;
  const bot = (botId && bots.find((candidate) => candidate.id === botId)) || fallbackBot(botId ?? "", routine);
  // A run not in the app's window yet: load it by id, then the store has it.
  const [missing, setMissing] = useState<"loading" | "gone" | null>(run ? null : "loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (run) { setMissing(null); return; }
    let live = true;
    setMissing("loading");
    api<{ runs?: RoutineRun[] }>(`/api/routines?run=${encodeURIComponent(target.runId)}`)
      .then(({ runs }) => {
        if (!live) return;
        if (Array.isArray(runs) && runs.length) dispatch({ type: "routineRunsLoaded", runs });
        else setMissing("gone");
      })
      .catch(() => { if (live) setMissing("gone"); });
    return () => { live = false; };
  }, [run ? run.id : null, target.runId, attempt, dispatch]);

  if (!run) {
    return (
      <ExchangeSheet
        chrome="window"
        run={routineRunPendingExchange({ routineName: routine?.name ?? "", bot })}
        bots={[...bots]}
        showToolCalls
        onClose={onClose}
        loadError={missing === "gone"}
        onRetry={() => setAttempt((was) => was + 1)}
        meta={missing === "loading" ? <Loader2 size={12} className="inline animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" /> : undefined}
        testId="routine-run-window"
        ariaLabel={routine?.name}
      />
    );
  }
  return (
    <RunActivityState key={run.id} run={run}>{({ detail, error, reload, waiting }) => (
      <RoutineRunWindowSheet
        run={run}
        routine={routine}
        bot={bot}
        bots={bots}
        detail={detail}
        detailError={error}
        reload={reload}
        waiting={waiting}
        onClose={onClose}
        onStop={onStop}
      />
    )}</RunActivityState>
  );
}
