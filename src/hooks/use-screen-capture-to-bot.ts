// The shell's capture key (Cmd+Shift+0 by default, electron/screen-capture-hotkey.mjs)
// hands one PNG to the page: it lands as a picture in the open bot's
// composer draft (src/lib/screen-capture-to-bot.ts), opening the first bot
// when none is open. Nothing is sent by itself.
import { useEffect, useRef } from "react";

import { appendDraftAttachments, changeDraftAttachmentPending, replaceDraftAttachment } from "@/lib/drafts";
import { handoffAttachmentImagePreview, imageAttachmentFromFile, optimisticImageAttachment, releaseAttachmentImagePreview } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { captureErrorKey, captureFile, captureTarget } from "@/lib/screen-capture-to-bot";
import { navigate } from "@/lib/view-transitions";
import { botOpensTo, openBot, useStore } from "@/state/store";

export function useScreenCaptureToBot(showThreads: boolean): void {
  const { state, dispatch } = useStore();
  const latest = useRef({ state, showThreads });
  latest.current = { state, showThreads };

  useEffect(() => window.ogb?.onScreenCapture?.((capture) => {
    const { state: now, showThreads: threads } = latest.current;
    if ("error" in capture) {
      dispatch({ type: "error", message: t(captureErrorKey(capture)) });
      return;
    }
    const target = captureTarget({ selectedId: now.selectedId, bots: now.bots, instances: now.instances });
    if (!target) {
      dispatch({ type: "error", message: t("screenCapture.noBot") });
      return;
    }
    const bot = now.bots.find((candidate) => candidate.id === target.botId)!;
    if (target.open) navigate(() => openBot(dispatch, bot, threads));
    if (!target.images) {
      dispatch({ type: "error", message: t("screenCapture.noImages", { bot: bot.name }) });
      return;
    }
    const draftId = target.open ? `bot:${bot.id}:${botOpensTo(bot, threads)}` : target.draftId;
    const file = captureFile(capture.png);
    let optimistic: ReturnType<typeof optimisticImageAttachment> = null;
    try {
      optimistic = optimisticImageAttachment(file);
    } catch {
      dispatch({ type: "error", message: t("screenCapture.tooLarge") });
      return;
    }
    if (!optimistic) return;
    const placeholder = optimistic;
    appendDraftAttachments(draftId, [placeholder]);
    changeDraftAttachmentPending(draftId, true);
    void imageAttachmentFromFile(file, placeholder)
      .then((completed) => {
        if (!completed) {
          replaceDraftAttachment(draftId, placeholder.id, null);
          releaseAttachmentImagePreview(placeholder);
          return;
        }
        handoffAttachmentImagePreview(completed.path, completed.previewUrl);
        if (!replaceDraftAttachment(draftId, placeholder.id, completed)) releaseAttachmentImagePreview(completed);
      })
      .catch(() => {
        replaceDraftAttachment(draftId, placeholder.id, null);
        releaseAttachmentImagePreview(placeholder);
        dispatch({ type: "error", message: t("screenCapture.uploadFailed") });
      })
      .finally(() => changeDraftAttachmentPending(draftId, false));
  }), [dispatch]);
}
