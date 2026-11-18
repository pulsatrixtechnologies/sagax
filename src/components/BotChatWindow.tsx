// A bot's chat in a window of its own (the bot row menu's "New window",
// issue #4639): the page behind `/artifact-window#bot=<id>&artifact=chat:<id>`
// (src/lib/chat-windows.ts). It is the app's own chat view, header and
// composer included (the bot's mascot and name, the "..." menu, "Message
// <bot>"), with no sidebar and nothing else around it: the same ChatView the
// main window draws, so the conversation, the live stream and every action
// are the main window's. The window has its own store, like any other tab of
// the app, and the same sign-in.
import { useEffect } from "react";

import { ChatView } from "@/components/ChatView";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { openBot } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";

/** macOS draws its traffic lights over the chat header in this window (the
 * desktop window's hidden inset title bar): the header keeps clear of them. */
function insetChrome(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as { artifactWindowSelf?: unknown }).artifactWindowSelf) && /Mac/i.test(globalThis.navigator?.platform ?? "");
}

export function BotChatWindow({ botId }: { botId: string }) {
  const dispatch = useStoreDispatch();
  const bot = useStoreSelector((current) => current.bots.find((candidate) => candidate.id === botId));
  const selectedId = useStoreSelector((current) => current.selectedId);
  const showThreads = useShowThreads();
  // This window's store shows this bot, opened as its row would (openBot).
  useEffect(() => {
    if (bot && selectedId !== botId) openBot(dispatch, bot, showThreads);
  }, [bot, botId, selectedId, showThreads, dispatch]);
  useEffect(() => {
    if (bot?.name) document.title = bot.name;
  }, [bot?.name]);
  if (!bot) {
    return (
      <main className="flex h-dvh items-center justify-center bg-app px-6 text-center text-[13px] text-ink-secondary" role="status">
        {t("chatWindow.loading")}
      </main>
    );
  }
  return (
    <ConfirmProvider>
      <ThreadRefsProvider>
        <main
          data-bot-chat-window={botId}
          data-inset={insetChrome() || undefined}
          className="app-content-frame relative flex h-dvh min-w-0 flex-col bg-app text-ink data-[inset=true]:[&_[data-chat-header-bar]]:pl-[84px]"
        >
          <ChatView bot={bot} />
        </main>
      </ThreadRefsProvider>
    </ConfirmProvider>
  );
}
