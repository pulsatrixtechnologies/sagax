import { t } from "@/lib/i18n";
import { activeLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { PendingApprovalBox, type Pending } from "../PendingApproval";
import { QuestionCard } from "../QuestionCard";
import type { ParallelQuestion } from "../parallel-approvals";

export function ComposerPendingStrip({
  bot,
  parallelQuestions,
  approval,
  approvals,
  threadId,
  approvalBotFor,
  onCancelTurn,
}: {
  bot?: Bot;
  parallelQuestions: ParallelQuestion[];
  approval?: Pending;
  approvals: Pending[];
  threadId: string;
  approvalBotFor: (pending: Pending) => Bot | undefined;
  onCancelTurn: () => void;
}) {
  return (
    <>
      {/* #1145: a parallel task's question, answered here and sent to
          its own thread, so nobody has to open the task to reply. */}
      {bot && parallelQuestions.map((question) => (
        <div key={`${question.threadId}:${question.message.id}`} data-parallel-question={question.threadId} className="mb-2">
          <div className="mb-1 px-1 text-[11px] text-ink-tertiary">{t("composer.parallelQuestion", { title: question.parallelTitle || t("task.newShort") })}</div>
          <QuestionCard threadId={question.threadId} bot={{ name: bot.name }} message={question.message} />
        </div>
      ))}
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
