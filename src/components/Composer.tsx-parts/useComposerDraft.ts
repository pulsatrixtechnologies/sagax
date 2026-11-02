import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { api, type Bot, type Group, type Message } from "@/state/store";
import {
  appendDraftAttachments,
  markDraftEdited,
  recoverFailedComposerSend,
  useComposerDraft as useDraftStore,
  useComposerChannelMode,
  useDraftAttachmentPending,
  useFailedComposerSends,
} from "@/lib/drafts";
import { cancelAttachmentUpload } from "@/lib/attachment-uploads";
import {
  appendPastedText,
  releaseAttachmentImagePreview,
  type Attachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { prewarmConversation } from "@/lib/prewarm";
import { goalTextFromComposer } from "@/lib/composer-commands";
import type { ComposerDraftSnapshot } from "./types";

export function useComposerDraftState({
  draftId,
  bot,
  group,
  onRestoreReply,
  inputRef,
  setCaret,
  setDismissedAt,
  imageTargetsSupport,
}: {
  draftId: string;
  bot?: Bot;
  group?: Group;
  onRestoreReply?: (message: Message, threadId: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  setCaret: Dispatch<SetStateAction<number>>;
  setDismissedAt: Dispatch<SetStateAction<number | null>>;
  imageTargetsSupport: (message: string, mode: "chat" | "goal") => boolean;
}) {
  // Per-thread draft: switching bots unmounts this component, so both the
  // text and its attachment chips have to outlive it (see lib/drafts).
  const [text, setText, attachments, setAttachments] = useDraftStore(
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
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const typedGoalText = (group && !group.dm) || !group ? goalTextFromComposer(text) : null;
  const effectiveText = typedGoalText ?? text;
  const effectiveChannelMode = typedGoalText !== null ? "goal" : channelMode;
  const engineSupportsImages = imageTargetsSupport(effectiveText, effectiveChannelMode);

  return {
    draftId,
    text, setText, attachments, setAttachments,
    pendingUploads, attachmentPending, failedSends, channelMode, setChannelMode,
    warmBotId, warmThreadId, editText, editAttachments, restoreDraft,
    addAttachments, removeAttachment, displayPasteInChatBox,
    attachmentNotice, setAttachmentNotice,
    typedGoalText, effectiveText, effectiveChannelMode, engineSupportsImages,
  };
}
