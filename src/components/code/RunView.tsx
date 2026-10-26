// One run (spec 9.3): the agent's conversation on the left with the alerts
// and the « Add a follow up » composer, a tabbed panel on the right
// (Changes | Desktop | Terminal | Files | +). The panel resizes from its
// edge, goes full screen or folds away. Live: the run's events arrive over
// the relayed SSE stream (followRunEvents); a state or PR event reloads the
// run, a commit reloads the diff.
import {
  AlertTriangle, ArrowLeft, Archive, ChevronDown, Copy, ExternalLink, FileText, Folder, GitBranch, Loader2, Maximize2,
  Minimize2, Monitor, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, Send, Square, SquareTerminal, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commitsFrom, diffFilesFrom, type CodeArtifact, type CodeCommit, type CodeFileEntry, type DiffFile } from "../../../shared/code-runs.ts";
import { DiffView } from "./DiffView";
import { formatAge, pillLabel, RunPillBadge, runCardPill } from "./RunCard";
import { RunTimeline } from "./RunTimeline";
import {
  approveRun, archiveRun, followRunEvents, followUpRun, loadCodeRun, loadRunCommits, loadRunDiff, loadRunEvents, loadRunFiles,
  markRunRead, mergeEvents, runActive, runPrOf, runWorking, stopRun, timelineItems, workedMinutes,
  type CodeEvent, type CodeRun, type FollowUpMode,
} from "@/lib/code-runs";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";

type Tab = "changes" | "desktop" | "terminal" | "files";
type SubTab = "diff" | "review" | "commits";

const PANEL_MIN = 360;
const PANEL_DEFAULT = 560;

function Placeholder({ icon: Icon, title, body }: { icon: typeof Monitor; title: string; body: string }) {
  return (
    <div data-code-placeholder className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon size={22} aria-hidden className="text-ink-tertiary" />
      <span className="text-[13.5px] font-medium text-ink">{title}</span>
      <span className="max-w-xs text-[12.5px] text-ink-secondary">{body}</span>
      <span className="rounded-full bg-control px-2 py-0.5 text-[11px] text-ink-secondary">{t("code.soon")}</span>
    </div>
  );
}

