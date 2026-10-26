// The two picture sources of a bot's avatar, shared by the Appearance pane
// (AppearancePane.tsx): Upload (a local image, then its zoom and framing)
// and Generate (the server's image provider, AvatarImageGenerator). Both
// save through the bot patch the pane is given, so the persona editor and
// the New bot dialog's draft write the same fields the same way.
import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Download, ImagePlus, Loader2, Trash2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { avatarFileProblem, avatarImageFrom, dragMayCarryImage, exportAvatarImage } from "@/lib/avatar-input";
import { cn } from "@/lib/cn";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import {
  AVATAR_FOCUS_CENTER,
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  botAvatarUrlFromStoredPath,
  clampAvatarFocus,
  clampAvatarZoom,
} from "../../../shared/bot-avatar";
import { BotAvatar } from "../Avatar";
import { useBotEditor } from "../bot-settings/BotEditorContext";

export type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "color" | "mascotExpression" | "mascotBody" | "mascotSkin" | "mascotLook">
>;

const FRAME_SIZE = 168;

/**
 * Upload, remove and generate, with one busy flag and one error between
 * them. A generation commits the debounced profile edits first (the server
 * reads the bot's identity and crop), then comes back through the same
 * patch lane as an upload.
 */
export function useAvatarSources(bot: Bot, onPatch: (patch: AvatarPatch) => void) {
  const { flushBotPatches } = useStore();
  const { request: api, uploadAvatar } = useBotEditor();
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crop = bot.avatarCrop ?? "mascot";
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const busy = uploading || generating;

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
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
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setError(null);
    onPatch({
      avatarUrl: null,
      avatarCrop: "mascot",
      avatarZoom: AVATAR_ZOOM_MIN,
      avatarFocusX: AVATAR_FOCUS_CENTER,
      avatarFocusY: AVATAR_FOCUS_CENTER,
    });
  };

  const generate = async (direction: string) => {
    if (busy) return;
    setGenerating(true);
    setError(null);
    try {
      const cropAtStart = cropRef.current;
      await flushBotPatches(bot.id);
      const result: { avatarUrl: string; bot: Bot } = await api(`/api/bots/${bot.id}/avatar/generate`, {
        method: "POST",
        body: JSON.stringify({ prompt: direction.trim() }),
      });
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl: result.avatarUrl,
        // The server owns this crop for generate (server/index.ts picks
        // "circle" for a mascot bot); "circle" is only the truthful default
        // if it ever did not assign one.
        avatarCrop: latestCrop === cropAtStart ? (result.bot.avatarCrop ?? "circle") : latestCrop,
      });
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : String(generateError));
    } finally {
      setGenerating(false);
    }
  };

  return { uploading, generating, busy, error, upload, removeImage, generate };
}

