import { activeLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { PendingApprovalBox, type Pending } from "../PendingApproval";

export function ComposerPendingStrip({
  approval,
  approvals,
  threadId,
  approvalBotFor,
  onCancelTurn,
}: {
  bot?: Bot;
  approval?: Pending;
  approvals: Pending[];
  threadId: string;
  approvalBotFor: (pending: Pending) => Bot | undefined;
  onCancelTurn: () => void;
}) {
  return (
    <>
      {/* #2082: a parallel task's or a run's question is never drawn
          here, over the thread of another conversation: it lives inline
          in its own conversation; this one only shows the task's card
          (waiting, Review) and the sidebar dot. */}
      {/* An approval takes over the composer: you answer it before you
          can type again, so a waiting bot is impossible to miss. */}
      {approval && (
        <PendingApprovalBox
          approvals={approvals}
          threadId={threadId}
          botFor={approvalBotFor}
          onCancelTurn={onCancelTurn}
          locale={activeLocale()}
        />
      )}
    </>
  );
}