function FilesTab({ files }: { files: CodeArtifact<CodeFileEntry> | null }) {
  if (!files) return <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-ink-tertiary motion-reduce:animate-none" aria-hidden /></div>;
  if (!files.available) return <Placeholder icon={Folder} title={t("code.files.title")} body={t("code.files.later")} />;
  if (files.items.length === 0) return <p className="py-8 text-center text-[13px] text-ink-secondary">{t("code.files.empty")}</p>;
  return (
    <ul data-code-files className="flex flex-col py-2 font-mono text-[12px]">
      {files.items.map((entry) => {
        const depth = entry.path.split("/").length - 1;
        const name = entry.path.split("/").at(-1);
        return (
          <li key={entry.path} className="flex items-center gap-1.5 px-3 py-0.5 text-ink" style={{ paddingLeft: 12 + depth * 14 }}>
            {entry.kind === "dir" ? <Folder size={12} aria-hidden className="text-ink-tertiary" /> : <FileText size={12} aria-hidden className="text-ink-tertiary" />}
            <span className="truncate">{name}</span>
            {entry.size !== undefined && <span className="ml-auto text-[11px] text-ink-tertiary">{t("code.files.size", { n: Math.max(1, Math.round(entry.size / 1024)) })}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function CommitsTab({ commits, now }: { commits: CodeArtifact<CodeCommit> | null; now: number }) {
  if (!commits) return null;
  if (!commits.available) return <Placeholder icon={GitBranch} title={t("code.commits.title")} body={t("code.files.later")} />;
  if (commits.items.length === 0) return <p className="py-8 text-center text-[13px] text-ink-secondary">{t("code.commits.empty")}</p>;
  return (
    <ul data-code-commits className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-card">
      {commits.items.map((commit) => (
        <li key={commit.sha} className="flex items-center gap-3 px-3 py-2">
          <span className="font-mono text-[11.5px] text-ink-secondary">{commit.sha.slice(0, 7)}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{commit.title}</span>
          {commit.at && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{formatAge(new Date(commit.at), now)}</span>}
        </li>
      ))}
    </ul>
  );
}

function RunMenu({ run, consoleUrl, onStop, onArchive }: { run: CodeRun; consoleUrl?: string; onStop: () => void; onArchive: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const pr = runPrOf(run);
  const link = pr?.url ?? (consoleUrl ? `${consoleUrl.replace(/\/$/, "")}/runs/${encodeURIComponent(run.id)}` : "");
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-popover-ink hover:bg-popover-hover disabled:opacity-50";
  const terminal = ["finished", "failed", "stopped", "expired", "archived"].includes(run.state);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={t("code.run.menu")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-md p-1.5 text-ink-secondary hover:bg-hover">
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-30 w-56 rounded-lg border border-popover-border bg-popover p-1 shadow-lg">
          <button type="button" role="menuitem" className={item} disabled={terminal} onClick={() => { setOpen(false); onStop(); }}><Square size={13} aria-hidden />{t("code.action.stop")}</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onArchive(); }}><Archive size={13} aria-hidden />{t("code.action.archive")}</button>
          {consoleUrl && <a role="menuitem" className={item} href={`${consoleUrl.replace(/\/$/, "")}/runs/${encodeURIComponent(run.id)}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}><ExternalLink size={13} aria-hidden />{t("code.action.console")}</a>}
          <button type="button" role="menuitem" className={item} disabled={!link} onClick={() => { setOpen(false); if (link) void copyText(link); }}><Copy size={13} aria-hidden />{t("code.action.copyLink")}</button>
        </div>
      )}
    </div>
  );
}

function FollowUpComposer({ run, onSend }: { run: CodeRun; onSend: (text: string, mode: FollowUpMode) => Promise<void> }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<FollowUpMode>("queue");
  const [menu, setMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const closed = ["failed", "stopped", "expired", "archived"].includes(run.state);
  const send = async () => {
    const value = text.trim();
    if (!value || sending || closed) return;
    setSending(true);
    try {
      await onSend(value, mode);
      setText("");
      setMode("queue");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="relative rounded-2xl border border-hairline bg-composer px-2 py-1.5 focus-within:ring-2 focus-within:ring-composer-ring">
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={t("code.followup.modes")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="rounded-full p-1.5 text-ink-secondary hover:bg-hover">
          <Plus size={15} aria-hidden />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          disabled={closed}
          aria-label={t("code.followup.placeholder")}
          placeholder={closed ? t("code.followup.closed") : t("code.followup.placeholder")}
          className="min-w-0 flex-1 bg-transparent py-1 text-[13.5px] text-ink placeholder:text-ink-tertiary focus:outline-none disabled:opacity-60"
        />
        {mode !== "queue" && <span className="rounded-full bg-control px-2 py-0.5 text-[11px] text-ink-secondary">{t(`code.followup.mode.${mode}` as "code.followup.mode.steer")}</span>}
        <span className="hidden shrink-0 text-[12px] text-ink-tertiary sm:inline">{run.model}</span>
        <button type="button" onClick={() => void send()} disabled={!text.trim() || sending || closed} aria-label={t("code.followup.send")} className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-40">
          {sending ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Send size={13} aria-hidden />}
        </button>
      </div>
      {menu && (
        <div role="menu" className="absolute bottom-11 left-1 z-20 w-64 rounded-lg border border-popover-border bg-popover p-1 shadow-lg">
          {(["queue", "steer", "interrupt"] as const).map((value) => (
            <button key={value} type="button" role="menuitemradio" aria-checked={mode === value} onClick={() => { setMode(value); setMenu(false); }} className={cn("flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-popover-hover", mode === value && "bg-popover-hover")}>
              <span className="text-[12.5px] text-popover-ink">{t(`code.followup.mode.${value}`)}</span>
              <span className="text-[11.5px] text-popover-ink-secondary">{t(`code.followup.mode.${value}.hint`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RunView({ runId, consoleUrl, onBack }: { runId: string; consoleUrl?: string; onBack: () => void }) {
  const [run, setRun] = useState<CodeRun | null>(null);
  const [events, setEvents] = useState<CodeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<CodeArtifact<DiffFile> | null>(null);
  const [commits, setCommits] = useState<CodeArtifact<CodeCommit> | null>(null);
  const [files, setFiles] = useState<CodeArtifact<CodeFileEntry> | null>(null);
  const [tab, setTab] = useState<Tab>("changes");
  const [sub, setSub] = useState<SubTab>("diff");
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [panel, setPanel] = useState<"open" | "full" | "closed">("open");
  const [width, setWidth] = useState(PANEL_DEFAULT);
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const [details, setDetails] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastStats = useRef<string>("");
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = run ? runActive(run) : true; }, [run]);

  const reloadRun = useCallback(async () => {
    try {
      const next = await loadCodeRun(runId);
      setRun(next);
      const stats = JSON.stringify(next.stats ?? {}) + next.state;
      if (stats !== lastStats.current) {
        lastStats.current = stats;
        void loadRunDiff(runId).then(setDiff).catch(() => setDiff({ available: false, items: [] }));
        void loadRunCommits(runId).then(setCommits).catch(() => setCommits({ available: false, items: [] }));
        void loadRunFiles(runId).then(setFiles).catch(() => setFiles({ available: false, items: [] }));
      }
      return next;
    } catch (cause) {
      setError(readableErrorMessage(cause, t("code.error")));
      return null;
    }
  }, [runId]);

  useEffect(() => {
    let live = true;
    let pending: number | null = null;
    const abort = new AbortController();
    setRun(null); setEvents([]); setDiff(null); setCommits(null); setFiles(null); setError(null);
    lastStats.current = "";
    void (async () => {
      const first = await reloadRun();
      if (!live || !first) return;
      if (first.unread) void markRunRead(runId).then((read) => { if (live) setRun(read); }).catch(() => {});
      const initial = await loadRunEvents(runId).catch(() => [] as CodeEvent[]);
      if (!live) return;
      setEvents(initial);
      void followRunEvents(runId, initial.at(-1)?.seq ?? 0, (event) => {
        setEvents((list) => mergeEvents(list, [event]));
        // The runner's diff and commit list arrive whole in the event:
        // shown as they are, no round trip to Perspicax.
        if (event.kind === "diff") setDiff({ available: true, items: diffFilesFrom(event.payload) });
        if (event.kind === "commits") setCommits({ available: true, items: commitsFrom(event.payload) });
        if (["state", "pr", "status", "stats", "approval", "approval_answer", "followup"].includes(event.kind) && pending === null) {
          pending = window.setTimeout(() => { pending = null; if (live) void reloadRun(); }, 250);
        }
      }, abort.signal, () => activeRef.current);
    })();
    return () => { live = false; abort.abort(); if (pending !== null) window.clearTimeout(pending); };
  }, [runId, reloadRun]);

  const working = run ? runWorking(run) : false;
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [working]);

  const warnings = useMemo(() => timelineItems(events).filter((item): item is Extract<ReturnType<typeof timelineItems>[number], { kind: "warning" }> => item.kind === "warning"), [events]);

  const act = async (work: () => Promise<CodeRun>) => {
    try {
      setRun(await work());
      setError(null);
    } catch (cause) {
      setError(readableErrorMessage(cause, t("code.error")));
    }
  };

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (e: PointerEvent) => setWidth(Math.max(PANEL_MIN, Math.min(window.innerWidth - 360, startWidth + (startX - e.clientX))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-secondary">
        {error ? <><p role="alert" className="text-[13px] text-danger">{error}</p><button type="button" onClick={onBack} className="ui-button">{t("code.back")}</button></> : <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />}
      </div>
    );
  }

  const pr = runPrOf(run);
  const pill = runCardPill(run.state, pr);
  const prPill = pr ? runCardPill("finished", pr) : pill;
  const commitCount = commits?.items.length ?? (typeof run.stats?.commits === "number" ? run.stats.commits : 0);

  const left = (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel === "full" && "hidden")}>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4">
          <RunTimeline
            events={events}
            workedMinutes={workedMinutes(run, now)}
            working={working}
            onApprove={(approvalId, option) => void act(() => approveRun(run.id, approvalId, option))}
          />
          {run.error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{run.error}</p>}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2 px-6 pb-4">
        {run.subscription && run.subscription.state !== "ok" && (
          <div role="alert" data-code-subscription={run.subscription.state} className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{t("code.subscription.title")}</p>
                <p className="text-[12.5px] text-ink-secondary">
                  {t(`code.subscription.${run.subscription.state}` as "code.subscription.missing", { engine: run.subscription.engine === "codex" ? "ChatGPT (Codex)" : "Claude" })}
                </p>
              </div>
            </div>
          </div>
        )}
        {warnings.filter((w) => !dismissed.has(w.seq)).map((warning) => (
          <div key={warning.seq} role="status" data-code-warning className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{t("code.warning.title")}</p>
                <p className="text-[12.5px] text-ink-secondary">{warning.text}</p>
                {details === warning.seq && warning.details && <p className="mt-1 text-[12.5px] text-ink-secondary">{warning.details}</p>}
              </div>
              <button type="button" aria-label={t("code.warning.dismiss")} onClick={() => setDismissed((set) => new Set([...set, warning.seq]))} className="rounded p-0.5 text-ink-secondary hover:bg-hover"><X size={13} aria-hidden /></button>
            </div>
            {warning.details && details !== warning.seq && (
              <div className="mt-1.5 flex justify-end"><button type="button" onClick={() => setDetails(warning.seq)} className="ui-button ui-button-sm">{t("code.warning.details")}</button></div>
            )}
          </div>
        ))}
        {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
        <FollowUpComposer run={run} onSend={async (text, followMode) => { await act(() => followUpRun(run.id, text, followMode)); }} />
      </div>
    </div>
  );

  const changes = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <RunPillBadge pill={prPill} />
          <span className="min-w-0 truncate font-mono text-[12px] text-ink-secondary">{run.branch} → {run.base_branch}</span>
          <span className="flex-1" />
          {pr && <a href={pr.url} target="_blank" rel="noreferrer" className="ui-button ui-button-sm inline-flex shrink-0 items-center gap-1 whitespace-nowrap">{t("code.pr.view")}<ExternalLink size={11} aria-hidden /></a>}
        </div>
        <div className="flex items-center gap-2 text-[13px] text-ink">
          <span className="min-w-0 truncate font-medium">{run.title}</span>
          {commitCount > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-ink-secondary">{commitCount === 1 ? t("code.commits.count.one") : t("code.commits.count", { n: commitCount })}<ChevronDown size={12} aria-hidden /></span>}
        </div>
      </div>
      <div role="tablist" aria-label={t("code.changes.subtabs")} className="flex gap-1 border-b border-hairline px-3 py-1.5">
        {(["diff", "review", "commits"] as const).map((value) => (
          <button key={value} role="tab" type="button" aria-selected={sub === value} onClick={() => setSub(value)} className={cn("rounded-md px-2.5 py-1 text-[12.5px]", sub === value ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover")}>
            {t(`code.changes.${value}`)}{value === "commits" && commitCount > 0 ? ` ${commitCount}` : ""}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {sub === "diff" && (!diff
          ? <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-ink-tertiary motion-reduce:animate-none" aria-hidden /></div>
          : !diff.available ? <Placeholder icon={GitBranch} title={t("code.changes.diff")} body={t("code.files.later")} />
            : <DiffView files={diff.items} mode={mode} onModeChange={setMode} />)}
        {sub === "review" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="max-w-xs text-[13px] text-ink-secondary">{pr ? t("code.review.body") : t("code.review.noPr")}</p>
            {pr && <a href={`${pr.url}/files`} target="_blank" rel="noreferrer" className="ui-button ui-button-sm">{t("code.review.open")}</a>}
          </div>
        )}
        {sub === "commits" && <CommitsTab commits={commits} now={now} />}
      </div>
    </div>
  );

  const right = panel !== "closed" && (
    <aside
      aria-label={t("code.panel.aria")}
      className={cn("relative flex min-w-0 flex-col border-l border-hairline bg-panel", panel === "full" ? "flex-1" : "shrink-0")}
      style={panel === "full" ? undefined : { width }}
    >
      {panel === "open" && (
        <div role="separator" aria-orientation="vertical" aria-label={t("code.panel.resize")} onPointerDown={startResize} className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/20" />
      )}
      <div className="flex items-center gap-1 border-b border-hairline px-2 py-1.5">
        <div role="tablist" aria-label={t("code.panel.tabs")} className="flex min-w-0 flex-1 items-center gap-0.5">
          {(["changes", "desktop", "terminal", "files"] as const).map((value) => (
            <button key={value} role="tab" type="button" aria-selected={tab === value} onClick={() => setTab(value)} className={cn("rounded-md px-2.5 py-1 text-[12.5px]", tab === value ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover")}>
              {t(`code.tab.${value}`)}
            </button>
          ))}
          <button type="button" disabled title={t("code.tab.portSoon")} aria-label={t("code.tab.portSoon")} className="rounded-md p-1 text-ink-tertiary opacity-60"><Plus size={14} aria-hidden /></button>
        </div>
        <button type="button" aria-label={panel === "full" ? t("code.panel.exitFull") : t("code.panel.full")} title={panel === "full" ? t("code.panel.exitFull") : t("code.panel.full")} onClick={() => setPanel(panel === "full" ? "open" : "full")} className="rounded-md p-1.5 text-ink-secondary hover:bg-hover">
          {panel === "full" ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
        </button>
        <button type="button" aria-label={t("code.panel.close")} title={t("code.panel.close")} onClick={() => setPanel("closed")} className="rounded-md p-1.5 text-ink-secondary hover:bg-hover">
          <PanelRightClose size={14} aria-hidden />
        </button>
      </div>
      {tab === "changes" && changes}
      {tab === "desktop" && <Placeholder icon={Monitor} title={t("code.tab.desktop")} body={t("code.desktop.soon")} />}
      {tab === "terminal" && <Placeholder icon={SquareTerminal} title={t("code.tab.terminal")} body={t("code.terminal.soon")} />}
      {tab === "files" && <div className="min-h-0 flex-1 overflow-y-auto"><FilesTab files={files} /></div>}
    </aside>
  );

  return (
    <div data-code-run={run.id} className="flex h-full min-h-0 flex-col">
      <header className="window-no-drag flex items-center gap-2 border-b border-hairline px-3 py-2">
        <button type="button" onClick={onBack} aria-label={t("code.back")} title={t("code.back")} className="rounded-md p-1.5 text-ink-secondary hover:bg-hover"><ArrowLeft size={16} aria-hidden /></button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-[14px] font-medium text-ink">{run.title}</h1>
          <span className="shrink-0 truncate text-[12.5px] text-ink-tertiary">{run.repo}</span>
          <span className="shrink-0" title={pillLabel(pill)}><RunPillBadge pill={pill} small /></span>
        </div>
        {panel === "closed" && (
          <button type="button" aria-label={t("code.panel.open")} title={t("code.panel.open")} onClick={() => setPanel("open")} className="rounded-md p-1.5 text-ink-secondary hover:bg-hover"><PanelRightOpen size={16} aria-hidden /></button>
        )}
        <RunMenu run={run} consoleUrl={consoleUrl} onStop={() => void act(() => stopRun(run.id))} onArchive={() => void act(async () => { const archived = await archiveRun(run.id); onBack(); return archived; })} />
      </header>
      <div className="flex min-h-0 flex-1">
        {left}
        {right}
      </div>
    </div>
  );
}
