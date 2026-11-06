// What a task waits on from the person, at the head of its sheet
// (2026-10-29): an approval or a question, the task's own or one of its
// sub-agents', with its answers right there. The approval is the
// conversation's own card (PendingApprovalBox: same words, same Allow and
// Deny, same remembered rules) and the question its own card (OptionCard),
// so an answer here is the same answer. A run that waits without a card
// the sheet can read (a routine's own question) shows what it asks and
// opens its conversation.
import { Hand, ExternalLink, GitFork } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { WaitingItem } from "@/lib/use-waiting-cards";
import type { Bot } from "@/state/store";
import { OptionCard } from "../OptionCard";
import { PendingApprovalBox } from "../PendingApproval";
import { PILL } from "../SettingsPrimitives";

export type WaitingNote = { kind: "note"; text: string; threadId?: string; botId: string; from?: string };

/** What the person is asked for, from the items at the head. */
export function waitingKind(items: readonly (WaitingItem | WaitingNote)[]): "approval" | "question" | undefined {
  if (items.some((item) => item.kind === "approval")) return "approval";
  if (items.some((item) => item.kind === "question" || item.kind === "note")) return "question";
  return undefined;
}

export function WaitingOnYou({ items, threadId, botFor, onCancel, onOpenThread, className }: {
  items: readonly (WaitingItem | WaitingNote)[];
  /** The task's own thread: the approval box answers there unless the
   * card names another (a sub-agent's). */
  threadId: string;
  botFor: (botId: string) => Bot | undefined;
  /** Stop the task from the approval card ("cancel the turn"). */
  onCancel: () => void;
  onOpenThread?: (botId: string, threadId: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  const approvals = items.flatMap((item) => (item.kind === "approval" ? [item.pending] : []));
  const rest = items.filter((item) => item.kind !== "approval");
  return (
    <section data-task-waiting={items.length} aria-labelledby="task-waiting-title" className={cn("flex flex-col gap-2 rounded-2xl border border-warning/50 bg-warning/[0.07] px-4 pb-3 pt-3", className)}>
      <h3 id="task-waiting-title" className="flex items-center gap-1.5 text-[13px] font-semibold leading-[18px] text-ink">
        <Hand size={14} aria-hidden="true" className="text-warning" />
        {t("task.sheet.waiting")}
      </h3>
      {approvals.length > 0 && (
        <div data-task-waiting-approvals={approvals.length} className="-mb-2">
          <PendingApprovalBox
            approvals={approvals}
            threadId={threadId}
            botFor={(pending) => botFor(items.find((item) => item.kind === "approval" && item.pending === pending)?.botId ?? "") }
            onCancelTurn={onCancel}
          />
        </div>
      )}
      {rest.map((item) => (
        <div key={item.kind === "question" ? item.message.id : `${item.threadId ?? "run"}:${item.text}`} data-task-waiting-item={item.kind} className="flex flex-col gap-1.5">
          {item.from && (
            <p data-task-waiting-from={item.threadId} className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
              <GitFork size={12} aria-hidden="true" />
              <span className="truncate">{t("task.sheet.waiting.from", { title: item.from })}</span>
            </p>
          )}
          {item.kind === "question" ? (
            <div className="[&>*]:max-w-none">
              <OptionCard botId={item.botId} threadId={item.threadId} message={item.message} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">{item.text}</p>
              {item.threadId && onOpenThread && (
                <button type="button" data-task-waiting-open onClick={() => onOpenThread(item.botId, item.threadId!)} className={cn(PILL, "gap-1.5")}>
                  <ExternalLink size={13} aria-hidden="true" />
                  {t("approvals.openThread")}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
