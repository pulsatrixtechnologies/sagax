// The bot panel's Coding section as Claude Code's agent list (JC, 2026-11-05,
// #2099): one row per coding task or launched agent.
//
//   ○ @Marc · Fix the column order                 20m 58s · ↓ 101.8k tokens  ■
//     Running src/board tests · parser · main
//   ● general-purpose · Review the PR                        4m 12s · ↓ 12.4k tokens
//
// `○` while it runs (accent), `●` once done (green) or failed (red); the tag
// (the bot the work belongs to), the title; at the right the elapsed time
// and, when the task's usage is known, its tokens; Stop on the row while it
// runs. Past five rows, "↓ N more" shows the rest. A click opens the task in
// the chat column (the coding chat): never a side panel.
import { useState } from "react";
import { Loader2, Square, X } from "lucide-react";

import type { TaskUsage } from "@/state/store";
import { activityStatusActive, activityStatusLabel, activityTitle, codingWhere, formatActivityDuration, type BotActivityItem, type BotLaunchedAgentItem } from "@/lib/bot-activity";
import { humanStep } from "@/lib/coding-chat";
import { formatTokens, headlineTokens } from "@/lib/usage";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { PANEL_CARD, PANEL_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";

/** Rows shown before "↓ N more". */
export const AGENT_ROWS_SHOWN = 5;

type RowStatus = BotActivityItem["status"] | BotLaunchedAgentItem["status"];

export interface AgentRowsProps {
  /** This bot's coding tasks (sessions, parallel work, cloud agents). */
  items: readonly BotActivityItem[];
  /** Agents it launched through the agent API. */
  launched?: readonly BotLaunchedAgentItem[];
  onOpen: (item: BotActivityItem) => void;
  onOpenLaunched?: (item: BotLaunchedAgentItem) => void;
  onStop?: (item: BotActivityItem) => void;
  stopping?: ReadonlySet<string>;
  now?: number;
  /** The task's usage, by thread, for "↓ 101.8k tokens"; absent when unknown. */
  usageOf?: (threadId: string) => TaskUsage | undefined;
  /** Rows before "↓ N more" (tests). */
  shown?: number;
  /** #2148: Ignore on a finished row (by its id): it leaves the list at
   * once and stays gone; the work itself is kept. */
  onIgnore?: (id: string) => void;
}

/** Ignore on a finished row: no confirmation, it only hides the row. */
function IgnoreButton({ id, title, onIgnore }: { id: string; title: string; onIgnore: (id: string) => void }) {
  return (
    <button
      type="button"
      data-agent-ignore={id}
      onClick={() => onIgnore(id)}
      aria-label={t("botPanel.coding.ignoreAria", { title })}
      title={t("botPanel.coding.ignore")}
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
    >
      <X size={12} aria-hidden="true" />
    </button>
  );
}

function glyphFor(status: RowStatus): { glyph: string; className: string } {
  if (status === "running") return { glyph: "○", className: "text-accent-text animate-pulse motion-reduce:animate-none" };
  if (status === "waiting" || status === "blocked") return { glyph: "○", className: "text-accent-text" };
  if (status === "queued") return { glyph: "○", className: "text-ink-tertiary" };
  if (status === "failed") return { glyph: "●", className: "text-danger" };
  if (status === "stopped") return { glyph: "●", className: "text-ink-tertiary" };
  return { glyph: "●", className: "text-success" };
}

function Right({ elapsed, tokens }: { elapsed?: string; tokens?: number }) {
  return (
    <span data-agent-right className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">
      {elapsed}
      {tokens !== undefined && tokens > 0 && (
        <>
          {elapsed && <span aria-hidden="true"> · </span>}
          <span data-agent-tokens>{t("botPanel.coding.tokens", { tokens: formatTokens(tokens) })}</span>
        </>
      )}
    </span>
  );
}

function Shell({ status, tag, title, line, right, onOpen, openAria, stop, children, attrs }: {
  status: RowStatus;
  tag?: string;
  title: string;
  /** the second line: what it does now, or how it ended */
  line?: React.ReactNode;
  right: React.ReactNode;
  onOpen?: () => void;
  openAria: string;
  stop?: React.ReactNode;
  children?: React.ReactNode;
  attrs: Record<string, string | undefined>;
}) {
  const { glyph, className } = glyphFor(status);
  return (
    // 2026-11-06 (JC): the same card, row and UI font as Upcoming beside it (PANEL_CARD / PANEL_ROW), never mono.
    <li {...attrs} data-agent-row data-agent-status={status} className={cn("group flex items-center gap-2.5 hover:bg-hover", PANEL_ROW)}>
      <span aria-hidden="true" className={cn("flex size-4 shrink-0 select-none items-center justify-center text-[10px]", className)}>{glyph}</span>
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={openAria}
        className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] leading-[18px]" title={title}>
            {tag && <span data-agent-tag className="font-semibold text-ink">{tag}</span>}
            {tag && <span aria-hidden="true" className="text-ink-tertiary"> · </span>}
            <span className="text-ink">{title}</span>
          </span>
          {right}
        </span>
        {line && <span data-agent-line className="block truncate text-[12px] leading-4 text-ink-secondary">{line}</span>}
        {children}
      </button>
      {stop}
    </li>
  );
}

