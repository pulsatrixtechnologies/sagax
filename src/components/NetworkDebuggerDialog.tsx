import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play } from "lucide-react";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { formatDebuggerBytes as formatBytes } from "../../shared/format-bytes";
import { DetailPanel } from "./DetailPanel";
import { PILL } from "./SettingsPrimitives";

export { formatBytes };

/** One request as the server sends it: already redacted (no body, no
 * credential), headers only when asked for. See server/browser/browser-network-debug.ts. */
export interface NetworkRow {
  id: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  resourceType: string;
  mimeType: string;
  startedDateTime: string;
  time: number | null;
  timings: Record<string, number> | null;
  requestBodySize: number | null;
  responseBodySize: number | null;
  httpVersion: string;
  requestHeaders: Array<{ name: string; value: string }>;
  responseHeaders: Array<{ name: string; value: string }>;
}

export type StatusFilter = "all" | "ok" | "redirect" | "error" | "failed";
const REFRESH_MS = 3_000;
const button = "rounded-md p-1.5 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed";

/** The request types the filter offers, from what was captured. */
export function networkTypes(rows: readonly NetworkRow[]): string[] {
  return [...new Set(rows.map((row) => row.resourceType).filter(Boolean))].sort();
}

export function matchesStatus(status: number, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "failed") return status === 0;
  if (filter === "ok") return status >= 200 && status < 300;
  if (filter === "redirect") return status >= 300 && status < 400;
  return status >= 400;
}

/** Rows matching the text (URL or method), the type and the status. */
export function filterNetworkRows(rows: readonly NetworkRow[], query: string, type: string, status: StatusFilter): NetworkRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => (!needle || row.url.toLowerCase().includes(needle) || row.method.toLowerCase() === needle)
    && (!type || row.resourceType === type) && matchesStatus(row.status, status));
}

