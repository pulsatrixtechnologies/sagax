import { useState, type RefObject, type MutableRefObject } from "react";
import { createPinnedHold, PinnedHoldContext } from "@/lib/pinned-waiting";
import { Square } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useStore, type Bot, type Group, type Message } from "@/state/store";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import type { ThreadReads } from "@/lib/read-receipts";
import { BotAvatar } from "../Avatar";
import { useChatColumnClass } from "@/lib/chat-bubble-width";
import { ConversationGalleryProvider } from "../ConversationGallery";
import { Transcript } from "./Transcript";
import { LiveReply } from "../LiveReply";
import { TurnPresence } from "../TurnPresence";
import { TranscriptAnnouncer } from "../TranscriptAnnouncer";
import { JumpToLatestPill } from "../JumpToLatestPill";
import { Composer } from "../Composer";
import { CitationSelectionToolbar } from "../CitationUI";
import { appendDraftAttachments } from "@/lib/drafts";
import { groupResponseHint, jevRoomRoutingOn } from "@/lib/group-routing";
import type { TranscriptSnapshot } from "@/lib/transcript-announcer";
import type { ConfigStatus } from "@/state/store";
import { peopleDmPeer } from "@/lib/people-dm";
import { groupNudgeTarget } from "@/lib/group-nudge";
import type { LiveActivityPhrases } from "@/lib/live-activity";
import { ChatEdgeFade } from "@/components/ChatEdgeFade";

type Peer = NonNullable<ReturnType<typeof peopleDmPeer>>;
type Nudge = ReturnType<typeof groupNudgeTarget>;

