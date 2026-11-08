import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Code,
  Eye,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Webhook,
  X,
} from "lucide-react";
import { cancelLocalSend } from "@/lib/send-cancel";
import { restoreComposerDraft } from "@/lib/drafts";
import { MessageBar, MessageMenuItem } from "../MessageBar";
import { HOVER_ICON } from "../MessageHoverActions";
import { useHoverDwell } from "@/hooks/use-hover-dwell";
import { useSpeech } from "@/lib/tts/useSpeech";
import { useRemoteClient } from "@/lib/render-reads";
import { formatTime, type Message } from "@/state/store";
import { ChatMarkdown } from "../ChatMarkdown";
import { VoiceNoteBubble, type VoiceNoteAttachment } from "../VoiceNoteBubble";
import { RawMarkdownView } from "../RawMarkdownToggle";
import { MessageBoundary } from "../MessageBoundary";
import { TerminalChatEmbed } from "@/components/terminal/TerminalChatEmbed";
import { RemoteSessionCard } from "@/components/remote-session/RemoteSessionCard";
import { ResourceUsageCard } from "@/components/resource-usage/ResourceUsageCard";
import { ConnectorSetupCard } from "@/components/connector-setup/ConnectorSetupCard";
import { PageRefChip } from "../PageComposerParts";
import { ReplyQuote } from "../ReplyQuote";
import { AttachmentGallery, collectMessageFiles, imagePathOf, replyAttachmentGroup, splitMessageAttachments } from "../AttachmentGallery";
import { prefersWideBubble } from "@/lib/rich-blocks";
import { chatBubbleWidth, useChatBubbleWidthClasses } from "@/lib/chat-bubble-width";
import { SentCitations } from "../CitationUI";
import { SpeakMenuItem } from "../SpeakButton";
import { TurnRunLine } from "../TurnRunLine";
import { ReactionChips } from "../Reactions";
import { myReactions, useToggleReaction } from "@/lib/reactions";
import { peerLine, peerRequest } from "@/lib/peer-message";
import { OtherAuthorLabel } from "../MessageAuthor";
import { stripLeakedSystemHarnessMessages } from "../../../shared/system-message-guard.ts";
import { claimMessageEntrance } from "@/lib/message-entrance";
import { webhookMessageView } from "@/lib/webhook-message";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { highlightCitationSource } from "@/lib/citations-dom";
import { sendsMessage, useSendKey } from "@/lib/send-key";
import { ThreadRefText } from "../ThreadRefs";
import { cn } from "@/lib/cn";
import { t, activeLocale } from "@/lib/i18n";
import { USER_COLLAPSE_CHARS, USER_COLLAPSE_LINES, useChatRows } from "./types";
import { PeerLabel } from "./chips";

/** Inline editor a user bubble turns into: the send key sends (forking the
 * conversation), Esc cancels. Any other Enter is a newline, like the composer. */
