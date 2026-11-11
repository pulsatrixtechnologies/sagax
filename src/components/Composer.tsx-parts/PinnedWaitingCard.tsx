// The pinned card over the composer (#3214): what the bots of this
// conversation wait on from the person, stuck above the box until answered.
//
// Every open question (a bot's structured ask) and every approval of the
// conversation is in here, oldest first, one at a time with "1 of N" and
// arrows when several wait. Answering one drops it out and the next moves
// up. The card itself is the existing one (QuestionCard, the approval panel
// and its row of answers), drawn flat inside this frame: same rows, same
// buttons, same remembered grants. A chevron folds it to one line that still
// names who waits and for what; it never hides while something is pending.
// "See in the conversation" scrolls the transcript to where the bot asked.
//
// #3681 (the owner, 2026-11-11): while an item waits here the conversation
// draws no card for it (pinnedHeldIds, read by the transcript from this same
// list); once answered, skipped or expired its record is back at its place.
//
// #3414: one compact card, the chat's ask surface (AskCard), with one row on
// top. An approval's title is that row ("Orla wants to view alerts"), its
// jump, stepper and fold on the right: no header bar of its own, the bot
// named once. A question keeps one quiet line naming who waits, since the
// question card's title is the question itself; so does an approval whose
// title does not name the bot (a proposal, a room's member bot).
//
// #3543: the items are the server's own (src/lib/pinned-waiting.ts), the
// same list Today and the connector read: the app builds none from the
// conversation. An item of a kind this app does not know is drawn with its
// text, and "See in the conversation" opens its conversation.
import { ChevronDown, ChevronUp, CornerLeftUp } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PinnedItem } from "@/lib/pending-question";
import { pinnedItemsFrom } from "@/lib/pinned-waiting";
import { useShowThreads } from "@/lib/thread-preferences";
import { openThread, useStore, type Bot, type Message } from "@/state/store";
import type { ServedWaitingItem } from "../../../shared/waiting-items";
import { PendingApprovalActions, PendingApprovalPanel, readOnlyApprovals, Stepper, type Pending } from "../PendingApproval";
import { QuestionCard } from "../QuestionCard";
import { PersonRequestCard, skipPersonRequest, skipPlace } from "../InputRequestCard";
import { CardCloseButton } from "../AskCard";
import { OptionCard } from "../OptionCard";

/** How much of the question the folded line keeps. */
const FOLDED_TEXT_MAX = 72;

/** The pinned card's own state, kept by the composer session so the box
 * knows which item the person is on (typing answers that one). `served` is
 * the server's list for this conversation, `threadId` the conversation on
 * screen, `fresh` its transcript in the store and `approvals` its live
 * approvals, which add who asked (src/lib/pinned-waiting.ts). */
export function usePinnedWaiting(served: readonly ServedWaitingItem[], threadId = "", fresh: readonly Message[] = [], approvals: readonly Pending[] = []) {
  const items = pinnedItemsFrom(served, threadId, fresh, approvals);
  // the item is remembered by key, not by position: one answered ahead of
  // it must not move the person to another request
  const [place, setPlace] = useState<{ key: string; at: number } | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  // #3471: the item the person was on left (answered, skipped, expired):
  // the one after it moves up into its place, never back to the first
  const found = place ? items.findIndex((item) => item.key === place.key) : -1;
  const index = found >= 0 ? found : Math.min(place?.at ?? 0, Math.max(0, items.length - 1));
  return {
    items,
    index,
    current: items[index],
    go: (to: number) => {
      const target = items[to];
      setPlace(target ? { key: target.key, at: to } : undefined);
    },
    collapsed,
    setCollapsed,
  };
}

export type PinnedWaiting = ReturnType<typeof usePinnedWaiting>;

/** The words of what waits, for the folded line. */
export function pinnedItemText(item: PinnedItem): string {
  const raw = item.kind === "question"
    ? item.message.card?.questionRequest?.questions[0]?.question ?? item.message.card?.title ?? ""
    : item.kind === "offer"
      ? item.message.card?.title || item.message.card?.subtitle || ""
    : item.kind === "request"
      ? item.card.items[0]?.text ?? ""
    : item.kind === "other"
      ? item.item.title || item.item.text
      : item.pending.message.card?.title || item.pending.detail || item.pending.tool;
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > FOLDED_TEXT_MAX ? `${text.slice(0, FOLDED_TEXT_MAX - 1).trimEnd()}…` : text;
}

/** The message this item came from, when it is in this conversation's
 * transcript (this topic or an earlier one, #3438): a parallel task's
 * approval has nothing to scroll to. An approval of an earlier topic sits
 * in that topic. #3681: while it waits the conversation draws no card for
 * it, so the conversation lands on the words before it (pinnedJumpTarget). */
