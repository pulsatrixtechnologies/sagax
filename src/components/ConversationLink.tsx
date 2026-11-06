// The one way a transcript says "Go to conversation": a centered, quiet line
// (phrase, the bot's mark, the bot's name). Used by the collapsed bot-to-bot
// exchange and by the opened-thread receipt, so they cannot drift apart.
// Threads off (the unified chat, the default) draws none of it: no "Go to
// conversation", no "Open thread", no thread sheet (JC 2026-11-06, the
// "Sent work to Katarina · Done" card had one under it).
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { mausInk, type MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { PartyAvatar } from "./PartyAvatar";

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
    <div className={compact ? "flex justify-start py-0.5" : "flex justify-center py-1"}>
      <button
        type="button"
        {...(testId ? { "data-testid": testId } : {})}
        {...attributes}
        onClick={onClick}
        {...(label ? { "aria-label": label } : {})}
        {...(title ? { title } : {})}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-raised"
      >
        <span>{t("chat.goToConversation")}</span>
        <PartyAvatar id={agentId} bot={bot} size={16} />
        <span className="font-medium" style={{ color: mausInk(color) }}>{name}</span>
      </button>
      {children}
    </div>
  );
}
