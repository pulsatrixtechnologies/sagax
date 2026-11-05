// What a bot's turn elsewhere left for the person (2026-11-05, the
// maintainer: "they should write to me and show me cards"): a hand-off, a
// thread another bot opened or a routine run ended with items only the
// person can do. The card sits in the person's own conversation with that
// bot (server/turns/person-attention-relay.ts), of the routine run and
// approval card family: the bot's mascot, what it needs, each item with
// its ticket, and clear buttons (Open ticket, Open thread, Open run).
import { ArrowRight, ExternalLink, Hand } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { PersonAttentionCard, PersonAttentionItem } from "../../shared/person-attention";
import { ChatMarkdown } from "./ChatMarkdown";

const ACTION_PILL = "inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline/50 px-3 py-1 text-[12.5px] font-medium text-ink transition-colors hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

function safeTicketUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The items, each with its ticket button (shared with the routine run card). */
export function AttentionItems({ items }: { items: readonly PersonAttentionItem[] }) {
  return (
    <ul data-attention-items className="flex flex-col gap-2">
      {items.map((item, index) => {
        const url = safeTicketUrl(item.ticketUrl);
        return (
          <li key={`${item.ticketId ?? ""}-${index}`} data-attention-item={item.ticketId ?? index} className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-3 py-2">
            <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink">
              <ChatMarkdown text={item.text} inert />
            </div>
            {item.ticketId && url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                data-attention-ticket={item.ticketId}
                aria-label={t("needsYou.openTicketFor", { id: String(item.ticketId) })}
                className={cn(ACTION_PILL, "mt-0.5")}
              >
                {t("needsYou.openTicket", { id: String(item.ticketId) })}
                <ExternalLink aria-hidden="true" size={12} />
              </a>
            ) : item.ticketId ? (
              <span data-attention-ticket={item.ticketId} className="mt-1 shrink-0 text-[12px] font-medium tabular-nums text-ink-secondary">#{item.ticketId}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AttentionCard({
  card,
  bot,
  onOpenThread,
  onOpenRun,
}: {
  card: PersonAttentionCard;
  bot?: Bot;
  onOpenThread?: (botId: string, threadId: string) => void;
  onOpenRun?: (runId: string) => void;
}) {
  const title = card.kind === "question"
    ? t("needsYou.titleQuestion", { bot: card.botName })
    : card.kind === "failure"
      ? t("needsYou.titleFailure", { bot: card.botName })
      : t("needsYou.title", { bot: card.botName });
  const from = card.routineName
    ? t("needsYou.fromRoutine", { name: card.routineName })
    : card.openedBy
      ? t("needsYou.fromHandoff", { name: card.openedBy.name })
      : t("needsYou.fromThread", { name: card.threadTitle ?? card.botName });
  return (
    <section
      data-attention-card
      data-attention-kind={card.kind}
      aria-label={title}
      className="relative w-full max-w-[680px] overflow-hidden rounded-2xl border border-warning/40 bg-card px-3.5 py-3 shadow-sm"
    >
      <div className="flex items-start gap-3">
        {bot && "color" in bot && bot.color
          ? <BotAvatar bot={bot} size={30} animated={false} />
          : <div aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-xl bg-inset"><Hand size={15} className="text-warning" /></div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate text-[14px] font-semibold leading-snug text-ink">{title}</h3>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[11px] font-medium leading-none text-warning">
              {card.items.length === 1 ? t("needsYou.countOne") : t("needsYou.countMany", { count: String(card.items.length) })}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-ink-secondary">{from}</div>
        </div>
      </div>
      <div className="mt-2.5 pl-[42px]">
        <AttentionItems items={card.items} />
        <div className="mt-2.5 flex flex-wrap gap-2">
          {onOpenThread && (
            <button type="button" data-attention-open-thread onClick={() => onOpenThread(card.botId, card.threadId)} className={ACTION_PILL}>
              {t("needsYou.openThread")}
              <ArrowRight aria-hidden="true" size={12} />
            </button>
          )}
          {card.routineRunId && onOpenRun && (
            <button type="button" data-attention-open-run onClick={() => onOpenRun(card.routineRunId!)} className={ACTION_PILL}>
              {t("needsYou.openRun")}
              <ArrowRight aria-hidden="true" size={12} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
