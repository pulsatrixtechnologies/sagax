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
import type { RoutineRunCardReport } from "@/state/store/model";
import { ExchangeSheet } from "../BotExchangeChip";
import { RunActivityState } from "./RunActivityState";
import { useWaitingNotPinned, WaitingOnYou } from "../task/WaitingOnYou";
import type { WaitingItem } from "@/lib/use-waiting-cards";

/** #3581: `report` is the chat card's own report (its message's summary),
 * the window's fallback when the run's record is gone or holds less. */
export type RoutineRunWindowTarget = { runId: string; routineId?: string; botId?: string; report?: RoutineRunCardReport };

/** What a run's record keeps of its output (server/routines/routines.ts
 * clips it with clipReadable, which may end it a little earlier with "…"). */
const RECORD_OUTPUT_MAX = 2_000;

/** The record's output may be a clip of a longer report. */
function recordMayBeClipped(output: string | undefined): boolean {
  const length = output?.length ?? 0;
  return length >= RECORD_OUTPUT_MAX || (length > RECORD_OUTPUT_MAX / 2 && output!.trimEnd().endsWith("…"));
}

function fallbackBot(botId: string, routine: Routine | null): Bot {
  return { id: botId, name: routine?.bot?.name ?? t("routines.unavailableBot"), color: "blue" } as Bot;
}

/** #3581: a finished run's whole report, so the window is whole from every
 * entry (the chat's card, the panel, Automations). The app's runs keep the
 * record's 2,000 characters; the single-run read gives the rest as `report`,
 * asked once and only when the record may be a clip (`asked`: the window
 * already loaded this run by id, with its report when the server had one).
 * The card's own report (`cardReport`) wins whenever it holds more: the
 * run's task thread may be gone while the chat still holds the whole text. */
function useWholeReport(run: RoutineRun, cardReport: string | undefined, asked: boolean): RoutineRun {
  const [report, setReport] = useState<string | undefined>(undefined);
  const card = cardReport?.trim() ?? "";
  const known = run.report ?? run.output ?? "";
  const wanted = !asked && !run.report && !run.redacted && run.status === "completed"
    && recordMayBeClipped(run.output) && card.length <= known.length;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api<{ runs?: RoutineRun[] }>(`/api/routines?run=${encodeURIComponent(run.id)}`)
      .then(({ runs }) => {
        const whole = runs?.find((candidate) => candidate.id === run.id)?.report;
        if (live && whole) setReport(whole);
      })
      .catch(() => { /* the record's text stays */ });
    return () => { live = false; };
  }, [wanted, run.id]);
  return useMemo(() => {
    if (run.redacted) return run;
    const longest = [run.report, report, card].reduce<string>((best, text) => (text && text.length > best.length ? text : best), run.output ?? "");
    return longest && longest !== (run.output ?? "") && longest !== run.report ? { ...run, report: longest } : run;
  }, [run, report, card]);
}

function RoutineRunWindowSheet({ run: listed, cardReport, asked, routine, bot, bots, detail, detailError, reload, waiting, onClose, onStop }: {
  run: RoutineRun;
  cardReport?: string;
  asked: boolean;
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
  const run = useWholeReport(listed, cardReport, asked);
  const live = ["queued", "running", "waiting"].includes(run.status);
  const exchange = useMemo(
    () => routineRunToExchange({ run, routine, bot, detail }),
    [run, run.output, run.report, run.status, run.error, routine, bot, detail],
  );
  const meta = (
    <span data-routine-run-meta>
      {routineRunExchangeMeta(run)}
      {live && <Loader2 size={12} className="ml-1.5 inline animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" />}
    </span>
  );
  // What the run waits on, answerable here as in the conversation.
  // #4204: the chat's composer stays under this window; what its pinned
  // card holds is drawn there only
  const items = useWaitingNotPinned(run.redacted ? [] : waiting);
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
  // #3581: this window read the run by id, its whole report with it
  const [loadedById, setLoadedById] = useState(false);
  useEffect(() => {
    if (run) { setMissing(null); return; }
    let live = true;
    setMissing("loading");
    api<{ runs?: RoutineRun[] }>(`/api/routines?run=${encodeURIComponent(target.runId)}`)
      .then(({ runs }) => {
        if (!live) return;
        if (Array.isArray(runs) && runs.length) {
          setLoadedById(true);
          dispatch({ type: "routineRunsLoaded", runs });
        } else setMissing("gone");
      })
      .catch(() => { if (live) setMissing("gone"); });
    return () => { live = false; };
  }, [run ? run.id : null, target.runId, attempt, dispatch]);

  // #3581: a run whose record is gone (the run log trimmed) still opens the
  // report its card holds: the window is whole from every entry.
  const cardReport = target.report?.text.trim();
  if (!run && missing === "gone" && cardReport) {
    const kept = {
      id: target.runId,
      routineId: routineId ?? "",
      routineName: routine?.name ?? "",
      botId: bot.id,
      target: "bot",
      status: "completed",
      scheduledFor: target.report!.at,
      output: cardReport,
    } as RoutineRun;
    return (
      <ExchangeSheet
        chrome="window"
        run={routineRunToExchange({ run: kept, routine, bot })}
        bots={[...bots]}
        onClose={onClose}
        testId="routine-run-window"
        ariaLabel={routine?.name}
      />
    );
  }

  if (!run) {
    return (
      <ExchangeSheet
        chrome="window"
        run={routineRunPendingExchange({ routineName: routine?.name ?? "", bot })}
        bots={[...bots]}
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
        cardReport={cardReport}
        asked={loadedById}
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
