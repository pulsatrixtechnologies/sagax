// "Cloud agents (N)" under the bot message that launched them (spec 1.2 and
// 9.1): compact run rows, an Open button that opens the run in the Code
// section (a Perspicax run) or the provider's page (other providers), and a
// menu: Stop, Copy the PR link, Open the PR. The rows come from the bot's
// cloud agent records for this thread (GET /api/bots/:id/cloud-agents),
// refreshed by the `cloud.agent` stream frame and a poll while one works.
import { Cloud, Copy, ExternalLink, MoreHorizontal, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cloudAgentStatusActive, type CloudAgentRecord } from "../../../shared/cloud-agents.ts";
import { RunCard } from "./RunCard";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";

const POLL_ACTIVE_MS = 8_000;

/** The thread's cloud agent records, newest last. */
export function useThreadCloudAgents(botId: string, threadId: string): CloudAgentRecord[] {
  const [records, setRecords] = useState<CloudAgentRecord[]>([]);
  const refresh = useCallback(async () => {
    try {
      const answer = await api<{ items?: CloudAgentRecord[] }>(`/api/bots/${encodeURIComponent(botId)}/cloud-agents?thread=${encodeURIComponent(threadId)}`);
      setRecords((answer.items ?? []).filter((row) => row.threadId === threadId && !row.archived).sort((a, b) => a.createdAt - b.createdAt));
    } catch {
      // a refused or failed read leaves the last rows
    }
  }, [botId, threadId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onFrame = (event: Event) => {
      const detail = (event as CustomEvent<{ botId?: string; item?: { threadId?: string } }>).detail;
      if (detail?.botId === botId && (!detail.item?.threadId || detail.item.threadId === threadId)) void refresh();
    };
    window.addEventListener("sagax-cloud-agent", onFrame);
    return () => window.removeEventListener("sagax-cloud-agent", onFrame);
  }, [botId, threadId, refresh]);
  const active = records.some((row) => cloudAgentStatusActive(row.status) && row.status !== "idle");
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_ACTIVE_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);
  return records;
}

/** A provider's link, kept only when it is https (never javascript: or a
 * local file). */
export function httpsOnly(url: string | undefined): string | undefined {
  return typeof url === "string" && url.startsWith("https://") ? url : undefined;
}

/** Each record goes under the last transcript row at or before its launch
 * (a little slack: the tool's chip lands just after the record). Returns
 * row index -> records. Pure, for tests. */
export function cloudAgentAnchors(rowTimes: readonly number[], records: readonly CloudAgentRecord[], slackMs = 5_000): Map<number, CloudAgentRecord[]> {
  const out = new Map<number, CloudAgentRecord[]>();
  if (rowTimes.length === 0) return out;
  for (const record of records) {
    let index = -1;
    for (let i = 0; i < rowTimes.length; i++) if (rowTimes[i]! <= record.createdAt + slackMs) index = i;
    // launched before the loaded window: under the first row shown
    const at = Math.max(0, index);
    out.set(at, [...(out.get(at) ?? []), record]);
  }
  return out;
}

/** The Perspicax state a local status stands for (RunCard reads states). */
function cardState(record: CloudAgentRecord): string {
  switch (record.status) {
    case "creating": return "provisioning";
    case "cancelled": return "stopped";
    default: return record.status;
  }
}

function RowMenu({ record, botId }: { record: CloudAgentRecord; botId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", key); };
  }, [open]);
  const prUrl = httpsOnly(record.pr?.url ?? record.gitBranches.find((branch) => branch.prUrl)?.prUrl);
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-popover-ink hover:bg-popover-hover disabled:opacity-50";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={t("code.card.menu")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-md p-1 text-ink-secondary hover:bg-hover">
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-7 z-20 w-52 rounded-lg border border-popover-border bg-popover p-1 shadow-lg">
          <button
            type="button" role="menuitem" className={item}
            disabled={!cloudAgentStatusActive(record.status)}
            onClick={() => { setOpen(false); void api(`/api/bots/${encodeURIComponent(botId)}/cloud-agents/${encodeURIComponent(record.id)}/cancel`, { method: "POST" }).catch(() => {}); }}
          >
            <Square size={13} aria-hidden />{t("code.action.stop")}
          </button>
          <button type="button" role="menuitem" className={item} disabled={!prUrl} onClick={() => { setOpen(false); if (prUrl) void copyText(prUrl); }}>
            <Copy size={13} aria-hidden />{t("code.action.copyPr")}
          </button>
          <a role="menuitem" className={cn(item, !prUrl && "pointer-events-none opacity-50")} href={prUrl ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!prUrl} onClick={() => setOpen(false)}>
            <ExternalLink size={13} aria-hidden />{t("code.action.openPr")}
          </a>
        </div>
      )}
    </div>
  );
}

export function CloudAgentsCard({ records, botId, confidential = false }: { records: CloudAgentRecord[]; botId: string; confidential?: boolean }) {
  const { dispatch } = useStore();
  if (records.length === 0) return null;
  const open = (record: CloudAgentRecord) => {
    if (record.provider === "perspicax") dispatch({ type: "showCode", runId: record.externalId });
    else if (httpsOnly(record.url)) window.open(httpsOnly(record.url), "_blank", "noopener,noreferrer");
  };
  return (
    <section data-cloud-agents-card aria-label={t("code.card.title", { n: records.length })} className="my-2 flex w-full max-w-[560px] flex-col gap-1 rounded-xl border border-hairline bg-card px-2 py-2">
      <header className="flex items-center gap-1.5 px-2 pb-1 text-[12px] font-medium text-ink-secondary">
        <Cloud size={13} aria-hidden />
        {t("code.card.title", { n: records.length })}
      </header>
      {records.map((record) => (
        <div key={record.id} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <RunCard
              compact
              title={record.name}
              state={cardState(record)}
              pr={record.pr ? { number: record.pr.number, state: record.pr.state } : undefined}
              stats={record.stats}
              model={record.model}
              updatedAt={new Date(record.updatedAt)}
              unread={record.unread}
              onOpen={() => open(record)}
            />
          </div>
          <button type="button" onClick={() => open(record)} className="ui-button ui-button-sm shrink-0">{t("code.card.open")}</button>
          <RowMenu record={record} botId={botId} />
        </div>
      ))}
      {confidential && records.some((record) => record.provider === "perspicax") && (
        <p className="px-2 pt-1 text-[11px] text-ink-tertiary">{t("code.card.notConfidential")}</p>
      )}
    </section>
  );
}
