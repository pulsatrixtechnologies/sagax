import { citationReplyAction } from "@/lib/citation-reply";
import { WorkingDots } from "@/components/WorkingIndicator";
import { BotAvatar } from "../Avatar";
import { TurnPresence } from "../TurnPresence";
import { LiveReply } from "../LiveReply";
import { ultracodeFromSelection } from "@/lib/ultracode-chrome";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { agentStateForBot, stateForBot } from "@/lib/mascot";
import { askText, runSkill, skillPrompt } from "@/lib/verify-steps";
import { appendComposerDraft, appendDraftAttachments } from "@/lib/drafts";
import { useChatColumnClass } from "@/lib/chat-bubble-width";
import { CitationSelectionToolbar } from "../CitationUI";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { Composer } from "../Composer";
import { BackgroundEffectLayer } from "../BackgroundEffectLayer";
import { ConfidentialBanner } from "../ConfidentialBanner";
import { ConversationGalleryProvider } from "../ConversationGallery";
import { VerifyCard } from "../VerifyCard";
import { PageBotStatus, pageBotStatusLine } from "../PageComposerParts";
import { RailAligned, useRailFits } from "../dev-pods/DevPods";
import { ChatWindowProvider } from "../BotHeaderPill";
import { JumpToLatestPill } from "../JumpToLatestPill";
import { EarlierConversationList } from "../BotConversations";
import { ExchangeColumnProvider } from "../BotExchangeChip";
import { TranscriptAnnouncer } from "../TranscriptAnnouncer";
import { ThreadLinkContext } from "@/components/ThreadLinkMenu";
import { ChatRowsContext } from "./types";
import { ChatBusyContext } from "../MessageActions";
import { LiveToolsContext, LiveTurnsContext } from "@/hooks/use-live-tool-ids";
import { MessagesList } from "./MessagesList";
import { EmptyChat } from "./chips";
import { FreshTopicDivider, PreviousTopicsLine, StreamEarlierTopics, TopicDivider } from "./stream";
import { NewConversationInstead } from "./NewConversationInstead";
import { ChatViewBanners } from "./ChatViewBanners";
import { ChatViewHeader } from "./ChatViewHeader";
import { ChatViewPagePanel } from "./ChatViewPagePanel";
import { ChatViewSheets } from "./ChatViewSheets";
import { ChatEdgeFade } from "@/components/ChatEdgeFade";
import { ThoughtsPanelHost } from "../ThoughtsPanel";
import { HeavyLeaderContext } from "../HeavyTeamRow";
import { useState } from "react";
import { createPinnedHold, PinnedHoldContext } from "@/lib/pinned-waiting";

