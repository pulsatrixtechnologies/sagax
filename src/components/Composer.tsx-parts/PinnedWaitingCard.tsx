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
// "See in the conversation" scrolls the transcript to the original message.
//
// #3414: one compact card, the chat's ask surface (AskCard), with one row on
// top. An approval's title is that row ("Orla wants to view alerts"), its
// jump, stepper and fold on the right: no header bar of its own, the bot
// named once. A question keeps one quiet line naming who waits, since the
// question card's title is the question itself; so does an approval whose
// title does not name the bot (a proposal, a room's member bot).
import { ChevronDown, ChevronUp, CornerLeftUp } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { pinnedItems, type PinnedItem } from "@/lib/pending-question";
import { useStore, type Bot, type Message } from "@/state/store";
import { approvalCardStaysInChat } from "../ApprovalCard";
import { PendingApprovalActions, PendingApprovalPanel, readOnlyApprovals, Stepper, type Pending } from "../PendingApproval";
import { QuestionCard } from "../QuestionCard";

/** How much of the question the folded line keeps. */
const FOLDED_TEXT_MAX = 72;

/** The pinned card's own state, kept by the composer session so the box
 * knows which item the person is on (typing answers that one). */
export function usePinnedWaiting(approvals: readonly Pending[], questions: readonly Message[]) {
  const items = pinnedItems(approvals, questions);
  // the item is remembered by key, not by position: one answered ahead of
  // it must not move the person to another request
  const [key, setKey] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const found = key ? items.findIndex((item) => item.key === key) : -1;
  const index = found >= 0 ? found : 0;
  return {
    items,
    index,
    current: items[index],
    go: (to: number) => setKey(items[to]?.key),
    collapsed,
    setCollapsed,
  };
}

export type PinnedWaiting = ReturnType<typeof usePinnedWaiting>;

/** The words of what waits, for the folded line. */
export function pinnedItemText(item: PinnedItem): string {
  const raw = item.kind === "question"
    ? item.message.card?.questionRequest?.questions[0]?.question ?? item.message.card?.title ?? ""
    : item.pending.message.card?.title || item.pending.detail || item.pending.tool;
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > FOLDED_TEXT_MAX ? `${text.slice(0, FOLDED_TEXT_MAX - 1).trimEnd()}…` : text;
}

/** The message this item came from, when it is in this conversation's
 * transcript: a parallel task's approval, or one whose card never stays in
 * the chat, has nothing to scroll to. */
export function pinnedItemMessageId(item: PinnedItem, threadId: string): string | undefined {
  if (item.kind === "question") return item.message.id;
  if (item.pending.threadId && item.pending.threadId !== threadId) return undefined;
  return approvalCardStaysInChat(item.pending.message.card) ? item.pending.message.id : undefined;
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
  const { dispatch } = useStore();
  const { items, index, current, go, collapsed, setCollapsed } = pinned;
  if (!current) return null;
  const name = nameFor(current);
  const messageId = pinnedItemMessageId(current, threadId);
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
  const jumpButton = messageId ? (
    <button
      type="button"
      onClick={() => dispatch({ type: "focusMessage", threadId, messageId })}
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
  const controls = <>{jumpButton}{stepper}{foldButton}</>;
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
      </section>
    );
  }

  return (
    <section
      aria-label={t("pinned.aria", { name })}
      data-pinned-waiting="open"
      className={frame}
    >
      {current.kind === "question" ? (
        <div className="px-4 pb-3 pt-2.5" data-pinned-body="question">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            {mark}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-secondary" data-pinned-title="">{t("pinned.waiting", { name })}</span>
            {controls}
          </div>
          <QuestionCard
            key={current.key}
            threadId={threadId}
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
            threadId={threadId}
            bot={botFor(current.pending)}
            // a parallel task's "cancel" stops that task, a bot-to-bot
            // conversation's stops that conversation's turn, never this one's
            onCancelTurn={current.pending.threadId && current.pending.threadId !== threadId && botFor(current.pending)
              ? current.pending.askedBy !== undefined
                ? () => dispatch({ type: "interrupt", botId: botFor(current.pending)!.id, threadId: current.pending.threadId! })
                : () => dispatch({ type: "stopParallelTask", botId: botFor(current.pending)!.id, threadId: current.pending.threadId! })
              : onCancelTurn}
          />
        </div>
      )}
    </section>
  );
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
