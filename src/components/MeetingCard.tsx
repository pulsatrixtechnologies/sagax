// The meeting a bot asks to join as a notetaker (join_meeting): first the
// consent card the person answers, then the live meeting (status, the last
// transcript lines, Leave). The answer goes through the same respond route
// as every card. Always allow (#3367) saves the card's ownerRule for that
// provider; Full access still never joins on its own (isolation hold).
import { useState } from "react";
import { CalendarClock, LogOut } from "lucide-react";
import { useStore, api, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useOrgApprovalPolicy } from "@/lib/org-approval-policy";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { cn } from "@/lib/cn";
import { MEETING_PROVIDER_LABELS } from "../../shared/meeting-links";
import { MEETING_APPROVE_LABELS, MEETING_DECLINE_LABELS, MEETING_LIVE_STATUSES, type MeetingRequestCardData, type MeetingStatus } from "../../shared/meeting-request";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_PRIMARY_BUTTON, AskCard } from "./AskCard";
import { perspicaxConsoleUrl } from "./PerspicaxOrgSettings";
import { readableError } from "@/lib/plain-error";

const STATUS_KEYS: Record<MeetingStatus, LocaleKey> = {
  pending: "meeting.status.pending",
  joining: "meeting.status.joining",
  waiting: "meeting.status.waiting",
  announcing: "meeting.status.announcing",
  recording: "meeting.status.recording",
  ending: "meeting.status.ending",
  ended: "meeting.status.ended",
  declined: "meeting.status.declined",
  failed: "meeting.status.failed",
};

export function meetingStatusLabel(status: MeetingStatus): string {
  return t(STATUS_KEYS[status]);
}

/** Whether the live card offers Leave: only while the bot is in, or on its
 * way in. */
export function meetingCanLeave(data: Pick<MeetingRequestCardData, "status">): boolean {
  return MEETING_LIVE_STATUSES.has(data.status) && data.status !== "ending";
}

export function MeetingCard({ botId, botName, threadId, message }: {
  botId: string;
  botName: string;
  threadId: string;
  message: Message;
}) {
  const { dispatch } = useStore();
  const orgPolicy = useOrgApprovalPolicy();
  const orgIssuer = usePerspicaxOrg()?.org.identity.issuer ?? "";
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = message.card;
  const data = card?.meetingRequest;
  if (!card || !data) return null;
  const platform = MEETING_PROVIDER_LABELS[data.provider];
  const pending = !card.answered && data.status === "pending";
  const ownerRule = card.ownerRule;
  const secondary = cn(ASK_CHIP, ASK_CHIP_IDLE);

  const answer = (allow: boolean) => {
    dispatch({
      type: "answerCard", botId, threadId, messageId: message.id,
      // A fixed label, whatever the app's language: the server maps it to allow or deny.
      answer: allow ? MEETING_APPROVE_LABELS[1] : MEETING_DECLINE_LABELS[1],
    });
  };
  // #3367: Always allow keeps the card's ownerRule (this bot, this provider)
  // and joins now; next join of that provider skips the card (keptRule).
  const alwaysAllow = () => {
    if (!card.requestId || !ownerRule) return;
    dispatch({
      type: "decideRequest",
      threadId,
      requestId: card.requestId,
      behavior: "allow",
      rule: "allow",
      settle: { answered: "allow" },
    });
  };
  const leave = async () => {
    setLeaving(true);
    setError(null);
    try {
      await api("/api/meetings/leave", { method: "POST", body: JSON.stringify({ threadId, requestId: data.requestId }) });
    } catch (cause) {
      setError(readableError(cause));
      setLeaving(false);
    }
  };

  const title = data.supported
    ? t("meeting.card.title", { bot: botName, platform })
    : t("meeting.card.unsupported", { platform });

  return (
    <AskCard
      ariaLabel={title}
      icon={<CalendarClock size={15} />}
      title={title}
      meta={pending ? undefined : meetingStatusLabel(data.status)}
      explanation={data.reason ? <span className="text-[13px] text-ink-secondary" dir="auto">{data.reason}</span> : undefined}
    >
      <div className="space-y-2 text-[13px] text-ink-secondary" data-meeting-status={data.status}>
        <div className="break-all">
          <a href={data.url} target="_blank" rel="noreferrer" className="text-accent-text underline-offset-2 hover:underline">{data.url}</a>
        </div>
        {data.supported && <div>{t("meeting.card.name", { name: data.displayName })}</div>}
        {pending && data.supported && (
          <div role="note" className="rounded-xl bg-ink/[0.05] px-3 py-2 text-ink">{t("meeting.card.consent")}</div>
        )}
        {data.endReason === "participant" && <div>{t("meeting.card.leftByParticipant")}</div>}
        {data.detail && data.endReason !== "participant" && (
          <div dir="auto" {...(pending ? { role: "alert", className: "text-danger" } : {})}>{data.detail}</div>
        )}
        {data.transcriptTail && data.transcriptTail.length > 0 && (
          <div aria-live="polite" className="rounded-xl bg-ink/[0.05] px-3 py-2">
            <div className="mb-1 text-[12px] font-medium text-ink-tertiary">
              {t("meeting.card.transcript")}{data.segments ? ` · ${t("meeting.card.segments", { count: data.segments })}` : ""}
            </div>
            {data.transcriptTail.map((line, index) => <p key={index} dir="auto" className="text-ink">{line}</p>)}
          </div>
        )}
        {error && <div role="alert" className="text-danger">{error}</div>}
      </div>
      {pending && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.supported && (
            <button type="button" className={ASK_PRIMARY_BUTTON} onClick={() => answer(true)}>{t("meeting.card.approve")}</button>
          )}
          <button type="button" className={secondary} onClick={() => answer(false)}>{t("meeting.card.decline")}</button>
          {data.supported && ownerRule && (orgPolicy.alwaysAllow ? (
            <button
              type="button"
              className={secondary}
              onClick={alwaysAllow}
              title={t("approval.action.alwaysAllowRuleHint", { name: botName, rule: ownerRule.description })}
              data-always-allow=""
              data-owner-rule="allow"
            >
              {t("approval.action.alwaysAllow")}
            </button>
          ) : (
            <span className="text-[11.5px] text-ink-tertiary" data-org-always-allow-off="">
              {t("approval.orgOnce")}
              {orgIssuer ? <>{" "}<a href={perspicaxConsoleUrl(orgIssuer)} target="_blank" rel="noreferrer noopener" data-perspicax-link="approvals" className="font-medium text-accent-text hover:underline">Perspicax</a></> : null}
            </span>
          ))}
        </div>
      )}
      {!pending && meetingCanLeave(data) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={leaving} className={secondary} onClick={() => void leave()}>
            <LogOut size={13} aria-hidden="true" /> {leaving ? t("meeting.card.leaving") : t("meeting.card.leave")}
          </button>
        </div>
      )}
    </AskCard>
  );
}
