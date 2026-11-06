// One header for every chat view (JC 2026-11-06, hotfix 0.8.57): the bot
// chat, a group, a split pane, a coding chat, a bot-to-bot conversation and
// a routine run all float the same bar over their transcript. No band of its
// own: the transcript scrolls under it and ChatEdgeFade softens it (#2343).
// The pill sits in the middle (40px, ChatPill), what goes back or closes at
// the left, the conversation's controls at the right.
//
// ChatBottomEdge is the matching bottom: a positioned dock whose fade rises
// above it over the transcript, like the chat's composer dock.
import type { CSSProperties, HTMLAttributes, MouseEventHandler, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ChatEdgeFade } from "./ChatEdgeFade";

/** Height the transcript keeps free at its top for the floating bar. */
export const CHAT_HEADER_BAR_PX = 52;
/** The transcript's top room under the bar (scroll content starts below it). */
export const CHAT_UNDER_BAR_PAD = "pt-[52px]";

type DataAttributes = { [key: `data-${string}`]: string | boolean | undefined };

export function ChatHeaderBar({
  start,
  center,
  children,
  className,
  startClassName,
  centerClassName,
  centerStyle,
  style,
  onClick,
  ...rest
}: {
  /** Back arrow or X, the thread title: left end. */
  start?: ReactNode;
  /** The pill, centered on the column. */
  center?: ReactNode;
  /** Controls at the right end. */
  children?: ReactNode;
  className?: string;
  startClassName?: string;
  centerClassName?: string;
  centerStyle?: CSSProperties;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
} & DataAttributes & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style" | "onClick">) {
  return (
    <div
      {...rest}
      data-chat-header-bar=""
      onClick={onClick}
      style={style}
      className={cn(
        "content-topbar",
        "@container/chathead absolute inset-x-0 top-0 z-[3] flex min-h-[52px] items-center justify-end gap-2 px-5 py-2.5",
        // Room for the drawer button, which overlays this corner below sm.
        "pl-11 sm:pl-5",
        className,
      )}
    >
      <ChatEdgeFade edge="top" />
      {start && <div data-chat-header-start="" className={cn("mr-auto flex min-w-0 max-w-[20%] items-center gap-1", startClassName)}>{start}</div>}
      <div
        data-chat-header-center=""
        className={cn("absolute left-1/2 top-1/2 flex max-w-[60%] -translate-x-1/2 -translate-y-1/2 items-center gap-2", centerClassName)}
        style={centerStyle}
      >
        {center}
      </div>
      {children}
    </div>
  );
}

/** The bottom of a chat view without the chat's composer dock (a window's
 * action row, or nothing): positioned over the transcript's end, with the
 * same bottom fade. Empty, it is a 0px edge whose fade still rises. */
export function ChatBottomEdge({ children, className, onClick, ...rest }: {
  children?: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
} & DataAttributes) {
  return (
    <div {...rest} data-chat-bottom-edge="" onClick={onClick} className={cn("relative z-[2] shrink-0", !children && "pointer-events-none h-0", className)}>
      <ChatEdgeFade edge="bottom" />
      {children}
    </div>
  );
}
