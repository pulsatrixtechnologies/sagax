// The bot panel's Coding section (JC, 2026-11-06): one CodingSessionRow per
// coding task or launched agent, in the panel card under a grey "Coding"
// label. State mark, title, grey subtitle (state and "#N" pull request
// link), chevron (2026-11-07). Past five
// rows, "↓ N more" shows the rest. A click opens the session in the chat
// column (the coding chat), never a side panel. An orchestrator's work rows
// (#3575) lead the same card, drawn by the same row.
import { useEffect, useState, type ReactNode } from "react";

import { activityStatusActive, activityTitle, codingWhere, type BotActivityItem, type BotLaunchedAgentItem } from "@/lib/bot-activity";
import { loadBranchPull } from "@/lib/code-branches";
import { pullOfItem, type CodingRowPull } from "@/lib/coding-row-state";
import { PANEL_CARD, SHOW_MORE_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { CodingSessionRow } from "./CodingSessionRow";

/** Rows shown before "↓ N more". */
export const AGENT_ROWS_SHOWN = 5;

export interface AgentRowsProps {
  /** This bot's coding tasks (sessions, parallel work, cloud agents). */
  items: readonly BotActivityItem[];
  /** Agents it launched through the agent API. */
  launched?: readonly BotLaunchedAgentItem[];
  onOpen: (item: BotActivityItem) => void;
  onOpenLaunched?: (item: BotLaunchedAgentItem) => void;
  onStop?: (item: BotActivityItem) => void;
  stopping?: ReadonlySet<string>;
  /** Rows before "↓ N more" (tests). */
  shown?: number;
  /** #2148: Ignore on a finished row (by its id): it leaves the list at
   * once and stays gone; the work itself is kept. */
  onIgnore?: (id: string) => void;
  /** Rows drawn first in the same card, never folded under "↓ N more" (an
   * orchestrator's work, #3575). */
  lead?: ReactNode;
}

const LIVE_MS = 60_000;
const livePulls = new Map<string, { at: number; pull: CodingRowPull | null }>();

/** The job's pull request as GitHub says it now (Draft, Changes requested,
 * Checks failing), read for a job whose own calls left it open. Without a
 * reading the row keeps what the calls said. */
function useLivePull(item: BotActivityItem, own: CodingRowPull | undefined): CodingRowPull | undefined {
  const branch = item.code?.pullRequests?.at(-1)?.branch ?? item.code?.branch;
  const wanted = own?.state === "open" && Boolean(branch) && Boolean(item.threadId);
  const key = wanted ? `${item.botId}:${item.threadId}:${branch}` : "";
  const [read, setRead] = useState<{ key: string; pull: CodingRowPull | null } | null>(() => {
    const hit = key ? livePulls.get(key) : undefined;
    return hit ? { key, pull: hit.pull } : null;
  });
  useEffect(() => {
    if (!key || !item.threadId || !branch) return;
    const hit = livePulls.get(key);
    if (hit && Date.now() - hit.at < LIVE_MS) return;
    let alive = true;
    loadBranchPull(item.botId, item.threadId, branch).then(
      (pull) => {
        const value = pull ? { number: pull.number, url: pull.url, state: pull.state, draft: pull.draft, review: pull.review, checks: pull.checks } : null;
        livePulls.set(key, { at: Date.now(), pull: value });
        if (alive) setRead({ key, pull: value });
      },
      () => undefined,
    );
    return () => { alive = false; };
  }, [key, item.botId, item.threadId, branch]);
  return read?.key === key && read.pull ? read.pull : own;
}

function ItemRow({ item, onOpen, onStop, stopping, onIgnore }: { item: BotActivityItem; onOpen: (item: BotActivityItem) => void; onStop?: (item: BotActivityItem) => void; stopping?: ReadonlySet<string>; onIgnore?: (id: string) => void }) {
  const live = activityStatusActive(item.status);
  const canStop = live && Boolean(onStop) && (item.canStop ?? true);
  const pull = useLivePull(item, pullOfItem(item));
  return (
    <CodingSessionRow
      title={activityTitle(item)}
      hint={codingWhere(item) || undefined}
      status={item.status}
      pull={pull}
      attrs={{ "data-activity-card": item.id, "data-activity-status": item.status }}
      onOpen={() => onOpen(item)}
      onStop={canStop ? () => onStop?.(item) : undefined}
      stopId={item.id}
      stopping={stopping?.has(item.id) ?? false}
      onIgnore={!live && onIgnore ? () => onIgnore(item.id) : undefined}
      ignoreId={item.id}
    />
  );
}

function LaunchedRow({ item, onOpen, onIgnore }: { item: BotLaunchedAgentItem; onOpen?: (item: BotLaunchedAgentItem) => void; onIgnore?: (id: string) => void }) {
  const live = item.status === "running" || item.status === "queued" || item.status === "waiting";
  const openable = Boolean(item.threadId) && Boolean(onOpen);
  return (
    <CodingSessionRow
      title={item.title}
      status={item.status}
      attrs={{ "data-launched-agent": item.id, "data-launched-status": item.status }}
      onOpen={openable ? () => onOpen!(item) : undefined}
      onIgnore={onIgnore && !live ? () => onIgnore(item.id) : undefined}
      ignoreId={item.id}
    />
  );
}

export function AgentRows({ items, launched = [], onOpen, onOpenLaunched, onStop, stopping, shown = AGENT_ROWS_SHOWN, onIgnore, lead }: AgentRowsProps) {
  const [all, setAll] = useState(false);
  const rows: Array<{ key: string; node: React.ReactNode }> = [
    ...launched.map((item) => ({ key: `launched:${item.id}`, node: <LaunchedRow key={`launched:${item.id}`} item={item} onOpen={onOpenLaunched} onIgnore={onIgnore} /> })),
    ...items.map((item) => ({ key: item.id, node: <ItemRow key={item.id} item={item} onOpen={onOpen} onStop={onStop} stopping={stopping} onIgnore={onIgnore} /> })),
  ];
  if (rows.length === 0 && !lead) return null;
  const hidden = all ? 0 : Math.max(0, rows.length - shown);
  const drawn = hidden > 0 ? rows.slice(0, shown) : rows;
  return (
    <div data-agent-rows className="flex flex-col gap-1">
      <ul aria-label={t("botPanel.coding.title")} className={PANEL_CARD} {...(launched.length > 0 ? { "data-launched-agents": "" } : {})}>
        {lead}
        {drawn.map((row) => row.node)}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          data-agent-rows-more
          onClick={() => setAll(true)}
          className={`${SHOW_MORE_ROW} rounded-md px-3`}
        >
          ↓ {t("botPanel.coding.more", { count: hidden })}
        </button>
      )}
    </div>
  );
}
