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
import { useMemo, useState, type ReactNode } from "react";

import { BotAvatar } from "@/components/Avatar";

import { chatBubbleWidth, useChatBubbleWidthClasses } from "@/lib/chat-bubble-width";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { prefersWideBubble } from "@/lib/rich-blocks";
import type { Bot } from "@/state/store";
import { attentionChoices, type PersonAttentionCard, type PersonAttentionItem } from "../../shared/person-attention";
import { ChatMarkdown } from "./ChatMarkdown";
import { QuestionSheet, SheetChoices, SheetField, SheetNote, sheetKeyHandler } from "./QuestionSheet";

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

/** What the person answered on this card, kept for the folded card. */
type Answer = { text: string; picked?: string };

/**
 * One conversation (2026-11-06, the maintainer: the bubble with a bare
 * textarea and a grey "Send answer" "felt cheap like a form to fill"): the
 * card is the same QuestionSheet every question in the chat uses. Its head is
 * the bot's mascot and name with where the work came from in small grey; the
 * question is the main text; the answers the question offers are one-tap rows
 * (attentionChoices) and a field in words always stays, Enter sends. Once
 * answered it folds to what was chosen. The words go into the thread the bot
 * asked in, as InputRequestCard sends them.
 */
function AttentionSheet({
  card,
  bot,
  title,
  provenance,
  onReply,
}: {
  card: PersonAttentionCard;
  bot?: Bot;
  title: string;
  provenance: ReactNode;
  onReply: (text: string) => Promise<void>;
}) {
  const choices = useMemo(() => attentionChoices(card), [card]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState<Answer | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settled = Boolean(answer) || Boolean(card.handledAt);
  const send = async (next: Answer) => {
    if (!next.text.trim() || sending || settled) return;
    setSending(next);
    setError(null);
    try {
      await onReply(next.text.trim());
      setAnswer(next);
      setDraft("");
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setSending(null);
    }
  };
  const pick = (choice: string) => void send({ text: choice, picked: choice });
  const shown = answer ?? sending;
  // the row reads as a sentence start; the answer sent is the bot's own word
  const sheetChoices = choices.map((choice) => ({ id: choice, label: choice.charAt(0).toLocaleUpperCase() + choice.slice(1) }));
  return (
    <QuestionSheet
      ariaLabel={title}
      settled={settled}
      onKeyDown={settled || !choices.length ? undefined : sheetKeyHandler(choices.length, (index) => pick(choices[index]!))}
    >
      <div data-attention-head className="mb-2.5 flex min-w-0 items-center gap-2.5">
        {bot && "color" in bot && bot.color
          ? <BotAvatar bot={bot} size={26} animated={false} />
          : null}
        <div className="min-w-0 flex-1 leading-tight">
          <div data-attention-bot className="truncate text-[13px] font-semibold text-ink">{card.botName}</div>
          {provenance}
        </div>
      </div>
      <div data-attention-question className="text-[14px] font-medium leading-relaxed text-ink">
        <AttentionItems items={card.items} />
      </div>
      {sheetChoices.length > 0 && (
        <div className="mt-2.5" data-attention-choices>
          <SheetChoices
            choices={sheetChoices}
            picked={shown?.picked ? [shown.picked] : []}
            settled={settled}
            disabled={Boolean(sending)}
            ariaLabel={title}
            onPick={pick}
          />
        </div>
      )}
      {!settled && (
        <SheetField
          value={draft}
          ariaLabel={t("chat.inputRequest.placeholder")}
          placeholder={sheetChoices.length ? t("needsYou.otherAnswer") : t("chat.inputRequest.placeholder")}
          canSend={Boolean(draft.trim()) && !sending}
          sendLabel={t("chat.inputRequest.send")}
          onChange={setDraft}
          onSend={() => void send({ text: draft })}
          className="mt-2.5"
          fieldId={card.sourceMessageId}
        />
      )}
      {error && <div role="alert" className="mt-2 text-[12.5px] leading-snug text-danger">{error}</div>}
      {settled && (
        <div data-attention-answered>
          {answer && !answer.picked ? <SheetNote>{answer.text}</SheetNote> : null}
          {!answer || answer.picked ? <SheetNote>{t("chat.inputRequest.answered")}</SheetNote> : null}
        </div>
      )}
    </QuestionSheet>
  );
}

export function AttentionCard({
  card,
  bot,
  onOpenThread,
  onOpenRun,
  onReply,
}: {
  card: PersonAttentionCard;
  /** The bot that asks: its mascot heads the answerable card (one conversation). */
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
  const provenance = (inSheet: boolean) => (
    <div
      data-attention-provenance
      title={title}
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ink-secondary",
        inSheet ? "mt-0.5 text-[11.5px]" : "mt-1 pl-0.5 text-[11px]",
      )}
    >
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
  );
  if (onReply) {
    return (
      <section data-attention-card data-attention-kind={card.kind} data-attention-sheet aria-label={title} className="relative w-full">
        <AttentionSheet card={card} bot={bot} title={title} provenance={provenance(true)} onReply={onReply} />
      </section>
    );
  }
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
      {provenance(false)}
    </section>
  );
}
