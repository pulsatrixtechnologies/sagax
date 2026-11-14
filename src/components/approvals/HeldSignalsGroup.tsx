// #4233: "While you were quiet" on Today: what the signal gate held back
// (quiet hours, the day's budget, FYI), in its own words, with its
// conversation one click away. Shown whether or not the person has a brief;
// the server clears it once read (useHeldSignals), so the brief does not
// say it again. Never an id on screen.
import { X } from "lucide-react";

import type { InboxHeldSignal } from "../../../shared/approvals-inbox";
import { withoutIds } from "@/lib/approvals-inbox";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { ageLabel, InboxAvatar } from "./ApprovalRow";

export function HeldSignalsGroup({
  items,
  bots,
  now,
  onOpen,
  onDismiss,
}: {
  items: readonly InboxHeldSignal[];
  bots: ReadonlyMap<string, Bot>;
  now: number;
  onOpen: (item: InboxHeldSignal) => void;
  onDismiss: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <section data-held-signals="" aria-label={t("approvals.held.title")} className="border-t border-hairline/40 px-5 py-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-ink">{t("approvals.held.title")}</h2>
        <span className="rounded-full bg-control px-1.5 py-px text-[11px] font-medium tabular-nums text-ink-secondary">{items.length}</span>
        <span className="min-w-0 truncate text-[11.5px] text-ink-tertiary">{t("approvals.held.why")}</span>
        <span className="flex-1" />
        <button type="button" onClick={onDismiss} aria-label={t("approvals.held.dismiss")} title={t("approvals.held.dismiss")} className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-1.5 max-h-[34vh] overflow-y-auto">
        {items.map((item) => {
          const bot = item.botId ? bots.get(item.botId) : undefined;
          const name = item.botName ?? bot?.name ?? "";
          const linked = Boolean(item.botId && item.threadId);
          // a push's title is often the bot's own name, already on the line above
          const raw = withoutIds(item.title);
          const title = raw && raw !== name ? raw : "";
          const body = withoutIds(item.body);
          return (
            <li key={`${item.at}:${item.botId ?? ""}:${item.title}`}>
              <button
                type="button"
                data-held-signal=""
                disabled={!linked}
                onClick={() => onOpen(item)}
                title={linked && name ? t("approvals.openChat", { bot: name }) : undefined}
                className={cn("flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors", linked ? "hover:bg-control/60" : "cursor-default")}
              >
                <InboxAvatar bot={bot} name={name || raw} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {name && <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{name}</span>}
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-tertiary">{ageLabel(item.at, now)}</span>
                  </span>
                  {title && <span className="block truncate text-[13px] leading-5 text-ink">{title}</span>}
                  {body && body !== title && <span className="block line-clamp-2 text-[12.5px] leading-[18px] text-ink-secondary">{body}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