function ItemRow({ item, now, onOpen, onStop, stopping, usageOf, onIgnore }: { item: BotActivityItem; now: number; onOpen: (item: BotActivityItem) => void; onStop?: (item: BotActivityItem) => void; stopping?: ReadonlySet<string>; usageOf?: (threadId: string) => TaskUsage | undefined; onIgnore?: (id: string) => void }) {
  const live = activityStatusActive(item.status);
  const usage = item.threadId ? usageOf?.(item.threadId) : undefined;
  // A finished row shows how long it ran (end minus start); with no end
  // known, no number at all (never "now minus start": 228h on an old thread).
  const elapsed = live ? formatActivityDuration(now - item.startedAt) : item.endedAt !== undefined ? formatActivityDuration(item.endedAt - item.startedAt) : undefined;
  const step = live ? humanStep(item.currentStep) ?? activityStatusLabel(item.status) : activityStatusLabel(item.status);
  // where it works (repository · branch) stays on the second line, after the step
  const where = codingWhere(item);
  const line = where ? <>{step}<span aria-hidden="true" className="text-ink-tertiary"> · </span><span data-activity-where className="text-ink-tertiary">{where}</span></> : step;
  const canStop = live && Boolean(onStop) && (item.canStop ?? true);
  const busy = stopping?.has(item.id) ?? false;
  return (
    <Shell
      status={item.status}
      tag={item.botName ? `@${item.botName}` : undefined}
      title={activityTitle(item)}
      line={line}
      right={<Right elapsed={elapsed} tokens={usage ? headlineTokens(usage) : undefined} />}
      onOpen={() => onOpen(item)}
      openAria={t("botPanel.coding.openAria", { title: activityTitle(item) })}
      attrs={{ "data-activity-card": item.id, "data-activity-status": item.status }}
      stop={!live && onIgnore ? <IgnoreButton id={item.id} title={activityTitle(item)} onIgnore={onIgnore} /> : canStop && (
        <button
          type="button"
          data-activity-stop={item.id}
          onClick={() => onStop?.(item)}
          disabled={busy}
          aria-label={t("botPanel.activity.stopAria", { title: activityTitle(item) })}
          title={t("botPanel.activity.stop")}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square size={10} fill="currentColor" aria-hidden="true" />}
        </button>
      )}
    />
  );
}

function LaunchedRow({ item, now, onOpen, usageOf, onIgnore }: { item: BotLaunchedAgentItem; now: number; onOpen?: (item: BotLaunchedAgentItem) => void; usageOf?: (threadId: string) => TaskUsage | undefined; onIgnore?: (id: string) => void }) {
  const usage = item.threadId ? usageOf?.(item.threadId) : undefined;
  const ended = item.status === "running" || item.status === "queued" || item.status === "waiting" ? now : item.updatedAt;
  const elapsed = formatActivityDuration(Math.max(0, ended - item.startedAt));
  const pr = item.status === "failed" ? item.pullRequest : undefined;
  const line = pr
    ? (
      <>
        {t("botPanel.coding.runFailedPrefix")}
        {" · "}
        {pr.url
          ? <a href={pr.url} data-launched-pr className="underline decoration-ink-secondary/60 underline-offset-2 hover:text-ink" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openExternalLink(pr.url!); }}>#{pr.number}</a>
          : <span data-launched-pr>#{pr.number}</span>}
      </>
    )
    : t(`botPanel.coding.status.${item.status}` as "botPanel.coding.status.running");
  const openable = Boolean(item.threadId) && Boolean(onOpen);
  return (
    <Shell
      status={item.status}
      tag={item.targetBotName ? `@${item.targetBotName}` : undefined}
      title={item.title}
      line={line}
      right={<Right elapsed={elapsed} tokens={usage ? headlineTokens(usage) : undefined} />}
      onOpen={openable ? () => onOpen!(item) : undefined}
      openAria={t("botPanel.coding.openAria", { title: item.title })}
      attrs={{ "data-launched-agent": item.id, "data-launched-status": item.status }}
      stop={onIgnore && item.status !== "running" && item.status !== "queued" && item.status !== "waiting" ? <IgnoreButton id={item.id} title={item.title} onIgnore={onIgnore} /> : undefined}
    />
  );
}

export function AgentRows({ items, launched = [], onOpen, onOpenLaunched, onStop, stopping, now = Date.now(), usageOf, shown = AGENT_ROWS_SHOWN, onIgnore }: AgentRowsProps) {
  const [all, setAll] = useState(false);
  const rows: Array<{ key: string; node: React.ReactNode }> = [
    ...launched.map((item) => ({ key: `launched:${item.id}`, node: <LaunchedRow key={`launched:${item.id}`} item={item} now={now} onOpen={onOpenLaunched} usageOf={usageOf} onIgnore={onIgnore} /> })),
    ...items.map((item) => ({ key: item.id, node: <ItemRow key={item.id} item={item} now={now} onOpen={onOpen} onStop={onStop} stopping={stopping} usageOf={usageOf} onIgnore={onIgnore} /> })),
  ];
  if (rows.length === 0) return null;
  const hidden = all ? 0 : Math.max(0, rows.length - shown);
  const drawn = hidden > 0 ? rows.slice(0, shown) : rows;
  return (
    <div data-agent-rows className="flex flex-col gap-1">
      <ul aria-label={t("botPanel.coding.title")} className={PANEL_CARD} {...(launched.length > 0 ? { "data-launched-agents": "" } : {})}>
        {drawn.map((row) => row.node)}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          data-agent-rows-more
          onClick={() => setAll(true)}
          className="w-full rounded-md px-3 py-2 text-center text-[13px] leading-[18px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        >
          ↓ {t("botPanel.coding.more", { count: hidden })}
        </button>
      )}
    </div>
  );
}
