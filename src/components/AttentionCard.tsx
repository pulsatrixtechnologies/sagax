// What a bot's turn elsewhere left for the person (2026-11-05, the
// maintainer: "they should write to me and show me cards"): a hand-off, a
// thread another bot opened or a routine run ended with items only the
// person can do. It sits in the person's own conversation with that bot
// (server/turns/person-attention-relay.ts).
//
// 2026-11-05 (#2081, owner: "there is a unified chat mode and you keep
// putting threads everywhere"): it reads as the bot's own message, in the
// bot's bubble, each item with its ticket link; where it comes from is one
// small grey line under it (the work handed over, the routine, the run).
// With one conversation the person answers right here: the answer is their
// own message into the thread the question was asked in, which the runtime
// takes as the answer (coordinator.answer). "Open thread" exists only with
// threads shown.
import { ArrowRight, ExternalLink } from "lucide-react";
import { useState } from "react";

import { chatBubbleWidth, useChatBubbleWidthClasses } from "@/lib/chat-bubble-width";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { prefersWideBubble } from "@/lib/rich-blocks";
import type { Bot } from "@/state/store";
import type { PersonAttentionCard, PersonAttentionItem } from "../../shared/person-attention";
import { ChatMarkdown } from "./ChatMarkdown";

const TICKET_PILL = "inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline/50 px-2 py-0.5 text-[11.5px] font-medium text-ink transition-colors hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const LINE_LINK = "inline-flex items-center gap-0.5 rounded font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

function safeTicketUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The items, each with its ticket link (shared with the routine run card):
 * a plain list inside the bot's bubble, never a card per item. */
export function AttentionItems({ items }: { items: readonly PersonAttentionItem[] }) {
  return (
    <ul data-attention-items className="flex flex-col gap-1.5">
      {items.map((item, index) => {
        const url = safeTicketUrl(item.ticketUrl);
        return (
          <li key={`${item.ticketId ?? ""}-${index}`} data-attention-item={item.ticketId ?? index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ChatMarkdown text={item.text} inert />
            </div>
            {item.ticketId && url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                data-attention-ticket={item.ticketId}
                aria-label={t("needsYou.openTicketFor", { id: String(item.ticketId) })}
                className={cn(TICKET_PILL, "mt-0.5")}
              >
                {t("needsYou.openTicket", { id: String(item.ticketId) })}
                <ExternalLink aria-hidden="true" size={11} />
              </a>
            ) : item.ticketId ? (
              <span data-attention-ticket={item.ticketId} className="mt-0.5 shrink-0 text-[12px] font-medium tabular-nums text-ink-secondary">#{item.ticketId}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The answer box under the message, one conversation: the person's words go
 * into the thread the bot asked in, as InputRequestCard sends them. */
function AttentionReply({ onReply }: { onReply: (text: string) => Promise<void> }) {
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    const text = answer.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await onReply(text);
      setSent(true);
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setSending(false);
    }
  };
  if (sent) return <div data-attention-answered className="mt-1.5 pl-0.5 text-[11.5px] text-ink-secondary">{t("chat.inputRequest.answered")}</div>;
  return (
    <div data-attention-reply className="mt-2 flex w-full max-w-[560px] flex-col gap-1.5">
      <textarea
        className="min-h-[2.25rem] w-full resize-y rounded-xl border border-hairline/50 bg-panel px-3 py-1.5 text-[13px] leading-5 text-ink placeholder:text-ink-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        value={answer}
        placeholder={t("chat.inputRequest.placeholder")}
        aria-label={t("chat.inputRequest.placeholder")}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
        }}
      />
      {error ? <div className="text-[11.5px] text-danger">{error}</div> : null}
      <div>
        <button
          type="button"
          className="rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-accent-ink disabled:opacity-50"
          disabled={!answer.trim() || sending}
          onClick={() => void send()}
        >
          {t("chat.inputRequest.send")}
        </button>
      </div>
    </div>
  );
}

export function AttentionCard({
  card,
  onOpenThread,
  onOpenRun,
  onReply,
}: {
  card: PersonAttentionCard;
  /** Kept for callers; the message carries no avatar of its own, as a bot's reply does not. */
  bot?: Bot;
  /** Threads shown only: the thread the bot said it in. */
  onOpenThread?: (botId: string, threadId: string) => void;
  onOpenRun?: (runId: string) => void;
  /** One conversation: the person's answer, sent into the bot's thread. */
  onReply?: (text: string) => Promise<void>;
}) {
  const widths = useChatBubbleWidthClasses();
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
  const wide = card.items.some((item) => prefersWideBubble(item.text));
  return (
    <section
      data-attention-card
      data-attention-kind={card.kind}
      aria-label={title}
      className="relative w-full"
    >
      <div
        data-attention-bubble
        // the bot's own bubble: ChatView's Bubble classes for a bot reply
        className={cn("rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink", widths[chatBubbleWidth({ terminal: false, wide })])}
      >
        <AttentionItems items={card.items} />
      </div>
      <div data-attention-provenance title={title} className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-0.5 text-[11px] text-ink-secondary">
        <span className="min-w-0 truncate">{from}</span>
        {card.items.length > 1 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t("needsYou.countMany", { count: String(card.items.length) })}</span>
          </>
        )}
        {onOpenThread && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" data-attention-open-thread onClick={() => onOpenThread(card.botId, card.threadId)} className={LINE_LINK}>
              {t("needsYou.openThread")}
              <ArrowRight aria-hidden="true" size={11} />
            </button>
          </>
        )}
        {card.routineRunId && onOpenRun && (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" data-attention-open-run onClick={() => onOpenRun(card.routineRunId!)} className={LINE_LINK}>
              {t("needsYou.openRun")}
              <ArrowRight aria-hidden="true" size={11} />
            </button>
          </>
        )}
      </div>
      {onReply && !card.handledAt && <AttentionReply onReply={onReply} />}
    </section>
  );
}
