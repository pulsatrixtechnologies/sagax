// The history, from the Coding or Activity section title: the bot's last 7
// days as this person may read them, coding jobs or everything else
// (`?filter=coding|other`, server/routes/bot-activity.ts; Activity adds the
// sub-agents), newest first, narrowed by status (running, finished, failed)
// and by words.
//
// 2026-11-01 lot 3: a pushed page in the bot panel (PanelPage), not a
// Settings-sized window. Wide, master and detail side by side; narrow, the
// list fills the page and an entry replaces it, with Back.
import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityStatusActive, historyItems, loadBotActivity, type BotActivityFilter, type BotActivityItem, type HistoryStatus } from "@/lib/bot-activity";
import { ActivityList } from "./ActivityList";
import { ActivityDetailPane, WIDE_PX } from "./ActivityDetailModal";
import { activityChip, useElementWidth } from "./ActivityWindow";
import { PanelPage } from "./PanelPage";

const POLL_MS = 4_000;
const FILTERS: BotActivityFilter[] = ["coding", "other"];
const STATUSES: HistoryStatus[] = ["all", "running", "finished", "failed"];
const STATUS_KEYS = {
  all: "botPanel.history.status.all",
  running: "botPanel.history.status.running",
  finished: "botPanel.history.status.finished",
  failed: "botPanel.history.status.failed",
} as const;

export function ActivityListModal({ botId, filter, onFilter, onClose, onChanged, onStop, stopping }: {
  botId: string;
  filter: BotActivityFilter;
  onFilter: (filter: BotActivityFilter) => void;
  onClose: () => void;
  /** An entry was stopped from its detail: the panel refreshes too. */
  onChanged?: () => void;
  onStop: (item: BotActivityItem) => void;
  stopping: ReadonlySet<string>;
}) {
  const { dispatch } = useStore();
  const [frameRef, width] = useElementWidth<HTMLDivElement>(380);
  const split = width >= WIDE_PX;
  const [chosen, setChosen] = useState<BotActivityItem | null>(null);
  const [items, setItems] = useState<BotActivityItem[] | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<HistoryStatus>("all");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };

  const load = useCallback(() => {
    const id = ++request.current;
    return loadBotActivity(api, botId, { filter, limit: 50 })
      .then((next) => {
        if (id !== request.current) return;
        setItems([...next.items, ...next.subagents]);
        setNow(Date.now());
        setError(false);
      })
      .catch(() => { if (id === request.current) setError(true); });
  }, [botId, filter]);

  useEffect(() => { setItems(null); void load(); }, [load]);
  const running = items?.some((item) => activityStatusActive(item.status)) ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { window.clearInterval(timer); window.clearInterval(tick); };
  }, [running, load]);

  const shown = items && historyItems(items, status, search);
  // Wide, the newest entry is on screen from the start (never a blank half).
  useEffect(() => {
    if (chosen || !shown || shown.length === 0) return;
    const frame = frameRef.current;
    if ((frame ? frame.getBoundingClientRect().width : width) >= WIDE_PX) setChosen(shown[0]);
  }, [chosen, shown, width, frameRef]);
  const current = chosen ? items?.find((item) => item.id === chosen.id) ?? chosen : null;

  const list = (
    <div data-activity-history-list className={cn("flex min-h-0 flex-col", split ? "w-[min(340px,40%)] shrink-0 border-r border-hairline-weak bg-panel" : "min-w-0 flex-1")}>
      <div className="px-4 pb-2 pt-3">
        <p className="text-[12px] text-ink-secondary">{t("botPanel.list.window")}</p>
        <div role="tablist" className="mt-3 flex gap-1">
          {FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              data-activity-filter={id}
              onClick={() => { setChosen(null); onFilter(id); }}
              className={activityChip(filter === id)}
            >
              {t(id === "coding" ? "botPanel.list.filter.coding" : "botPanel.list.filter.other")}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("botPanel.history.statusAria")} className="mt-2 flex flex-wrap gap-1">
          {STATUSES.map((id) => (
            <button key={id} type="button" aria-pressed={status === id} data-history-status={id} onClick={() => setStatus(id)} className={activityChip(status === id)}>
              {t(STATUS_KEYS[id])}
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-1.5 rounded-lg border-[0.5px] border-border bg-inset px-2.5 py-1.5 focus-within:border-focus">
          <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <input
            type="search"
            data-history-search
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("botPanel.history.search")}
            aria-label={t("botPanel.history.search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-secondary"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2">
        <ActivityList items={shown} error={error} onOpen={setChosen} onStop={onStop} stopping={stopping} now={now} emptyKey="botPanel.list.empty" currentId={split ? current?.id : undefined} />
      </div>
    </div>
  );

  const detail = current ? (
    <div data-activity-history-detail={current.id} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ActivityDetailPane
        key={current.id}
        item={current}
        wide={split && width - 340 >= WIDE_PX}
        onClose={onClose}
        onChanged={() => { void load(); onChanged?.(); }}
      />
    </div>
  ) : (
    <div data-activity-history-empty className="flex min-w-0 flex-1 items-center justify-center px-8 text-center text-[13px] leading-[18px] text-ink-secondary">
      {t("activity.history.pick")}
    </div>
  );

  const back = !split && current ? () => setChosen(null) : onClose;
  const title = !split && current ? (current.title || t("botPanel.history.title")) : t("botPanel.history.title");

  return (
    <PanelPage
      name={title}
      onBack={back}
      onClose={closePanel}
      data-activity-list={filter}
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
    >
      <div ref={frameRef} className="flex min-h-0 flex-1">
        {split ? <>{list}{detail}</> : current ? detail : list}
      </div>
    </PanelPage>
  );
}
