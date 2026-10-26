import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MessageHoverActions, MessageMenuItem, type HoverReactions } from "./MessageHoverActions";

export { MessageMenuItem };

/** The quiet controls beside a 1:1 message: react, reply and "…" in a row
 * (MessageHoverActions.tsx, Grok Bot's tray, JC 2026-10-15), the time under
 * them. The "…" menu starts with the quick reactions, then Reply, Copy,
 * Copy request ID, then the entries passed as children (edit, regenerate,
 * pin), then the `view` entries (read aloud, raw markdown).
 *
 * Hover or keyboard focus on the message reveals it, touch screens always
 * show it. It always takes its room, shown or not, so the message never
 * moves. `visible` keeps it out while a mode the menu turned on needs to be
 * seen (raw markdown, a message being read aloud). */
export function MessageBar({
  side,
  time,
  copy,
  onReply,
  requestId,
  react,
  visible = false,
  persistent,
  children,
  view,
}: {
  side: "user" | "bot";
  time: string;
  /** The message's text, when it has any to copy. */
  copy?: string;
  onReply?: () => void;
  /** What "Copy request ID" copies. */
  requestId?: string;
  react?: HoverReactions;
  visible?: boolean;
  /** Controls of a mode the person turned on, kept in the row. */
  persistent?: ReactNode;
  /** The menu's own entries, as MessageMenuItem. */
  children?: ReactNode;
  /** The entries that change how the message is shown (read aloud, raw
   * markdown), in the menu's last section. */
  view?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mirrored = side === "user";
  return (
    <div
      data-testid="message-actions"
      data-message-bar
      data-open={open ? "true" : undefined}
      className={cn(
        "relative flex shrink-0 select-none flex-col gap-0.5 self-end pb-0.5",
        mirrored ? "items-end" : "items-start",
        open || visible
          ? "opacity-100"
          : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
      )}
    >
      <MessageHoverActions side={side} onReply={onReply} copy={copy} requestId={requestId} react={react} persistent={persistent} onOpenChange={setOpen} view={view}>
        {children}
      </MessageHoverActions>
      <span data-message-time className="select-none px-1 text-[11px] tabular-nums leading-4 whitespace-nowrap text-ink-tertiary">
        {time}
      </span>
    </div>
  );
}