/** Chat chrome: header, banners, transcript, composer, page panel. */
export function ChatViewShell(m: Record<string, any>) {
  const {
    side, bot, profile, storeBots, engine, state, dispatch,
    showInspector, advanced, remoteClient, showThreads, confidential, privateHint,
    exchangeColumnNode, exchangeColumnRef, pageHostRef, pageChatWide, pageChatSurface, setPageChatSurface,
    openPage, pageBeside, pageCover, pageStage, pageOpenerRef, composerDockRef, composerDock,
    backgroundEffect, canWrite, computerStarting, findOpen, setFindOpen,
    replyTo, clearReply, consumeReply, restoreReply, selectReply,
    autoPauseSettled, resumeAutoPaused,
    headerDragProps, headerNoDragStyle, controlsShiftStyle, macInset, browser, panelOpen, pillPanelOpen, togglePanelFromPill, dataItem,
    messages, lookups, seenRow, recordedRun, canSaveRun, setRunDismissed, firstRunStep,
    scrollRef, transcriptRef, topSentinelRef, transcriptKey, following, followRef,
    windowedMessages, hiddenCount, laterCount, olderPending, showLater, jumpToLatest, scrollHandlers,
    runCardOpen, lastBotTextId, unreadDivider,
    mentionPeers, rows, place, liveTools, liveTurns, busy,
    currentTask, streamOn, streamHasEarlier, askedFresh, resumeTopic, newTopicBack, backFromNewTopic, streamReach, clearStreamReach,
    quoteEarlier, streamEngine, streamDrawn, earlierConversations, conversationsOpen, toggleConversations,
    editingId, setEditingId, startEdit, cancelEdit, submitEdit,
    lastUserMessage, lastUserMessageHasAttachments, activity, onCall, liveShown, popping, presenceVisible,
    announcement, busySince, regenerate, threadLink, latestPageVersion, botPill, chatHeader, chatWindow, bubbleStyle, Root, preview,
  } = m;
  const railFits = useRailFits(scrollRef, runCardOpen);
  const chatColumnClassName = useChatColumnClass();
  // #3681: this view's composer tells its transcript what its pinned card
  // holds; the transcript draws no card for those while they wait
  const [pinnedHold] = useState(createPinnedHold);

  const runCard = runCardOpen && firstRunStep ? (
    <RailAligned className="pointer-events-none pb-2">
      <div className="pointer-events-auto w-full min-w-0">
        <VerifyCard
          key={transcriptKey}
          steps={recordedRun}
          canSave={canSaveRun}
          skill={runSkill(messages, recordedRun)}
          onDismiss={() => setRunDismissed((current: ReadonlyMap<string, string>) => new Map(current).set(transcriptKey, firstRunStep.id))}
          onSave={() => {
            appendComposerDraft(`bot:${bot.id}:${bot.threadId}`, skillPrompt(recordedRun, askText(messages)));
            composerDockRef.current?.querySelector("textarea")?.focus();
          }}
        />
      </div>
    </RailAligned>
  ) : null;
  return (
<PinnedHoldContext value={pinnedHold}>
<ThreadLinkContext value={threadLink}>
    <ChatWindowProvider value={chatWindow}>
    <ExchangeColumnProvider node={exchangeColumnNode}>
    <Root
      ref={pageHostRef}
      aria-label={side?.label}
      data-side-chat={side ? "" : undefined}
      data-page-beside={pageBeside ? "" : undefined}
      data-page-cover={pageCover ? "" : undefined}
      style={bubbleStyle}
      className={cn(
        "app-glow relative isolate flex h-full min-w-0 flex-1 bg-app",
        // Host-width beside/cover (not viewport md:): split panes stay correct.
        pageBeside ? "flex-row" : "flex-col",
      )}
    >
      <div
        ref={exchangeColumnRef}
        data-chat-column=""
        inert={pageCover ? true : undefined}
        className={cn(
          // Exchange sheet portals here (absolute inset-0), never over the page.
          "relative isolate flex min-h-0 min-w-0 flex-1 flex-col",
          pageBeside && "order-2 w-[min(26rem,38%)] max-w-[28rem] flex-none border-l border-pane-edge",
        )}
      >
      <ChatViewHeader
        side={side}
        bot={bot}
        state={state}
        dispatch={dispatch}
        botPill={botPill}
        chatHeader={chatHeader}
        headerDragProps={headerDragProps}
        headerNoDragStyle={headerNoDragStyle}
        controlsShiftStyle={controlsShiftStyle}
        macInset={macInset}
        browser={browser}
        panelOpen={panelOpen}
        pillPanelOpen={pillPanelOpen}
        onTogglePanel={togglePanelFromPill}
        showInspector={showInspector}
        advanced={advanced}
        remoteClient={remoteClient}
        showThreads={showThreads}
        confidential={confidential}
        messages={messages}
        dataItem={dataItem}
      />

      <div className="content-card-body flex min-h-0 flex-1 flex-col">
      <ChatViewBanners
        side={side}
        bot={bot}
        profile={profile}
        state={state}
        dispatch={dispatch}
        showThreads={showThreads}
        confidential={confidential}
        privateHint={privateHint}
        findOpen={findOpen}
        setFindOpen={setFindOpen}
        streamOn={streamOn}
        remoteClient={remoteClient}
        messages={messages}
        autoPauseSettled={autoPauseSettled}
        resumeAutoPaused={resumeAutoPaused}
      />


      {/* Messages + composer share one pane so bubbles scroll into the pill
          instead of dying on a rectangular clip above a black dock. */}
      <div className="relative min-h-0 flex-1">
      {/* Behind the transcript, which is positioned only while the field is
          on so it paints over the canvas (BackgroundEffectLayer.tsx). */}
      <BackgroundEffectLayer paneRef={scrollRef} effect={backgroundEffect} />
      <div
        ref={scrollRef}
        data-virtual-root=""
        className={cn("h-full overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 [overflow-anchor:none]", backgroundEffect && "relative")}
        {...scrollHandlers}
      >
        <div
          ref={transcriptRef}
          inert={preview ? true : undefined}
          aria-busy={preview ? true : undefined}
          className={cn(chatColumnClassName, "pt-14")}
          style={{ paddingBottom: composerDock.pad }}
          role="log"
          // off: a polite log re-reads every tick and chip while the bot
          // works; TranscriptAnnouncer below speaks once when it is done
          aria-live="off"
          aria-label={t("chat.conversationWith", { name: bot.name })}
        >
          {/* The one conversation: the earlier topics above the live one,
              once the live one is read back to its first message; the
              topic before loads on scroll-up. An asked-for New topic
              clears to the empty greeting with Back. */}
          {askedFresh ? (
            <>
              <FreshTopicDivider onResume={resumeTopic} />
              <EmptyChat bot={bot} />
            </>
          ) : (
            <>
          {newTopicBack && <FreshTopicDivider onResume={backFromNewTopic} />}
          {earlierConversations.length > 0 && <PreviousTopicsLine open={conversationsOpen} onToggle={toggleConversations} />}
          {conversationsOpen && earlierConversations.length > 0 && <EarlierConversationList self={bot} rows={earlierConversations} bots={storeBots} />}
          {streamDrawn && (
            <>
              <StreamEarlierTopics bot={bot} rows={rows} place={place} engine={streamEngine} scrollRef={scrollRef} followRef={followRef} reach={streamReach} onReached={clearStreamReach} onQuote={quoteEarlier} />
              {currentTask && <TopicDivider task={currentTask} />}
            </>
          )}
          {/* Reverse infinite scroll sentinel and smooth loading indicator */}
          {olderPending ? (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-ink-tertiary">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span>{t("chat.loadingEarlier")}</span>
            </div>
          ) : hiddenCount > 0 || bot.hasMore ? (
            <div ref={topSentinelRef} className="h-2 w-full pointer-events-none" aria-hidden="true" />
          ) : null}
          {windowedMessages.length === 0 && !bot.busy && (!streamHasEarlier || !streamDrawn) && <EmptyChat bot={bot} />}
          <ChatRowsContext.Provider value={rows}><LiveToolsContext value={liveTools}><LiveTurnsContext value={liveTurns}><ChatBusyContext value={busy}><HeavyLeaderContext value={bot}>
            <ConversationGalleryProvider>
            <MessagesList
              confidential={confidential}
              messages={windowedMessages}
              transcript={messages}
              lookups={lookups}
              place={place}
              pinnedMessageId={bot.pinnedMessageId}
              editingId={editingId}
              lastBotTextId={lastBotTextId}
              emergingId={popping}
              canRetryLast={!bot.busy && Boolean(lastUserMessage)}
              engine={engine}
              unreadDividerId={unreadDivider.messageId}
              unreadDividerFading={unreadDivider.fading}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onSubmitEdit={submitEdit}
              onRegenerate={regenerate}
              onReply={selectReply}
              seen={seenRow}
            />
            </ConversationGalleryProvider>
          </HeavyLeaderContext></ChatBusyContext></LiveTurnsContext></LiveToolsContext></ChatRowsContext.Provider>
          {laterCount > 0 && (
            <div className="flex justify-center">
              <button
                onClick={showLater}
                className="ui-pill"
              >
                {t("chat.showLater", { count: laterCount })}
              </button>
            </div>
          )}
            </>
          )}
          {computerStarting && (
            <div className="flex justify-start">
              <div className="ui-pill">
                <WorkingDots size={3.5} />
                {computerStarting}
              </div>
            </div>
          )}
          <LiveReply threadId={bot.threadId} botId={bot.id} mentionPeers={mentionPeers} hidden={onCall} shownRef={liveShown} />
        </div>
      </div>

      <TranscriptAnnouncer threadKey={transcriptKey} snapshot={announcement} />
      {/* #4901: the Thoughts panel of a Heavy run, docked in the right-hand slot */}
      <ThoughtsPanelHost messages={messages} busy={Boolean(busy)} />

      {/* #2149: the dev context pods (</>) live only in a coding window
          (CodingChat), never in the plain chat. */}

      {/* Reading scrollback — one tap back to the end, streaming or not.
          Hidden only while a phone page covers the chat; desktop keeps it
          in the side pane. */}
      {!following && !pageCover && (
        <JumpToLatestPill onClick={jumpToLatest} bottom={composerDock.height + 16} scrollRef={scrollRef} />
      )}

      {runCard && railFits && (
        <div
          data-run-overlay=""
          className="pointer-events-none absolute inset-x-0 z-[2]"
          style={{ bottom: composerDock.height }}
        >
          {runCard}
        </div>
      )}
      {/* Keyed by task: each conversation keeps its own draft and a failed
          request can restore the old task without spilling into the newly
          selected one. ArrowUp-to-edit stays gated on busy because editing
          rewinds the thread, which a live turn forbids (the server 409s it).
          Stage mode docks this composer on the page (measured HTML path);
          beside keeps it in the side column. */}
      {!pageStage && (
      <div ref={composerDockRef} data-composer-dock="" className="pointer-events-none absolute inset-x-0 bottom-0 z-[2]">
      <ChatEdgeFade edge="bottom" />
      {confidential && <ConfidentialBanner position="bottom" className="mb-1" />}
      {/* Optional beside: bot status above the side-pane composer. */}
      {pageBeside && openPage && (
        <PageBotStatus
          status={pageBotStatusLine(messages, bot.busy === true, openPage.openedAt ?? 0)}
          name={bot.name}
          avatar={<BotAvatar bot={bot} primary={isViewersPrimaryBot(bot, viewerActorId(state.config))} state={stateForBot({ ...bot, messages })} agentState={agentStateForBot({ ...bot, messages })} size={22} />}
        />
      )}
      {/* The pane is too narrow for the side column: the card would cover the
          messages, so it joins the dock. The transcript pad (measured from the
          dock) then keeps the last message clear of it. */}
      {runCard && !railFits && <div data-run-card-docked="">{runCard}</div>}
      {/* JC 2026-11-06: the working line (dots or mascot, phrase, timer) sits
          at the bottom of the chat, just above the composer, on the message
          column, whatever the scroll. Part of the dock, so the transcript pad
          (measured from the dock) keeps the last message clear of it. */}
      <div data-turn-presence-slot="" className="px-4 [&:not(:has(.turn-presence))]:hidden">
        <div className={cn(chatColumnClassName, "pb-1.5")}>
          <TurnPresence
            ultracode={ultracodeFromSelection(bot.modelSelection)}
            bot={bot}
            streamThreadId={bot.threadId}
            visible={presenceVisible}
            phrases={activity.phrases}
            phase={activity.phase}
            quietSince={activity.stepSince ?? null}
            seed={`${bot.id}:${bot.threadId ?? ""}:${busySince ?? ""}`}
            since={busySince}
            answering={popping !== null}
          />
        </div>
      </div>
      {canWrite === false ? (
        <NewConversationInstead onNew={() => dispatch({ type: "newTask", botId: bot.id })} />
      ) : (
      <Composer
        key={bot.threadId}
        bot={profile}
        // back from a page: focus returns to what opened it, not here
        focusOnOpen={pageOpenerRef.current === null}
        replyTo={replyTo}
        onClearReply={clearReply}
        onConsumeReply={consumeReply}
        onRestoreReply={restoreReply}
        onEditLast={lastUserMessage && !lastUserMessageHasAttachments && !bot.busy && !lastUserMessage.id.startsWith("optimistic-")
          ? () => setEditingId(lastUserMessage.id)
          : undefined}
        onRetryLast={regenerate}
      />
      )}
      {canWrite !== false && (
      <CitationSelectionToolbar
        key={`${bot.id}:${bot.threadId}`}
        viewportRef={scrollRef}
        onReply={(citation) => dispatch(citationReplyAction(citation, "bot", bot.id, bot.threadId))}
        onAdd={(citation) => appendDraftAttachments(`bot:${bot.id}:${bot.threadId}`, [citation])}
      />
      )}
      </div>
      )}
      </div>
      </div>
      </div>

      {openPage && (
        <ChatViewPagePanel
          bot={bot}
          profile={profile}
          state={state}
          dispatch={dispatch}
          openPage={openPage}
          pageChatSurface={pageChatSurface}
          setPageChatSurface={setPageChatSurface}
          pageChatWide={pageChatWide}
          pageCover={pageCover}
          pageStage={pageStage}
          composerDockRef={composerDockRef}
          messages={messages}
          latestPageVersion={latestPageVersion}
          canWrite={canWrite}
          replyTo={replyTo}
          clearReply={clearReply}
          consumeReply={consumeReply}
          restoreReply={restoreReply}
          lastUserMessage={lastUserMessage}
          lastUserMessageHasAttachments={lastUserMessageHasAttachments}
          setEditingId={setEditingId}
        />
      )}
    </Root>
    <ChatViewSheets
      side={side}
      state={state}
      storeBots={storeBots}
      dispatch={dispatch}
    />
    </ExchangeColumnProvider>
    </ChatWindowProvider>
    </ThreadLinkContext>
</PinnedHoldContext>
  );
}
