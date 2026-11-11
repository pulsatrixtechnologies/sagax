// The reply a bot is writing right now, growing in its bubble (Settings >
// Appearance > Conversation > "Show replies as they are written",
// src/lib/stream-replies-preference.ts). It reads the store's per-frame
// stream (useStreaming: the engine's text deltas, merged on the server per
// 50 ms and on this page per animation frame), so it is the only part of the
// conversation that re-renders while the words arrive. The Markdown is cut
// into finished blocks and the one still growing (splitLiveMarkdown): each
// finished block keeps its memoized renderer, only the last one is parsed
// again. When the reply is done the settled message takes its place in the
// same commit (the store clears the stream with the message frame), and the
// final text is what stays: notifications and the transcript read that one.
// Off, or an engine that does not stream: nothing here, the reply appears
// whole as before. A short text is not drawn here but in the working line
// (#3696, src/lib/live-text-place.ts): this bubble opens only once the text
// grows past it, so a note never shows as a bubble that a step then hides.
import { useLayoutEffect, useMemo, type MutableRefObject } from "react";
import { cn } from "@/lib/cn";
import { useChatBubbleWidthClasses, useChatRoomFitClass } from "@/lib/chat-bubble-width";
import { splitLiveMarkdown } from "@/lib/live-markdown-blocks";
import { prefersWideBubble } from "@/lib/rich-blocks";
import { liveTextPlace } from "@/lib/live-text-place";
import { useStreamReplies } from "@/lib/stream-replies-preference";
import type { MentionPeer } from "@/lib/mentions";
import { useStreamSelector } from "@/state/store-selector";
import { stripLeakedSystemHarnessMessages } from "../../shared/system-message-guard.ts";
import { ChatMarkdown } from "./ChatMarkdown";

/** What of a thread's in-flight text a reader sees: never a leaked harness line. */
export function liveReplyText(raw: string | undefined): string {
  return raw ? stripLeakedSystemHarnessMessages(raw) : "";
}

export function LiveReply({
  threadId,
  botId,
  mentionPeers,
  label,
  room = false,
  hidden = false,
  shownRef,
}: {
  /** the conversation whose in-flight text this draws */
  threadId: string | null | undefined;
  botId?: string;
  mentionPeers?: readonly MentionPeer[];
  /** a room's speaker, named above the bubble as its runs are */
  label?: string;
  /** a room's bubble measure (GroupView) */
  room?: boolean;
  /** on a call the words are spoken, not typed out */
  hidden?: boolean;
  /** set while live text is on screen: the settled reply then replaces it
   * without the pop-in a finished reply makes */
  shownRef?: MutableRefObject<boolean>;
}) {
  const enabled = useStreamReplies();
  // this thread's text only: another bot's stream does not render it (#3624)
  const raw = useStreamSelector((stream) => (threadId ? stream.streaming[threadId] ?? "" : ""));
  const text = enabled && !hidden ? liveReplyText(raw) : "";
  // #3696: a short text is written in the working line (TurnPresence); it
  // opens here once it grows past it, and stays (live-text-place.ts)
  const visible = Boolean(text.trim()) && liveTextPlace(text) === "bubble";
  useLayoutEffect(() => {
    if (visible && shownRef) shownRef.current = true;
  }, [visible, shownRef]);
  const blocks = useMemo(() => (visible ? splitLiveMarkdown(text) : []), [visible, text]);
  const wide = useMemo(() => visible && prefersWideBubble(text), [visible, text]);
  const bubbleWidths = useChatBubbleWidthClasses();
  const roomFit = useChatRoomFitClass();
  if (!visible) return null;
  return (
    <div data-live-reply="" className="flex w-full flex-col items-start">
      {label && <div className="mb-1 ps-1 text-[12px] font-medium text-ink-secondary">{label}</div>}
      <div
        data-chat-bubble
        aria-busy="true"
        className={cn(
          "rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink",
          room && !wide ? roomFit : bubbleWidths[wide ? "wide" : "fit"],
        )}
      >
        <div className="flex min-w-0 flex-col gap-2">
          {blocks.map((block, index) => (
            // a block's index is its identity: finished blocks never change
            <ChatMarkdown key={index} text={block} botId={botId} mentionPeers={mentionPeers} />
          ))}
        </div>
      </div>
    </div>
  );
}