/** Upload: the file button, the remove button while a picture is set, then its framing. */
export function AvatarUploadPanel({ bot, busy, uploading, onUpload, onRemove, onPatch }: {
  bot: Bot;
  busy: boolean;
  uploading: boolean;
  onUpload: (file: File | undefined) => Promise<void>;
  onRemove: () => void;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const crop = bot.avatarCrop ?? "mascot";
  const [dropping, setDropping] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const exportImage = () => {
    if (!bot.avatarUrl) return;
    setExportFailed(false);
    void exportAvatarImage(bot.avatarUrl, bot.name).catch(() => setExportFailed(true));
  };
  return (
    <div
      data-avatar-upload=""
      data-avatar-dropping={dropping ? "" : undefined}
      tabIndex={-1}
      onDragOver={(event) => {
        if (busy || !dragMayCarryImage(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={(event) => {
        setDropping(false);
        const file = avatarImageFrom(event.dataTransfer);
        if (!file) return;
        // preventDefault tells the chat's window drop target (ComposerAttachments) the picture is taken
        event.preventDefault();
        void onUpload(file);
      }}
      onPaste={(event) => {
        const file = avatarImageFrom(event.clipboardData);
        if (!file || busy) return;
        event.preventDefault();
        event.stopPropagation();
        void onUpload(file);
      }}
      className={cn("rounded-xl outline-none", dropping && "ring-2 ring-accent")}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        onChange={(event) => {
          void onUpload(event.target.files?.[0]).finally(() => {
            if (fileRef.current) fileRef.current.value = "";
          });
        }}
      />
      <div className="flex max-w-[360px] gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          {t("botPanel.avatar.uploadImage")}
        </button>
        {bot.avatarUrl && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={t("botPanel.avatar.removeAria")}
            title={t("botPanel.avatar.removeTitle")}
            className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        )}
        {bot.avatarUrl && (
          <button
            type="button"
            data-avatar-export=""
            onClick={exportImage}
            aria-label={t("botPanel.avatar.export")}
            title={t("botPanel.avatar.export")}
            className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
          >
            <Download size={14} />
          </button>
        )}
      </div>
      <div className="mt-1.5 text-[11.5px] text-ink-secondary">{t("botPanel.avatar.dropOrPaste")}</div>
      <div className="text-[11.5px] text-ink-secondary">{t("botPanel.avatar.typesLarge")}</div>
      {exportFailed && <div role="alert" className="mt-1 text-[11.5px] text-danger">{t("botPanel.avatar.exportFailed")}</div>}
      {crop !== "mascot" && bot.avatarUrl && <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />}
    </div>
  );
}

/** A custom picture's zoom and framing: drag to move it, scroll or the slider to zoom. */
function AvatarFraming({
  bot,
  disabled,
  onPatch,
}: {
  bot: Bot;
  disabled: boolean;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const zoom = clampAvatarZoom(bot.avatarZoom ?? AVATAR_ZOOM_MIN);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? AVATAR_FOCUS_CENTER);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? AVATAR_FOCUS_CENTER);
  const framed = zoom !== AVATAR_ZOOM_MIN || focusX !== AVATAR_FOCUS_CENTER || focusY !== AVATAR_FOCUS_CENTER;
  const drag = useRef<{ x: number; y: number; focusX: number; focusY: number; pointer: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, focusX, focusY, pointer: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointer) return;
    onPatch({
      avatarFocusX: clampAvatarFocus(start.focusX - (event.clientX - start.x) / FRAME_SIZE / zoom),
      avatarFocusY: clampAvatarFocus(start.focusY - (event.clientY - start.y) / FRAME_SIZE / zoom),
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (disabled || event.deltaY === 0) return;
    event.preventDefault();
    onPatch({ avatarZoom: clampAvatarZoom(zoom + (event.deltaY < 0 ? 0.08 : -0.08)) });
  };

  return (
    <div className="max-w-[360px] py-3">
      <div
        className="mx-auto w-fit cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <BotAvatar bot={bot} size={FRAME_SIZE} animated={false} label={`${bot.name} avatar preview`} />
      </div>
      <div className="mb-1.5 mt-4 flex items-baseline justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("botPanel.avatar.zoom")}</span>
        <span className="tabular-nums text-[12px] text-ink-secondary">{Math.round(zoom * 100)}%</span>
      </div>
      <input
        type="range"
        min={AVATAR_ZOOM_MIN}
        max={AVATAR_ZOOM_MAX}
        step={0.01}
        value={zoom}
        disabled={disabled}
        aria-label={t("botPanel.avatar.zoomAria")}
        aria-valuemin={AVATAR_ZOOM_MIN}
        aria-valuemax={AVATAR_ZOOM_MAX}
        aria-valuenow={zoom}
        aria-valuetext={`${Math.round(zoom * 100)}%`}
        onChange={(event) => onPatch({ avatarZoom: clampAvatarZoom(Number(event.target.value)) })}
        className="w-full accent-accent"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px] text-ink-secondary">
        <span>{t("botPanel.avatar.drag")}</span>
        {framed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPatch({ avatarZoom: AVATAR_ZOOM_MIN, avatarFocusX: AVATAR_FOCUS_CENTER, avatarFocusY: AVATAR_FOCUS_CENTER })}
            className="shrink-0 rounded-md px-2 py-1 text-ink hover:bg-control disabled:opacity-50"
          >
            {t("botPanel.avatar.resetFrame")}
          </button>
        )}
      </div>
    </div>
  );
}
