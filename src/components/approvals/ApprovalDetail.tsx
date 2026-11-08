// The Approvals screen's right side: the whole card, where it would run,
// and the answer as large buttons. The card and its buttons are the
// conversation's own components (PendingApprovalPanel and
// PendingApprovalActions in their "inbox" size, QuestionCard), so a card
// reads and answers the same here as in the chat, with the same grants.
// After an answer it says what happens next.
import { ArrowUpRight, Check, Cloud, Globe, HardDrive, KeyRound, Laptop, Lock, MonitorSmartphone, Server, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { InboxApproval, InboxDestination } from "../../../shared/approvals-inbox";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "@/components/PendingApproval";
import { AttentionCard } from "@/components/AttentionCard";
import { QuestionCard } from "@/components/QuestionCard";
import { answerProactive, attentionOf, inboxWhere, markHandled, withoutIds } from "@/lib/approvals-inbox";
import { readableError } from "@/lib/plain-error";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import { AgePill, InboxAvatar, KindPill } from "./ApprovalRow";

const DESTINATION_ICON: Record<InboxDestination, typeof Laptop> = {
  computer: Laptop,
  vm: MonitorSmartphone,
  sandbox: HardDrive,
  server: Server,
  cloud: Cloud,
  browser: Globe,
};

/** What the screen shows once a card is answered, until the next one. */
export interface InboxOutcome {
  key: string;
  botName: string;
  decision: "allow" | "deny" | "answer";
}

export function OutcomePanel({ outcome }: { outcome: InboxOutcome }) {
  const allowed = outcome.decision !== "deny";
  const Icon = allowed ? Check : X;
  return (
    <div role="status" data-outcome={outcome.decision} className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className={cn("approval-mark-in flex size-14 items-center justify-center rounded-full", allowed ? "bg-success/15 text-success" : "bg-danger/12 text-danger")}>
        <Icon size={28} strokeWidth={2.5} aria-hidden="true" />
      </span>
      <div className="text-[17px] font-semibold text-ink">
        {t(outcome.decision === "deny" ? "approvals.outcome.denied" : outcome.decision === "answer" ? "approvals.outcome.answered" : "approvals.outcome.allowed")}
      </div>
      <div className="max-w-sm text-[13.5px] text-ink-secondary">
        {t(outcome.decision === "deny" ? "approvals.outcome.deniedNext" : "approvals.outcome.resumes", { bot: outcome.botName })}
      </div>
    </div>
  );
}

export function ApprovalDetail({
  entry,
  bot,
  now,
  onDecided,
  onDecideFailed,
  onOpenThread,
  onCancelTurn,
}: {
  entry: InboxApproval;
  bot?: Bot;
  now: number;
  onDecided: (decision: "allow" | "deny" | "answer") => void;
  /** the server refused the answer: the card comes back */
  onDecideFailed: () => void;
  onOpenThread: () => void;
  onCancelTurn: () => void;
}) {
  const message = entry.message as Message | undefined;
  const card = message?.card;
  const pending = useMemo(() => (message && entry.kind !== "question" ? pendingApprovals([message])[0] : undefined), [message, entry.kind]);
  // A meeting or a terminal is answered on its own card in the conversation.
  const ownCard = Boolean(card?.meetingRequest || card?.phoneCallConsent || card?.terminalRequest);
  const where = withoutIds(inboxWhere(entry));
  const Destination = entry.destination ? DESTINATION_ICON[entry.destination] : undefined;
  const at = new Date(entry.at);

  return (
    <div className="flex h-full min-h-0 flex-col" data-approval-detail={entry.kind}>
      <header className="flex items-start gap-3 border-b border-hairline/40 px-5 pb-3 pt-4">
        <InboxAvatar bot={bot} name={entry.botName} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold text-ink">{entry.botName}</span>
            <KindPill entry={entry} />
            {entry.scope !== "mine" && (
              <span className="rounded-full bg-control px-1.5 py-px text-[10.5px] font-medium text-ink-secondary">{t(`approvals.scope.${entry.scope}`)}</span>
            )}
            {entry.confidential && (
              <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-secondary"><Lock size={11} aria-hidden="true" />{t("approvals.confidential")}</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-secondary">
            {where && <span className="min-w-0 truncate">{where}</span>}
            {entry.ownerName && entry.scope !== "mine" && <span>{t("approvals.ownedBy", { name: entry.ownerName })}</span>}
            <time dateTime={at.toISOString()} title={at.toLocaleString(activeLocale())}>{at.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}</time>
            <AgePill at={entry.at} now={now} />
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenThread}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink"
        >
          {t("approvals.openThread")}
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(Destination || entry.needsKey) && (
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4 text-[12.5px]">
            {Destination && entry.destination && (
              <span data-destination={entry.destination} className="inline-flex items-center gap-1.5 rounded-lg bg-inset px-2 py-1 text-ink">
                <Destination size={13} aria-hidden="true" className="text-ink-secondary" />
                {t("approvals.runsOn", { place: t(`approvals.destination.${entry.destination}`) })}
              </span>
            )}
            {entry.needsKey && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning/12 px-2 py-1 text-warning">
                <KeyRound size={13} aria-hidden="true" />
                {t("approvals.needsKey")}
              </span>
            )}
          </div>
        )}

        {!entry.decidable ? (
          <div className="px-5 py-6">
            <div className="text-[15px] font-medium text-ink">{t("approvals.notYoursTitle")}</div>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              {entry.waitingOn === "admin"
                ? t("approvals.waitingAdmin")
                : t("approvals.waitingOn", { name: entry.waitingOnName ?? entry.ownerName ?? t("approval.someone") })}
            </p>
          </div>
        ) : entry.kind === "attention" && attentionOf(entry) ? (
          <TodayAttention entry={entry} bot={bot} onDecided={onDecided} onDecideFailed={onDecideFailed} />
        ) : entry.proactiveId && card ? (
          <TodayProposal entry={entry} options={card.options} onDecided={onDecided} onDecideFailed={onDecideFailed} />
        ) : entry.kind === "question" && message ? (
          <div className="px-5 py-4" data-inbox-question="">
            <QuestionCard threadId={entry.threadId} bot={{ name: entry.botName }} message={message} onAnswered={() => onDecided("answer")} onAnswerFailed={onDecideFailed} />
          </div>
        ) : pending && !ownCard ? (
          <>
            <div className="pb-1">
              <PendingApprovalPanel pending={pending} count={1} index={0} bot={bot} locale={activeLocale()} />
            </div>
            <PendingApprovalActions
              key={pending.requestId}
              pending={pending}
              threadId={entry.threadId}
              bot={bot}
              variant="inbox"
              onCancelTurn={onCancelTurn}
              onDecided={onDecided}
              onDecideFailed={onDecideFailed}
            />
          </>
        ) : (
          <div className="px-5 py-6">
            <p className="text-[13.5px] text-ink-secondary">{t("approvals.answerInThread")}</p>
            <button type="button" onClick={onOpenThread} className="ui-button ui-button-primary mt-3">{t("approvals.openThread")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** #2689: a bot's "needs you" card, answered in place (its words go into the
 * thread the bot asked in, as in the conversation), or marked handled. */
function TodayAttention({ entry, bot, onDecided, onDecideFailed }: {
  entry: InboxApproval;
  bot?: Bot;
  onDecided: (decision: "allow" | "deny" | "answer") => void;
  onDecideFailed: () => void;
}) {
  const card = attentionOf(entry)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onDecided("answer");
    try {
      await markHandled(entry);
    } catch (failure) {
      setError(readableError(failure));
      onDecideFailed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-5 py-4" data-inbox-attention="">
      <AttentionCard
        card={card}
        bot={bot}
        onReply={async (text) => {
          await api(`/api/bots/${card.botId}/messages`, { method: "POST", body: JSON.stringify({ text, threadId: card.threadId, sendId: crypto.randomUUID() }) });
          onDecided("answer");
        }}
      />
      <div className="mt-3 flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void handled()} className="ui-button" data-testid="inbox-attention-handled">
          <Check className="size-4" aria-hidden />{t("approvals.attention.handled")}
        </button>
        {error && <span className="text-[12.5px] text-danger">{error}</span>}
      </div>
    </div>
  );
}

/** #2689: a proactive proposal (the bot offers to handle an event): its
 * own yes and no, as on the card in the conversation. */
function TodayProposal({ entry, options, onDecided, onDecideFailed }: {
  entry: InboxApproval;
  options: readonly string[];
  onDecided: (decision: "allow" | "deny" | "answer") => void;
  onDecideFailed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onDecided(accept ? "allow" : "deny");
    try {
      await answerProactive(entry, accept);
    } catch (failure) {
      setError(readableError(failure));
      onDecideFailed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-5 py-4" data-inbox-proactive="">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void answer(true)} className="ui-button ui-button-primary">{options[0] ?? t("approvals.proactive.accept")}</button>
        <button type="button" disabled={busy} onClick={() => void answer(false)} className="ui-button">{options[1] ?? t("approvals.proactive.decline")}</button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}
