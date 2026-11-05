import { sendBlockStops } from "@/lib/send-state";
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { track } from "@/lib/analytics";
import { currentOpenPage } from "@/lib/open-page";
import type { Action, AppState, Bot, Group, Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { consumeRetroCommand, retroSignal } from "@/lib/retro98";
import { reportAchievement } from "@/lib/achievements";
import {
  draftRevision,
  changeDraftAttachmentPending,
  failedComposerSends,
  forgetFailedComposerSend,
  useNetworkOnline,
  rememberFailedComposerSend,
  restoredSendId,
  restoredRequestText,
  type FailedComposerSend,
} from "@/lib/drafts";
import { pathForFile } from "../ComposerAttachments";
import {
  clipboardHasImages,
  clipboardOtherFiles,
  composeMessage,
  dataContextFor,
  withPageContext,
  intakeFiles,
  isLongPaste,
  pasteAttachment,
  snapshotClipboardImages,
  type Attachment,
} from "@/lib/composer-attachments";
import { forgetAttachmentUploads, startAttachmentUpload } from "@/lib/attachment-uploads";
import { isStopIntent } from "../../../shared/stop-intent";
import { dataWindowEnabled } from "@/lib/feature-flags";
import { serializeThreadRefs, threadTokenFromPaste, threadTokenSpacing } from "@/lib/thread-refs";
import { goalSubcommandBlock, goalSubcommandFromComposer, type GoalSubcommand } from "@/lib/composer-commands";
import { parseLoopCommand, type LoopCommand } from "@/lib/composer-loop";
import { useRetroSkin } from "../RetroChromeHost";
import type { ComposerDraftSnapshot } from "./types";

export function useComposerSend({
  draftId,
  text,
  setText,
  attachments,
  setAttachments,
  editText,
  editAttachments,
  effectiveText,
  effectiveChannelMode,
  channelMode: _channelMode,
  setChannelMode,
  attachmentPending,
  engineSupportsImages,
  imageTargetsSupport,
  locked,
  busy,
  canSteer,
  autoRoutesBusySend,
  sendBlock,
  sendState,
  bot,
  group,
  threadId,
  replyTo,
  onConsumeReply,
  onRestoreReply: _onRestoreReply,
  restoreDraft,
  addAttachments,
  dispatch,
  getState,
  config,
  threads,
  currentBotId,
  sendLabel,
  interruptTurn,
  runLoopCommand,
  runGoalSubcommand,
  goalStatus,
  inputRef,
  setCaret,
  setAttachmentNotice,
  refocusInput,
}: {
  draftId: string;
  text: string;
  setText: (v: string) => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  editText: (next: string) => void;
  editAttachments: (next: SetStateAction<Attachment[]>) => void;
  effectiveText: string;
  effectiveChannelMode: "chat" | "goal";
  channelMode: "chat" | "goal";
  setChannelMode: (mode: "chat" | "goal") => void;
  attachmentPending: boolean;
  engineSupportsImages: boolean;
  imageTargetsSupport: (message: string, mode: "chat" | "goal") => boolean;
  locked: boolean;
  busy: boolean;
  canSteer: boolean;
  autoRoutesBusySend: boolean;
  sendBlock: import("@/lib/send-state").SendBlock | null;
  sendState: { recheck: () => void; block: import("@/lib/send-state").SendBlock | null };
  bot?: Bot;
  group?: Group;
  threadId: string;
  replyTo?: Message | null;
  onConsumeReply?: () => void;
  onRestoreReply?: (message: Message, threadId: string) => void;
  restoreDraft: (sent: ComposerDraftSnapshot) => void;
  addAttachments: (next: Attachment[]) => void;
  dispatch: Dispatch<Action>;
  getState: () => AppState;
  config: import("@/state/store").ConfigStatus | null | undefined;
  threads: import("../ThreadRefs").ThreadRefsValue["threads"];
  currentBotId?: string;
  sendLabel: string;
  interruptTurn: () => void;
  runLoopCommand: (command: LoopCommand) => void;
  runGoalSubcommand: (sub: GoalSubcommand) => boolean;
  goalStatus: import("../../../shared/group-goal-run").GroupGoalRunStatus | undefined;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  setCaret: Dispatch<SetStateAction<number>>;
  setAttachmentNotice: Dispatch<SetStateAction<string | null>>;
  refocusInput: () => void;
}) {
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
    // an advisory line (#2013) informs only: sending again is the retry
    if (sendBlockStops(sendBlock)) { sendState.recheck(); return; }
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

  return {
    uploadImage, uploadFile, pickFiles, hasContent,
    sendLabelFor, sendTitleFor, retroSkin, retryFailedSend, send, handlePaste,
  };
}
