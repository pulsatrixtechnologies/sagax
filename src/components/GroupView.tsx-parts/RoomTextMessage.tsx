import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import { useEffect, useRef, useState } from "react";
import { t, activeLocale } from "@/lib/i18n";
import { formatTime, useStore, type Bot, type Group, type Message } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { cn } from "@/lib/cn";
import { MESSAGE_ROW, MessageActions, messageActionClass } from "../MessageActions";
import { personModerationMenu, useBotMessageMenu, userMessageMenu, type PinAction } from "../message-menu";
import { blockPerson, isBlockedId, personLineAuthor, unblockPerson, useBlockedPeople } from "@/lib/moderation";
import { ReportPersonDialog } from "../ReportPersonDialog";
import { ConfirmDialog } from "../ConfirmDialog";
import { RawMarkdownView, RawToggleAction } from "../RawMarkdownToggle";
import { SpeakButton } from "../SpeakButton";
import { useSpeech } from "@/lib/tts/useSpeech";
import { useLocalSystemVoice } from "@/lib/render-reads";
import { myReactions, useToggleReaction } from "@/lib/reactions";
import { ReactionChips } from "../Reactions";
import { ChatMarkdown } from "../ChatMarkdown";
import { MessageBoundary } from "../ChatView";
import { ReplyQuote } from "../ReplyQuote";
import { AttachmentGallery, MessageAttachmentGallery, replyAttachmentGroup } from "../AttachmentGallery";
import { VoiceNoteBubble, type VoiceNoteAttachment } from "../VoiceNoteBubble";
import { ThreadRefText } from "../ThreadRefs";
import { SentCitations } from "../CitationUI";
import { splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { highlightCitationSource } from "@/lib/citations-dom";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { stripLeakedSystemHarnessMessages } from "../../../shared/system-message-guard.ts";
import { runCorners } from "@/lib/room-authors";
import type { MentionPeer } from "@/lib/mentions";

/** Pin for one room message, one pin per room, patchGroup path. */
function roomPin(group: Group, message: Message, dispatch: ReturnType<typeof useStore>["dispatch"]): PinAction | undefined {
  if (window.ogb?.remoteClient?.active) return undefined;
  const pinned = group.pinnedMessageId === message.id;
  return {
    pinned,
    hint: t("room.pinHint"),
    onToggle: () => dispatch({ type: "patchGroup", groupId: group.id, patch: { pinnedMessageId: pinned ? "" : message.id } }),
  };
}

export const NO_PEOPLE: ReadonlyMap<string, OrgDirectoryPerson> = new Map();

/** Same limits as a 1:1 user bubble (ChatView). */
const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 8;

export function RoutedByLine({ routedBy }: { routedBy: NonNullable<Message["routedBy"]> }) {
  const percent = Math.round(Math.min(1, Math.max(0, routedBy.probability)) * 100);
  return (
    <div data-testid="routed-by" className="mt-1 px-1 text-[11px] text-ink-secondary">
      {t("room.routedBy", { percent: String(percent) })}
    </div>
  );
}

/** One room text message: the same actions as a 1:1 bubble, and a boundary
 * so a bad markdown node stays inside this row. */
export function RoomTextMessage({
  group,
  message: m,
  members,
  mentionPeers,
  transcript,
  emerging,
  eager,
  mine,
  joinsAbove,
  joinsBelow,
  onReply,
  reactionSelf,
}: {
  group: Group;
  message: Message;
  members: Bot[];
  /** Who an @ can name here: the room's bots, then its people (chips). */
  mentionPeers: readonly MentionPeer[];
  transcript: Message[];
  emerging: boolean;
  eager: boolean;
  /** Your own line: the end side, in your bubble (src/lib/room-authors.ts). */
  mine: boolean;
  /** Part of a run of lines by one author: the corners join. */
  joinsAbove: boolean;
  joinsBelow: boolean;
  onReply: (message: Message) => void;
  /** Who "I" am on a reaction chip (src/lib/reactions.ts). */
  reactionSelf: readonly string[];
}) {
  "use memo";
  const dispatch = useStoreDispatch();
  const focus = useStoreSelector((current) => current.focusMessage);
  const tts = useStoreSelector((current) => current.config?.tts);
  const localVoice = useLocalSystemVoice();
  const user = m.role === "user";
  // Emoji reactions (src/components/Reactions.tsx): the smiley of the hover
  // row and the head of its "…" menu; the chips sit under the bubble.
  const toggleReactionOn = useToggleReaction(group.threadId, dispatch);
  const reactable = !m.id.startsWith("optimistic-");
  const react = reactable ? { mine: myReactions(m.reactions, reactionSelf), onPick: (emoji: string) => toggleReactionOn(m.id, emoji) } : undefined;
  const requestId = m.id.startsWith("optimistic-") ? undefined : m.id;
  // a bot's leaked internal system lines never reach the reader
  const rawText = user ? (m.text ?? "") : stripLeakedSystemHarnessMessages(m.text ?? "");
  const cited = user && m.text ? splitTranscriptCitations(m.text) : null;
  const attachments = user && m.text ? splitTranscriptAttachments(cited?.display ?? m.text) : null;
  const display = attachments?.display ?? rawText;
  // A person's line that is only a picture or a GIF has no bubble: the media
  // is the message and sets its own width (iMessage / Grok Bot), never a
  // coloured box stretched past it. With text the media sits above it, still
  // as compact thumbnails, so the bubble hugs the widest of the two.
  const mediaOnly = user && !m.replyToId && !display.trim() && Boolean(attachments && (attachments.images.length || attachments.files.length));
  const [expanded, setExpanded] = useState(false);
  const [viewRaw, setViewRaw] = useState(false);
  const speech = useSpeech();
  const speaking = speech.messageId === m.id && speech.status !== "idle";
  const focusedSearch = focus?.messageId === m.id && Boolean(focus.matchText) && focus.threadId === group.threadId;
  const collapsible = user && !expanded && (display.length > USER_COLLAPSE_CHARS || display.split("\n").length > USER_COLLAPSE_LINES);
  useEffect(() => {
    if (focusedSearch && collapsible) setExpanded(true);
  }, [focusedSearch, collapsible, focus?.nonce]);
  const speakerBot = members.find((member) => member.id === m.from?.botId);
  const botText = rawText;
  const pin = roomPin(group, m, dispatch);
  const botMenu = useBotMessageMenu({
    text: botText,
    botId: speakerBot?.id,
    messageId: m.id,
    voiceId: speakerBot?.voice,
    tts: tts,
    localVoice,
    canSpeak: true,
    viewRaw,
    onToggleRaw: () => setViewRaw((raw) => !raw),
    pin,
  });
  // a reply with text lists its files under the text, without the ones it links inline
  // (memoized by the React Compiler on the text and the attachments)
  const replyGroup = !user && botText.trim() ? replyAttachmentGroup(botText, m.attachments) : null;
  // Another person's line (App Store 1.2): Report it, Block its author for
  // me only. A blocked person's line folds into one row that opens on a click.
  const config = useStoreSelector((current) => current.config);
  const blockedPeople = useBlockedPeople();
  const author = user && !mine ? personLineAuthor(m, config) : null;
  const authorBlocked = author ? isBlockedId(blockedPeople, author.id) : false;
  const [revealed, setRevealed] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);
  // The "..." button stays mounted after the report item's menu closes.
  const reportAnchor = useRef<HTMLElement | null>(null);
  const openReport = () => {
    reportAnchor.current = lineRef.current?.querySelector<HTMLElement>("[data-more-button]") ?? lineRef.current;
    setReporting(true);
  };
  const personMenu = [
    ...userMessageMenu({ pin }),
    ...(author && requestId ? personModerationMenu({
      name: author.name,
      blocked: authorBlocked,
      onReport: openReport,
      onToggleBlock: () => { if (authorBlocked) void unblockPerson(author.id).catch(() => {}); else setConfirmBlock(true); },
    }) : []),
  ];
  const moderationDialogs = author ? (
    <>
      {reporting && requestId && (
        <ReportPersonDialog
          open
          anchorRef={reportAnchor}
          threadId={group.threadId}
          messageId={requestId}
          author={author}
          blocked={authorBlocked}
          onClose={() => setReporting(false)}
        />
      )}
      <ConfirmDialog
        open={confirmBlock}
        tone="neutral"
        title={t("moderation.block.confirmTitle", { name: author.name })}
        body={t("moderation.block.confirmBody")}
        confirmLabel={t("moderation.block.confirm")}
        onCancel={() => setConfirmBlock(false)}
        onConfirm={() => { setConfirmBlock(false); void blockPerson(author).catch(() => {}); }}
      />
    </>
  ) : null;
  // While the report popover is open, keep this row (and its "..." button,
  // the anchor) mounted. Folding the line away would drop the anchor.
  if (author && authorBlocked && !revealed && !reporting) {
    return (
      <div data-author="person" data-blocked-line="" className="group flex w-full flex-col items-start" {...{ [MESSAGE_ROW]: "" }}>
        <div className="flex items-center gap-2 rounded-[18px] bg-raised px-3 py-[7px] text-[12.5px] text-ink-secondary ring-1 ring-inset ring-hairline/40">
          <span>{t("moderation.blocked.line")}</span>
          <button type="button" onClick={() => setRevealed(true)} className="text-ink-secondary underline hover:text-ink">{t("moderation.blocked.show")}</button>
        </div>
        {moderationDialogs}
      </div>
    );
  }
  return (
    <div
      ref={lineRef}
      data-author={mine ? "self" : user ? "person" : "bot"}
      className={cn("group flex w-full flex-col", mine ? "items-end" : "items-start", joinsAbove && "-mt-2")}
      // the whole row reveals its actions on hover, focus or a tap (MessageActions)
      {...{ [MESSAGE_ROW]: "" }}
    >
      <div className={cn("relative flex w-full items-end gap-1.5", mine ? "justify-end" : "justify-start")}>
        {mine && (
          <MessageActions side="user" menu={userMessageMenu({ pin })} onReply={() => onReply(m)} copy={display.trim() ? display : undefined} requestId={requestId} react={react} />
        )}
        <div
          data-chat-bubble
          className={cn(
            "text-[13px] leading-5",
            !user && emerging && "turn-answer",
            !user
              // A bot's reply is a quiet grey bubble (--color-bubble-bot); its name
              // labels the run above (RoomBotLabel). An attachments-only line keeps
              // its tighter fit and no bubble.
              ? (!m.text?.trim() && !m.replyToId && m.attachments?.length
                  ? "w-fit max-w-[min(80%,560px,calc(100%-82px))] text-ink"
                  : "w-fit max-w-[min(94%,780px,calc(100%-82px))] rounded-[18px] bg-bubble-bot px-3 py-[7px] text-ink")
              // A person keeps a rounded bubble: yours in the accent (--color-bubble-user),
              // another person's in the bot's grey.
              : mediaOnly
                ? "w-fit max-w-[min(80%,560px,calc(100%-82px))] text-ink"
                : cn(
                  "rounded-[18px] w-fit max-w-[min(80%,560px,calc(100%-82px))]",
                  mine
                    ? "chat-text whitespace-pre-wrap bg-bubble-user px-3 py-[7px] text-ink"
                    : "chat-text whitespace-pre-wrap bg-bubble-bot px-3 py-[7px] text-ink",
                  runCorners(mine ? "end" : "start", joinsAbove, joinsBelow),
                ),
          )}
          title={new Date(m.at).toLocaleString(activeLocale())}
        >
          {m.replyToId && (() => {
            const target = transcript.find((candidate) => candidate.id === m.replyToId);
            return target ? (
              <div className="mb-2">
                <ReplyQuote
                  message={target}
                  fallbackName={t("room.fallbackBot")}
                  compact
                  onJump={() =>
                    dispatch({ type: "focusMessage", threadId: group.threadId, messageId: target.id })
                  }
                />
              </div>
            ) : null;
          })()}
          {user ? (
            <>
              {attachments && (
                <AttachmentGallery
                  beneath
                  align={mine ? "end" : "start"}
                  images={attachments.images}
                  files={attachments.files}
                  message={{ threadId: group.threadId, messageId: m.id }}
                  eager={eager}
                  className={mediaOnly ? "mt-0" : "mb-1.5 mt-0"}
                />
              )}
              <div
                className={cn(collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
                data-citation-source={m.id}
                data-citation-owner-type="group"
                data-citation-owner={group.id}
                data-citation-thread={group.threadId}
              >
                <ThreadRefText text={display} peers={mentionPeers} everyone={!group.dm} />
              </div>
              {cited && <SentCitations
                citations={cited.citations}
                onNavigate={async (citation: CitationAttachment) => {
                  if (citation.source.ownerType !== "group" || !group.messages.some((candidate) => candidate.id === citation.source.messageId)) return false;
                  dispatch({ type: "focusMessage", threadId: group.threadId, messageId: citation.source.messageId });
                  return highlightCitationSource(citation);
                }}
              />}
              {m.via === "api" && (
                <div className="mt-1 text-[11px] text-ink-secondary">{t("group.viaApi")}</div>
              )}
              {collapsible && (
                <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showFull")}
                </button>
              )}
              {expanded && (
                <button type="button" onClick={() => setExpanded(false)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showLess")}
                </button>
              )}
            </>
          ) : (
            <MessageBoundary key={viewRaw ? "raw" : "rendered"} fallbackText={botText || t("chat.generatedImage")}>
              {(m.attachments ?? []).some((attachment) => attachment.kind === "audio") && (
                <div className={cn("flex flex-col", (m.text || (m.attachments ?? []).some((attachment) => attachment.kind === "image")) && "mb-2")}>
                  {m.attachments!.filter((attachment): attachment is VoiceNoteAttachment => attachment.kind === "audio").map((note) => (
                    <VoiceNoteBubble key={note.path} attachment={note} />
                  ))}
                </div>
              )}
              {!botText.trim() && <MessageAttachmentGallery text={botText} attachments={m.attachments} message={{ threadId: group.threadId, messageId: m.id }} className={m.text ? undefined : "mb-0"} eager={eager} />}
              {viewRaw && botText ? (
                <div data-citation-source={m.id} data-citation-owner-type="group" data-citation-owner={group.id} data-citation-thread={group.threadId}><RawMarkdownView text={botText} /></div>
              ) : botText ? (
                <div data-citation-source={m.id} data-citation-owner-type="group" data-citation-owner={group.id} data-citation-thread={group.threadId}>
                  <ChatMarkdown
                    text={botText}
                    botId={m.from?.botId}
                    emailDrafts={speakerBot?.emailDrafts !== false}
                    mentionPeers={mentionPeers}
                    everyone={!group.dm}
                    message={{ threadId: group.threadId, messageId: m.id }}
                    youtubeSendToBot={(body) => dispatch({ type: "sendGroup", groupId: group.id, threadId: group.threadId, text: body })}
                    delivered={replyGroup?.delivered}
                  />
                </div>
              ) : null}
              {replyGroup && <AttachmentGallery images={replyGroup.images} files={replyGroup.files} message={{ threadId: group.threadId, messageId: m.id }} eager={eager} beneath />}
            </MessageBoundary>
          )}
        </div>
        {!mine && user && (
          <MessageActions side="bot" forceOpen={reporting} menu={personMenu} onReply={() => onReply(m)} copy={display.trim() ? display : undefined} requestId={requestId} react={react} />
        )}
        {!user && (
          <MessageActions
            side="bot"
            forceOpen={viewRaw || speaking}
            menu={botMenu}
            onReply={() => onReply(m)}
            copy={botText || undefined}
            requestId={requestId}
            react={react}
            persistent={
              // a state the person turned on keeps its switch in view
              <>
                {botText && viewRaw && <RawToggleAction active onToggle={() => setViewRaw(false)} className={messageActionClass} />}
                {botText && speaking && (
                  <SpeakButton text={botText} botId={speakerBot?.id} messageId={m.id} voiceId={speakerBot?.voice} tts={tts} localVoice={localVoice} className={cn(messageActionClass, "text-accent")} />
                )}
              </>
            }
          />
        )}
        <span className="self-end pb-1 text-[11px] tabular-nums text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100">
          {formatTime(m.at)}
        </span>
      </div>
      <ReactionChips reactions={m.reactions} selfIds={reactionSelf} bots={members} end={mine} onToggle={(emoji) => toggleReactionOn(m.id, emoji)} />
      {!user && m.routedBy && <RoutedByLine routedBy={m.routedBy} />}
      {moderationDialogs}
    </div>
  );
}
