import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";

/** What a channel shows for `waiting-on-owner`. No Allow/Deny: those stay
 * on the admin's card. The person who started the turn can still Cancel
 * (#2042), which uses the same interrupt path as Stop / Escape / typed stop. */
export function OwnerWait({
  ownerName,
  onCancel,
}: {
  ownerName: string;
  /** Stops the pending approval and its turn. Only for the person who started it. */
  onCancel?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
      <p className="min-w-0 text-[15px] leading-relaxed text-ink-secondary">
        {`En attente de ${ownerName}`}
      </p>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          data-owner-wait-cancel=""
          className="shrink-0 rounded-md px-1 py-1 text-[12.5px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
        >
          {t("approval.action.cancelTurn")}
        </button>
      ) : null}
    </div>
  );
}

/** What someone who is not the approval audience sees once the card is
 * settled (`owner-settled`): who answered and the verdict, nothing of the
 * request. A dismissed or expired card shows nothing, as before. */
export function OwnerSettled({ message }: { message: Pick<Message, "card" | "ownerName"> }) {
  const card = message.card;
  if (!card?.answered) return null;
  const by = card.answeredBy;
  const name = (by?.kind === "session" && by.name.trim() ? by.name : message.ownerName?.trim()) || t("approval.someone");
  return (
    <p className="px-4 py-2.5 text-[15px] leading-relaxed text-ink-secondary">
      {t(card.answered === "allow" ? "approval.ownerSettled.allowed" : "approval.ownerSettled.denied", { name })}
    </p>
  );
}
