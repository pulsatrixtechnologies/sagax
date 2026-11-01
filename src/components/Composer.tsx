import { track } from "@/lib/analytics";
import { currentOpenPage } from "@/lib/open-page";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { ArrowUp, Clock, Target, Users, X } from "lucide-react";
import { ComposerSendBlock } from "@/components/ComposerSendBlock";
import { useSendBlock } from "@/lib/send-state";
import { useStoreDispatch, useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { api, visibleMessages, currentTaskBot, type Bot, type Group, type Message } from "@/state/store";
import { orgFullAccessFor } from "@/lib/full-access";
import { useOrgPeople, usePerspicaxOrg } from "@/lib/perspicax-org";
import { MENTION_ALL, roomAllowsMentionAll, roomMentionPeople, type RoomMentionPerson } from "@/lib/person-mentions";
import { viewerActorId } from "@/lib/viewer";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { activeLocale, t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { composerPlaceholder } from "@/lib/composer-placeholder";
import { useBoundedLock } from "@/lib/composer-lock";
import { pendingQuestions } from "@/lib/pending-question";
import { consumeRetroCommand, retroSignal } from "@/lib/retro98";
import { reportAchievement } from "@/lib/achievements";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { canTeachInBrowser } from "@/lib/bot-capabilities";
import { imeComposing, sendKeyLabel, sendsMessage, useSendKey } from "@/lib/send-key";
import {
  draftRevision,
  appendDraftAttachments,
  changeDraftAttachmentPending,
  failedComposerSends,
  forgetFailedComposerSend,
  useNetworkOnline,
  markDraftEdited,
  prependComposerDraft,
  recoverFailedComposerSend,
  rememberFailedComposerSend,
  restoredSendId,
  restoredRequestText,
  useComposerDraft,
  useComposerChannelMode,
  useDraftAttachmentPending,
  useFailedComposerSends,
  type ComposerSendSnapshot,
  type FailedComposerSend,
} from "@/lib/drafts";
import { BotAvatar } from "./Avatar";
import { ComposerMenuRow } from "./ComposerMenuRow";
import { MentionTextarea } from "./MentionTextarea";
import { ComposerAttachments, pathForFile } from "./ComposerAttachments";
import { splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { effectivePlace } from "@/lib/place";
import { FullAccessWarning } from "./FullAccessWarning";
import { ModelPicker, type ComposerModelMenuControl } from "./ModelPicker";
import { CallButton } from "./CallView";
import { GroupCallButton } from "./GroupCallView";
import { NudgeButton } from "./NudgeButton";
import { CommandAllowlistDialog } from "./CommandAllowlistDialog";
import { isStopIntent } from "../../shared/stop-intent";
import {
  appendPastedText,
  clipboardHasImages,
  clipboardOtherFiles,
  composeMessage,
  dataContextFor,
  withPageContext,
  composerShouldRefocus,
  composerTakesFocusOnOpen,
  replyTargetTakesFocus,
  intakeFiles,
  isLongPaste,
  pasteAttachment,
  snapshotClipboardImages,
  releaseAttachmentImagePreview,
  type Attachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { cancelAttachmentUpload, cancelAttachmentUploads, forgetAttachmentUploads, retryAttachmentUpload, startAttachmentUpload } from "@/lib/attachment-uploads";
import { normalizeState } from "@/lib/mascot";
import { goalCoordinatorForComposer, groupComposerHint, jevRoomRoutingOn, openTaskWorking, roomRespondersForComposer, roomTakesImages } from "@/lib/group-routing";
import { ultracodeFromSelection } from "@/lib/ultracode-chrome";
import { PendingApprovalBox, pendingApprovals, type Pending } from "./PendingApproval";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { ComposerReplyStrip } from "./ReplyQuote";
import { prewarmConversation } from "@/lib/prewarm";
import { escapeCancelsReply } from "@/lib/replies";
import { useThreadRefs } from "./ThreadRefs";
import {
  QueuedComposerMessages,
  composerCanSteerQueuedMessages,
  doubleEnterSteerWindowExpiresAt,
  doubleEnterSteersQueue,
} from "./ComposerQueuedMessages";
import { useParallelCards } from "./parallel-approvals";
import { QuestionCard } from "./QuestionCard";
import { useOnCall } from "@/lib/call";
import { browserAvailable, builtInBrowserEnabled, dataWindowEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { requestBrowserTeach } from "@/lib/teach-request";
import { TeachChooserDialog, TeachStepsDialog } from "./TeachStepsDialog";
import { MyChromeRecordDialog } from "./MyChromeRecordDialog";
import { myChromeCall, type MyChromeRecordingResult } from "@/lib/my-chrome";
import { useRetroSkin } from "./RetroChromeHost";
import { mentionChoicesForQuery, mentionRowDescription } from "@/lib/mentions";
import { serializeThreadRefs, threadTokenFromPaste, threadTokenSpacing } from "@/lib/thread-refs";
import {
  composerCommandMenu,
  skillCommandInsertion,
  composerGroupCommandMenu,
  composerGroupSlashTrigger,
  composerSlashTrigger,
  engineCommandInsertion,
  groupCommandTargets,
  goalSubcommandBlock,
  goalSubcommandFromComposer,
  goalTextFromComposer,
  replaceComposerSlashTrigger,
  GOAL_SUBCOMMANDS,
  type GoalSubcommand,
  type ComposerMenuItem,
  type ComposerSlashCommand,
  type GroupEngineCommands,
} from "@/lib/composer-commands";
import { useGroupHarnessCommands, useHarnessCommands } from "@/lib/harness-commands";
import { useSlashSkills } from "@/lib/use-slash-skills";
import { LOOP_SUBCOMMANDS, loopRoutineName, parseLoopCommand, type LoopCommand } from "@/lib/composer-loop";
import { ComposerCommandMenu } from "./ComposerCommandMenu";
import { ComposerNoticeBand, WorkplaceNotice } from "./WorkplaceNotice";
import { ATTACH_ICON, ComposerCtaSeat, ComposerMicButton, ComposerPlusMenu, ComposerSendButton, DictationChip, RecordMark, VoiceNoteChip, type PlusMenuItem } from "./ComposerControls";
import { useComposerDictation } from "./useComposerDictation";
import { useVoiceNoteRecorder } from "./useVoiceNoteRecorder";
import { dictationEngine, isDictationHold, joinDictated } from "@/lib/composer-dictation";
import { botCtaColors } from "@/lib/voice-cta";
import { useVoiceModeCheck } from "@/lib/voice-mode/api";
import { openProviderKeyDialog } from "./settings/ProviderKeys";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

type MentionChoice = { id: string; name: string; bot?: Bot; person?: RoomMentionPerson; all?: true };

interface ComposerDraftSnapshot extends ComposerSendSnapshot {
  reply: Message | null;
}

/** Renders the editable message composer and its pending attachments. */
/** Asked by the desktop mascot's balloon (FloatingBots.tsx): `detail.botId`'s composer opens its file picker. */
/** One empty queue, so a thread with nothing queued keeps the same array. */
const NO_QUEUED: readonly never[] = [];

export const COMPOSER_ATTACH_EVENT = "omb:composer-attach";

export function Composer({
  bot: profile,
  group,
  members,
  onEditLast,
  nudgePeer = null,
  nudgeGroup = null,
  replyTo,
  onClearReply,
  onConsumeReply,
  onRestoreReply,
  aboutPage,
  focusOnOpen = true,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  onEditLast?: () => void;
  /** The other person, only on a person-to-person conversation. */
  /** `threadId`: the person conversation's thread on screen (the nudge line goes there). */
  nudgePeer?: { id: string; name: string; threadId?: string } | null;
  /** The group chat, when it names someone other than the viewer. */
  nudgeGroup?: { id: string; name: string } | null;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onConsumeReply?: () => void;
  onRestoreReply?: (message: Message, threadId: string) => void;
  /** Title of the page this composer is docked on (stage chat, lot 5): its
   * accessible name becomes "Message about <title>"; the visible
   * placeholder keeps naming the bot (measured Grok). */
  aboutPage?: string;
  /** False when the conversation gives focus back elsewhere as this composer
   * mounts (ChatView after a page closes: back to what opened the page). */
  focusOnOpen?: boolean;
}) {
  const bot = profile ? currentTaskBot(profile) : undefined;
  // 2026-10-29: the box locks only while a thread's page is on its way, and
  // for a bounded time (src/lib/composer-lock.ts): a page that never lands
  // (a server restart, a dropped fetch) must not keep the person from
  // writing. A pending approval never locks it either: the person answers
  // the card or writes past it, and their words join the running turn at
  // its next safe point or wait for it (server/busy-routing.ts).
  const locked = useBoundedLock(Boolean(bot?.awaitingThreadSnapshot));
  // Slices of the store, so a dispatch elsewhere (an unread mark, another
  // bot's frame) does not render the composer while someone types.
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const storeBots = useStoreSelector((current) => current.bots);
  const routines = useStoreSelector((current) => current.routines);
  const config = useStoreSelector((current) => current.config);
  const instances = useStoreSelector((current) => current.instances);
  const ownerOrAdmin = useOwnerOrAdmin();
  const { threads, currentBotId } = useThreadRefs();
  const { capabilities } = useDesktopCapabilities();
  // Enter, Shift+Enter or Ctrl/⌘+Enter, from Settings → Appearance; the hints name it.
  const sendKey = useSendKey();
  const sendLabel = sendKeyLabel(sendKey);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  // Unified target: a 1:1 bot thread or a room. In a room the @ picker
  // offers members plus @everyone; explicit mentions override the room's
  // configured default responder.
  const threadId = group?.threadId ?? bot?.threadId ?? "";
  // The maintainer, 2026-10-27: a bot that certainly cannot answer this person (its
  // engine not connected for them, the computer or local server behind its
  // model down) does not take the message; one line says why and what to do,
  // and the draft stays. Asked again when the bot or its engines change.
  const sendStateKey = bot ? `${bot.modelSelection.instanceId}\u0000${bot.modelSelection.model}\u0000${bot.activity ?? ""}\u0000${instances.map((instance) => `${instance.instanceId}:${instance.snapshot?.authenticated ?? ""}`).join(",")}` : "";
  const sendState = useSendBlock(!group ? bot?.id : undefined, !group ? bot?.threadId : undefined, sendStateKey);
  const sendBlock = sendState.block;
  const currentGroupTask = group?.tasks?.find((task) => task.threadId === threadId);
  const groupBusyBotId = currentGroupTask?.busyBotId ?? (currentGroupTask?.working ? group?.busyBotId : (group?.threadId === threadId ? group?.busyBotId : null));
  const groupWorking = group ? openTaskWorking(group) : false;
  const busy = group ? Boolean(groupWorking || groupBusyBotId) : Boolean(bot?.busy);
  // an engine with a live session takes a message INTO the running turn;
  // for those the composer never locks — the server steers instead of 409.
  // A room steers through its busy speaker's engine, mirroring how the
  // server's queue-steer route resolves the running turn.
  const steerInstanceId = group
    ? members?.find((member) => member.id === groupBusyBotId)?.modelSelection.instanceId
    : bot?.modelSelection.instanceId;
  const canSteer =
    instances.find((i) => i.instanceId === steerInstanceId)?.capabilities?.queueing === true;
  // The conversation's own place, when pinned; the chip reads it next to the bot default.
  const composerTask = profile?.tasks?.find((task) => task.threadId === threadId);
  // the VISIBLE branch only — an approval left on a branch you edited away
  // from must not keep blocking the composer
  // this conversation's own, then those its parallel tasks wait on
  // #1145: with threads hidden, every parallel task of the one conversation,
  // its questions included: the person never leaves it to answer
  const showThreadsHere = useShowThreads();
  const parallelCards = useParallelCards(group ? undefined : bot, !showThreadsHere);
  const parallelApprovals = parallelCards.pendings;
  const parallelQuestions = parallelCards.questions;
  const approvals = [...pendingApprovals(group ? group.messages : bot ? visibleMessages(bot) : []), ...parallelApprovals];
  const approval = approvals[0];
  // A bot's question waits in the chat; the composer stays free. Writing
  // about something else leaves it open (the bot never picks for the
  // person, and there is no X on a waiting question, #885).
  const openQuestions = pendingQuestions(group ? group.messages : bot ? visibleMessages(bot) : []);
  const approvalBotFor = (pending: Pending) => group
    ? members?.find((member) => member.id === pending.message.from?.botId) ??
      members?.find((member) => member.id === groupBusyBotId)
    : bot;
  // A send while this 1:1 conversation works is "auto" (2026-10-18): the
  // bot decides whether it joins the running work, runs as a parallel task
  // or waits for it (server/busy-routing.ts). Nobody is asked. On a voice
  // call the words join the running turn.
  const onCall = useOnCall();
  const autoRoutesBusySend = Boolean(bot && !group && busy && onCall !== bot.id);
  // Per-thread draft: switching bots unmounts this component, so both the
  // text and its attachment chips have to outlive it (see lib/drafts).
  const draftId = group
    ? `group:${group.id}:${group.threadId}`
    : `bot:${bot?.id ?? ""}:${bot?.threadId ?? ""}`;
  const [text, setText, attachments, setAttachments] = useComposerDraft(
    draftId,
    !group && bot ? `bot:${bot.id}` : undefined,
  );
  const pendingUploads = useDraftAttachmentPending(draftId);
  const attachmentPending = pendingUploads || attachments.some((attachment) =>
    (attachment.kind === "file" || attachment.kind === "image") && Boolean(attachment.uploading || attachment.uploadError));
  const failedSends = useFailedComposerSends(draftId);
  // Goal mode is opt-in and one-shot so the next ordinary channel message
  // cannot accidentally start another multi-turn team run.
  const [channelMode, setChannelMode] = useComposerChannelMode(draftId);
  // Pre-warm (src/lib/prewarm.ts): the engine starts when the person opens
  // this conversation or types in it, so the first message is not cold.
  const warmBotId = !group && bot ? bot.id : undefined;
  const warmThreadId = !group && bot ? bot.threadId : undefined;
  useEffect(() => {
    prewarmConversation(api, warmBotId, warmThreadId);
  }, [warmBotId, warmThreadId]);
  const editText = useCallback(
    (next: string) => {
      markDraftEdited(draftId);
      setText(next);
      if (next.trim()) prewarmConversation(api, warmBotId, warmThreadId, Date.now(), true);
    },
    [draftId, setText, warmBotId, warmThreadId],
  );
  const editAttachments = useCallback(
    (next: SetStateAction<Attachment[]>) => {
      markDraftEdited(draftId);
      setAttachments(next);
    },
    [draftId, setAttachments],
  );
  const restoreDraft = useCallback(
    (sent: ComposerDraftSnapshot) => {
      // Shared recovery reaches a newly mounted view after navigation and
      // falls back to a separate retry item when a newer draft already exists.
      if (recoverFailedComposerSend(sent) === "restored") {
        if (sent.reply) onRestoreReply?.(sent.reply, sent.threadId);
      }
    },
    [onRestoreReply],
  );
  const addAttachments = useCallback(
    (next: Attachment[]) => appendDraftAttachments(draftId, next),
    [draftId],
  );
  const removeAttachment = useCallback(
    (id: string) => {
      cancelAttachmentUpload(id);
      const removed = attachments.find((attachment) => attachment.id === id);
      if (removed?.kind === "image") releaseAttachmentImagePreview(removed);
      editAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    },
    [attachments, editAttachments],
  );
  const displayPasteInChatBox = useCallback(
    /** Moves one pasted attachment into the editable draft and restores focus. */
    function displayPasteInChatBox(attachment: PasteAttachment) {
      const nextText = appendPastedText(text, attachment.text);
      editText(nextText);
      editAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      setCaret(nextText.length);
      setDismissedAt(null);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(nextText.length, nextText.length);
      });
    },
    [text, editText, editAttachments],
  );
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const [dismissedSlashAt, setDismissedSlashAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  // the latest caret, readable from callbacks without re-creating them
  const caretRef = useRef(0);
  caretRef.current = caret;
  /** Returns keyboard focus to the draft, keeping the caret where it was. */
  const refocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerShouldRefocus(document.activeElement, input)) return;
      const at = Math.min(caretRef.current, input.value.length);
      input.focus();
      input.setSelectionRange(at, at);
    });
  }, []);
  // The composer is keyed by thread, so mounting means a thread was just
  // opened: put the caret at the end of its draft so the person can type
  // without clicking the box first. Touch screens are skipped — focusing
  // there pops the on-screen keyboard over the conversation.
  const focusOnOpenRef = useRef(focusOnOpen);
  useEffect(() => {
    if (!focusOnOpenRef.current) return;
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // Choosing a message to reply to means typing the reply comes next, so the
  // caret follows the new target the same way it does when a thread opens.
  // A reply restored with the thread is the open effect's; the ref starts on
  // it so the two never both run.
  const replyToId = replyTo?.id ?? null;
  const focusedReplyRef = useRef(replyToId);
  useEffect(() => {
    const previous = focusedReplyRef.current;
    focusedReplyRef.current = replyToId;
    if (!replyTargetTakesFocus(previous, replyToId)) return;
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [replyToId]);
  const mentionListRef = useRef<HTMLDivElement>(null);

  // image paste is offered only when every bot that will actually answer
  // can open one. sendGroup routes to mentions, else the room default —
  // `members.some` would let a mixed room send <attached-image> to Grok.
  const botSupportsImages = (candidate?: Bot) =>
    Boolean(
      candidate &&
        instances.find((i) => i.instanceId === candidate.modelSelection.instanceId)?.capabilities?.images,
    );
  const imageTargetsSupport = (message: string, mode: "chat" | "goal") => {
    if (!group) return botSupportsImages(bot);
    if (mode === "goal") {
      return botSupportsImages(goalCoordinatorForComposer(message, members ?? [], group) ?? undefined);
    }
    const responders = roomRespondersForComposer(message, members ?? [], group);
    return roomTakesImages(group, responders, botSupportsImages);
  };
  const typedGoalText = (group && !group.dm) || !group ? goalTextFromComposer(text) : null;
  const effectiveText = typedGoalText ?? text;
  const effectiveChannelMode = typedGoalText !== null ? "goal" : channelMode;
  const engineSupportsImages = imageTargetsSupport(effectiveText, effectiveChannelMode);

  // ── Slash commands and @mentions ─────────────────────────────────────
  // In a group "/" also opens right after a leading @mention: that bot's
  // engine commands only (shared/harness-commands.ts groupCommandTarget).
  const groupSlash = group && !group.dm ? composerGroupSlashTrigger(text, caret, members ?? []) : null;
  const slash = group && !group.dm ? groupSlash?.trigger ?? null : composerSlashTrigger(text, caret);
  const locale = activeLocale();
  // The engine's own commands (Claude Code, Codex) for a 1:1 conversation,
  // read the first time "/" is typed there (src/lib/harness-commands.ts).
  // On an organization server the list is the signed-in person's own, so the
  // cache is theirs too.
  const commandViewerId = config?.viewer?.principalId ?? null;
  const engineCommands = useHarnessCommands(api, !group ? bot?.id : undefined, threadId || undefined, Boolean(slash) && !group, commandViewerId);
  // The bot's own enabled skills, each run for one turn with `/name`
  // (shared/skill-command.ts). A 1:1 chat only: in a room the command would
  // reach several bots, each with its own skills.
  const slashSkills = useSlashSkills(!group ? bot?.id : undefined, Boolean(slash) && slash?.start !== dismissedSlashAt && !group);
  // In a group: the commands of the bot(s) the command would reach, per bot.
  const groupSlashOpen = Boolean(groupSlash);
  const groupSlashBotId = groupSlash?.botId;
  const groupTargets = useMemo(
    () => groupSlashOpen && group ? groupCommandTargets({ botId: groupSlashBotId }, members ?? [], group.defaultResponder) : [],
    [groupSlashOpen, groupSlashBotId, group, members],
  );
  const groupEngineCommands = useGroupHarnessCommands(api, groupTargets.map((target) => target.bot.id), group && !group.dm ? group.id : undefined, threadId || undefined, groupSlashOpen, commandViewerId);
  const commandListRef = useRef<HTMLDivElement>(null);
  const supportsAgents = (candidate?: Bot) =>
    Boolean(
      candidate &&
        instances.find(
          (instance) => instance.instanceId === candidate.modelSelection.instanceId,
        )?.capabilities?.agentsMcp,
    );
  // /learn: also the + menu's "Teach a task"
  const learnAvailable = skillAuthoringEnabled(config) &&
    (group ? (members ?? []).some(supportsAgents) : supportsAgents(bot));
  // ...which can also be shown in the bot's browser (a recording) when this
  // person can open that browser (the Browser panel's own conditions).
  const browserTeach = Boolean(bot && !group && bot.browser !== false && canTeachInBrowser(config, bot, ownerOrAdmin)
    && (builtInBrowserEnabled(config) || browserAvailable(config)) && config?.browserEngine?.kind === "engine");
  const [teachChooser, setTeachChooser] = useState(false);
  // ...or shown in the person's own Chrome (My Chrome's recorder), where this
  // server offers My Chrome to this person (its status answers them only).
  const [myChromeOffered, setMyChromeOffered] = useState(false);
  const [myChromeRecord, setMyChromeRecord] = useState(false);
  const [myChromeTaught, setMyChromeTaught] = useState<MyChromeRecordingResult | null>(null);
  const myChromeBotId = bot && !group && !remoteClient ? bot.id : "";
  useEffect(() => {
    if (!myChromeBotId) { setMyChromeOffered(false); return; }
    let live = true;
    myChromeCall("status").then((status) => { if (live) setMyChromeOffered(status.offered); }, () => { if (live) setMyChromeOffered(false); });
    return () => { live = false; };
  }, [myChromeBotId]);
  const showInBrowser = () => {
    if (!bot) return;
    requestBrowserTeach(bot.id);
    dispatch({ type: "toggleComputer", open: true });
  };
  // The room's latest goal run, its card in the transcript: what /goal
  // status, resume and stop act on.
  const latestGoalRun = useMemo(() => {
    if (!group || group.dm) return null;
    for (let index = group.messages.length - 1; index >= 0; index -= 1) {
      const message = group.messages[index]!;
      if (message.kind === "goal.run" && message.goalRun) return { messageId: message.id, run: message.goalRun };
    }
    return null;
  }, [group]);
  const goalStatus = latestGoalRun?.run.status;
  const commandCandidates = useMemo((): ComposerMenuItem[] => {
    if (!slash || slash.start === dismissedSlashAt) return [];
    const available: ComposerSlashCommand[] = [];
    if ((group && !group.dm) || !group) {
      available.push({
        id: "goal",
        label: "/goal",
        description: t(group ? "composer.command.goalDesc" : "composer.command.soloGoalDesc"),
        argumentHint: t("composer.command.goalHint"),
      });
      // A team's subcommands. In a 1:1, /goal status and /goal stop are sent as text.
      if (group) for (const sub of GOAL_SUBCOMMANDS) {
        const block = goalSubcommandBlock(sub, goalStatus);
        available.push({
          id: `goal-${sub}`,
          label: `/goal ${sub}`,
          description: t(`composer.goal.sub.${sub}`),
          ...(block ? { unavailableReason: t(`composer.goal.block.${block}`) } : {}),
        });
      }
    }
    if (learnAvailable) {
      available.push({
        id: "learn",
        label: "/learn",
        description: t("composer.command.learnDesc"),
      });
    }
    // Setup mode needs the agents tools (propose_profile and friends) and a
    // single bot: a room cannot set itself up.
    if (!group && supportsAgents(bot)) available.push({
      id: "setup",
      label: "/setup",
      description: t("composer.command.setupDesc"),
    });
    if (bot || (group && !group.dm)) {
      available.push({
        id: "loop",
        label: "/loop",
        description: t("composer.command.loopDesc"),
        argumentHint: t("composer.command.loopHint"),
      });
      for (const sub of LOOP_SUBCOMMANDS) {
        available.push({
          id: `loop-${sub}`,
          label: `/loop ${sub}`,
          description: t(`composer.loop.sub.${sub}`),
        });
      }
    }
    return group
      ? composerGroupCommandMenu(groupSlashBotId ? [] : available, groupTargets.map((target): GroupEngineCommands => ({
        bot: { id: target.bot.id, name: target.bot.name },
        commands: groupEngineCommands.lists.find((list) => list.botId === target.bot.id)?.answer.commands ?? [],
        mention: target.mention,
      })), slash.query)
      : composerCommandMenu(available, engineCommands.answer?.commands ?? [], slash.query, slashSkills);
  }, [slash, dismissedSlashAt, group, members, bot, config, instances, locale, engineCommands.answer, groupTargets, groupEngineCommands.lists, groupSlashBotId, learnAvailable, goalStatus, slashSkills]);
  const commandPickerOpen = commandCandidates.length > 0;

  // Tag another bot; the agent reaches it via ask_bot. In a room, tag a
  // person too: they get a notification (server/room-mentions.ts), and
  // @all tags all of them when the room allows it.
  const mention = mentionQueryAt(text, caret);
  const orgPeople = useOrgPeople();
  const roomPeople = useMemo(
    () => (group ? roomMentionPeople(group, orgPeople, viewerActorId(config)) : []),
    [group, orgPeople, config],
  );
  const mentionAll = group ? roomAllowsMentionAll(group) && roomPeople.length > 0 : false;
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool: MentionChoice[] = group
      ? [
          ...(!group.dm ? [{ id: "__everyone__", name: "everyone" }] : []),
          ...(mentionAll ? [{ id: "__all__", name: MENTION_ALL, all: true as const }] : []),
          ...(members ?? []).map((member) => ({ id: member.id, name: member.name, bot: member })),
          ...roomPeople.map((person) => ({ id: `person:${person.id}`, name: person.name, person })),
        ]
      : storeBots
          .filter((member) => member.id !== bot?.id && !member.hidden)
          .map((member) => ({ id: member.id, name: member.name, bot: member }));
    return mentionChoicesForQuery(pool, mention.query);
  }, [mention, dismissedAt, storeBots, bot?.id, group, members, roomPeople, mentionAll]);
  // @everyone reaches the room's visible bots. Hidden members stay out of
  // the count so the line matches who the server will actually answer.
  const mentionEveryoneCount = (members ?? []).filter((member) => !member.hidden).length;
  const mentionPickerOpen = candidates.length > 0;
  const commandMotion = useMenuMotion(commandPickerOpen);
  const mentionMotion = useMenuMotion(mentionPickerOpen);

  useEffect(
    () => setHighlight(0),
    [mention?.start, mention?.query, slash?.start, slash?.query],
  );

  // the engine's commands load after the menu opens, so the list can shrink
  // under the highlighted row
  useEffect(() => {
    if (!commandPickerOpen) return;
    setHighlight((current) => Math.min(current, commandCandidates.length - 1));
  }, [commandCandidates.length, commandPickerOpen]);

  useEffect(() => {
    if (!commandPickerOpen) return;
    commandListRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, commandPickerOpen]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    mentionListRef.current
      ?.querySelector<HTMLElement>(`[data-mention-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, mentionPickerOpen]);

  const pickMention = (peer: MentionChoice) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    editText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // picking completes this tag — close the popup so the next Enter sends
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  /** /goal status, resume, stop: picked in the "/" menu or typed and sent.
   * Status shows the run's card, resume starts its goal again (there is no
   * pause path yet), stop interrupts the room as the Stop button does. */
  const runGoalSubcommand = (sub: GoalSubcommand): boolean => {
    if (!group || goalSubcommandBlock(sub, goalStatus) || !latestGoalRun) return false;
    if (sub === "status") {
      dispatch({ type: "focusMessage", threadId: group.threadId, messageId: latestGoalRun.messageId });
      editText("");
      setChannelMode("chat");
      return true;
    }
    if (sub === "stop") {
      dispatch({ type: "interruptGroup", groupId: group.id, threadId });
      editText("");
      setChannelMode("chat");
      return true;
    }
    if (sub === "resume") {
      const goal = latestGoalRun.run.goal;
      editText(goal);
      setChannelMode("goal");
      setCaret(goal.length);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(goal.length, goal.length);
      });
      return true;
    }
    return false;
  };

  /** /loop writes a routine for this chat. It never becomes a message the bot
   * has to interpret. Status opens the routine list. Stop turns one off. */
  const runLoopCommand = (command: LoopCommand) => {
    const loopBot = bot ?? (group && !group.dm ? (members ?? []).find((member) => !member.hidden) : undefined);
    if (command.kind === "incomplete") {
      dispatch({ type: "error", message: t("composer.loop.needCadence") });
      return;
    }
    if (!loopBot) {
      dispatch({ type: "error", message: t("composer.loop.needBot") });
      return;
    }
    if (command.kind === "status") {
      dispatch({ type: "showRoutines", section: "schedule", view: "list", botId: loopBot.id });
      editText("");
      return;
    }
    if (command.kind === "stop") {
      const mine = routines.filter((routine) => routine.botId === loopBot.id && routine.schedule.type === "interval" && routine.enabled !== false);
      const named = command.name.toLowerCase();
      const hits = named
        ? mine.filter((routine) => routine.name.toLowerCase().includes(named) || routine.prompt.toLowerCase().includes(named))
        : mine.filter((routine) => routine.name.startsWith("Loop "));
      if (hits.length === 0) {
        dispatch({ type: "error", message: t("composer.loop.none") });
        return;
      }
      for (const routine of hits) dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: false } });
      dispatch({ type: "error", message: t("composer.loop.stopped") });
      editText("");
      return;
    }
    dispatch({
      type: "createRoutine",
      input: {
        name: loopRoutineName(command.everyMinutes, command.prompt),
        prompt: command.prompt,
        botId: loopBot.id,
        ...(group ? { groupId: group.id } : {}),
        schedule: { type: "interval", everyMinutes: command.everyMinutes, anchorAt: Date.now() },
        postResults: true,
        continuity: true,
      },
    });
    if (command.raised) dispatch({ type: "error", message: t("composer.loop.raised") });
    else if (command.capped) dispatch({ type: "error", message: t("composer.loop.capped") });
    editText("");
  };

  const pickCommand = (item: ComposerMenuItem | undefined) => {
    if (!slash || !item) return;
    // What the chat cannot run stays listed, with its reason, but inserts nothing.
    if (item.kind === "engine" && item.unavailable) return;
    if (item.kind === "sagax" && item.command.unavailableReason) return;
    if (item.kind === "sagax" && item.command.id.startsWith("goal-")) {
      setDismissedSlashAt(slash.start);
      runGoalSubcommand(item.command.id.slice("goal-".length) as GoalSubcommand);
      return;
    }
    if (item.kind === "sagax" && item.command.id.startsWith("loop-")) {
      setDismissedSlashAt(slash.start);
      runLoopCommand(item.command.id === "loop-stop" ? { kind: "stop", name: "" } : { kind: "status" });
      return;
    }
    const command = item.kind === "sagax" ? item.command : null;
    const replacement = item.kind === "engine"
      ? engineCommandInsertion(item)
      : item.kind === "skill" ? skillCommandInsertion(item)
      : command?.id === "learn" ? "/learn " : command?.id === "setup" ? "/setup " : command?.id === "loop" ? "/loop " : "";
    const next = replaceComposerSlashTrigger(text, slash, replacement);
    editText(next.text);
    setCaret(next.caret);
    setDismissedSlashAt(slash.start);
    setChannelMode(command?.id === "goal" ? "goal" : "chat");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  // Busy sends are owned by the harness immediately for both channels and
  // 1:1 chats. Keeping a channel follow-up in this component used to lose its
  // auto-send intent whenever navigation unmounted the composer.
  const queuedMessages = useStoreSelector((current) => current.pendingQueued[threadId]) ?? NO_QUEUED;
  const pendingCount = queuedMessages.length;
  const canSteerQueued = composerCanSteerQueuedMessages(
    busy,
    locked,
    pendingCount,
    Boolean(approval),
  );
  const [steering, setSteering] = useState(false);
  const interruptTurn = () => {
    if (group) dispatch({ type: "interruptGroup", groupId: group.id, threadId });
    else if (bot) dispatch({ type: "interrupt", botId: bot.id, threadId });
  };
  const queueHeadId = queuedMessages[0]?.queueId;
  const steerQueued = () => {
    if (!queueHeadId) return;
    setSteering(true);
    const settle = () => setSteering(false);
    if (group && canSteer) {
      // A steer-capable room folds the queued head into the running turn
      // through the server; it never interrupts the turn to do it.
      dispatch({ type: "steerGroupQueued", groupId: group.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (group) {
      // A room whose running engine cannot steer keeps the old behavior:
      // Steer ends the running turn so the next queued message starts.
      dispatch({ type: "interruptGroup", groupId: group.id, threadId, onError: settle });
    } else if (bot && canSteer) {
      // A steer-capable engine folds the queued words into the running turn
      // through the server; it never interrupts the turn to do it.
      dispatch({ type: "steerQueued", botId: bot.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (bot) {
    // Unlike the general Stop control, Steer belongs to this exact queue.
    // Scoping prevents a 1:1 queue from interrupting the same bot in a room
    // (or a routine) whose work is unrelated to the words shown here.
      dispatch({ type: "interrupt", botId: bot.id, threadId, onError: settle });
    }
  };
  useEffect(() => setSteering(false), [threadId, queueHeadId]);
  // Edit pulls a queued message back into the composer. The server removes it
  // from the queue first; only a confirmed removal hands the words back, so a
  // message that already drained into a turn can never also be resent.
  const editQueued = (queueId: string) => {
    const queued = queuedMessages.find((item) => item.queueId === queueId);
    if (!queued) return;
    const targetDraftId = draftId;
    const onCancelled = () => {
      const cited = splitTranscriptCitations(queued.text);
      if (cited.display) prependComposerDraft(targetDraftId, cited.display);
      appendDraftAttachments(targetDraftId, cited.citations);
      if (targetDraftId !== draftIdRef.current) return;
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(cited.display.length, cited.display.length);
      });
    };
    if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId, onCancelled });
    else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId, onCancelled });
  };
  // Double-Enter gesture: when a send lands as a queued chip on a busy
  // steer-capable thread (live steer lost its race, an attachment, an
  // older CLI), a second Enter within a short window pulls that queue into
  // the running turn. Plain sends never consult the window, so they keep
  // their normal latency.
  const steerAgainUntilRef = useRef(0);
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    const expiresAt = doubleEnterSteerWindowExpiresAt(
      prevPendingCountRef.current,
      pendingCount,
      busy,
      canSteer,
    );
    if (expiresAt !== null) steerAgainUntilRef.current = expiresAt;
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, busy, canSteer]);
  // Most engines acknowledge interruption quickly, but a lost response must
  // not leave a control claiming to steer forever. Queue drain or turn end
  // clears it immediately; twenty seconds is the final recovery floor.
  useEffect(() => {
    if (!busy || pendingCount === 0) {
      setSteering(false);
      return;
    }
    if (!steering) return;
    const timeout = window.setTimeout(() => setSteering(false), 20_000);
    return () => window.clearTimeout(timeout);
  }, [busy, pendingCount, steering]);
  const fileInput = useRef<HTMLInputElement>(null);
  // A headless model picker stays mounted here: the desktop mascot's model
  // chip opens it (the + menu has no Model row, as in the reference design).
  const modelMenu = useRef<ComposerModelMenuControl | null>(null);
  const composerRowRef = useRef<HTMLDivElement>(null);
  // the desktop mascot's clip (its balloon's composer row): the app comes forward and this composer picks files
  const attachBotId = bot?.id;
  useEffect(() => {
    if (!attachBotId) return;
    const onAttach = (event: Event) => {
      if ((event as CustomEvent<{ botId?: string }>).detail?.botId === attachBotId) fileInput.current?.click();
    };
    window.addEventListener(COMPOSER_ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(COMPOSER_ATTACH_EVENT, onAttach);
  }, [attachBotId]);
  const [approvalWarning, setApprovalWarning] = useState<{
    mode: "auto" | "full";
    botId: string;
    threadId: string;
  } | null>(null);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [commandAllowlistTarget, setCommandAllowlistTarget] = useState<{ botId: string; botName: string; threadId: string } | null>(null);
  // Approval mode belongs to one bot; a room has several, each with its own.
  const modeBot = group ? undefined : bot;
  const trustedThreadAccess = Boolean(!remoteClient && window.ogb?.approvals && capabilities.host.packaged);
  // Organization server: the bot's owner grants Full over HTTP while the
  // organization allows it (src/lib/full-access.ts, server/org-full-access.ts).
  const perspicaxOrg = usePerspicaxOrg();
  const viewerId = config?.viewer?.principalId ?? null;
  const orgFullAccess = orgFullAccessFor(perspicaxOrg, modeBot, viewerId);
  const fullAccessAvailable = trustedThreadAccess || orgFullAccess === "allowed";
  const uploadImage = useCallback(async (file: File): Promise<Attachment | null> => {
    await startAttachmentUpload(draftId, file, true);
    return null;
  }, [draftId]);
  const uploadFile = useCallback(async (file: File): Promise<"handled" | null> =>
    await startAttachmentUpload(draftId, file, false) ? "handled" : null, [draftId]);
  const pickFiles = async (picked: FileList | readonly File[] | null) => {
    if (!picked?.length) return;
    changeDraftAttachmentPending(draftId, true);
    try {
      const { attachments: added, notice } = await intakeFiles(Array.from(picked), {
        allowImages: engineSupportsImages,
        getPath: pathForFile,
        uploadImage,
        uploadFile,
      });
      if (added.length) addAttachments(added);
      if (notice) setAttachmentNotice(notice);
    } finally {
      changeDraftAttachmentPending(draftId, false);
    }
    // the file dialog leaves focus on the paperclip button; typing should
    // continue in the draft without another click
    refocusInput();
  };
  const hasContent = Boolean(effectiveText.trim()) || attachments.length > 0;
  const sendLabelFor = () => busy && canSteer ? t("composer.send.steer") : busy ? t("composer.send.queue") : t("composer.send.message");
  const sendTitleFor = () => busy && canSteer ? t("composer.send.steer") : busy ? t("composer.send.queueHint") : `${t("chat.send")} (${sendLabel})`;
  const retroSkin = useRetroSkin();
  const retryFailedSend = (failed: FailedComposerSend) => {
    const failedMode = failed.channelMode ?? "chat";
    if (failed.requestText.includes("<attached-image ") && !imageTargetsSupport(failed.requestText, failedMode)) {
      dispatch({ type: "error", message: t("composer.error.noImages") });
      return;
    }
    forgetFailedComposerSend(draftId, failed.id);
    const retry = {
      sendId: failed.sendId,
      text: failed.requestText,
      replyToId: failed.replyToId,
      threadId: failed.threadId,
      onSent: () => forgetAttachmentUploads(failed.attachmentIds ?? []),
      onError: () => {
        rememberFailedComposerSend(draftId, {
          sendId: failed.sendId,
          text: failed.text,
          requestText: failed.requestText,
          replyToId: failed.replyToId,
          threadId: failed.threadId,
          channelMode: failed.channelMode,
          attachmentIds: failed.attachmentIds,
        });
      },
    };
    if (group) {
      dispatch({ type: "sendGroup", groupId: group.id, mode: failedMode, ...retry });
    } else if (bot) {
      dispatch({ type: "send", botId: bot.id, ...retry });
    }
  };
  // A message queued with no network goes out by itself on reconnect.
  const online = useNetworkOnline();
  const retryFailedSendRef = useRef(retryFailedSend);
  retryFailedSendRef.current = retryFailedSend;
  useEffect(() => {
    if (!online) return;
    for (const queued of failedComposerSends(draftId)) {
      if (!queued.offline) continue;
      // Hand it to the manual retry first, so a refusal never loops on reconnect.
      queued.offline = false;
      retryFailedSendRef.current(queued);
    }
  }, [online, draftId]);
  const send = () => {
    // The Hibou 98 easter egg: the secret command toggles the retro owl and
    // is never sent to anyone.
    if (consumeRetroCommand(text, attachments.length)) {
      // using the command unlocks Trombi for good (shared/achievements-catalog.ts)
      reportAchievement("trombi.summoned");
      setText("");
      return;
    }
    if (locked || attachmentPending) return;
    // the bot cannot answer now: the draft stays, the line above says why
    if (sendBlock) { sendState.recheck(); return; }
    // `/goal stop` typed whole runs the subcommand, never a goal named "stop"
    const typedLoop = parseLoopCommand(text);
    if (typedLoop && attachments.length === 0) {
      runLoopCommand(typedLoop);
      return;
    }
    const typedGoalSub = group && !group.dm ? goalSubcommandFromComposer(text) : null;
    if (typedGoalSub) {
      const block = goalSubcommandBlock(typedGoalSub, goalStatus);
      if (block) dispatch({ type: "error", message: t(`composer.goal.block.${block}`) });
      else runGoalSubcommand(typedGoalSub);
      return;
    }
    // "stop", "arrête", "attends" alone while the turn runs: in a room, stop
    // it now like Escape. A bot's own conversation sends it: the server
    // stops the turn at once, keeps the words and answers with one
    // "Stopped" line (shared/stop-intent.ts), the same for every client.
    if (busy && group && attachments.length === 0 && isStopIntent(text)) {
      interruptTurn();
      setText("");
      return;
    }
    if (
      attachments.some((attachment) => attachment.kind === "image") &&
      !imageTargetsSupport(effectiveText, effectiveChannelMode)
    ) {
      dispatch({ type: "error", message: t("composer.error.noImages") });
      return;
    }
    // named `body`, not `t` — that name belongs to the catalog lookup now
    // resolvable "#Title" runs leave as canonical links, so the thread id
    // stays machine-readable in the stored send and the model's context
    const composed = composeMessage(serializeThreadRefs(effectiveText, threads, currentBotId), attachments);
    if (!composed) return;
    const body = restoredRequestText(draftId) ?? composed;
    // While this conversation works, the bot routes the message.
    const busyMode = autoRoutesBusySend ? "auto" as const : undefined;
    // The viewed Data result (in this bot's Data window) travels as its own
    // field of the send, never in the words: only for this bot's own thread,
    // and never ahead of an opening command the server parses first.
    // A page open over this conversation (src/lib/open-page.ts): the message
    // is about it; the chip shows on the message and the bot gets the page.
    const dataContext = withPageContext(
      dataContextFor(body, dataWindowEnabled(config) ? getState().dataView : null, !group && bot ? { botId: bot.id, threadId } : undefined),
      body,
      currentOpenPage(),
      !group && bot ? { botId: bot.id } : undefined,
    );
    const sentDraft: ComposerDraftSnapshot = {
      draftId,
      revision: draftRevision(draftId),
      sendId: restoredSendId(draftId) ?? crypto.randomUUID(),
      text,
      requestText: body,
      attachments: [...attachments],
      reply: replyTo ?? null,
      replyToId: replyTo?.id,
      threadId,
      channelMode: group ? effectiveChannelMode : undefined,
    };
    const onSent = () => forgetAttachmentUploads(sentDraft.attachments.map((attachment) => attachment.id));
    if (group) {
      dispatch({
        type: "sendGroup",
        groupId: group.id,
        text: body,
        sendId: sentDraft.sendId,
        replyToId: replyTo?.id,
        threadId,
        mode: effectiveChannelMode,
        onSent,
        onError: () => restoreDraft(sentDraft),
      });
      track("message_sent", { room: true, mode: effectiveChannelMode, queued: busy });
    } else if (bot) {
      dispatch({
        type: "send",
        botId: bot.id,
        text: body,
        sendId: sentDraft.sendId,
        replyToId: replyTo?.id,
        threadId,
        ...(effectiveChannelMode === "goal" ? { mode: "goal" as const } : {}),
        ...(busyMode ? { busyMode } : {}),
        dataContext,
        onSent,
        onError: () => restoreDraft(sentDraft),
      });
      track("message_sent", { driver: bot.modelSelection?.instanceId, queued: busy && !canSteer });
    }
    retroSignal("send");
    setText("");
    setAttachments([]);
    onConsumeReply?.();
    if (group) setChannelMode("chat");
  };

  /**
   * Handles clipboard paste events in the composer textarea: converts pasted clipboard
   * images into uploaded attachments (if supported by the responder) and converts oversized
   * text into draft attachment chips.
   *
   * @param e - Clipboard event from the composer textarea.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // an image from the clipboard becomes an uploaded attachment —
    // but only for engines that can open one; a grok bot politely
    // refuses instead of receiving a path it cannot read
    if (clipboardHasImages(e.clipboardData)) {
      e.preventDefault();
      if (!engineSupportsImages) {
        dispatch({
          type: "error",
          message: t("composer.error.noImages"),
        });
        return;
      }
      // Start the reads before this handler returns. A clipboard blob can
      // be consumed once, and the next paste would otherwise see empty bytes.
      const pendingImages = snapshotClipboardImages(e.clipboardData);
      changeDraftAttachmentPending(draftId, true);
      void (async () => {
        try {
          const imageFiles = await pendingImages;
          if (imageFiles.length === 0) {
            dispatch({ type: "error", message: t("composer.error.clipboardImage") });
            return;
          }
          const results = await Promise.allSettled(imageFiles.map(uploadImage));
          for (const result of results) {
            if (result.status === "rejected") {
              dispatch({
                type: "error",
                message: result.reason instanceof Error ? result.reason.message : "image upload failed",
              });
            }
          }
        } finally {
          changeDraftAttachmentPending(draftId, false);
        }
      })();
      return;
    }
    // a zip or a document copied in the Finder or Explorer attaches like a
    // picked file (same intake, same limits and notices)
    const otherFiles = clipboardOtherFiles(e.clipboardData);
    if (otherFiles.length > 0) {
      e.preventDefault();
      void pickFiles(otherFiles);
      return;
    }
    const pasted = e.clipboardData.getData("text/plain");
    // a pasted thread reference — canonical link, its markdown shape, or a
    // raw UUID — becomes the token the composer holds when it names a
    // thread the person can see; anything else stays ordinary text
    const reference = threadTokenFromPaste(pasted, threads, currentBotId);
    if (reference) {
      e.preventDefault();
      const start = e.currentTarget.selectionStart ?? text.length;
      const end = e.currentTarget.selectionEnd ?? start;
      // "#Title" only links at a word boundary, so keep the token clear of
      // the words it may land between
      const { lead, trail } = threadTokenSpacing(text, start, end);
      const token = lead + reference.token + trail;
      editText(text.slice(0, start) + token + text.slice(end));
      const at = start + token.length;
      setCaret(at);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(at, at);
      });
      return;
    }
    // a wall of text becomes a chip instead of burying the input
    if (!isLongPaste(pasted)) return;
    e.preventDefault();
    // Preserve native paste replacement semantics: if text was
    // selected, the attachment replaces that selection.
    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    if (start !== end) {
      editText(`${text.slice(0, start)}${text.slice(end)}`);
      setCaret(start);
    }
    editAttachments((prev) => [...prev, pasteAttachment(pasted)]);
  };

  // Dictation (the grey mic): the Mac's own, else voice mode's speech to
  // text for this bot, else the mic opens the Keys card (lib/composer-dictation).
  const voiceCheck = useVoiceModeCheck(!group && bot && !remoteClient ? bot.id : "");
  const engine = dictationEngine({
    native: capabilities.dictation.available && Boolean(window.ogb),
    xai: Boolean(!group && bot && voiceCheck.state === "ready" && voiceCheck.status.available),
  });
  const dictation = useComposerDictation({ engine, botId: bot?.id, threadId, text, editText });
  const recording = dictation.phase === "recording";
  const dictating = dictation.phase !== "idle";
  // A voice note (+ > Record a voice note): the clip goes as an audio
  // attachment, its words (this bot's speech to text) as the text, then it
  // sends like the dictation pill's Send (sendAfterDictation below).
  const voiceNote = useVoiceNoteRecorder({
    botId: !group ? bot?.id : undefined,
    threadId,
    transcribe: Boolean(!group && bot && voiceCheck.state === "ready" && voiceCheck.status.available),
    onReady: ({ attachment, transcript }) => {
      editAttachments((prev) => [...prev, attachment]);
      if (transcript) editText(joinDictated(text.trim(), transcript));
      sendAfterDictation.current = true;
    },
  });
  const voiceNoting = voiceNote.phase !== "idle";
  const openDictationSetup = () => {
    dispatch({ type: "toggleAppSettings", open: true, section: "providers" });
    // the xAI key carries voice and dictation (2026-10-14)
    openProviderKeyDialog("xai");
  };
  const toggleMic = () => {
    // one microphone at a time: a voice note keeps it until sent or cancelled
    if (voiceNoting) return;
    if (dictating) {
      dictation.stop();
      return;
    }
    if (!engine) {
      openDictationSetup();
      return;
    }
    void dictation.start();
  };
  // Hold to dictate: a press that starts the mic and is kept down (the mic
  // button, or the shortcut) stops it on release; a tap keeps listening.
  const micHold = useRef<{ at: number; started: boolean } | null>(null);
  const pressMic = () => {
    const started = !dictating && !voiceNoting && Boolean(engine);
    micHold.current = { at: Date.now(), started };
    if (started) void dictation.start();
  };
  const releaseMic = () => {
    const hold = micHold.current;
    if (hold?.started && isDictationHold(hold.at, Date.now())) dictation.stop();
    // the click that follows a pointer press must not toggle it back
    if (hold) window.setTimeout(() => { if (micHold.current === hold) micHold.current = null; }, 0);
  };
  const clickMic = () => {
    if (micHold.current?.started) {
      micHold.current = null;
      return;
    }
    toggleMic();
  };
  // Send from the dictation pill: stop listening, then send what was heard
  // once the field holds it (a transcript lands as the recording settles).
  const sendAfterDictation = useRef(false);
  useEffect(() => {
    if (dictation.phase !== "idle" || voiceNoting || !sendAfterDictation.current) return;
    sendAfterDictation.current = false;
    send();
  });
  const dictationShortcut = isMacPlatform() ? "⌘D" : "Ctrl+D";
  // The CTA (Voice, or Send once typed) wears the open bot's color.
  const ctaTone = !group && bot ? botCtaColors(bot.color) : null;
  // Put a command at the start of the draft, keeping what follows it.
  const startDraftWith = (command: "/learn " | "/setup ") => {
    const rest = text.replace(/^\/(?:learn|setup)\s*/, "");
    editText(`${command}${rest}`);
    setChannelMode("chat");
    const at = command.length;
    setCaret(at);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
    });
  };
  const goalModeOn = effectiveChannelMode === "goal";
  // Goal mode off: also what the chip does (a typed /goal loses its token).
  const leaveGoalMode = () => {
    markDraftEdited(draftId);
    if (typedGoalText !== null) {
      const nextCaret = Math.max(0, caret - (text.length - typedGoalText.length));
      editText(typedGoalText);
      setCaret(nextCaret);
      setChannelMode("chat");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
      return;
    }
    setChannelMode("chat");
  };
  // The + menu, as in the reference design: attach files and teach a task,
  // (Loop and Goal mode are reached from the "/" menu). The model and the approval level live in the
  // bot's settings; typing /setup still sets the bot up.
  const plusItems: PlusMenuItem[] = [
    { id: "attach", group: "add", label: t("composer.plus.attach"), icon: ATTACH_ICON, onSelect: () => fileInput.current?.click() },
    ...(learnAvailable || browserTeach || myChromeOffered ? [{
      id: "teach",
      group: "add" as const,
      label: t("composer.plus.teach"),
      icon: <RecordMark />,
      ...(learnAvailable ? { hint: "/learn" } : {}),
      // in words, the same as picking /learn in the "/" menu; with a
      // browser, a choice between that and showing it there
      onSelect: () => [learnAvailable, browserTeach, myChromeOffered].filter(Boolean).length > 1 ? setTeachChooser(true)
        : browserTeach ? showInBrowser() : myChromeOffered ? setMyChromeRecord(true) : startDraftWith("/learn "),
    }] : []),
  ];
  // Measured Grok HTML Pages: visible placeholder stays Message <botname>.
  // Source-derived j7O9JP Message about title is the stage-chat aria-label,
  // only on the composer docked on the page (ChatView passes the live title).
  const pageTitle = !group ? aboutPage : undefined;
  const composerAria = pageTitle?.trim()
    ? t("composer.placeholder.page", { title: pageTitle.trim() })
    : t("composer.placeholder.bot", { name: group ? group.name : (bot?.name ?? "") });
  return (
    <div className="pointer-events-none relative overflow-x-clip px-[max(16px,calc((100%-960px)/2))] pb-4">
      {/* No fill or hairline on this wrapper — those were the black frame
          in the pill's top corners. The dock overlays the transcript. */}
      {(dictation.error || voiceNote.error) && (
        <ComposerNoticeBand className="pointer-events-auto">
          <div className="w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            {dictation.error || voiceNote.error}
          </div>
        </ComposerNoticeBand>
      )}
      <div className="pointer-events-auto relative w-full">
        <WorkplaceNotice place={modeBot ? effectivePlace(modeBot, composerTask) : null} />
        {failedSends.map((failed) => (
          <ComposerNoticeBand key={failed.id}>
          <div
            className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
          >
            <span className="min-w-0 flex-1 truncate">
              {failed.offline
                ? t("composer.failed.offline", { text: failed.text.trim() || t("composer.failed.attachment") })
                : t("composer.failed.notSent", {
                    text: failed.text.trim() || t("composer.failed.attachment"),
                  })}
            </span>
            <button
              type="button"
              onClick={() => retryFailedSend(failed)}
              className="shrink-0 rounded px-2 py-1 font-medium hover:bg-danger/10"
            >
              {t("chat.retry")}
            </button>
            <button
              type="button"
              onClick={() => {
                cancelAttachmentUploads(failed.attachmentIds ?? []);
                forgetFailedComposerSend(draftId, failed.id);
              }}
              aria-label={t("composer.failed.dismissAria")}
              title={t("composer.failed.dismiss")}
              className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-danger/10"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </div>
          </ComposerNoticeBand>
        ))}
        {commandMotion.shown && (
          <ComposerCommandMenu
            listRef={commandListRef}
            className={commandMotion.className}
            exitProps={commandMotion.exitProps}
            items={commandCandidates}
            highlight={highlight}
            loading={group ? groupEngineCommands.loading : engineCommands.loading}
            onRefresh={group
              ? groupEngineCommands.lists.some((list) => list.answer.available) ? groupEngineCommands.refresh : undefined
              : engineCommands.answer?.available ? engineCommands.refresh : undefined}
            onPick={pickCommand}
            onHighlight={setHighlight}
          />
        )}
        {mentionMotion.shown && (
          <div
            ref={mentionListRef}
            role="listbox"
            aria-label={t("composer.mention.aria")}
            className={cn("absolute bottom-full start-2 z-20 mb-2 max-h-72 w-72 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-hairline/40 bg-raised shadow-lg", mentionMotion.className)} {...mentionMotion.exitProps}
          >
            {candidates.map((peer, i) => {
              const description = mentionRowDescription(peer.bot
                ? { kind: "bot", title: peer.bot.title }
                : peer.person
                  ? { kind: "person" }
                  : peer.all
                    ? { kind: "all", count: roomPeople.length }
                    : { kind: "everyone", count: mentionEveryoneCount });
              return (
                <ComposerMenuRow
                  key={peer.id}
                  id={`composer-mention-${peer.id}`}
                  data-mention-index={i}
                  role="option"
                  aria-selected={i === highlight}
                  onClick={() => pickMention(peer)}
                  onMouseEnter={() => setHighlight(i)}
                  selected={i === highlight}
                  icon={peer.bot ? (
                    <BotAvatar
                      bot={peer.bot}
                      state={normalizeState(peer.bot.mascotExpression) ?? "happy"}
                      size={24}
                    />
                  ) : peer.person?.avatarUrl ? (
                    <img src={peer.person.avatarUrl} alt="" className="size-6 rounded-full object-cover" />
                  ) : (
                    <span className="flex size-6 items-center justify-center rounded-full bg-raised text-ink-secondary">
                      <Users size={14} aria-hidden="true" />
                    </span>
                  )}
                  name={peer.name}
                  description={description || undefined}
                  kind={peer.bot ? t("composer.mention.agent") : peer.person ? t("composer.mention.person") : t("composer.mention.channel")}
                />
              );
            })}
          </div>
        )}
        {/* #1145: a parallel task's question, answered here and sent to
            its own thread, so nobody has to open the task to reply. */}
        {bot && parallelQuestions.map((question) => (
          <div key={`${question.threadId}:${question.message.id}`} data-parallel-question={question.threadId} className="mb-2">
            <div className="mb-1 px-1 text-[11px] text-ink-tertiary">{t("composer.parallelQuestion", { title: question.parallelTitle || t("task.newShort") })}</div>
            <QuestionCard threadId={question.threadId} bot={{ name: bot.name }} message={question.message} />
          </div>
        ))}
        {/* An approval takes over the composer: you answer it before you
            can type again, so a waiting bot is impossible to miss. */}
        {approval && (
          <PendingApprovalBox
            approvals={approvals}
            threadId={threadId}
            botFor={approvalBotFor}
            onCancelTurn={interruptTurn}
            locale={activeLocale()}
          />
        )}
        <ComposerAttachments
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
          onChangeCitation={(citation: CitationAttachment) => editAttachments((current) => current.map((attachment) => attachment.id === citation.id ? citation : attachment))}
          onDisplayInChatBox={displayPasteInChatBox}
          allowImages={engineSupportsImages}
          notice={attachmentNotice}
          onNotice={setAttachmentNotice}
          onPendingChange={(pending) => changeDraftAttachmentPending(draftId, pending)}
          uploadImage={uploadImage}
          uploadFile={uploadFile}
          onRetry={retryAttachmentUpload}
        />
        <QueuedComposerMessages
          items={queuedMessages}
          onSteer={canSteerQueued ? steerQueued : undefined}
          steerInterrupts={!canSteer}
          steerMode={group ? "next" : "all"}
          steering={steering}
          onCancel={(queueId) => {
            if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId });
            else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId });
          }}
          onEdit={locked ? undefined : editQueued}
        />
        {sendBlock && !locked && (
          <ComposerSendBlock
            block={sendBlock}
            onConnect={() => dispatch({ type: "toggleAppSettings", open: true, section: "providers" })}
            onRetry={sendState.recheck}
          />
        )}
        <div className="relative">
          {/* App-ground from the pill midline down, full-bleed. Bubbles may
              tuck into the top half of the radius; they must not show below
              center. End at the dock's pb-4 padding: a viewport-height
              backdrop extends the document and lets focus scroll the header
              away. Only the decoration is bounded; upward menus stay free. */}
          <div
            aria-hidden
            data-composer-backdrop
            className="pointer-events-none absolute -left-[50vw] -right-[50vw] -bottom-4 top-1/2 bg-app [[data-page-stage-chat]_&]:hidden"
          />
        {/* One row while it fits: chips, editor, mic. Below the container
            width where the chips and the placeholder cannot share a line,
            the editor takes a full line of its own above the chips.
            The same row in Simple and Advanced mode. */}
        <div
          data-tour="composer"
          data-ultracode={bot && ultracodeFromSelection(bot.modelSelection) ? "" : undefined}
          className={cn(
            "@container/composer relative z-[1] min-h-11 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5 shadow-[0_2px_8px_-1px_#0000000d,0_1px_2px_#00000008,0_0_0_1px_#e4e4e40a] transition-colors hover:border-border-strong focus-within:border-border-strong",
            bot && ultracodeFromSelection(bot.modelSelection) && "ultracode-chrome",
          )}
        >
        {replyTo && <ComposerReplyStrip message={replyTo} fallbackName={bot?.name} onClear={onClearReply} />}
        <div ref={composerRowRef} data-composer-row className="flex items-end gap-1 @max-[30rem]/composer:flex-wrap">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void pickFiles(e.target.files);
              // same file twice in a row still fires onChange
              e.target.value = "";
            }}
          />
          {!locked && (
            <div className="composer-band flex flex-wrap items-center gap-2">
              {/* One + (Grok Bot's): attach and teach a task, the modes
                  (goal, setup), then this conversation's model and approval
                  level as rows that open beside it (2026-10-15/16; the
                  model since 2026-10-18, no workspace row since #743). */}
              <ComposerPlusMenu items={plusItems} />
              {teachChooser && bot && <TeachChooserDialog botName={bot.name} onShow={browserTeach ? showInBrowser : undefined}
                onShowInMyChrome={myChromeOffered ? () => setMyChromeRecord(true) : undefined}
                onDescribe={learnAvailable ? () => startDraftWith("/learn ") : undefined} onClose={() => setTeachChooser(false)} />}
              {myChromeRecord && bot && <MyChromeRecordDialog botId={bot.id} botName={bot.name} dictationEngine={engine}
                onDone={setMyChromeTaught} onClose={() => setMyChromeRecord(false)} />}
              {myChromeTaught && bot && <TeachStepsDialog botId={bot.id} botName={bot.name} steps={myChromeTaught.steps} recordedAt={myChromeTaught.recordedAt}
                replay={myChromeTaught.replay} onClose={() => setMyChromeTaught(null)} />}
              {/* /goal or the + menu's Goal mode starts it; the chip appears
                  only while it is on, says so, and turns it off
                  (2026-10-14: the chip only when it shows the current goal). */}
              {((group && !group.dm) || !group) && goalModeOn && (
                <button
                  type="button"
                  data-composer-goal
                  aria-pressed
                  aria-label={t("composer.goal.aria")}
                  title={t("composer.goal.title")}
                  onClick={leaveGoalMode}
                  className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/35 bg-accent/10 px-3 text-[13px] text-accent transition-colors"
                >
                  <Target size={14} aria-hidden="true" />
                  /goal
                </button>
              )}
            </div>
          )}
          <MentionTextarea
          wrapperClassName="@max-[30rem]/composer:order-first @max-[30rem]/composer:basis-full"
          inputRef={inputRef}
          peers={group ? [...(members ?? []), ...roomPeople.map((person) => ({ name: person.name, person: true as const }))] : storeBots.filter((member) => member.id !== bot?.id)}
          everyone={Boolean(group && !group.dm)}
          // the message is composed in the writer's language, not the UI's
          dir="auto"
          rows={1}
          value={text}
          onChange={(e) => {
            editText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissedAt(null);
            setDismissedSlashAt(null);
          }}
          onPaste={handlePaste}
          onKeyUp={(e) => {
            setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
            // letting go of the shortcut after a hold ends the dictation
            if (e.key.toLowerCase() === "d" || e.key === "Meta" || e.key === "Control") {
              const hold = micHold.current;
              micHold.current = null;
              if (hold?.started && isDictationHold(hold.at, Date.now())) dictation.stop();
            }
          }}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            // an input method's keys pick its own candidates: its confirming
            // Enter must not pick a mention or command, nor its arrows move them
            if (imeComposing(e.nativeEvent)) return;
            // ⌘D / Ctrl+D dictates (Grok Bot's shortcut), and stops it
            if ((isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
              e.preventDefault();
              // a key held down repeats: the first press only decides
              if (e.repeat) return;
              pressMic();
              if (!micHold.current?.started) {
                micHold.current = null;
                toggleMic();
              }
              return;
            }
            if (commandPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((current) =>
                  (current + delta + commandCandidates.length) % commandCandidates.length,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickCommand(commandCandidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedSlashAt(slash?.start ?? null);
                return;
              }
            }
            if (mentionPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            // Escape drops the reply target, the strip's x from the keyboard
            if (onClearReply && escapeCancelsReply(e.nativeEvent, { replying: Boolean(replyTo), recording })) {
              e.preventDefault();
              onClearReply();
              return;
            }
            // Escape in an empty composer stops the running turn (there is no
            // Stop button: typing "stop" works too)
            if (e.key === "Escape" && busy && !locked && !recording && !hasContent) {
              e.preventDefault();
              interruptTurn();
              return;
            }
            // an empty composer + ArrowUp = edit your last message (like a chat app)
            if (e.key === "ArrowUp" && !hasContent && onEditLast) {
              e.preventDefault();
              onEditLast();
              return;
            }
            // the chosen send key sends; any other Enter is a new line
            if (sendsMessage(e.nativeEvent, sendKey)) {
              e.preventDefault();
              // The second Enter of the gesture: the chip above is waiting,
              // the composer is empty, and the window is open — steer the
              // queue into the running turn instead of waiting it out.
              if (
                canSteer &&
                doubleEnterSteersQueue(steerAgainUntilRef.current, Date.now(), pendingCount, hasContent)
              ) {
                steerAgainUntilRef.current = 0;
                steerQueued();
                return;
              }
              send();
            }
            // handled here: an open page's Escape-to-close leaves it alone
            if (e.key === "Escape" && recording) { e.preventDefault(); dictation.stop(); }
          }}
          // an upload in flight must not disable the box: a disabled element
          // drops keyboard focus and never gets it back, so the writer had to
          // click the input again after every pasted image (#1014). send()
          // already refuses while an attachment is pending. A pending
          // approval does not disable it either (2026-10-29).
          disabled={locked}
          aria-busy={bot?.awaitingThreadSnapshot || undefined}
          placeholder={composerPlaceholder({
            approval: Boolean(approval),
            question: openQuestions.length > 0,
            attachmentPending,
            recording,
            busy,
            groupName: group?.name,
            goalMode: channelMode === "goal",
            groupHint: () => groupComposerHint(group!, members ?? [], { jevOn: jevRoomRoutingOn(config) }),
            botName: bot?.name ?? "",
          })}
          aria-label={composerAria}
            className="block max-h-[7.5rem] min-h-6 w-full resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none"
          />
          <div data-composer-actions className="composer-band flex items-center gap-1 @max-[30rem]/composer:ml-auto">
          {bot && !group && !remoteClient && (
            // no chip: the mascot's model chip opens its menu
            <ModelPicker inComposer headless key={bot.threadId} bot={bot} threadId={threadId}
              menuControl={modelMenu}
              fallbackAnchor={() => composerRowRef.current?.querySelector<HTMLElement>("[data-composer-plus]") ?? null} />
          )}
          {/* No Stop button: Escape in the empty field, or a message that
              only says "stop", ends the running turn. */}
        {!locked && (
          <ComposerMicButton
            onClick={clickMic}
            onPress={pressMic}
            onRelease={releaseMic}
            hidden={dictating || voiceNoting}
            needsSetup={!engine}
            engine={engine}
            shortcut={dictationShortcut}
          />
        )}
        {!locked && dictating && (
          <DictationChip
            seconds={dictation.seconds}
            levels={dictation.levels}
            processing={dictation.phase === "processing"}
            onStop={dictation.stop}
            onCancel={dictation.cancel}
            onSend={() => {
              sendAfterDictation.current = true;
              if (recording) dictation.stop();
            }}
            sendTone={ctaTone}
          />
        )}
        {!locked && voiceNoting && (
          <VoiceNoteChip
            seconds={voiceNote.seconds}
            bars={voiceNote.bars}
            sending={voiceNote.phase === "sending"}
            onCancel={voiceNote.cancel}
            onSend={() => void voiceNote.finish()}
            sendTone={ctaTone}
          />
        )}
        {/* Hibou 98 draws Send as a labelled push button, always there */}
        {retroSkin && !locked && (
          <button
            onClick={() => send()}
            disabled={attachmentPending || !hasContent}
            data-r98-send=""
            aria-label={sendLabelFor()}
            title={sendTitleFor()}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:brightness-110"
          >
            {busy && !canSteer ? <Clock size={15} /> : <ArrowUp size={17} />}
            <span className="r98-send-label">{t("chat.send")}</span>
          </button>
        )}
        {/* No Send button: Enter sends. Grok Bot's round CTA turns into the
            send arrow while something is typed, Voice otherwise. */}
        {!dictating && !voiceNoting && (() => {
          const sendButton = !retroSkin && !locked ? (
            <ComposerSendButton
              onClick={() => send()}
              disabled={attachmentPending || !hasContent || Boolean(sendBlock)}
              tone={ctaTone}
              queued={busy && !canSteer}
              label={sendLabelFor()}
              title={sendTitleFor()}
            />
          ) : null;
          const typed = Boolean(sendButton && hasContent);
          if (bot && !group) {
            return <ComposerCtaSeat typed={typed} send={sendButton} voice={<CallButton bot={bot} tone={ctaTone} />} />;
          }
          if (group) return typed ? sendButton : <GroupCallButton group={group} members={members ?? []} />;
          return typed ? sendButton : null;
        })()}
          {nudgePeer && <NudgeButton principalId={nudgePeer.id} name={nudgePeer.name} threadId={nudgePeer.threadId} />}
          {!nudgePeer && nudgeGroup && <NudgeButton groupId={nudgeGroup.id} name={nudgeGroup.name} />}
          </div>
        </div>
        </div>
        </div>
      </div>
      <div className="pointer-events-auto">
      {commandAllowlistTarget && <CommandAllowlistDialog
        key={`${commandAllowlistTarget.botId}:${commandAllowlistTarget.threadId}`}
        {...commandAllowlistTarget}
        onClose={() => setCommandAllowlistTarget(null)}
      />}
      <FullAccessWarning
        open={approvalWarning?.mode === "full"}
        scope={perspicaxOrg ? "organization" : "thread"}
        onCancel={() => setApprovalWarning(null)}
        onConfirm={() => {
          const target = approvalWarning;
          setApprovalWarning(null);
          if (target?.mode !== "full" || !fullAccessAvailable) return;
          dispatch({ type: "updateTask", botId: target.botId, threadId: target.threadId,
            patch: { approvalMode: "full", confirmFullAccess: true, ...(perspicaxOrg ? { organizationFullAccess: true } : {}) } });
        }}
      />
      <LocalComputerAutoWarning
        open={approvalWarning?.mode === "auto"}
        onCancel={() => setApprovalWarning(null)}
        onConfirm={() => {
          if (approvalWarning?.mode === "auto") {
            dispatch({
              type: "updateTask",
              botId: approvalWarning.botId,
              threadId: approvalWarning.threadId,
              patch: { approvalMode: "auto", acknowledgeLocalAuto: true },
            });
          }
          setApprovalWarning(null);
        }}
      />
      </div>
    </div>
  );
}