export function BubbleEditor({
  initial,
  onCancel,
  onSubmit,
  bubbleStyle,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
  bubbleStyle?: ReturnType<typeof import("@/lib/user-bubble-tone").userBubbleStyle>;
}) {
  const [draft, setDraft] = useState(initial);
  const sendKey = useSendKey();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const submit = () => {
    if (draft.trim()) onSubmit(draft.trim());
  };
  return (
    <div className={cn("w-full max-w-[min(42rem,78%)] rounded-2xl border border-hairline/40 bg-bubble-user px-4 py-3", bubbleStyle && "user-bubble-colored")} style={bubbleStyle}>
      <textarea
        ref={ref}
        dir="auto"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (sendsMessage(e.nativeEvent, sendKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={Math.min(10, Math.max(2, draft.split("\n").length))}
        className="chat-input-text w-full resize-none bg-transparent text-ink focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-ink disabled:opacity-40"
        >
          {t("chat.send")}
        </button>
      </div>
    </div>
  );
}

/** One message. Memoized: it renders when its own props change (the
 * message, whether it is pinned or being edited) or the chat's ChatRows do,
 * never for the rest of the store. The callbacks take the message they act
 * on, so every row shares the same ones. */
export const Bubble = memo(function Bubble({
  message,
  emerging = false,
  eagerAttachments = false,
  editing,
  pinned,
  versions,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  replyTarget,
  onReply,
}: {
  message: Message;
  emerging?: boolean;
  eagerAttachments?: boolean;
  editing: boolean;
  pinned: boolean;
  /** Every version of an edited question, oldest first; absent when it was never edited. */
  versions?: readonly Message[];
  onStartEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (messageId: string, text: string) => void;
  /** Given to the last answer only. */
  onRegenerate?: () => void;
  replyTarget?: Message;
  onReply: (message: Message) => void;
}) {
  "use memo";
  const bubbleWidths = useChatBubbleWidthClasses();
  const { botId, threadId, botName, viewerName, voiceId, tts, localVoice, busy, bots, mentionPeers, focus, dispatch, onBranch, reactionSelf, bubbleStyle } = useChatRows();
  // Emoji reactions (src/components/Reactions.tsx): the smiley of the hover
  // row and the head of its "…" menu, the chips under the bubble.
  const toggleReactionOn = useToggleReaction(threadId, dispatch);
  const reactable = message.kind === "text" && !message.id.startsWith("optimistic-");
  const react = reactable ? {
    onPick: (emoji: string) => toggleReactionOn(message.id, emoji),
    mine: myReactions(message.reactions, reactionSelf),
  } : undefined;
  const remoteClient = useRemoteClient();
  // A user-role line another bot delivered (ask_bot, delegate_bot,
  // start_thread) is that bot speaking, not the person: it takes the
  // bot side of the chat under the peer's name, with the model-facing
  // provenance note stripped from what the reader sees. A coordinate_bots
  // request is stored bot-role and gets the same label.
  const peer = peerLine(message) ?? peerRequest(message, botId);
  const user = message.role === "user" && !peer;
  // The entrance plays only for a genuinely new line, decided once at mount:
  // never for rows drawn by opening or switching threads (message-entrance.ts).
  const [entering] = useState(() => user && claimMessageEntrance(message));
  const [expanded, setExpanded] = useState(false);
  const focusedSearch = focus?.messageId === message.id && Boolean(focus.matchText);
  const [viewRaw, setViewRaw] = useState(false);
  const speech = useSpeech();
  const speaking = speech.messageId === message.id && speech.status !== "idle";
  // a quiet model/effort line once the pointer rests on a bot reply
  const dwell = useHoverDwell(!user && !peer && Boolean(message.turnRun));
  // a sign-in card's text is only the fallback for clients without the card
  const rawText = peer ? peer.body : message.connectorSetup && message.role !== "user" ? "" : (message.text ?? "");
  // a bot's leaked internal system lines never reach the reader
  const text = user ? rawText : stripLeakedSystemHarnessMessages(rawText);
  const wideBubble = useMemo(() => !user && Boolean(text) && prefersWideBubble(text), [user, text]);
  const attached = useMemo(() => splitMessageAttachments(message.attachments), [message.attachments]);
  const generatedPaths = attached.images;
  const linkedFiles = useMemo(
    () => user ? [] : [...attached.files, ...collectMessageFiles(text, [...attached.images.map(imagePathOf), ...attached.files.map((file) => file.path)])],
    [user, text, attached],
  );
  // a reply with text lists its files under the text, without the ones it links inline
  const group = useMemo(
    () => !user && text.trim() ? replyAttachmentGroup(text, message.attachments) : null,
    [user, text, message.attachments],
  );
  const voiceNotes = useMemo(
    () => message.attachments?.filter((attachment): attachment is VoiceNoteAttachment => attachment.kind === "audio") ?? [],
    [message.attachments],
  );
  const webhookView = user ? webhookMessageView(text) : null;
  const cited = user && !webhookView ? splitTranscriptCitations(text) : null;
  const attachments = user && !webhookView ? splitTranscriptAttachments(cited?.display ?? text) : null;
  const visibleText = webhookView?.task ?? attachments?.display ?? text;
  const hasAttachments = Boolean(cited?.citations.length || (attachments && (attachments.images.length || attachments.files.length)));
  // A message that is only attachments is just the files: no bubble around them.
  const attachmentsOnly = !webhookView && !replyTarget && !visibleText.trim() &&
    (user ? hasAttachments : generatedPaths.length + linkedFiles.length > 0);
  const remoteCard = !user && Boolean(message.remoteSession || message.resourceUsage || message.connectorSetup);
  // A remote computer's card and its terminal sit one above the other: both
  // take the transcript column and, without text, no bubble padding, so they
  // line up on the same edges and reflow with the chat's width.
  const terminalCard = !user && Boolean(message.terminalEmbed);
  const columnCard = terminalCard || (!user && Boolean(message.remoteSession));
  const collapsible =
    user && !webhookView && !expanded && (visibleText.length > USER_COLLAPSE_CHARS || visibleText.split("\n").length > USER_COLLAPSE_LINES);
  useEffect(() => {
    if (focusedSearch && collapsible) setExpanded(true);
  }, [focusedSearch, collapsible, focus?.nonce]);

  if (user && editing && !webhookView && !hasAttachments) {
    return (
      <div className="flex w-full justify-end">
        <BubbleEditor initial={text} bubbleStyle={bubbleStyle} onCancel={onCancelEdit} onSubmit={(edited) => onSubmitEdit(message.id, edited)} />
      </div>
    );
  }

  // "‹ 2/3 ›" under an edited message — every fork it belongs to
  const forks = user && versions ? versions : [message];
  const versionIndex = forks.findIndex((v) => v.id === message.id);
  const switchTo = (v: Message | undefined) => {
    // an edit still waiting for its server fork has no branch to switch to yet
    if (v && !busy && !v.id.startsWith("optimistic-")) dispatch({ type: "switchBranch", botId, threadId, messageId: v.id });
  };
  const togglePin = () =>
    dispatch({ type: "updateTask", botId, threadId, patch: { pinnedMessageId: pinned ? "" : message.id } });

  return (
    <div
      className={cn("group flex w-full flex-col", user ? "items-end" : "items-start", entering && "animate-msg-in")}
      // Read only by the Hibou 98 skin, which lays the chat out as a log with
      // the author and time above each line; invisible everywhere else.
      data-retro-author={user ? viewerName || t("retro.chat.you") : peer?.name ?? botName}
      data-retro-time={formatTime(message.at)}
      data-retro-role={user ? "user" : "bot"}
      {...dwell.handlers}
    >
      {peer && <PeerLabel peer={peer} autoModel={message.autoModel} />}
      {user && <OtherAuthorLabel message={message} />}
      <div className={cn("flex w-full items-center gap-1.5", user ? "justify-end" : "justify-start")}>
        {user && (
          <MessageBar
            side="user"
            time={formatTime(message.at)}
            copy={visibleText.trim() ? visibleText : undefined}
            onReply={() => onReply(message)}
            requestId={message.id.startsWith("optimistic-") ? undefined : message.id}
            react={react}
          >
            {/* editing rewinds the thread, so it waits for the turn to end —
                same rule as the version switcher below */}
            {message.kind === "text" && !webhookView && !hasAttachments && !busy && !message.id.startsWith("optimistic-") && (
              <MessageMenuItem label={t("chat.editMessage")} icon={<Pencil {...HOVER_ICON} />} onSelect={() => onStartEdit(message.id)} />
            )}
            {message.sendId && message.id.startsWith("optimistic-") && (
              <MessageMenuItem
                label={t("chat.cancelReply")}
                icon={<X {...HOVER_ICON} />}
                title={t("chat.cancelReply")}
                onSelect={() => {
                  if (cancelLocalSend(message.sendId!) === "cancelled") {
                    dispatch({ type: "optimisticMessageRemoved", threadId, sendId: message.sendId! });
                    restoreComposerDraft(`bot:${botId}:${threadId}`, { text, attachments: [] });
                  } else {
                    dispatch({ type: "error", message: `${t("chat.cancelReplyFailed")} ${t("chat.cancelReplyInFlight")}` });
                  }
                }}
              />
            )}
            <MessageMenuItem
              label={pinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
              icon={pinned ? <PinOff {...HOVER_ICON} /> : <Pin {...HOVER_ICON} />}
              onSelect={togglePin}
              hidden={remoteClient}
            />
          </MessageBar>
        )}
        <div
          data-chat-bubble
          className={cn(
            "text-[13px] leading-5",
            emerging && "turn-answer",
            "rounded-[18px]",
            bubbleWidths[chatBubbleWidth({ terminal: columnCard, wide: wideBubble || remoteCard })],
            user && webhookView
              ? "overflow-hidden border border-accent/25 bg-card text-ink shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
              : (remoteCard || terminalCard) && !visibleText.trim()
                ? "text-ink"
                : remoteCard
                  ? "bg-card px-3 py-[7px] text-ink"
                  : attachmentsOnly
                  ? "text-ink"
                  : user
                    // the person's own message: a bubble in the accent (--color-bubble-user)
                    ? cn("bg-bubble-user px-3 py-[7px] whitespace-pre-wrap text-ink", bubbleStyle && "user-bubble-colored")
                    // a bot's reply: a quiet grey bubble; its tables, code and cards keep their own look
                    : "bg-bubble-bot px-3 py-[7px] text-ink",
          )}
          style={user && !webhookView && !attachmentsOnly ? bubbleStyle : undefined}
          title={new Date(message.at).toLocaleString(activeLocale())}
        >
          {replyTarget && (
            <div className="mb-2">
              <ReplyQuote
                message={replyTarget}
                fallbackName={botName}
                compact
                onJump={() =>
                  dispatch({ type: "focusMessage", threadId, messageId: replyTarget.id })
                }
              />
            </div>
          )}
          {/* sent from an open page: the page it is about (src/components/PageComposerParts.tsx) */}
          {user && message.dataContext?.page && (
            <div><PageRefChip page={message.dataContext.page} botId={botId} threadId={threadId} /></div>
          )}
          {user && webhookView ? (
            <div className="min-w-[300px] max-w-[520px]">
              <div className="flex items-center gap-2 border-b border-accent/15 bg-accent/[0.055] px-4 py-2.5 text-[11.5px] font-medium text-accent">
                <Webhook size={13} />
                <span>{t("chat.webhookTask")}</span>
              </div>
              <div className="chat-text px-4 py-3 whitespace-pre-wrap">{webhookView.task}</div>
              {webhookView.payload && (
                <details className="border-t border-hairline/30 bg-inset/25 px-4 py-2.5 text-[11.5px] text-ink-secondary">
                  <summary className="cursor-pointer select-none hover:text-ink">{t("chat.viewPayload")}</summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-hairline/25 bg-black/25 p-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink-secondary">{webhookView.payload}</pre>
                </details>
              )}
            </div>
          ) : user ? (
            <>
              {attachments && <AttachmentGallery images={attachments.images} files={attachments.files} message={{ threadId, messageId: message.id }} eager={eagerAttachments} className={!visibleText ? "mb-0" : undefined} />}
              {visibleText && (
                <div
                  className={cn("chat-text", collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
                  data-citation-source={message.id}
                  data-citation-owner-type="bot"
                  data-citation-owner={botId}
                  data-citation-thread={threadId}
                >
                  <ThreadRefText text={visibleText} peers={mentionPeers} />
                </div>
              )}
              {cited && <SentCitations
                citations={cited.citations}
                onNavigate={async (citation: CitationAttachment) => {
                  if (citation.source.ownerType !== "bot" || !onBranch(citation.source.messageId)) return false;
                  dispatch({ type: "focusMessage", threadId, messageId: citation.source.messageId });
                  return highlightCitationSource(citation);
                }}
              />}
              {message.steered && (
                <div className="mt-1 text-[11px] text-ink-tertiary" title={t("chat.sentMidTurnHint")}>
                  {t("chat.sentMidTurn")}
                </div>
              )}
              {message.via === "call" && (
                <span className="mt-1 text-[11px] text-ink-tertiary" title={t("chat.viaCall")}>
                  {t("chat.viaCall")}
                </span>
              )}
              {message.via === "sms" && (
                <span className="mt-1 text-[11px] text-ink-tertiary" data-via="sms">
                  {t("chat.viaSms")}
                </span>
              )}
              {collapsible && (
                <button onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showFull")}
                </button>
              )}
              {expanded && (
                <button onClick={() => setExpanded(false)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showLess")}
                </button>
              )}
            </>
          ) : (
            <MessageBoundary key={viewRaw ? "raw" : "rendered"} fallbackText={text || t("chat.generatedImage")}>
              {voiceNotes.length > 0 && (
                <div className={cn("flex flex-col", (text || generatedPaths.length > 0 || linkedFiles.length > 0) && "mb-2")}>
                  {voiceNotes.map((note) => (
                    <VoiceNoteBubble key={note.path} attachment={note} />
                  ))}
                </div>
              )}
              {message.remoteSession && <RemoteSessionCard botId={botId} threadId={threadId} view={message.remoteSession} />}
              {!user && message.resourceUsage && <ResourceUsageCard view={message.resourceUsage} />}
              {!user && message.connectorSetup && <ConnectorSetupCard threadId={threadId} view={message.connectorSetup} />}
              {message.terminalEmbed && <TerminalChatEmbed embed={message.terminalEmbed} owner={{ botId, threadId, messageId: message.id }} />}
              {!group && <AttachmentGallery images={generatedPaths} files={linkedFiles} message={{ threadId, messageId: message.id }} className={text ? undefined : "mb-0"} eager={eagerAttachments} />}
              {viewRaw && text ? (
                <div data-citation-source={message.id} data-citation-owner-type="bot" data-citation-owner={botId} data-citation-thread={threadId}><RawMarkdownView text={text} /></div>
              ) : text ? (
                <div data-citation-source={message.id} data-citation-owner-type="bot" data-citation-owner={botId} data-citation-thread={threadId}>
                  <ChatMarkdown
                    text={text}
                    botId={botId}
                    emailDrafts={bots.find((candidate) => candidate.id === botId)?.emailDrafts !== false}
                    mentionPeers={mentionPeers}
                    message={{ threadId, messageId: message.id }}
                    youtubeSendToBot={(body) => dispatch({ type: "send", botId, threadId, text: body })}
                    delivered={group?.delivered}
                  />
                </div>
              ) : null}
              {group && <AttachmentGallery images={group.images} files={group.files} message={{ threadId, messageId: message.id }} eager={eagerAttachments} beneath />}
            </MessageBoundary>
          )}
        </div>
        {!user && (
          <MessageBar
            side="bot"
            time={formatTime(message.at)}
            visible={viewRaw || speaking}
            copy={text || undefined}
            onReply={() => onReply(message)}
            requestId={message.id.startsWith("optimistic-") ? undefined : message.id}
            react={react}
            view={<>
              {message.kind === "text" && text && !peer && (
                <SpeakMenuItem text={text} botId={botId} messageId={message.id} voiceId={voiceId} tts={tts} localVoice={localVoice} />
              )}
              {text && (
                <MessageMenuItem
                  label={t(viewRaw ? "chat.showRenderedMarkdown" : "chat.showRawMarkdown")}
                  icon={viewRaw ? <Eye {...HOVER_ICON} /> : <Code {...HOVER_ICON} />}
                  active={viewRaw}
                  onSelect={() => setViewRaw((r) => !r)}
                />
              )}
            </>}
          >
            {!busy && onRegenerate && (
              <MessageMenuItem label={t("chat.regenerate")} icon={<RefreshCw {...HOVER_ICON} />} onSelect={onRegenerate} />
            )}
            <MessageMenuItem
              label={pinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
              icon={pinned ? <PinOff {...HOVER_ICON} /> : <Pin {...HOVER_ICON} />}
              onSelect={togglePin}
              hidden={remoteClient}
            />
          </MessageBar>
        )}
      </div>
      <ReactionChips reactions={message.reactions} selfIds={reactionSelf} bots={bots} end={user} onToggle={(emoji) => toggleReactionOn(message.id, emoji)} />
      {/* always laid out, only faded in: the answer above never moves (2026-10-15) */}
      {!user && !peer && message.turnRun && <TurnRunLine run={message.turnRun} visible={dwell.shown} />}
      {forks.length > 1 && (
        <div className="mt-1 flex items-center gap-0.5 pr-1 text-[12px] text-ink-secondary">
          <button
            onClick={() => switchTo(forks[versionIndex - 1])}
            disabled={versionIndex <= 0 || busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title={t("chat.previousVersion")}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums">
            {versionIndex + 1}/{forks.length}
          </span>
          <button
            onClick={() => switchTo(forks[versionIndex + 1])}
            disabled={versionIndex >= forks.length - 1 || busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title={t("chat.nextVersion")}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
});

/** Who wrote a relayed line and how it arrived, above the bubble — the
 * same shape as a room's cluster label. Looked up by id, then by name for
 * rows that predate Message.peerAsk; a peer since renamed or deleted still
 * shows the name the line carries. Renders with its bubble. */