export function pinnedItemMessageId(item: PinnedItem, threadId: string): string | undefined {
  if (item.kind === "other") return item.item.messageId;
  if (item.kind === "question" || item.kind === "request" || item.kind === "offer") return item.message.id;
  if (!item.threadId && item.pending.threadId && item.pending.threadId !== threadId) return undefined;
  return item.pending.message.id;
}

export function PinnedWaitingCard({
  pinned,
  threadId,
  bot,
  botFor,
  nameFor,
  onCancelTurn,
  locale,
}: {
  pinned: PinnedWaiting;
  threadId: string;
  /** this conversation's bot (a room has none: each item names its own) */
  bot?: Bot;
  /** who asked an approval: "always allow" is remembered against them */
  botFor: (pending: Pending) => Bot | undefined;
  /** who waits, for the header line */
  nameFor: (item: PinnedItem) => string;
  onCancelTurn: () => void;
  locale?: string;
}) {
  const { dispatch, state } = useStore();
  const showThreads = useShowThreads();
  const { items, index, current, go, collapsed, setCollapsed } = pinned;
  if (!current) return null;
  const name = nameFor(current);
  const messageId = pinnedItemMessageId(current, threadId);
  // #3438: an item of an earlier topic lives in that topic's thread
  const askedIn = current.threadId ?? threadId;
  const stepper = items.length > 1
    ? <Stepper index={index} count={items.length} onPrevious={index > 0 ? () => go(index - 1) : undefined} onNext={index < items.length - 1 ? () => go(index + 1) : undefined} />
    : null;
  const mark = (
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-bold leading-none text-accent-text">?</span>
  );
  const foldButton = (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      aria-label={collapsed ? t("pinned.expand") : t("pinned.collapse")}
      data-pinned-fold=""
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink"
    >
      {collapsed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );
  // #3543: an item this app cannot draw opens its conversation first (when
  // it sits in another one), then lands on its message
  const jump = () => {
    if (current.kind === "other" && current.threadId && current.threadId !== threadId) openThread(dispatch, { botId: current.item.botId, threadId: current.threadId }, state, showThreads);
    if (messageId) dispatch({ type: "focusMessage", threadId: askedIn, messageId });
  };
  const jumpButton = messageId || current.kind === "other" ? (
    <button
      type="button"
      onClick={jump}
      className="flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-1 text-[12px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
      aria-label={t("pinned.seeInConversation")}
      title={t("pinned.seeInConversation")}
      data-pinned-jump=""
    >
      {/* narrow: the arrow alone, so the title keeps its room */}
      <CornerLeftUp className="size-4 sm:hidden" aria-hidden="true" />
      <span className="hidden sm:inline">{t("pinned.seeInConversation")}</span>
    </button>
  ) : null;
  // #3471: one quiet skip at the end of the top row, for every kind
  const skip = pinnedItemSkip(current, askedIn, current.item.botId, dispatch);
  const skipButton = skip ? <CardCloseButton label={t("waitingCard.skipAria")} onClick={skip} className="ms-0" /> : null;
  const controls = <>{jumpButton}{stepper}{foldButton}{skipButton}</>;
  // the chat's ask surface (AskCard): no outline, no shadow at rest
  const frame = "mb-2 overflow-hidden rounded-3xl bg-composer ring-1 ring-composer-ring";

  if (collapsed) {
    return (
      <section
        aria-label={t("pinned.aria", { name })}
        data-pinned-waiting="collapsed"
        className={cn(frame, "flex items-center gap-2 py-1.5 pe-1.5 ps-3")}
      >
        {mark}
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="min-w-0 flex-1 truncate text-start text-[13px] leading-5 text-ink hover:text-ink"
          data-pinned-folded-line=""
        >
          <span className="font-semibold">{t("pinned.waiting", { name })}</span>
          <span className="text-ink-secondary">{t("pinned.foldedSeparator")}{pinnedItemText(current)}</span>
        </button>
        {stepper}
        {foldButton}
        {skipButton}
      </section>
    );
  }

  return (
    <section
      aria-label={t("pinned.aria", { name })}
      data-pinned-waiting="open"
      className={frame}
    >
      {current.kind === "other" ? (
        // #3543: a kind this app does not know: its text, and its
        // conversation opens from the top row
        <div className="px-4 pb-3 pt-2.5" data-pinned-body="other">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            {mark}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-secondary" data-pinned-title="">{t("pinned.waiting", { name })}</span>
            {controls}
          </div>
          <p className="whitespace-pre-wrap break-words text-[14px] leading-5 text-ink" data-pinned-text="">{current.item.text || current.item.title}</p>
        </div>
      ) : current.kind === "request" ? (
        <div className="px-4 pb-3 pt-2.5" data-pinned-body="request">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            {mark}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-secondary" data-pinned-title="">{t("pinned.waiting", { name })}</span>
            {controls}
          </div>
          <PersonRequestCard key={current.key} message={current.message} card={current.card} threadId={askedIn} conversationBotId={current.item.botId} embedded />
        </div>
      ) : current.kind === "offer" ? (
        // #3512: an offer the bot posted on its own (the daily brief's, a
        // watch domain's), drawn flat as a question is, skipped from the top row
        <div className="px-4 pb-3 pt-2.5" data-pinned-body="offer">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            {mark}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-secondary" data-pinned-title="">{t("pinned.waiting", { name })}</span>
            {controls}
          </div>
          <OptionCard key={current.key} botId={current.message.from?.botId ?? current.item.botId} threadId={askedIn} message={current.message} embedded />
        </div>
      ) : current.kind === "question" ? (
        <div className="px-4 pb-3 pt-2.5" data-pinned-body="question">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            {mark}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-secondary" data-pinned-title="">{t("pinned.waiting", { name })}</span>
            {controls}
          </div>
          <QuestionCard
            key={current.key}
            threadId={askedIn}
            bot={questionBot(current.message, bot, name)}
            message={current.message}
            embedded
          />
        </div>
      ) : (
        <div data-pinned-body="approval">
          <PendingApprovalPanel
            key={`${current.key}-panel`}
            pending={current.pending}
            count={1}
            index={0}
            bot={botFor(current.pending)}
            askerName={name}
            locale={locale}
            allowAllReadOnly={readOnlyAllowAll(items, threadId, dispatch)}
            controls={controls}
          />
          <PendingApprovalActions
            key={`${current.key}-actions`}
            pending={current.pending}
            threadId={askedIn}
            bot={botFor(current.pending)}
            // a parallel task's "cancel" stops that task, a bot-to-bot
            // conversation's stops that conversation's turn, an earlier
            // topic's stops that topic's turn, never this one's
            onCancelTurn={current.pending.threadId && current.pending.threadId !== threadId && botFor(current.pending)
              ? current.pending.askedBy !== undefined || current.threadId
                ? () => dispatch({ type: "interrupt", botId: botFor(current.pending)!.id, threadId: current.pending.threadId! })
                : () => dispatch({ type: "stopParallelTask", botId: botFor(current.pending)!.id, threadId: current.pending.threadId! })
              : onCancelTurn}
          />
        </div>
      )}
    </section>
  );
}

/** How the pinned item is skipped (#3471): an approval or a question by its
 * request, a question in words by its card. Closed as skipped, never denied. */
export function pinnedItemSkip(item: PinnedItem, askedIn: string, conversationBotId: string | undefined, dispatch: ReturnType<typeof useStore>["dispatch"]): (() => void) | undefined {
  // a kind this app does not know is answered in its conversation
  if (item.kind === "other") return undefined;
  if (item.kind === "approval") {
    const card = item.pending.message.card;
    const requestId = card?.approvalOrigin?.requestId ?? item.pending.requestId;
    return () => dispatch({ type: "skipCard", threadId: item.pending.threadId ?? askedIn, requestId, tool: true });
  }
  if (item.kind === "question") {
    const requestId = item.message.card?.requestId;
    return requestId ? () => dispatch({ type: "skipCard", threadId: askedIn, requestId }) : undefined;
  }
  // #3512: an offer is skipped by its proposal, closed as skipped
  if (item.kind === "offer") {
    const proposal = item.message.card?.proactiveProposal;
    const botId = item.message.from?.botId ?? conversationBotId;
    return proposal && botId ? () => dispatch({ type: "skipCard", threadId: askedIn, proposal: { botId, id: proposal.id } }) : undefined;
  }
  const where = skipPlace(item.card, item.message, askedIn, conversationBotId);
  return where ? () => { void skipPersonRequest(where, dispatch, item.message).catch(() => undefined); } : undefined;
}

function questionBot(message: Message, bot: Bot | undefined, name: string): Pick<Bot, "name"> & { id?: string } {
  if (message.from?.botId && message.from.botId !== bot?.id) return { id: message.from.botId, name };
  return bot ? { id: bot.id, name: bot.name } : { name };
}

/** Several read-only approvals wait: allow them all at once (the same as
 * the approval box's own button). */
function readOnlyAllowAll(items: readonly PinnedItem[], threadId: string, dispatch: ReturnType<typeof useStore>["dispatch"]) {
  const approvals = items.flatMap((item) => (item.kind === "approval" ? [item.pending] : []));
  const readOnly = readOnlyApprovals(approvals);
  if (readOnly.length < 2) return undefined;
  return {
    count: readOnly.length,
    onAllow: () => {
      for (const each of readOnly) dispatch({ type: "decideRequest", threadId: each.threadId ?? threadId, requestId: each.message.card?.approvalOrigin?.requestId ?? each.requestId, behavior: "allow" });
    },
  };
}
