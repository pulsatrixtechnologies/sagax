// A room: several bots + you in one shared thread. The sidebar and call view
// carry the personality; avatars inside the room stay still so a busy group
// does not become a wall of competing motion. Plain messages go to the room's
// default responder; @mentions override that routing.
import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { Pin, X } from "lucide-react";
import {
  openRoutineRun,
  type Group,
} from "@/state/store";
import { TurnTimingLine } from "./TurnTimingLine";
import { groupNudgeTarget } from "@/lib/group-nudge";
import { peopleDmPeer } from "@/lib/people-dm";
import { splitBesideMain } from "@/lib/split-view";
import { defaultResponderName, jevRoomRoutingOn } from "@/lib/group-routing";
import { openSettings } from "@/lib/settings-link";
import { useReportRead, useThreadReads } from "@/lib/read-receipts-feed";
import { ChatErrorBanner, ChatNotice, ChatReconnectBanner, ChatStaleBanner } from "./ChatErrorBanner";
import { ChatFindBar } from "./ChatFindBar";
import { ConversationTurnLimit } from "./ConversationTurnLimit";
import { GroupTaskPicker, PersonThreadPicker, ThreadReturnLink } from "./TaskPicker";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { AccessCard } from "./AccessCard";
import { TransientNotice } from "./TransientNotice";
import { isRoutineAutoPausedNotice } from "../../shared/transient-notices";
import { autoPausedRoutineToResume, routineAutoPauseSettled } from "@/lib/transient-notice";
import { RoutineRunCard } from "./RoutineRunCard";
import { GoalRunHeaderChip } from "./GoalRunCard";
import type { SideChat } from "./ChatView.tsx-parts/sideChat";
import { GroupCallOverlay } from "./GroupCallView";
import { GroupPanel, PanelSection } from "./GroupPanel";
import { LeaveGroupDialog } from "./LeaveGroupDialog";
import { ExchangeColumnProvider, useExchangeColumn } from "./BotExchangeChip";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { cn } from "@/lib/cn";
import { useComposerDockPad } from "@/lib/composer-dock";
import { useTranscriptViewport } from "@/hooks/use-transcript-viewport";
import { useUnreadDivider } from "@/hooks/use-unread-divider";
import { useReplyDraft } from "@/lib/drafts";
import { citationPreviewText } from "@/lib/citations";
import { useActiveLocale } from "@/lib/render-reads";

import { RoomToolChip } from "./GroupView.tsx-parts/RoomToolChip";
import { Transcript } from "./GroupView.tsx-parts/Transcript";
import { RoutedByLine } from "./GroupView.tsx-parts/RoomTextMessage";
import {
  DefaultResponderSelect,
  RoomMentionAll,
  RoomWorkingFolder,
  roomFolderEditable,
} from "./GroupView.tsx-parts/RoomSettings";
import { useGroupLiveTail } from "./GroupView.tsx-parts/useGroupLiveTail";
import { useGroupRoomModel } from "./GroupView.tsx-parts/useGroupRoomModel";
import { GroupRoomRoster } from "./GroupView.tsx-parts/GroupRoomRoster";
import { GroupRoomTranscriptPane } from "./GroupView.tsx-parts/GroupRoomTranscriptPane";
import { groupRoomIdentity } from "./GroupView.tsx-parts/groupRoomIdentity";
import { RoomHoldsBanner } from "./GroupView.tsx-parts/RoomHoldsBanner";
import { ChatHeaderBar } from "@/components/ChatHeaderBar";
import { withoutLeakedTokens } from "@/lib/leaked-tokens";

export { RoomToolChip, Transcript, RoutedByLine, DefaultResponderSelect, RoomWorkingFolder, roomFolderEditable, RoomHoldsBanner };

/** A group in a section of the split view (#1504) passes `pane`: its own
 * header in place of the group's, and none of the window-wide parts (calls,
 * ⌘F, the app's banners, the group panel), which stay with the main chat. */
