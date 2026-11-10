// The one way a transcript says "Go to conversation": a centered, quiet line
// (phrase, the bot's mark, the bot's name). Used by the collapsed bot-to-bot
// exchange and by the opened-thread receipt, so they cannot drift apart.
// Threads off (the unified chat, the default) draws none of it: no "Go to
// conversation", no "Open thread", no thread sheet (JC 2026-11-06, the
// "Sent work to Wren · Done" card had one under it).
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { mausInk, type MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { PartyAvatar } from "./PartyAvatar";

/** The centered row of a quiet transcript line (this one, the "Messaged"
 * line of a turn that wrote to other bots). */
export const QUIET_LINE_ROW = "flex justify-center py-1";
/** The line itself: small, muted, no bubble. */
export const QUIET_LINE = "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink-secondary";

/** A bot on a quiet line: its face, then its name in its ink. `tone="neutral"`
 * draws the name in the app's ink, one step brighter than the line, so only
 * the face carries color (the Messaged line, #3275). */
export function QuietLineParty({ bot, agentId, name, color, nameClassName, tone = "bot" }: {
  bot: { name: string; color: MausColor } & Partial<Bot>;
  agentId?: string;
  name: string;
  color: MausColor;
  nameClassName?: string;
  tone?: "bot" | "neutral";
}) {
  const neutral = tone === "neutral";
  const className = ["font-medium", neutral ? "text-ink" : "", nameClassName ?? ""].filter(Boolean).join(" ");
  return (
    <>
      <PartyAvatar id={agentId} bot={bot} size={16} />
      <span className={className} style={neutral ? undefined : { color: mausInk(color) }}>{name}</span>
    </>
  );
}

export function ConversationLink({
  bot,
  agentId,
  name,
  color,
  onClick,
  label,
  title,
  testId,
  attributes,
  compact = false,
  children,
}: {
  bot: { name: string; color: MausColor } & Partial<Bot>;
  /** The other end's id when it may be an outside agent (`agent:`): a
   * neutral icon stands in for the mascot. */
  agentId?: string;
  name: string;
  color: MausColor;
  onClick: () => void;
  label?: string;
  title?: string;
  testId?: string;
  attributes?: Record<string, string>;
  /** A left-aligned line in a list, not a centered one. */
  compact?: boolean;
  /** Rendered beside the line, e.g. an opened sheet. */
  children?: ReactNode;
}) {
  const showThreads = useShowThreads();
  if (!showThreads) return null;
  return (
    <div className={compact ? "flex justify-start py-0.5" : QUIET_LINE_ROW}>
      <button
        type="button"
        {...(testId ? { "data-testid": testId } : {})}
        {...attributes}
        onClick={onClick}
        {...(label ? { "aria-label": label } : {})}
        {...(title ? { title } : {})}
        className={`${QUIET_LINE} hover:bg-raised`}
      >
        <span>{t("chat.goToConversation")}</span>
        <QuietLineParty bot={bot} agentId={agentId} name={name} color={color} />
      </button>
      {children}
    </div>
  );
}