export function GroupRoomTranscriptPane({
  group,
  stored,
  members,
  locale,
  windowedMessages,
  emergingId,
  unreadDividerId,
  unreadDividerFading,
  onReply,
  orgPeople,
  threadReads,
  scrollRef,
  transcriptRef,
  topSentinelRef,
  scrollHandlers,
  composerDockPad,
  olderPending,
  hiddenCount,
  laterCount,
  showLater,
  speaker,
  presenceVisible,
  presenceSpeaker,
  activity,
  onCall,
  liveShown,
  popping,
  transcriptKey,
  announcement,
  following,
  jumpToLatest,
  composerDockRef,
  composerDockHeight,
  replyTo,
  clearReply,
  consumeReply,
  restoreReply,
  peer,
  roomNudge,
  stateConfig,
  threadSpeaker,
}: {
  group: Group;
  stored: Group;
  members: Bot[];
  locale: string;
  windowedMessages: Message[];
  emergingId?: string | null;
  unreadDividerId?: string | null;
  unreadDividerFading?: boolean;
  onReply: (message: Message) => void;
  orgPeople: ReadonlyMap<string, OrgDirectoryPerson>;
  threadReads: { reads: ThreadReads; self: string | null };
  scrollRef: RefObject<HTMLDivElement | null>;
  transcriptRef: RefObject<HTMLDivElement | null>;
  topSentinelRef: RefObject<HTMLDivElement | null>;
  scrollHandlers: Record<string, unknown>;
  composerDockPad: string;
  olderPending: boolean;
  hiddenCount: number;
  laterCount: number;
  showLater: () => void;
  speaker?: Bot;
  presenceVisible: boolean;
  presenceSpeaker?: Bot;
  activity: LiveActivityPhrases;
  onCall: boolean;
  liveShown: MutableRefObject<boolean>;
  popping: { id: string; botId?: string } | null;
  transcriptKey: string;
  announcement: TranscriptSnapshot;
  following: boolean;
  jumpToLatest: () => void;
  composerDockRef: RefObject<HTMLDivElement | null>;
  composerDockHeight: number;
  replyTo: Message | null;
  clearReply: () => void;
  consumeReply: () => void;
  restoreReply: (message: Message, targetThreadId: string) => void;
  peer: Peer | null | undefined;
  roomNudge: Nudge;
  stateConfig: ConfigStatus | null | undefined;
  threadSpeaker?: Bot;
}) {
  const { dispatch } = useStore();
  const chatColumnClassName = useChatColumnClass();
  // #3681: the room's composer tells its transcript what its pinned card holds
  const [pinnedHold] = useState(createPinnedHold);
  return (
    <PinnedHoldContext value={pinnedHold}>
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full overflow-x-hidden overflow-y-auto px-5 [overflow-anchor:none]"
        {...scrollHandlers}
      >
        <div
          ref={transcriptRef}
          // Same chat column as a bot chat and the composer, so the
          // thread lines up with the field.
          // pt-14: the first message clears the floating header pill at
          // rest, as in a bot chat (ChatViewShell).
          className={cn(chatColumnClassName, "pt-14")}
          style={{ paddingBottom: composerDockPad }}
          role="log"
          // off, as in ChatView: TranscriptAnnouncer speaks once per reply
          aria-live="off"
          aria-label={t("room.aria", { name: group.name })}
        >
          <ConversationGalleryProvider>
          {group.messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="flex -space-x-2">
                {members.slice(0, 3).map((b) => (
                  <BotAvatar
                    key={b.id}
                    bot={b}
                    state="happy"
                    size={44}
                    motion="none"
                    motionKey={0}
                    animated={false}
                  />
                ))}
              </div>
              <div className="text-[17px] font-semibold text-ink">{group.name}</div>
              <div className="max-w-[380px] text-[14px] text-ink-secondary">
                {groupResponseHint(group, members, { jevOn: jevRoomRoutingOn(stateConfig) })}
              </div>
            </div>
          )}
          {/* Reverse infinite scroll sentinel and smooth loading indicator */}
          {olderPending ? (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-ink-secondary">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span>{t("chat.loadingEarlier")}</span>
            </div>
          ) : hiddenCount > 0 || group.hasMore ? (
            <div ref={topSentinelRef} className="h-2 w-full pointer-events-none" aria-hidden="true" />
          ) : null}
          <Transcript
            group={group}
            members={members}
            locale={locale}
            messages={windowedMessages}
            transcript={group.messages}
            emergingId={emergingId}
            unreadDividerId={unreadDividerId}
            unreadDividerFading={unreadDividerFading}
            onReply={onReply}
            people={orgPeople}
            reads={threadReads.reads}
            reader={threadReads.self}
          />
          {laterCount > 0 && (
            <div className="flex justify-center">
              <button
                onClick={showLater}
                className="rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink"
              >
                {t("chat.showLater", { count: laterCount })}
              </button>
            </div>
          )}
          {speaker && <LiveReply threadId={group.threadId} botId={speaker.id} mentionPeers={members} label={speaker.name} room hidden={onCall} shownRef={liveShown} />}
          {/* Stop only the member that is working; the room carries on. */}
          {threadSpeaker && !group.dm && members.length > 1 && !group.holds?.[threadSpeaker.id] && (
            <div className="flex justify-start pl-12">
              <button
                type="button"
                data-testid="room-stop-member"
                onClick={() => dispatch({ type: "setGroupHold", groupId: group.id, botId: threadSpeaker.id, held: true })}
                title={t("room.holds.stopTitle", { name: threadSpeaker.name })}
                className="ui-pill"
              >
                <Square size={11} aria-hidden="true" />
                <span>{t("room.holds.stop", { name: threadSpeaker.name })}</span>
              </button>
            </div>
          )}
          </ConversationGalleryProvider>
        </div>
      </div>

      <TranscriptAnnouncer threadKey={transcriptKey} snapshot={announcement} />

      {!following && (
        <JumpToLatestPill onClick={jumpToLatest} bottom={composerDockHeight + 16} scrollRef={scrollRef} />
      )}

      <div ref={composerDockRef} data-composer-dock="" className="absolute inset-x-0 bottom-0 z-[2]">
      <ChatEdgeFade edge="bottom" />
      {/* JC 2026-11-06: the working line sits just above the composer, on the
          message column, whatever the scroll (as in ChatView). */}
      <div data-turn-presence-slot="" className="px-5 [&:not(:has(.turn-presence))]:hidden">
        <div className={cn(chatColumnClassName, "pb-1.5")}>
          {(speaker || presenceVisible) && (
            <TurnPresence
              // the speaker's colour and mascot, as in ChatView
              bot={presenceSpeaker ?? { color: "green" }}
              // a bot the room waits on (busy elsewhere) is not typing here
              streamThreadId={speaker ? group.threadId : null}
              visible={presenceVisible}
              phrases={activity.phrases}
              phase={activity.phase}
              quietSince={activity.stepSince ?? null}
              seed={`${group.id}:${group.turnStartedAt ?? ""}:${speaker?.id ?? ""}`}
              since={speaker ? group.turnStartedAt ?? null : null}
              answering={popping !== null}
            />
          )}
        </div>
      </div>
      <Composer
        key={group.threadId}
        group={group}
        members={members}
        nudgePeer={peer ? { ...peer, threadId: stored.threadId } : peer}
        nudgeGroup={roomNudge}
        replyTo={replyTo}
        onClearReply={clearReply}
        onConsumeReply={consumeReply}
        onRestoreReply={restoreReply}
      />
      <CitationSelectionToolbar
        key={`${group.id}:${group.threadId}`}
        viewportRef={scrollRef}
        onAdd={(citation) => appendDraftAttachments(`group:${citation.source.ownerId}:${citation.source.threadId}`, [citation])}
      />
      </div>
    </div>
    </PinnedHoldContext>
  );
}
