// The sub-agents of a task, compact (2026-10-29): the bot's mascot, the
// sub-agent's title, its state and the step it is on, its time. One that
// waits on the person comes first and says so; a click opens its own
// detail. Pure: the list takes the entries and a way to find each bot.
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityStatusActive, activityStatusLabel, formatActivityDuration, type BotActivityItem } from "@/lib/bot-activity";
import { BotAvatar, type BotAvatarProps } from "../Avatar";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";

const RANK: Record<BotActivityItem["status"], number> = { waiting: 0, running: 1, queued: 2, failed: 3, blocked: 3, finished: 4, stopped: 5 };

/** Waiting first, then running, then the settled ones, newest first. */
export function sortSubagents(items: readonly BotActivityItem[]): BotActivityItem[] {
  return [...items].sort((a, b) => RANK[a.status] - RANK[b.status] || b.updatedAt - a.updatedAt);
}

export function SubagentList({ items, now, botFor, onOpen, current }: {
  items: readonly BotActivityItem[];
  now: number;
  botFor: (botId: string) => (BotAvatarProps["bot"] & { name?: string }) | undefined;
  onOpen: (item: BotActivityItem) => void;
  /** The one open beside the list, if any. */
  current?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section data-task-subagents={items.length} aria-labelledby="task-subagents-title">
      <h3 id="task-subagents-title" className="mb-1.5 px-1 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{t("botPanel.activity.children")}</h3>
      <ul className="flex flex-col gap-1">
        {sortSubagents(items).map((item) => {
          const bot = botFor(item.botId);
          const waiting = item.status === "waiting";
          const active = activityStatusActive(item.status);
          const words = waiting ? t("task.sheet.waiting") : activityStatusLabel(item.status);
          const duration = formatActivityDuration((item.endedAt ?? now) - item.startedAt);
          return (
            <li key={item.id}>
              <button
                type="button"
                data-subagent={item.id}
                data-subagent-status={item.status}
                aria-current={current === item.id ? "true" : undefined}
                onClick={() => onOpen(item)}
                aria-label={t("botPanel.coding.openAria", { title: item.title })}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  waiting ? "border-warning/50 bg-warning/[0.07] hover:bg-warning/[0.12]" : current === item.id ? "border-border bg-selected" : "border-hairline-weak bg-card hover:bg-hover",
                )}
              >
                {bot?.color ? <BotAvatar bot={bot} size={26} animated={false} state={active ? "working" : "idle"} /> : <ActivityStatusIcon status={item.status} size={18} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-[18px] text-ink">{item.title}</span>
                  <span className={cn("flex min-w-0 items-center gap-1 truncate text-[12px] leading-[16px]", waiting ? "text-warning" : "text-ink-secondary")}>
                    {bot?.color && <ActivityStatusIcon status={item.status} size={12} />}
                    <span className="truncate">
                      {words}
                      {bot?.name ? ` · ${bot.name}` : item.botName ? ` · ${item.botName}` : ""}
                      {active && item.currentStep ? ` · ${item.currentStep}` : ""}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">{duration}</span>
                <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
