import { activeLocale } from "@/lib/i18n";
import type { PinnedItem } from "@/lib/pending-question";
import type { Bot } from "@/state/store";
import type { Pending } from "../PendingApproval";
import { PinnedWaitingCard, type PinnedWaiting } from "./PinnedWaitingCard";

export function ComposerPendingStrip({
  bot,
  pinned,
  threadId,
  storeBots,
  approvalBotFor,
  onCancelTurn,
}: {
  bot?: Bot;
  pinned: PinnedWaiting;
  threadId: string;
  storeBots: readonly Bot[];
  approvalBotFor: (pending: Pending) => Bot | undefined;
  onCancelTurn: () => void;
}) {
  // #3214, #3543: everything this conversation's bots wait on from the
  // person, pinned over the box until answered, one at a time: the server's
  // own list (the one Today and the connector read).
  // #3438: a question in words names the bot whose work asks it
  const nameFor = (item: PinnedItem) => item.kind === "approval"
    ? approvalBotFor(item.pending)?.name ?? bot?.name ?? item.item.botName
    : item.kind === "request"
      ? item.card.botName || bot?.name || item.item.botName
    : item.kind === "other"
      ? item.item.botName || bot?.name || ""
      : storeBots.find((candidate) => candidate.id === item.message.from?.botId)?.name ?? bot?.name ?? item.item.botName;
  return (
    <PinnedWaitingCard
      pinned={pinned}
      threadId={threadId}
      bot={bot}
      botFor={approvalBotFor}
      nameFor={nameFor}
      onCancelTurn={onCancelTurn}
      locale={activeLocale()}
    />
  );
}
