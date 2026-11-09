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
  // #3214: everything this conversation's bots wait on from the person,
  // pinned over the box until answered: its approvals (this turn's and its
  // parallel tasks') and its open questions, oldest first, one at a time.
  // #2082 still holds for questions: a parallel task's or a run's question
  // stays inline in its own conversation, never over another's thread.
  const nameFor = (item: PinnedItem) => item.kind === "approval"
    ? approvalBotFor(item.pending)?.name ?? bot?.name ?? ""
    : storeBots.find((candidate) => candidate.id === item.message.from?.botId)?.name ?? bot?.name ?? "";
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
