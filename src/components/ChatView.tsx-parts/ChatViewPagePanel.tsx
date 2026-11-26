import type { Dispatch, RefObject } from "react";
import { AppWindow } from "lucide-react";
import { BotAvatar } from "../Avatar";
import { Composer } from "../Composer";
import { PageBotStatus, pageBotStatusLine } from "../PageComposerParts";
import { PageSurface } from "../PageViewer";
import { MenuItem } from "../bot-settings/FilesSection";
import { closePagePanel, openPage as openPageAt, renameOpenPage } from "@/lib/open-page";
import { withPageContext } from "@/lib/composer-attachments";
import type { PageContextRef } from "../../../shared/data-context";
import { PAGE_CHAT_SURFACE_DEFAULT, type PageChatSurface } from "@/lib/page-chat-layout";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { agentStateForBot, stateForBot } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Action, Bot, ConfigStatus, Message } from "@/state/store";
import { NewConversationInstead } from "./NewConversationInstead";

/** The in-place ask about a selected passage (#4099), as the person's
 * ordinary message in the bot's conversation: the page and the passage go in
 * its dataContext, and a sendId as the composer's own, so the message, its
 * page chip and the passage show in the chat at once (a busy bot queues it). */
export function pageAskSend(botId: string, text: string, page: PageContextRef): Action {
  const dataContext = withPageContext(undefined, text, { ...page, botId }, { botId });
  return { type: "send", botId, text, sendId: crypto.randomUUID(), ...(dataContext ? { dataContext } : {}) };
}

/** The in-place ask is offered only over this bot's own conversation, where
 * the person can write: a page they only read has no composer. */
export function pageAskOffered(canWrite: boolean | null | undefined, openBotId: string | undefined, botId: string): boolean {
  return canWrite !== false && (!openBotId || openBotId === botId);
}

/** Open page surface (stage cover or beside) with its optional docked composer. */
export function ChatViewPagePanel({
  bot,
  profile,
  state,
  dispatch,
  openPage,
  pageChatSurface,
  setPageChatSurface,
  pageChatWide,
  pageCover,
  pageStage,
  composerDockRef,
  messages,
  latestPageVersion,
  canWrite,
  replyTo,
  clearReply,
  consumeReply,
  restoreReply,
  lastUserMessage,
  lastUserMessageHasAttachments,
  setEditingId,
}: {
  bot: Bot;
  profile: Bot;
  state: { config: ConfigStatus | null | undefined };
  dispatch: Dispatch<Action>;
  openPage: {
    pageId: string;
    version?: number;
    title?: string;
    botId?: string;
    threadId?: string;
    openedAt?: number;
  };
  pageChatSurface: PageChatSurface;
  setPageChatSurface: (surface: PageChatSurface) => void;
  pageChatWide: boolean;
  pageCover: boolean;
  pageStage: boolean;
  composerDockRef: RefObject<HTMLDivElement | null>;
  messages: Message[];
  latestPageVersion: number | undefined;
  canWrite: boolean | null | undefined;
  replyTo: unknown;
  clearReply: () => void;
  consumeReply: () => unknown;
  restoreReply: (value: unknown) => void;
  lastUserMessage: Message | undefined;
  lastUserMessageHasAttachments: boolean;
  setEditingId: (id: string | null) => void;
}) {
  return (
    <div
      data-page-panel={openPage.pageId}
      data-page-surface-mode={pageChatSurface}
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-app",
        // Stage (default): cover the mounted chat (exact scroll on close).
        // Optional beside: fill the main frame; chat stays in the side column.
        pageCover ? "absolute inset-0 z-[6]" : "relative z-auto order-1 flex-1",
      )}
    >
      <PageSurface
        key={openPage.pageId}
        pageId={openPage.pageId}
        {...(openPage.version !== undefined ? { version: openPage.version } : {})}
        initialTitle={openPage.title}
        {...(latestPageVersion !== undefined ? { latestVersion: latestPageVersion } : {})}
        onClose={() => {
          setPageChatSurface(PAGE_CHAT_SURFACE_DEFAULT);
          closePagePanel(openPage.pageId);
        }}
        onChange={(next) => renameOpenPage(next.id, next.title)}
        className="h-full min-h-0"
        moreItems={(close) => (
          <>
            <MenuItem icon={<AppWindow size={14} />} label={t("pages.openWindow")} onClick={() => {
              close();
              if (!openPage.botId || !openPage.threadId) return;
              void openPageAt({ pageId: openPage.pageId, botId: openPage.botId, threadId: openPage.threadId, title: openPage.title ?? "" }, "window");
            }} />
          </>
        )}
        // The optional side transcript (the reference's canvas chat pane) is
        // the top bar's chat toggle (#4099); the page still covers the chat
        // by default, and on a narrow host it can only cover it, so the
        // toggle is not drawn there (PageSurface hides it while disabled).
        chat={{
          open: pageChatSurface !== "stage",
          disabled: !pageChatWide,
          onToggle: () => setPageChatSurface(pageChatSurface === "stage" ? "beside" : "stage"),
        }}
        // #4099: select text on the page and ask its bot about it, in place.
        // Only over this bot's own conversation, where the person can write;
        // the words go as their ordinary message there, with the page and the
        // passage, and the bot's new version is drawn in place.
        {...(pageAskOffered(canWrite, openPage.botId, bot.id) ? {
          ask: {
            avatar: <BotAvatar bot={bot} primary={isViewersPrimaryBot(bot, viewerActorId(state.config))} state={stateForBot({ ...bot, messages })} agentState={agentStateForBot({ ...bot, messages })} size={28} />,
            botName: bot.name,
            working: bot.busy === true,
            onSend: (text: string, page: PageContextRef) => dispatch(pageAskSend(bot.id, text, page)),
          },
        } : {})}
        footer={pageStage ? (
          <div
            ref={composerDockRef}
            data-composer-dock=""
            data-page-stage-chat="docked"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[3]"
          >
            <PageBotStatus
              status={pageBotStatusLine(messages, bot.busy === true, openPage.openedAt ?? 0)}
              name={bot.name}
              avatar={<BotAvatar bot={bot} primary={isViewersPrimaryBot(bot, viewerActorId(state.config))} state={stateForBot({ ...bot, messages })} agentState={agentStateForBot({ ...bot, messages })} size={22} />}
            />
            {canWrite === false ? (
              <NewConversationInstead onNew={() => dispatch({ type: "newTask", botId: bot.id })} />
            ) : (
              <Composer
                key={bot.threadId}
                bot={profile}
                aboutPage={openPage.title}
                replyTo={replyTo as never}
                onClearReply={clearReply}
                onConsumeReply={consumeReply as never}
                onRestoreReply={restoreReply as never}
                onEditLast={lastUserMessage && !lastUserMessageHasAttachments && !bot.busy && !lastUserMessage.id.startsWith("optimistic-")
                  ? () => setEditingId(lastUserMessage.id)
                  : undefined}
              />
            )}
          </div>
        ) : undefined}
      />
    </div>
  );
}