export function formatMs(value: number | null): string {
  if (value === null) return "";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function shortUrl(url: string): string {
  try { const parsed = new URL(url); return `${parsed.host}${parsed.pathname}${parsed.search}`; } catch { return url; }
}

/** The person's network debugger of the bot's browser. It starts a capture
 * when it opens, refreshes it every few seconds and stops it (the server
 * forgets every record) when it closes. Nothing here reaches the bot.
 * 2026-11-01 lot 7: DetailPanel beside the thread (list and detail). */
export function NetworkDebuggerDialog({ botId, botName, onClose }: { botId: string; botName: string; onClose: () => void }) {
  const [rows, setRows] = useState<NetworkRow[]>([]);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const headersNow = useRef(showHeaders);
  headersNow.current = showHeaders;
  const path = `/api/bots/${encodeURIComponent(botId)}/browser/network`;
  const post = useCallback((body: Record<string, unknown>) => api(path, { method: "POST", body: JSON.stringify(body), timeoutMs: 30_000 }), [path]);

  useEffect(() => {
    let active = true;
    setError("");
    post({ action: "start" }).then((answer) => { if (active) { setRows(answer.entries ?? []); setStarted(true); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      active = false;
      void post({ action: "stop" }).catch(() => {});
    };
  }, [post]);

  const refresh = useCallback(async () => {
    try {
      const answer = await post({ action: "refresh", includeHeaders: headersNow.current });
      setRows(answer.entries ?? []); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [post]);
  useEffect(() => {
    if (!started || paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    timer = setTimeout(() => void tick(), REFRESH_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [started, paused, refresh]);
  useEffect(() => { if (started) void refresh(); }, [showHeaders, started, refresh]);

  const exportHar = async () => {
    try {
      const answer = await post({ action: "export", includeHeaders: headersNow.current });
      const url = URL.createObjectURL(new Blob([JSON.stringify(answer.har, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `network-${new Date().toISOString().replace(/[:.]/g, "-")}.har`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const types = useMemo(() => networkTypes(rows), [rows]);
  const visible = useMemo(() => filterNetworkRows(rows, query, type, status), [rows, query, type, status]);
  const detail = rows.find((row) => row.id === selected) ?? null;

  return (
    <DetailPanel
      label={t("browser.network.title")}
      title={t("browser.network.title")}
      closeLabel={t("browser.network.close")}
      onClose={onClose}
      data-network-debugger=""
      actions={
        <>
          <button type="button" className={button} onClick={() => setPaused((value) => !value)} aria-label={paused ? t("browser.network.resume") : t("browser.network.pause")} title={paused ? t("browser.network.resume") : t("browser.network.pause")}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
          <button type="button" className={`${PILL} gap-1.5`} disabled={!started || rows.length === 0} onClick={() => void exportHar()}><Download size={14} aria-hidden="true" />{t("browser.network.export")}</button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="border-b border-hairline/40 px-4 py-2 text-[12px] text-ink-secondary">{t("browser.network.subtitle", { name: botName })}</p>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline/40 px-4 py-2 text-[12px]">
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("browser.network.filter")} placeholder={t("browser.network.filter")} spellCheck={false}
            className="min-w-40 flex-1 rounded-lg bg-inset px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-accent" />
          <select value={type} onChange={(event) => setType(event.target.value)} aria-label={t("browser.network.type")} className="rounded-lg bg-inset px-2 py-1.5">
            <option value="">{t("browser.network.allTypes")}</option>
            {types.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label={t("browser.network.status")} className="rounded-lg bg-inset px-2 py-1.5">
            <option value="all">{t("browser.network.statusAll")}</option>
            <option value="ok">2xx</option>
            <option value="redirect">3xx</option>
            <option value="error">4xx, 5xx</option>
            <option value="failed">{t("browser.network.statusFailed")}</option>
          </select>
          <label className="flex items-center gap-1.5 text-ink-secondary">
            <input type="checkbox" checked={showHeaders} onChange={(event) => setShowHeaders(event.target.checked)} />{t("browser.network.showHeaders")}
          </label>
        </div>
        <p className="border-b border-hairline/40 px-4 py-1.5 text-[11px] text-ink-secondary">{t("browser.network.privacy")}</p>
        {error && <div role="alert" className="border-b border-hairline/30 px-4 py-2 text-[12px] text-danger">{error}</div>}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full table-fixed text-left text-[12px]">
              <thead className="sticky top-0 bg-app text-ink-secondary">
                <tr>
                  <th className="w-16 px-3 py-1.5 font-medium">{t("browser.network.method")}</th>
                  <th className="px-3 py-1.5 font-medium">{t("browser.network.url")}</th>
                  <th className="w-14 px-3 py-1.5 font-medium">{t("browser.network.status")}</th>
                  <th className="w-16 px-3 py-1.5 text-right font-medium">{t("browser.network.time")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => <tr key={row.id} onClick={() => setSelected(row.id === selected ? null : row.id)} aria-selected={row.id === selected}
                  className={cn("cursor-pointer border-t border-hairline/20 hover:bg-inset", row.id === selected && "bg-inset")}>
                  <td className="px-3 py-1 font-mono">{row.method}</td>
                  <td className="truncate px-3 py-1" title={row.url}>{shortUrl(row.url)}</td>
                  <td className={cn("px-3 py-1", row.status === 0 || row.status >= 400 ? "text-danger" : "")}>{row.status || "-"}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatMs(row.time)}</td>
                </tr>)}
              </tbody>
            </table>
            {visible.length === 0 && <p className="p-6 text-center text-[13px] text-ink-secondary">{started ? t("browser.network.empty") : t("browser.network.starting")}</p>}
          </div>
          {detail && <aside className="max-h-[40%] shrink-0 overflow-auto border-t border-hairline/40 p-3 text-[12px]">
            <div className="mb-2 break-all font-mono">{detail.method} {detail.url}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-secondary">
              <dt>{t("browser.network.status")}</dt><dd className="text-ink">{detail.status || "-"} {detail.statusText}</dd>
              <dt>{t("browser.network.type")}</dt><dd className="text-ink">{detail.mimeType || detail.resourceType}</dd>
              <dt>{t("browser.network.time")}</dt><dd className="text-ink">{formatMs(detail.time)}</dd>
              <dt>{t("browser.network.size")}</dt><dd className="text-ink">{formatBytes(detail.responseBodySize)}</dd>
            </dl>
            {detail.timings && <div className="mt-2 text-ink-secondary">{Object.entries(detail.timings).map(([name, value]) => `${name} ${formatMs(value)}`).join(", ")}</div>}
            {showHeaders ? (["requestHeaders", "responseHeaders"] as const).map((key) => <section key={key} className="mt-3">
              <h3 className="mb-1 font-medium">{t(key === "requestHeaders" ? "browser.network.requestHeaders" : "browser.network.responseHeaders")}</h3>
              {detail[key].length ? <ul className="flex flex-col gap-0.5 font-mono">{detail[key].map((header, index) => <li key={index} className="break-all"><span className="text-ink-secondary">{header.name}:</span> {header.value}</li>)}</ul>
                : <p className="text-ink-secondary">{t("browser.network.noHeaders")}</p>}
            </section>) : <p className="mt-3 text-ink-secondary">{t("browser.network.headersHidden")}</p>}
          </aside>}
        </div>
      </div>
    </DetailPanel>
  );
}
