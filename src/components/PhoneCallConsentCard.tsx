// One-time acceptable-use consent before a bot may place phone calls for
// this person. Same AskCard shape as MeetingCard; the answer is a fixed
// label the server maps (shared/phone-call-consent.ts).
import { Phone } from "lucide-react";
import { useStore, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  PHONE_CALL_CONSENT_APPROVE,
  PHONE_CALL_CONSENT_DECLINE,
  type PhoneCallConsentCardData,
} from "../../shared/phone-call-consent";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_PRIMARY_BUTTON, AskCard, AskSettledLine } from "./AskCard";

/** Locale keys for PHONE_CALL_CONSENT_POINTS_EN (shared/phone-call-consent.ts). */
const POINT_KEYS = [
  "phoneCall.consent.point1",
  "phoneCall.consent.point2",
  "phoneCall.consent.point3",
] as const;

export function PhoneCallConsentCard({ botId, threadId, message }: {
  botId: string;
  botName: string;
  threadId: string;
  message: Message;
}) {
  const { dispatch } = useStore();
  const card = message.card;
  const data = card?.phoneCallConsent;
  if (!card || !data) return null;

  const pending = !card.answered && data.status === "pending";
  const title = t("phoneCall.consent.title");

  const answer = (allow: boolean) => {
    dispatch({
      type: "answerCard", botId, threadId, messageId: message.id,
      // Fixed English label; the server maps Accept/Decline (and fr) to allow/deny.
      answer: allow ? PHONE_CALL_CONSENT_APPROVE[0] : PHONE_CALL_CONSENT_DECLINE[0],
    });
  };

  if (!pending) {
    const accepted = data.status === "accepted" || Boolean(data.acceptedAt);
    return (
      <div data-phone-call-consent={data.status}>
        <AskSettledLine ariaLabel={title}>
          {accepted ? t("phoneCall.consent.accepted") : t("phoneCall.consent.declined")}
        </AskSettledLine>
      </div>
    );
  }

  return (
    <AskCard
      ariaLabel={title}
      icon={<Phone size={15} />}
      title={title}
      explanation={<span className="text-[13px] text-ink-secondary">{t("phoneCall.consent.body")}</span>}
    >
      <div className="space-y-2 text-[13px] text-ink" data-phone-call-consent={data.status}>
        <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
          {POINT_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={ASK_PRIMARY_BUTTON} onClick={() => answer(true)}>
            {t("phoneCall.consent.accept")}
          </button>
          <button type="button" className={`${ASK_CHIP} ${ASK_CHIP_IDLE}`} onClick={() => answer(false)}>
            {t("phoneCall.consent.decline")}
          </button>
        </div>
      </div>
    </AskCard>
  );
}

/** Settled status label for tests and gallery. */
export function phoneCallConsentStatusLabel(data: Pick<PhoneCallConsentCardData, "status" | "acceptedAt">): string {
  if (data.status === "accepted" || data.acceptedAt) return t("phoneCall.consent.accepted");
  if (data.status === "declined") return t("phoneCall.consent.declined");
  return t("phoneCall.consent.title");
}
