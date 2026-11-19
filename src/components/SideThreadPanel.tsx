// The side thread column (src/lib/side-thread.ts): one bot thread beside
// the main chat, in the same chat view in its compact form (ChatView's
// `side`), with its own header (the thread, Open in the main chat, Close),
// a resizable left edge (DockedPanelResize, its own stored width) and its
// own copy of the thread's messages. Below the docked width it covers the
// chat, like the other docked panels.
import { useEffect, useMemo } from "react";
import { Loader2, Maximize2, X } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import {
  closeSideThread,
  SIDE_THREAD_DEFAULT_WIDTH,
  SIDE_THREAD_MAX_WIDTH,
  SIDE_THREAD_MIN_WIDTH,
  SIDE_THREAD_WIDTH_KEY,
  sideThreadRedundant,
  useSideThread,
} from "@/lib/side-thread";
import { useSideTranscript } from "@/lib/use-side-transcript";
import { useShowThreads } from "@/lib/thread-preferences";
import { BotAvatar } from "./Avatar";
import { ChatView } from "./ChatView";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";

const SIDE_BOUNDS = {
  key: SIDE_THREAD_WIDTH_KEY,
  min: SIDE_THREAD_MIN_WIDTH,
  max: SIDE_THREAD_MAX_WIDTH,
  fallback: SIDE_THREAD_DEFAULT_WIDTH,
};

export function SideThreadPanel() {
  const side = useSideThread();
  const { state } = useStore();
  const redundant = side ? sideThreadRedundant(side, state) : false;
  // The main chat opened this very thread, or it is gone: nothing to show.
  useEffect(() => {
    if (redundant) closeSideThread();
  }, [redundant]);
  const bot = side ? state.bots.find((candidate) => candidate.id === side.botId) : undefined;
  if (!side || !bot || redundant) return null;
  return <SideThreadColumn key={`${side.botId}:${side.threadId}`} bot={bot} threadId={side.threadId} />;
}

function SideThreadColumn({ bot, threadId }: { bot: Bot; threadId: string }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const panel = useDockedPanelWidth(SIDE_BOUNDS);
  const transcript = useSideTranscript(threadId);
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  const title = task?.title?.trim() || t("task.newShort");
  // On screen in this column is read: with threads hidden it is the only
  // place this thread opens, so its unread must clear here.
  const unread = task?.unread === true;
  useEffect(() => {
    if (unread) api(`/api/bots/${bot.id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
  }, [unread, bot.id, threadId]);
  // The chat view reads a bot whose open thread is this one, with this
  // column's messages; the bot's other fields (its threads' busy state,
  // approvals, model) are the store's, so they stay live. hasMore and
  // loadOlder stay on this column's transcript: the store only pages the
  // selected thread.
  const sideBot = useMemo<Bot>(() => ({
    ...bot,
    threadId,
    messages: transcript.messages,
    activeLeafId: transcript.activeLeafId,
    hasMore: transcript.hasMore,
  }), [bot, threadId, transcript.messages, transcript.activeLeafId, transcript.hasMore]);
  const openInMain = () => {
    closeSideThread();
    dispatch({ type: "switchTask", botId: bot.id, threadId });
  };
  const header = (
    <div data-side-thread-header className="content-topbar absolute inset-x-0 top-0 z-[3] flex min-h-[52px] items-center gap-2 px-3 py-2.5">
      <BotAvatar bot={bot} state="idle" size={24} animated={false} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-[13.5px] font-medium leading-5 text-ink">{title}</span>
        <span className="truncate text-[11.5px] leading-4 text-ink-secondary">{bot.name}</span>
      </span>
      {/* Threads hidden: the one conversation never gives way to another
          thread, so this column is the only place this one opens. */}
      {showThreads && <button type="button" data-side-thread-open-main onClick={openInMain} aria-label={t("sideThread.openInMain")} title={t("sideThread.openInMain")} className={CIRCLE_BUTTON}>
        <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>}
      <button type="button" data-side-thread-close onClick={closeSideThread} aria-label={t("sideThread.close")} title={t("sideThread.close")} className={CIRCLE_BUTTON}>
        <X size={17} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
  return (
    <aside
      data-side-thread={threadId}
      aria-label={t("sideThread.aria", { title })}
      style={{ width: panel.width }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-pane-edge bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        if (target.closest("textarea, input, [role=menu], [role=dialog]")) return;
        closeSideThread();
      }}
    >
      <DockedPanelResizeHandle label={t("sideThread.resize")} panel={panel} />
      {!transcript.loaded ? (
        <>
          {header}
          {transcript.failed
            ? <div role="alert" className="flex flex-1 items-center justify-center px-6 pt-14 text-center text-[13px] text-ink-secondary">{t("sideThread.loadFailed")}</div>
            : <div role="status" className="flex flex-1 items-center justify-center pt-14 text-ink-secondary"><Loader2 size={18} className="animate-spin" aria-hidden="true" /><span className="sr-only">{t("sideThread.loading")}</span></div>}
        </>
      ) : (
        <ChatView bot={sideBot} side={{ header, label: t("sideThread.aria", { title }), loadOlder: transcript.loadOlder, loadingOlder: transcript.loadingOlder }} />
      )}
    </aside>
  );
}
