import { useBotUnread } from "../unread-notice";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch } from "react";
import { BotAvatar } from "../Avatar";
import { BotChatHeader, BotHeaderPill, botPillActions, type ChatWindowContextValue } from "../BotHeaderPill";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { MAUS_COLORS, stateForBot } from "@/lib/mascot";
import { botBubbleVars } from "@/lib/bubble-colors";
import { mascotRowAnimated } from "@/lib/mascot-animate";
import { peerLine } from "@/lib/peer-message";
import { showWorkingDots } from "@/lib/turn-tail";
import { lastNonReceipt } from "@/lib/receipts";
import { liveActivityPhrases } from "@/lib/live-activity";
import { useOnCall } from "@/lib/call";
import { pendingApprovals } from "../PendingApproval";
import { latestFailure, latestReply, type TranscriptSnapshot } from "@/lib/transcript-announcer";
import { splitTranscriptCitations } from "@/lib/citations";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { latestPageVersionIn } from "@/lib/open-page";
import type { Action, Bot, ConfigStatus, Message } from "@/state/store";
import type { SideChat } from "./sideChat";

export function useChatViewPresence({
  bot,
  profile,
  messages,
  dispatch,
  state,
  side,
  pillPanelOpen,
  mascotMotion,
  pendingQueued,
  canWrite,
  openPage,
  pageStage,
  composerDockHeight,
}: {
  bot: Bot;
  profile: Bot;
  messages: Message[];
  dispatch: Dispatch<Action>;
  state: {
    config: ConfigStatus | null | undefined;
    panelOwner: unknown;
    settingsOpen?: boolean;
    computerOpen?: boolean;
  };
  side?: SideChat;
  pillPanelOpen: boolean;
  mascotMotion: { kind?: string; nonce?: number } | null;
  pendingQueued: Record<string, unknown[] | undefined>;
  canWrite: boolean | null | undefined;
  openPage: { pageId: string } | null | undefined;
  pageStage: boolean;
  composerDockHeight: number;
}) {
  const { noticing } = useBotUnread(bot);
  // one message at a time may be in edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => setEditingId(null), [bot.id, bot.threadId]);
  // stable handler identities — MessagesList is memo'd on them
  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const submitEdit = useCallback(
    (messageId: string, text: string) => {
      setEditingId(null); // closes the editor first — a double Enter can't fork twice
      dispatch({ type: "editMessage", botId: bot.id, threadId: bot.threadId, messageId, text });
    },
    [bot.id, bot.threadId, dispatch],
  );
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user" && m.kind === "text" && !peerLine(m)),
    [messages],
  );
  const lastUserMessageHasAttachments = useMemo(() => {
    if (!lastUserMessage?.text) return false;
    const cited = splitTranscriptCitations(lastUserMessage.text);
    const attached = splitTranscriptAttachments(cited.display);
    return cited.citations.length > 0 || attached.images.length > 0 || attached.files.length > 0;
  }, [lastUserMessage]);

  // The activity line while the turn works (TurnPresence): thinking, then
  // typing once answer text streams. The text itself stays invisible — when
  // the reply is finished, the whole bubble pops in where the line was.
  // The working line reads the last real message: a finished call's record
  // (and a turn's receipts) can trail a turn that is still working.
  const lastMessage = lastNonReceipt(messages);
  const activity = liveActivityPhrases(lastMessage);
  const waiting = Boolean(
    bot.busy &&
      bot.activity !== "waiting-on-you" &&
      showWorkingDots(bot.busy, lastMessage),
  );
  const wasWaiting = useRef(false);
  // the reply was drawn as it was written (LiveReply): it settles in place
  // On a call the words are spoken, not typed out (same as iOS ChatLiveTail).
  const onCall = useOnCall() === bot.id;
  const liveShown = useRef(false);
  const [popping, setPopping] = useState<string | null>(null);
  const poppingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
  }, []);
  useLayoutEffect(() => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    poppingTimer.current = null;
    wasWaiting.current = false;
    liveShown.current = false;
    setPopping(null);
  }, [bot.id]);
  useEffect(() => {
    if (waiting) wasWaiting.current = true;
  }, [waiting]);
  useLayoutEffect(() => {
    if (lastMessage?.role !== "bot" || lastMessage.kind !== "text" || !wasWaiting.current) return;
    wasWaiting.current = false;
    if (liveShown.current) {
      liveShown.current = false;
      return;
    }
    const messageId = lastMessage.id;
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    setPopping(messageId);
    poppingTimer.current = setTimeout(() => {
      poppingTimer.current = null;
      setPopping((current) => current === messageId ? null : current);
    }, 520);
  }, [lastMessage?.id, lastMessage?.role, lastMessage?.kind]);
  const presenceVisible = waiting || popping !== null;
  const announcement = useMemo((): TranscriptSnapshot => {
    const approval = pendingApprovals(messages)[0];
    return {
      busy: Boolean(bot.busy),
      reply: latestReply(messages, () => bot.name),
      failure: latestFailure(messages, () => bot.name),
      approval: approval ? { id: approval.requestId, name: bot.name } : undefined,
    };
  }, [messages, bot.busy, bot.name]);
  // Wall-clock anchor for the working row's elapsed readout — the server
  // stamps the turn's real start (turnStartedAt), so switching threads keeps
  // the count truthful; Date.now() only covers servers without the stamp.
  const [busySince, setBusySince] = useState<number | null>(null);
  useEffect(() => {
    setBusySince(bot.busy ? bot.turnStartedAt ?? Date.now() : null);
  }, [bot.busy, bot.id, bot.threadId, bot.turnStartedAt]);

  // regenerate = fork the last user message with the same text — reuses the
  // existing branch machinery, so the old answer stays reachable via ‹ ›
  const regenerate = useCallback(() => {
    if (lastUserMessage?.text && !bot.busy && !lastUserMessage.id.startsWith("optimistic-")) {
      dispatch({ type: "editMessage", botId: bot.id, threadId: bot.threadId, messageId: lastUserMessage.id, text: lastUserMessage.text });
    }
  }, [lastUserMessage, bot.busy, bot.id, bot.threadId, dispatch]);

  const currentLink = profile.tasks?.find((task) => task.threadId === bot.threadId)?.link;
  const threadLink = useMemo(() => canWrite !== false
    ? { link: currentLink, assign: (link: string | null) => dispatch({ type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { link } }) }
    : null, [canWrite, currentLink, bot.id, bot.threadId, dispatch]);


  const latestPageVersion = useMemo(() => (openPage ? latestPageVersionIn(messages, openPage.pageId) : undefined), [openPage, messages]);

  const Root = side ? "section" : "main";
  // The bot pill: mascot, name, chevron. The main chat's opens the panel
  // at the right; a split-view section's opens its own (side.panel).
  const panelPillOpen = side ? side.panel?.open === true : pillPanelOpen;
  const togglePanelFromPill = side?.panel ? side.panel.onToggle : () => {
    if (state.panelOwner) dispatch({ type: "toggleSettings", open: true, owner: null });
    else for (const action of botPillActions(pillPanelOpen)) dispatch(action);
  };
  const botPill = (
    <BotHeaderPill
      name={bot.name}
      panelOpen={panelPillOpen}
      onToggle={togglePanelFromPill}
      avatar={
        <BotAvatar
          bot={bot}
          primary={isViewersPrimaryBot(bot, viewerActorId(state.config))}
          primaryRingClassName="ring-elevated"
          state={stateForBot({ ...bot, messages })}
          size={22}
          motion={(mascotMotion?.kind as never) ?? "none"}
          motionKey={mascotMotion?.nonce ?? 0}
          animated={mascotRowAnimated(bot, pendingQueued as Record<string, unknown[]>, mascotMotion?.kind as never, noticing)}
        />
      }
    />
  );
  // The main chat's header, like Grok Bot (#2141): the name pill only, which
  // toggles the bot panel. No sharing pill, no gear (JC 2026-11-06).
  const chatHeader = side ? null : (
    <BotChatHeader
      name={bot.name}
      label={bot.title}
      panelOpen={pillPanelOpen}
      onToggle={() => {
        if (state.panelOwner) dispatch({ type: "toggleSettings", open: true, owner: null });
        else for (const action of botPillActions(pillPanelOpen)) dispatch(action);
      }}
      avatar={
        <BotAvatar
          bot={bot}
          primary={isViewersPrimaryBot(bot, viewerActorId(state.config))}
          primaryRingClassName="ring-elevated"
          state={stateForBot({ ...bot, messages })}
          size={22}
          motion={(mascotMotion?.kind as never) ?? "none"}
          motionKey={mascotMotion?.nonce ?? 0}
          animated={mascotRowAnimated(bot, pendingQueued as Record<string, unknown[]>, mascotMotion?.kind as never, noticing)}
        />
      }
    />
  );
  // My bubble (and its inline editor) in the bot's colour, whatever the
  // skin's accent (src/lib/bubble-colors.ts, botBubbleVars).
  const bubbleStyle = botBubbleVars(MAUS_COLORS[bot.color]) as CSSProperties;
  // #2149: a window over this chat (coding, a bot-to-bot or routine
  // conversation) toggles the same panel from its pill, ends above this
  // composer, and closes when the person sends here.
  const togglePanelRef = useRef(togglePanelFromPill);
  togglePanelRef.current = togglePanelFromPill;
  const windowSentKey = lastUserMessage?.id;
  const chatWindow = useMemo<ChatWindowContextValue | null>(() => (side && !side.panel ? null : {
    panelOpen: panelPillOpen,
    onTogglePanel: () => togglePanelRef.current(),
    composerInset: pageStage ? 0 : composerDockHeight,
    sentKey: windowSentKey,
  }), [side, panelPillOpen, pageStage, composerDockHeight, windowSentKey]);

  return {
    editingId, setEditingId, startEdit, cancelEdit, submitEdit,
    lastUserMessage, lastUserMessageHasAttachments,
    lastMessage, activity, waiting, onCall, liveShown, popping, presenceVisible,
    announcement, busySince, regenerate, currentLink, threadLink, latestPageVersion,
    botPill, chatHeader, chatWindow, bubbleStyle, Root,
  };
}
