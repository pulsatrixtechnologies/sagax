// Settings > Computer > Computer care, first rows (parity R7, system 6 and
// 5): Recover when the bot's computer is stuck (Grok Bot's "Recover
// computer"), Update now otherwise, and Reset as its own red row below. Update
// and Recover rebuild from the current image and keep the person's files
// (src/lib/computer-recover.ts); Reset is the heavier rebuild from the last
// snapshot.
//
// When a bot is working on the computer the server holds Update back (409
// computer_busy). Instead of only saying so, this row lists the bots working
// now (GET /api/computer/working-bots) and offers a Stop next to each, through
// the ordinary task stop (src/lib/computer-working-bots.ts). The list refreshes
// on its own, so Update enables the moment the last bot is done. Reset is not
// held back: it confirms first.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import { t } from "@/lib/i18n";
import { computerAction, loadComputerStatus, resetComputer, updateComputer, type ComputerStatusView } from "@/lib/computer-recover";
import { loadWorkingBots, stopWorkingBot, type WorkingBot } from "@/lib/computer-working-bots";
import { ApiError } from "@/state/store";
import { DANGER_PILL, DescribedRow, PILL } from "../SettingsPrimitives";

type Confirm = (message: string) => Promise<boolean>;
const defaultConfirm: Confirm = (message) => window.ogb?.confirm ? window.ogb.confirm(message) : Promise.resolve(window.confirm(message));

export function ComputerRecoverRow({
  initial = null,
  confirm = defaultConfirm,
  loadWorkingBotsFn = loadWorkingBots,
  stopWorkingBotFn = stopWorkingBot,
  pollMs = 3000,
}: {
  initial?: ComputerStatusView | null;
  confirm?: Confirm;
  loadWorkingBotsFn?: (signal?: AbortSignal) => Promise<WorkingBot[]>;
  stopWorkingBotFn?: (bot: WorkingBot) => Promise<void>;
  pollMs?: number;
}) {
  const [status, setStatus] = useState<ComputerStatusView | null>(initial);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [workers, setWorkers] = useState<WorkingBot[]>([]);
  const [stopping, setStopping] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    loadComputerStatus(controller.signal).then(setStatus, () => { /* no computer here: no row */ });
    return () => controller.abort();
  }, [initial]);

  const action = computerAction(status);
  // Only a running computer can be busy with a bot; a stuck one being
  // recovered is down, so there is nothing to list or stop.
  const watchWorkers = action === "update";

  const refreshWorkers = useCallback((signal?: AbortSignal) => {
    // Promise.resolve wraps a synchronous throw from the loader into a
    // rejection, so a failed poll is always caught here (never an effect crash).
    return Promise.resolve().then(() => loadWorkingBotsFn(signal)).then(
      (bots) => { if (!signal?.aborted && Array.isArray(bots)) setWorkers(bots); },
      () => { /* the list is best effort: keep the last one */ },
    );
  }, [loadWorkingBotsFn]);

  useEffect(() => {
    if (!watchWorkers) { setWorkers([]); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      void refreshWorkers(controller.signal).finally(() => {
        if (!controller.signal.aborted) timer = setTimeout(tick, pollMs);
      });
    };
    tick();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [watchWorkers, refreshWorkers, pollMs]);

  if (!action) return null;
  const recover = action === "recover";
  const busy = watchWorkers && workers.length > 0;

  const run = async () => {
    if (!(await confirm(t(recover ? "computerCare.recover.confirm" : "computerCare.updateNow.confirm")))) return;
    setRunning(true);
    setError("");
    try {
      setStatus(await updateComputer());
    } catch (cause) {
      // the server holds it back: a bot works on it, or an update already runs
      const code = cause instanceof ApiError ? (cause.body as { code?: unknown } | undefined)?.code : undefined;
      setError(t(code === "computer_busy" ? "computerCare.refused.busy"
        : code === "computer_updating" ? "computerCare.refused.updating"
          : recover ? "computerCare.recover.error" : "computerCare.updateNow.error"));
      loadComputerStatus().then(setStatus, () => {});
      void refreshWorkers();
    } finally {
      setRunning(false);
    }
  };

  const stop = async (bot: WorkingBot) => {
    setError("");
    setStopping((prev) => new Set(prev).add(bot.id));
    try {
      await stopWorkingBotFn(bot);
      await refreshWorkers();
    } catch {
      setError(t("computerCare.busy.stopError", { name: bot.name }));
    } finally {
      setStopping((prev) => { const next = new Set(prev); next.delete(bot.id); return next; });
    }
  };

  const reset = async () => {
    if (!(await confirm(t(busy ? "computerCare.reset.confirmBusy" : "computerCare.reset.confirm")))) return;
    setResetting(true);
    setError("");
    try {
      setStatus(await resetComputer());
      void refreshWorkers();
    } catch (cause) {
      const code = cause instanceof ApiError ? (cause.body as { code?: unknown } | undefined)?.code : undefined;
      setError(t(code === "computer_updating" ? "computerCare.refused.updating" : "computerCare.reset.error"));
      loadComputerStatus().then(setStatus, () => {});
    } finally {
      setResetting(false);
    }
  };

  const description = running
    ? t(recover ? "computerCare.recover.running" : "computerCare.updateNow.running")
    : busy
      ? t("computerCare.busy.working")
      : recover
        ? t(status?.waking ? "computerCare.recover.waking" : "computerCare.recover.hint")
        : t("computerCare.updateNow.hint");

  return (
    <div data-settings-card="computer.recover" data-computer-action={action} data-computer-busy={busy ? "yes" : "no"}>
      <DescribedRow
        label={t(recover ? "computerCare.recover.title" : "computerCare.updateNow.title")}
        rowId="computerRecover"
        icon={<RotateCcw size={14} />}
        description={<span role={running ? "status" : undefined}>{description}</span>}
        below={(
          <>
            {!recover && <p className="mt-1 text-[12px] text-ink-secondary">{t("computerCare.updateNow.allTogether")}</p>}
            {busy && (
              <ul className="mt-2 flex flex-col gap-1.5" data-working-bots="">
                {workers.map((bot) => (
                  <li key={`${bot.id}\n${bot.threadId}`} className="flex items-center justify-between gap-3 text-[13px] text-ink" data-working-bot={bot.id}>
                    <span className="min-w-0 truncate" title={bot.id} data-bot-id={bot.id}>{bot.name}</span>
                    <button
                      type="button"
                      className={`${PILL} shrink-0 gap-1.5`}
                      disabled={stopping.has(bot.id)}
                      onClick={() => void stop(bot)}
                      data-stop-bot={bot.id}
                    >
                      {stopping.has(bot.id) && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                      {t(stopping.has(bot.id) ? "computerCare.busy.stopping" : "computerCare.busy.stop", { name: bot.name })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
          </>
        )}
      >
        <button type="button" className={`${PILL} gap-1.5`} disabled={running || busy} onClick={() => void run()} data-computer-recover="">
          {running && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
          {t(recover ? "computerCare.recover.button" : "computerCare.updateNow.button")}
        </button>
      </DescribedRow>

      <DescribedRow
        label={t("computerCare.reset.title")}
        rowId="computerReset"
        icon={<RotateCcw size={14} />}
        description={<span role={resetting ? "status" : undefined}>{resetting ? t("computerCare.reset.running") : t("computerCare.reset.hint")}</span>}
      >
        <button type="button" className={`${DANGER_PILL} gap-1.5`} disabled={resetting || running} onClick={() => void reset()} data-computer-reset="">
          {resetting && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
          {t("computerCare.reset.button")}
        </button>
      </DescribedRow>
    </div>
  );
}
