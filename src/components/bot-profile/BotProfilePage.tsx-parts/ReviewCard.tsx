// Knowledge > To review (#3400, owner decision 2026-11-10): what the bot
// learned from use and waits for a decision before it applies it, one row
// each (its name, what it changes in one grey line), decided in place:
// Enable (or Update) and Decline answer the same card as the chat, so
// answering in one place settles the other, and a decision taken here
// leaves one quiet line in the chat. "Open in chat" shows the card itself.
// Nothing waits: the card is not drawn at all (owner, 2026-11-25,
// M-20261125-066); it stays only to say an error.
import { MessageSquare, Sparkles } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PILL } from "../../SettingsPrimitives";
import { CardRow, ProfileCard } from "./cards";

export interface ReviewEntry {
  id: string;
  name: string;
  gist: string;
  action?: "create" | "update";
  sha256?: string;
  /** the card in the chat this learning is decided on */
  card?: { threadId: string; requestId: string; messageId: string };
}

export function ReviewCard({ staged, canDecide, working, error, onDecide, onOpenChat }: {
  staged: readonly ReviewEntry[];
  /** kept for the callers; the card no longer draws a waiting state */
  loading: boolean;
  /** this viewer may answer the cards (the server still checks) */
  canDecide: boolean;
  /** the id being decided, or "" */
  working: string;
  error: string;
  onDecide: (entry: ReviewEntry, behavior: "allow" | "deny") => void;
  onOpenChat: (entry: ReviewEntry) => void;
}) {
  if (staged.length === 0 && !error) return null;
  return (
    <ProfileCard title={t("botProfile.review.title")} groupId="bot-profile-review">
      {staged.map((entry) => {
        const card = entry.card;
        const busy = working !== "";
        return (
          <CardRow
            key={entry.id}
            rowId={`review-${entry.id}`}
            icon={<Sparkles />}
            label={entry.name}
            state={entry.gist || null}
            action={card ? (
              <span className="flex shrink-0 items-center gap-1.5">
                {canDecide && entry.sha256 && (
                  <>
                    <button
                      type="button"
                      data-bot-profile-review-allow={entry.id}
                      disabled={busy}
                      onClick={() => onDecide(entry, "allow")}
                      aria-label={`${t(entry.action === "update" ? "botProfile.review.update" : "botProfile.review.enable")} ${entry.name}`}
                      className={cn(PILL, "shrink-0")}
                    >
                      {t(entry.action === "update" ? "botProfile.review.update" : "botProfile.review.enable")}
                    </button>
                    <button
                      type="button"
                      data-bot-profile-review-deny={entry.id}
                      disabled={busy}
                      onClick={() => onDecide(entry, "deny")}
                      aria-label={`${t("botProfile.review.decline")} ${entry.name}`}
                      className={cn(PILL, "shrink-0")}
                    >
                      {t("botProfile.review.decline")}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  data-bot-profile-review-open={entry.id}
                  onClick={() => onOpenChat(entry)}
                  aria-label={`${t("botProfile.review.openInChat")}: ${entry.name}`}
                  title={t("botProfile.review.openInChat")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
                >
                  <MessageSquare size={15} aria-hidden="true" />
                </button>
              </span>
            ) : undefined}
          />
        );
      })}
      {error && <p role="alert" className="px-4 pb-2 text-[12px] leading-4 text-danger">{error}</p>}
    </ProfileCard>
  );
}
