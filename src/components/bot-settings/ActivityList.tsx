import { Loader2 } from "lucide-react";

import { FINISHED_FADE_MS, type BotActivityItem } from "@/lib/bot-activity";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ActivityCard } from "./ActivityCard";

export interface CardActions {
  onOpen: (item: BotActivityItem) => void;
  onStop?: (item: BotActivityItem) => void;
  stopping?: ReadonlySet<string>;
  now?: number;
  /** A finished entry on its way out of the panel. */
  fading?: (item: BotActivityItem) => boolean;
  /** A third line under an entry (a coding job's repository and branch). */
  where?: (item: BotActivityItem) => string | undefined;
  /** The entry shown beside the list (History's right pane). */
  currentId?: string;
}

function Cards({ items, label, actions }: { items: BotActivityItem[]; label: string; actions: CardActions }) {
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {items.map((item) => (
        <li
          key={item.id}
          data-activity-fading={actions.fading?.(item) ? "" : undefined}
          className={cn("transition-opacity ease-out", actions.fading?.(item) && "opacity-0")}
          style={{ transitionDuration: `${FINISHED_FADE_MS}ms` }}
        >
          <ActivityCard item={item} onOpen={actions.onOpen} now={actions.now} onStop={actions.onStop} stopping={actions.stopping?.has(item.id)} where={actions.where?.(item)} current={actions.currentId === item.id} />
        </li>
      ))}
    </ul>
  );
}

/** A list of entries as it is drawn (the history modal's too): loading,
 * error, empty or the cards. Split out so it renders without the fetching
 * around it. */
export function ActivityList({ items, error, onOpen, now, onStop, stopping, fading, where, currentId, label, emptyKey = "botPanel.coding.empty" }: {
  items: BotActivityItem[] | null;
  label?: string;
  error: boolean;
  emptyKey?: "botPanel.coding.empty" | "botPanel.list.empty";
} & CardActions) {
  if (items === null && error) {
    return <p role="alert" className="rounded-xl bg-card px-3 py-2.5 text-[12.5px] text-ink-secondary">{t("botPanel.coding.error")}</p>;
  }
  if (items === null) {
    return (
      <p role="status" className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" />{t("botPanel.coding.loading")}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <div data-activity-empty className="rounded-xl border border-dashed border-hairline/50 px-4 py-3 text-center text-[12.5px] leading-relaxed text-ink-secondary">
        {t(emptyKey)}
      </div>
    );
  }
  return <Cards items={items} label={label ?? t("botPanel.coding.title")} actions={{ onOpen, now, onStop, stopping, fading, where, currentId }} />;
}
