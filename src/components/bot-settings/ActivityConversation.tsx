// A task's own conversation, live, inside its window (2026-10-16: "I
// should also be able to dive into the current subagent's chat"): the real
// thread (its messages, tool calls, approvals and composer) in the chat
// view's compact form, the way the side thread column shows one. Same data
// as that column (useSideTranscript: newest page, older pages on scroll-up,
// then the live stream), so it follows the run while it goes; no new route.
// "Open the conversation" in the window's footer still moves the main chat there.
// #2719: under a delegation card in the chat, the same view with Close
// (onClose) instead, since the conversation stays where the person is.
import { useMemo } from "react";
import { Loader2, Maximize2, X } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useSideTranscript } from "@/lib/use-side-transcript";
import { BotAvatar } from "../Avatar";
import { ChatView } from "../ChatView";

export default function ActivityConversation({ botId, threadId, title, onOpenInMain, onClose }: {
  botId: string;
  threadId: string;
  title: string;
  /** Moves the main chat to this conversation (the activity window). */
  onOpenInMain?: () => void;
  /** Puts the view away (under a delegation card, where it opened in place). */
  onClose?: () => void;
}) {
  const { state } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const transcript = useSideTranscript(threadId);
  // The chat view reads a bot whose open thread is this one, with these
  // messages; the bot's other fields stay the store's, so they stay live.
  const threadBot = useMemo<Bot | null>(() => bot ? {
    ...bot,
    threadId,
    messages: transcript.messages,
    activeLeafId: transcript.activeLeafId,
    hasMore: transcript.hasMore,
  } : null, [bot, threadId, transcript.messages, transcript.activeLeafId, transcript.hasMore]);

  const header = (
    <div data-activity-conversation-header className="content-topbar absolute inset-x-0 top-0 z-[3] flex min-h-[52px] items-center gap-2 px-3 py-2.5">
      {bot && <BotAvatar bot={bot} state="idle" size={24} animated={false} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-[13.5px] font-medium leading-5 text-ink">{title}</span>
        {bot && <span className="truncate text-[11.5px] leading-4 text-ink-secondary">{bot.name}</span>}
      </span>
      {onOpenInMain && (
        <button type="button" data-activity-conversation-main onClick={onOpenInMain} aria-label={t("sideThread.openInMain")} title={t("sideThread.openInMain")} className={CIRCLE_BUTTON}>
          <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {onClose && (
        <button type="button" data-activity-conversation-close onClick={onClose} aria-label={bot ? t("delegation.workClose", { name: bot.name }) : t("common.close")} title={bot ? t("delegation.workClose", { name: bot.name }) : t("common.close")} className={CIRCLE_BUTTON}>
          <X size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <div data-activity-conversation={threadId} className="relative flex min-h-0 flex-1 flex-col">
      {!threadBot || transcript.failed ? (
        <>
          {header}
          <div role="alert" className="flex flex-1 items-center justify-center px-6 pt-14 text-center text-[13px] text-ink-secondary">{t("sideThread.loadFailed")}</div>
        </>
      ) : !transcript.loaded ? (
        <>
          {header}
          <div role="status" className="flex flex-1 items-center justify-center pt-14 text-ink-secondary">
            <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">{t("sideThread.loading")}</span>
          </div>
        </>
      ) : (
        <ChatView bot={threadBot} side={{ header, label: t("activity.conversation.aria", { title }), loadOlder: transcript.loadOlder, loadingOlder: transcript.loadingOlder }} />
      )}
    </div>
  );
}
