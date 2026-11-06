// The raw event inspector: what a thread's turns actually looked like on
// the wire, for the moment a bot misbehaves and the chat view can't say
// why. Three lenses over the same thread:
//
//   Run log — readable, redacted activity from the visible conversation.
//   Events — the harness's normalized RuntimeEvent stream: turns, tool
//            items, requests, token usage, errors. Follows the app's live
//            stream.
//   Raw    — the provider's own protocol messages, verbatim (the native
//            tee). Read from disk; refreshed when a turn settles.
//
// Nothing here is captured for the panel's sake — both logs already exist
// under ~/.sagax (server/harness/bus.ts, server/drivers/native.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bug, ChevronDown, ChevronRight, PanelRight, RefreshCw } from "lucide-react";
import { api, useStore, visibleMessages, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useCaptionChrome, useMacInsetChrome } from "@/components/DesktopCapabilities";
import { formatTime, toRows, type InspectorEntry, type InspectorPage, type InspectorRow } from "@/lib/inspector";
import { listenLiveFrames } from "@/lib/live-events";
import type { RuntimeEvent } from "../../shared/runtime-events";
import { RunLog } from "./RunLog";
import { timelineEvents } from "@/lib/taskTimeline";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";

type Lens = "run" | "events" | "raw";

export function InspectorPanel({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  // Docked flush under the Windows caption corner: drop the header 16px.
  const { padClass, dragProps } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const threadId = bot.threadId;
  const [lens, setLens] = useState<Lens>("run");
  const activity = useMemo(() => timelineEvents(visibleMessages(bot), bot), [bot]);
  const [page, setPage] = useState<InspectorPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const loadAbort = useRef<AbortController | null>(null);
  const managedRefresh = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    try {
      const next = await api<InspectorPage>(`/api/threads/${threadId}/events?limit=400`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPage(next);
      setError(null);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(readableError(e));
    } finally {
      if (loadAbort.current === controller) loadAbort.current = null;
    }
  }, [threadId]);

  // history from disk on open / thread change
  useEffect(() => {
    setPage(null);
    setExpanded(new Set());
    stickToBottom.current = true;
    void load();
    return () => loadAbort.current?.abort();
  }, [load]);

  // live: append this thread's runtime events as the app's stream carries
  // them, and re-read the disk when a turn settles so the native tee (not on
  // the stream) catches up.
  useEffect(() => {
    let alive = true;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let refreshGeneration = 0;
    let refreshing = false;
    const pendingRuntime: RuntimeEvent[] = [];

    const appendRuntime = (runtime: RuntimeEvent) => {
      setPage((prev) => {
        // A disk refresh and replay can overlap. eventId is canonical, so a
        // replayed entry already present in the snapshot is an exact no-op.
        if (
          prev?.entries.some(
            (entry) => entry.kind === "runtime" && entry.data.eventId === runtime.eventId,
          )
        ) {
          return prev;
        }
        const entry: InspectorEntry = { kind: "runtime", at: runtime.createdAt, data: runtime };
        if (!prev) return { entries: [entry], total: { runtime: 1, native: 0 } };
        return { entries: [...prev.entries, entry], total: { ...prev.total, runtime: prev.total.runtime + 1 } };
      });
    };

    const flushPendingRuntime = () => {
      for (const runtime of pendingRuntime.splice(0)) appendRuntime(runtime);
    };

    const refresh = async () => {
      const generation = ++refreshGeneration;
      refreshing = true;
      await load();
      // A later refresh aborts the earlier fetch. Only its completion owns
      // the buffered live tail, otherwise the earlier finally can flush
      // frames immediately before the newer snapshot overwrites them.
      if (!alive || generation !== refreshGeneration) return;
      refreshing = false;
      // A failed reload keeps the previous page, so frames buffered during
      // it still belong there; after a good one, eventId drops repeats.
      flushPendingRuntime();
    };
    const requestRefresh = () => void refresh();
    managedRefresh.current = requestRefresh;

    // A gap the stream could not replay is on disk: reload it.
    const stopLive = listenLiveFrames({
      onMissedFrames: requestRefresh,
      onFrame: (frame) => {
        if (frame.kind !== "runtime") return;
        const runtime = frame.event;
        if (runtime.threadId !== threadId) return;
        if (refreshing) pendingRuntime.push(runtime);
        else appendRuntime(runtime);
        if (runtime.type === "turn.completed" || runtime.type === "runtime.error") {
          if (settle) clearTimeout(settle);
          settle = setTimeout(requestRefresh, 400);
        }
      },
    });
    return () => {
      alive = false;
      if (managedRefresh.current === requestRefresh) managedRefresh.current = () => {};
      stopLive();
      if (settle) clearTimeout(settle);
    };
  }, [threadId, load]);

  const entries = useMemo(
    () => (page ? page.entries.filter((e) => (lens === "raw" ? e.kind === "native" : e.kind === "runtime")) : []),
    [page, lens],
  );
  const rows = useMemo(() => toRows(entries), [entries]);

  // follow the tail unless the user has scrolled up to read
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [page?.entries.length, rows.length, lens]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const shown = entries.length;
  const total = lens === "raw" ? (page?.total.native ?? 0) : (page?.total.runtime ?? 0);

  return (
    <aside aria-label={t("chat.inspector")} className="app-docked-panel animate-panel-in absolute inset-0 z-40 flex h-full min-w-0 flex-col border-l-[0.5px] border-hairline-weak bg-app lg:static lg:z-auto lg:w-[min(460px,45vw)] lg:shrink-0">
      {(macInset || browser) && <div className="content-topbar-strip" />}
      <div {...dragProps} className={cn("content-topbar flex items-center justify-between px-4 py-3", padClass)}>
        <span className="flex items-center gap-2 text-[13px] font-medium leading-[18px] text-ink">
          <Bug size={16} className="text-ink-secondary" /> Inspector
        </span>
        <button
          onClick={() => dispatch({ type: "toggleInspector", open: false })}
          aria-label={t("inspector.close")}
          title={t("inspector.close")}
          className={CIRCLE_BUTTON}
        >
          <PanelRight size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className="content-card-body flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b-[0.5px] border-hairline-weak px-4 pb-2.5">
        <div role="tablist" aria-label={t("inspector.views")} className="flex gap-1" onKeyDown={(event) => {
          const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowRight" ? (current + 1) % tabs.length
            : event.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length
              : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault();
          tabs[next].focus();
          tabs[next].click();
        }}>
          {(["run", "events", "raw"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              id={`inspector-tab-${l}`}
              aria-selected={lens === l}
              aria-controls={`inspector-panel-${l}`}
              tabIndex={lens === l ? 0 : -1}
              onClick={() => setLens(l)}
              // Settings' borderless pills (2026-10-16): the chosen one filled.
              className={cn(
                "inline-flex h-7 min-h-[44px] items-center rounded-full px-2.5 text-[13px] leading-[18px] capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none md:min-h-0",
                lens === l ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink",
              )}
            >
              {l === "run" ? t("inspector.run.title") : l}
            </button>
          ))}
        </div>
        {lens !== "run" && <span className="ml-auto text-[11px] text-ink-secondary">
          {page ? (shown < total ? `last ${shown} of ${total}` : `${shown} entries`) : "loading…"}
        </span>}
        {lens !== "run" && <button type="button" onClick={() => managedRefresh.current()} className="ui-icon-button" title={t("inspector.reload")} aria-label={t("inspector.reload")}>
          <RefreshCw size={14} />
        </button>}
      </div>

      <div role="tabpanel" id={`inspector-panel-${lens}`} aria-labelledby={`inspector-tab-${lens}`} tabIndex={0} className="flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60">
      {lens === "run" ? <RunLog key={threadId} events={activity} /> : <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px]">
        {error && <div className="px-4 py-3 text-danger">{t("inspector.loadError", { error })}</div>}
        {page && rows.length === 0 && !error && (
          <div className="px-4 py-6 text-ink-secondary">
            {lens === "raw" ? "No native protocol messages recorded for this thread yet." : "No runtime events for this thread yet."}
          </div>
        )}
        {rows.map((row) => (
          <Row key={row.key} row={row} open={expanded.has(row.key)} onToggle={() => toggle(row.key)} />
        ))}
      </div>}
      </div>
      </div>
    </aside>
  );
}

function Row({ row, open, onToggle }: { row: InspectorRow; open: boolean; onToggle: () => void }) {
  return (
    <div
      className={cn(
        "border-b border-hairline/20",
        row.tone === "boundary" && "bg-raised/40",
        row.tone === "error" && "bg-danger/10",
      )}
    >
      <button onClick={onToggle} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-raised/60">
        <span className="mt-[1px] shrink-0 text-ink-secondary">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <span className="shrink-0 tabular-nums text-ink-secondary">{formatTime(row.at)}</span>
        <span
          className={cn(
            "shrink-0 rounded px-1 text-[10.5px]",
            row.kind === "native" ? "bg-accent/15 text-accent" : row.tone === "error" ? "bg-danger/20 text-danger" : "bg-inset text-ink-secondary",
          )}
        >
          {row.tag}
          {row.count > 1 ? ` ×${row.count}` : ""}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", row.tone === "error" ? "text-danger" : "text-ink")}>{row.summary}</span>
      </button>
      {open && (
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all border-t border-hairline/20 bg-app px-3 py-2 text-[11px] leading-relaxed text-ink">
          {JSON.stringify(row.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