export function GroupView({ group: stored, pane }: { group: Group; pane?: SideChat }) {
  "use memo";
  const roomShowThreads = useShowThreads();
  // A direct conversation between two people (server/people/people-dms.ts) runs on
  // the single-thread path of a bot-to-bot channel: no panel, no tasks. It
  // reads as the other person.
  const group = useMemo(() => (stored.peopleDm ? { ...stored, dm: true } : stored), [stored]);
  const model = useGroupRoomModel(group);
  const {
    state, dispatch, remoteClient, members, ownsRoom, editable, folderEditable, mayLeave,
    orgPeople, canAddRosterBot, canManageRoster, manageMembersButton, viewerId,
  } = model;
  const directPeople = orgPeople;
  const peer = peopleDmPeer(stored, viewerId, directPeople);
  const roomNudge = groupNudgeTarget(stored, viewerId, state.config?.profile?.email);
  const locale = useActiveLocale();
  // Same caption handling as ChatView: drag on the header (macOS and
  // Windows), and on Windows shift the right-hand controls below the
  // renderer-drawn caption buttons.
  const { dragProps: headerDragProps, noDragStyle: headerNoDragStyle, controlsShiftStyle } = useCaptionChrome();
  // Pulsatrix Light's navy top band mirrors the sidebar's own macOS-inset
  // strip, so the two stay vertically aligned; every other skin ignores it.
  const { macInset, browser } = useMacInsetChrome();
  const { node: exchangeColumnNode, ref: exchangeColumnRef } = useExchangeColumn();
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerDock = useComposerDockPad(composerDockRef);
  // The group panel shares the bot panel's slot: one open flag in the store.
  // A split-view section's panel (panelOwner) holds the slot instead. A
  // group section's own panel (pane.panel) portals to the window's right
  // edge (App's panel slot), where every panel opens.
  const panelOpen = !group.dm && (pane ? pane.panel?.open === true : state.settingsOpen && !state.panelOwner);
  const panelSlot = pane?.panel?.slot ?? null;
  const placePanel = (node: ReactNode) => (panelSlot ? createPortal(node, panelSlot) : node);
  const [findOpen, setFindOpen] = useState(false);
  const { replyTo, selectReply, clearReply, consumeReply, restoreReply } = useReplyDraft(
    group.threadId,
    `group:${group.id}:${group.threadId}`,
    group.messages,
  );
  useEffect(() => setFindOpen(false), [group.threadId]);
  useEffect(() => {
    if (pane) return;
    const onFind = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, [pane]);

  // Seen by (src/lib/read-receipts-feed.ts): who has read what, live, and
  // this person's own position while the window has focus.
  const threadReads = useThreadReads(group.threadId);
  // The task's goal, while it runs: the header carries a reminder that
  // brings its card into view.
  const activeGoalMessage = useMemo(() => {
    const latest = [...group.messages].reverse().find((message) => message.kind === "goal.run" && message.goalRun);
    return latest?.goalRun?.status === "working" ? latest : undefined;
  }, [group.messages]);
  const [leaving, setLeaving] = useState(false);
  const {
    speaker, activity, onCall, liveShown, popping, presenceVisible, presenceSpeaker, announcement,
    speakersElsewhere, threadSpeaker,
  } = useGroupLiveTail(group, members);

  // A reply stored as only `<|eos|>` does not show (src/lib/leaked-tokens.ts).
  const shownMessages = useMemo(() => withoutLeakedTokens(group.messages), [group.messages]);
  // Only a tail of the room mounts; working dots above stay on the FULL list.
  const {
    scrollRef,
    transcriptRef,
    topSentinelRef,
    transcriptKey,
    following,
    windowedMessages,
    hiddenCount,
    laterCount,
    olderPending,
    showLater,
    jumpToLatest,
    scrollHandlers,
  } = useTranscriptViewport({
    ownerId: group.id,
    threadId: group.threadId,
    messages: shownMessages,
    pinOn: [group.busyBotId, group.working, composerDock.pad],
    hasMore: group.hasMore,
    ...(pane?.loadOlder ? { onLoadOlder: pane.loadOlder, loadingOlder: pane.loadingOlder } : {}),
  });
  // Seen (src/lib/read-receipts.ts): this person's own position while the window has focus.
  useReportRead(group.threadId, scrollRef, group.messages.at(-1)?.id);
  const unreadDivider = useUnreadDivider({ threadId: group.threadId, messages: group.messages, following });

  // The room's panel, when it was already open as the room opened (it follows
  // the selection from the previous conversation), is drawn in place on the
  // first frame; only a panel the person opens here slides in.
  const [panelOpenedWithRoom, setPanelOpenedWithRoom] = useState(panelOpen);
  useEffect(() => {
    if (!panelOpen) setPanelOpenedWithRoom(false);
  }, [panelOpen]);

  const { memberMauses, groupPill } = groupRoomIdentity({
    group,
    members,
    peer,
    panelOpen,
    personPanelId: state.personPanelId,
    onTogglePanel: pane?.panel ? pane.panel.onToggle : () => dispatch(panelOpen
      ? { type: "toggleSettings", open: false }
      : { type: "toggleSettings", open: true, owner: null }),
    onOpenPerson: (personId) => dispatch({ type: "openPersonPanel", personId }),
    speakersElsewhere,
  });

  const Root = pane ? "section" : "main";
  return (
    // data-room-view: a navigation into or out of a room never animates
    // (src/lib/view-transitions.ts), it opens in place like a 1:1.
    // data-room-bubble: my bubble keeps the skin's accent, or the brand's when
    // the skin's is a neutral (src/styles/skin-bubble.css, roomBubbleColors).
    <Root data-room-view="" data-room-bubble="" className="app-glow relative flex h-full min-w-0 flex-1 bg-app" aria-label={pane?.label} data-side-chat={pane ? "" : undefined}>
      <ExchangeColumnProvider node={exchangeColumnNode}>
      <div ref={exchangeColumnRef} className="relative isolate flex min-w-0 flex-1 flex-col">
      {!pane && <GroupCallOverlay group={group} members={members} />}
      <LeaveGroupDialog groupId={leaving ? group.id : null} onClose={() => setLeaving(false)} />

      {!pane && (macInset || browser) && <div className="content-topbar-strip" />}
      {/* Header: laid out like a bot chat's. The centered chip (stacked
          member faces + name) opens the group panel; the right-hand
          controls move into the panel's top bar while it is open. */}
      {pane ? (typeof pane.header === "function" ? pane.header(groupPill) : pane.header) : <ChatHeaderBar
        {...(headerDragProps as HTMLAttributes<HTMLDivElement>)}
        // The same floating bar as a bot chat's (ChatHeaderBar): no band, the
        // pill floats over the transcript, which scrolls under it and fades
        // out there. Pulsatrix Light turns it back into a normal band
        // (styles.css `.content-topbar`).
        center={groupPill}
        centerClassName="max-w-[50%]"
        centerStyle={headerNoDragStyle}
      >
        <div
          className="flex shrink-0 items-center gap-2"
          // The caption buttons sit over the header's right end; drop this
          // control row 16px (visual only) below the 26px overlay.
          style={controlsShiftStyle}
        >
          {activeGoalMessage?.goalRun && (
            <GoalRunHeaderChip
              run={activeGoalMessage.goalRun}
              onShow={() => dispatch({ type: "focusMessage", threadId: group.threadId, messageId: activeGoalMessage.id })}
            />
          )}
          {!panelOpen && <ExportTranscriptMenu
            title={group.name}
            messages={group.messages}
            isGroup
            {...(mayLeave ? { onLeave: () => setLeaving(true) } : {})}
            onSplit={(edge) => splitBesideMain(roomShowThreads && !group.dm ? { kind: "group", groupId: group.id, threadId: group.threadId } : { kind: "group", groupId: group.id }, edge)}
          />}
          {!group.dm && <GroupTaskPicker group={group} />}
          {stored.peopleDm && <PersonThreadPicker group={stored} />}
          {group.dm && memberMauses}
          {/* A group's pill opens its panel: no second button for it. */}
        </div>
      </ChatHeaderBar>}

      <div className="content-card-body flex min-h-0 flex-1 flex-col">
      {/* Banners sit below the floating header, as in a bot chat
          (ChatViewBanners); the wrapper vanishes when none is showing so
          the transcript runs to the top, under the pill. */}
      <div className={cn("chat-banners empty:hidden", !pane && "pt-[52px]")}>
      {!pane && <ThreadReturnLink ownerId={group.id} threadId={group.threadId} />}
      {findOpen && <ChatFindBar threadId={group.threadId} onClose={() => setFindOpen(false)} />}
      {!pane && <ChatErrorBanner message={state.error} onDismiss={() => dispatch({ type: "error", message: null })} />}
      {!pane && <ChatNotice notice={state.notice} />}
      {!pane && <ChatReconnectBanner connected={state.connected} everConnected={state.everConnected} disconnectedAt={state.disconnectedAt} />}
      <TransientNotice messages={group.messages} settled={(m) => routineAutoPauseSettled(m, state.routines)} render={(m, close) => {
        if (m.kind === "access" && m.access) return (
          <AccessCard
            access={m.access}
            viewer={{ principalId: state.config?.viewer?.principalId ?? null, admin: state.config?.viewer?.role === "admin" || state.config?.viewer?.role === "owner" }}
            onSignIn={() => { close(); dispatch({ type: "toggleAppSettings", open: true, section: "providers" }); }}
          />
        );
        const runRef = m.routineRun?.runId ? m.routineRun : undefined;
        // 2026-10-26: the failure that paused its routine offers Resume.
        const paused = isRoutineAutoPausedNotice(m) ? autoPausedRoutineToResume(m, state.routines) : undefined;
        const onResume = paused
          ? () => { close(); dispatch({ type: "updateRoutine", routineId: paused.id, patch: { enabled: true } }); }
          : undefined;
        return <RoutineRunCard message={m} bot={state.bots.find((candidate) => candidate.id === m.from?.botId)} botOf={(id) => state.bots.find((candidate) => candidate.id === id)} onResume={onResume} onOpen={runRef ? () => { close(); openRoutineRun(dispatch, { runId: runRef.runId, routineId: runRef.routineId, report: { text: runRef.summary ?? "", at: m.at } }); } : undefined} />;
      }} />
      {!pane && <ChatStaleBanner />}

      {/* An Auto room answers like lead mode while the decision model is off: say so, once. */}
      {!group.dm && !remoteClient && state.config && group.defaultResponder.kind === "auto" && !jevRoomRoutingOn(state.config) && (
        <div className="w-full px-4">
          <p data-testid="room-jev-off" className="mb-1 px-2 text-[12px] text-ink-secondary">
            {t("room.responder.jevOffHint", { name: defaultResponderName(group, members) ?? t("room.responder.leadFallback") })}{" "}
            <button
              type="button"
              onClick={() => openSettings(dispatch, "decisionModel")}
              className="cursor-pointer text-accent hover:underline"
            >
              {t("room.responder.jevOffOpen")}
            </button>
          </p>
        </div>
      )}

      <TurnTimingLine timing={group.tasks?.find((task) => task.threadId === group.threadId)?.turnTiming ?? group.turnTiming} />
      {/* Members the person stopped: who is held, and how to bring them back. */}
      {!group.dm && <RoomHoldsBanner group={group} members={members} />}

      {/* Pinned message banner — resolves against the room's full transcript */}
      {(() => {
        const pinned = group.messages.find((m) => m.id === group.pinnedMessageId && m.kind === "text");
        const text = pinned ? citationPreviewText(pinned.text ?? "").replace(/\s+/g, " ").trim() : "";
        if (!pinned || !text) return null;
        const sender = pinned.role === "user" ? t("chat.you") : (pinned.from?.name ?? t("room.aBot"));
        return (
          <div className="w-full px-4">
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-1.5">
              <Pin size={12} className="shrink-0 text-accent" />
              <button
                onClick={() => dispatch({ type: "focusMessage", threadId: group.threadId, messageId: pinned.id })}
                className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                title={t("chat.pinnedJump")}
              >
                <span className="shrink-0 text-[11.5px] font-medium text-accent">{sender}</span>
                <span dir="auto" className="truncate text-[12.5px] text-ink-secondary">{text}</span>
              </button>
              <button
                onClick={() => dispatch({ type: "patchGroup", groupId: group.id, patch: { pinnedMessageId: "" } })}
                aria-label={t("chat.unpinMessage")}
                title={t("chat.unpin")}
                className={cn("shrink-0 rounded p-0.5 text-ink-secondary hover:bg-raised hover:text-ink", remoteClient && "hidden")}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })()}
      </div>

      <GroupRoomTranscriptPane
        group={group}
        stored={stored}
        members={members}
        locale={locale}
        windowedMessages={windowedMessages}
        emergingId={popping?.id}
        unreadDividerId={unreadDivider.messageId}
        unreadDividerFading={unreadDivider.fading}
        onReply={selectReply}
        orgPeople={orgPeople}
        threadReads={threadReads}
        scrollRef={scrollRef}
        transcriptRef={transcriptRef}
        topSentinelRef={topSentinelRef}
        scrollHandlers={scrollHandlers}
        composerDockPad={composerDock.pad}
        olderPending={olderPending}
        hiddenCount={hiddenCount}
        laterCount={laterCount}
        showLater={showLater}
        speaker={speaker}
        presenceVisible={presenceVisible}
        presenceSpeaker={presenceSpeaker}
        activity={activity}
        onCall={onCall}
        liveShown={liveShown}
        popping={popping}
        transcriptKey={transcriptKey}
        announcement={announcement}
        following={following}
        jumpToLatest={jumpToLatest}
        composerDockRef={composerDockRef}
        composerDockHeight={composerDock.height}
        replyTo={replyTo}
        clearReply={clearReply}
        consumeReply={consumeReply}
        restoreReply={restoreReply}
        peer={peer}
        roomNudge={roomNudge}
        stateConfig={state.config}
        threadSpeaker={threadSpeaker}
      />
      </div>
      </div>
      </ExchangeColumnProvider>
      {panelOpen && placePanel(
        <GroupPanel
          key={`panel:${group.id}`}
          arriving={!panelOpenedWithRoom}
          group={group}
          members={members}
          canEdit={editable}
          readOnlyNote={!remoteClient && !ownsRoom}
          canAddBot={canAddRosterBot}
          {...(mayLeave ? { onLeave: () => setLeaving(true) } : {})}
          roster={<GroupRoomRoster group={group} members={members} model={model} />}
          advanced={
            remoteClient ? (canManageRoster ? manageMembersButton : null) : (
              <>
                {/* Opens the People and Bots pickers together, above: the
                    inline Add rows do the same one list at a time. */}
                {canManageRoster && manageMembersButton}
                <PanelSection title={t("room.responder.aria")}>
                  <DefaultResponderSelect group={group} members={members} disabled={!ownsRoom} />
                </PanelSection>
                {(group.humanIds?.length ?? 0) > 0 && (
                  <PanelSection title={t("room.mentionAll.title")}>
                    <RoomMentionAll group={group} disabled={!ownsRoom} />
                  </PanelSection>
                )}
                <PanelSection title={t("room.turnLimit.aria")}>
                  <ConversationTurnLimit group={group} />
                </PanelSection>
                <PanelSection title={t("room.folder.title")}>
                  <RoomWorkingFolder group={group} disabled={!ownsRoom || !folderEditable} adminOnlyNote={ownsRoom && !folderEditable} />
                </PanelSection>
              </>
            )
          }
        />
      )}
    </Root>
  );
}
