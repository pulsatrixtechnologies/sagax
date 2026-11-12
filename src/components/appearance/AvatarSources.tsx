// A bot avatar's picture source: a local image dropped or pasted on the
// bot's avatar (BotProfileAvatarCard, the profile page's hero), saved
// through the bot patch the surface is given, so the profile page and the
// New bot dialog's draft write the same fields the same way. Generate and
// the Upload panel (with its framing) left the Appearance page with its
// source bar (the owner 2026-11-12, #4076).
import { useRef, useState } from "react";

import type { Bot } from "@/state/store";
import { avatarFileProblem } from "@/lib/avatar-input";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { AVATAR_FOCUS_CENTER, AVATAR_ZOOM_MIN, botAvatarUrlFromStoredPath } from "../../../shared/bot-avatar";
import { useBotEditor } from "../bot-settings/BotEditorContext";
import { readableError } from "@/lib/plain-error";

export type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "color" | "mascotExpression" | "mascotBody" | "mascotSkin" | "mascotLook">
>;

/** Upload, with its busy flag and its error. */
export function useAvatarSources(bot: Bot, onPatch: (patch: AvatarPatch) => void) {
  const { uploadAvatar } = useBotEditor();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crop = bot.avatarCrop ?? "mascot";
  const cropRef = useRef(crop);
  cropRef.current = crop;

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return;
    const problem = avatarFileProblem(file);
    if (problem) {
      setError(t(problem === "size" ? "botPanel.avatar.tooLarge" : "botPanel.avatar.chooseImage"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const saved = uploadAvatar ? null : await imageAttachmentFromFile(file);
      const avatarUrl = uploadAvatar ? await uploadAvatar(file) : saved ? botAvatarUrlFromStoredPath(saved.path) : null;
      if (!avatarUrl) throw new Error(t("botPanel.avatar.badImage"));
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl,
        avatarCrop: latestCrop === "mascot" ? "circle" : latestCrop,
        avatarZoom: AVATAR_ZOOM_MIN,
        avatarFocusX: AVATAR_FOCUS_CENTER,
        avatarFocusY: AVATAR_FOCUS_CENTER,
      });
    } catch (uploadError) {
      setError(readableError(uploadError));
    } finally {
      setUploading(false);
    }
  };

  return { busy: uploading, error, upload };
}
