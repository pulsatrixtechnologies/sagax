// The desktop's « Code » section (2026-10-18, lot P1.7,
// docs/superpowers/specs/2026-10-18-code-section-design.md): every
// Perspicax run of the person, whatever bot or origin started it, newest
// first and grouped (Today, This week, Older), with the launch composer on
// top; or one run (RunView). On a solo server it says Code needs Sagax
// Business, with a link. The data is server/routes/code.ts.
import { Cloud, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { WindowDragStrip } from "../DesktopCapabilities";
import { LaunchComposer } from "./LaunchComposer";
import { MiniBars } from "./MiniBars";
import { RunCard } from "./RunCard";
import { RunView } from "./RunView";
import { StatCard } from "./StatCard";
import {
  dailyOutcomes, launchCodeRun, loadCodeEnvironments, loadCodeRuns, runActive, runBucket, runPrOf, useCodeStatus,
  type CodeEnvironment, type CodeRun, type RunBucket,
} from "@/lib/code-runs";
import { runStats } from "../../../shared/cloud-agents.ts";
import { t, activeLocale } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";
import { useStore } from "@/state/store";

const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 30_000;

function BusinessGate({ businessUrl, reason }: { businessUrl?: string; reason?: string }) {
  return (
    <div data-code-gate={reason ?? "solo"} className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-24 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-card text-ink-secondary"><Cloud size={20} aria-hidden /></span>
      <h1 className="text-[18px] font-semibold text-ink">{t("code.title")}</h1>
      {reason === "solo" || !reason ? (
        <>
          <p className="text-[13.5px] text-ink-secondary">{t("code.gate.solo")}</p>
          {businessUrl && <a href={businessUrl} target="_blank" rel="noreferrer" className="ui-button ui-button-primary">{t("code.gate.cta")}</a>}
        </>
      ) : (
        <p className="text-[13.5px] text-ink-secondary">{t(reason === "no_session" ? "code.gate.signIn" : "code.gate.unreachable")}</p>
      )}
    </div>
  );
}

function RunsList({ consoleUrl, onOpen }: { consoleUrl?: string; onOpen: (id: string) => void }) {
  const [runs, setRuns] = useState<CodeRun[] | null>(null);
  const [envs, setEnvs] = useState<CodeEnvironment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      setRuns(await loadCodeRuns());
      setNow(Date.now());
      setError(null);
    } catch (cause) {
      setError(readableErrorMessage(cause, t("code.error")));
    }
  }, []);
  useEffect(() => {
    void refresh();
    loadCodeEnvironments().then(setEnvs).catch(() => setEnvs([]));
  }, [refresh]);
  const active = Boolean(runs?.some(runActive));
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    const onFrame = () => void refresh();
    window.addEventListener("sagax-cloud-agent", onFrame);
    return () => { window.clearInterval(timer); window.removeEventListener("sagax-cloud-agent", onFrame); };
  }, [active, refresh]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (runs ?? []).filter((run) => !q || run.title.toLowerCase().includes(q) || run.repo.toLowerCase().includes(q));
  }, [runs, query]);
  const groups = useMemo(() => {
    const out: Record<RunBucket, CodeRun[]> = { today: [], week: [], older: [] };
    for (const run of shown) out[runBucket(Date.parse(run.updated_at), now)].push(run);
    return out;
  }, [shown, now]);
  const week = useMemo(() => {
    const days = dailyOutcomes(runs ?? [], now, 7);
    const format = new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "short" });
    const recent = (runs ?? []).filter((run) => Date.parse(run.created_at) >= now - 7 * 86_400_000);
    const ok = days.reduce((n, d) => n + d.ok, 0);
    const fail = days.reduce((n, d) => n + d.fail, 0);
    const lines = recent.reduce((n, run) => { const s = runStats(run); return n + (s ? s.added + s.removed : 0); }, 0);
    const prs = recent.filter((run) => runPrOf(run)).length;
    return { series: days.map((d) => ({ label: format.format(d.day), ok: d.ok, fail: d.fail })), count: recent.length, rate: ok + fail ? ok / (ok + fail) : undefined, lines, prs };
  }, [runs, now]);

  const launch = async (input: { env_id: string; prompt: string; engine: string; model?: string }) => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const run = await launchCodeRun(input);
      await refresh();
      onOpen(run.id);
    } catch (cause) {
      setLaunchError(readableErrorMessage(cause, t("code.error")));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pb-16 pt-14">
        {envs === null ? <div className="h-28" /> : <LaunchComposer environments={envs} consoleUrl={consoleUrl} busy={launching} error={launchError} onLaunch={(input) => void launch(input)} />}
        {runs && runs.length > 0 && (
          <div data-code-stats className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label={t("code.stats.runs")} value={week.count} testId="code-stat-runs">
              <MiniBars series={week.series} />
            </StatCard>
            <StatCard label={t("code.stats.rate")} value={week.rate === undefined ? "-" : `${Math.round(week.rate * 100)} %`} ring={week.rate} testId="code-stat-rate" />
            <StatCard label={t("code.stats.lines")} value={week.lines} hint={t("code.stats.prs", { n: week.prs })} href={consoleUrl} testId="code-stat-lines" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[13px] font-medium text-ink-secondary">{t("code.list.title")}</h2>
          <label className="flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-ink-secondary focus-within:ring-2 focus-within:ring-accent/40">
            <Search size={13} aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("code.list.filter")} placeholder={t("code.list.filter")} className="w-40 bg-transparent text-[12.5px] text-ink placeholder:text-ink-tertiary focus:outline-none" />
          </label>
          <button type="button" onClick={() => void refresh()} aria-label={t("code.list.refresh")} title={t("code.list.refresh")} className="rounded-md p-1.5 text-ink-secondary hover:bg-hover"><RefreshCw size={14} aria-hidden /></button>
        </div>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {runs === null && !error && <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-ink-tertiary motion-reduce:animate-none" aria-hidden /></div>}
        {runs && shown.length === 0 && <p data-code-empty className="py-10 text-center text-[13px] text-ink-secondary">{query ? t("code.list.noMatch") : t("code.list.empty")}</p>}
        {(["today", "week", "older"] as const).map((bucket) => groups[bucket].length > 0 && (
          <section key={bucket} aria-label={t(`code.list.${bucket}`)} className="flex flex-col gap-1">
            <h3 className="px-2 text-[11.5px] font-medium uppercase tracking-wide text-ink-tertiary">{t(`code.list.${bucket}`)}</h3>
            {groups[bucket].map((run) => {
              const pr = runPrOf(run);
              return (
                <RunCard
                  key={run.id}
                  title={run.title}
                  state={run.state}
                  pr={pr ? { number: pr.number, state: pr.state } : undefined}
                  stats={runStats(run)}
                  model={run.model}
                  repo={run.repo}
                  updatedAt={new Date(run.updated_at)}
                  unread={run.unread}
                  now={now}
                  onOpen={() => onOpen(run.id)}
                />
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

export function CodePage() {
  const { state, dispatch } = useStore();
  const status = useCodeStatus();
  const runId = state.codeFocus.runId;
  // A Perspicax without the agents API: no Code page at all (the sidebar
  // hides its row), back to the conversation.
  const notAvailable = status?.available === false && status.reason === "not_available";
  useEffect(() => {
    if (notAvailable) dispatch({ type: "showChat" });
  }, [notAvailable, dispatch]);
  const open = (id: string) => dispatch({ type: "showCode", runId: id });
  return (
    <main data-code-page className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <WindowDragStrip />
      {status === null || notAvailable ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 size={18} className="animate-spin text-ink-tertiary motion-reduce:animate-none" aria-hidden /></div>
      ) : !status.available ? (
        <BusinessGate businessUrl={status.businessUrl} reason={status.reason} />
      ) : runId ? (
        <RunView key={runId} runId={runId} consoleUrl={status.consoleUrl} onBack={() => dispatch({ type: "showCode" })} />
      ) : (
        <RunsList consoleUrl={status.consoleUrl} onOpen={open} />
      )}
    </main>
  );
}
