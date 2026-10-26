// The signed-in person's photo on an organization server (2026-10-16): the
// avatar of the Account row becomes a button. With a photo it opens a small
// menu (Change photo, Remove photo); without one it opens the file picker.
// A chosen image opens the crop window (src/lib/avatar-crop.ts, the Perspicax
// console's geometry: drag inside a circle, zoom), then the 256 px square is
// sent to PUT /api/me/avatar, which writes it to Perspicax as this person
// (server/routes/me-avatar.ts). Remove asks first. Errors and the outcome
// show under the row. The new URL lands in the config at once and every
// other window and person gets it through the `person.avatar` frame.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  CROP_ACCEPT,
  CROP_CIRCLE,
  CROP_INSET,
  CROP_STAGE,
  CROP_ZOOM_MAX,
  CROP_ZOOM_MIN,
  clampPan,
  cropLayout,
  cropView,
  encodeAvatar,
} from "@/lib/avatar-crop";
import {
  announcePersonAvatar,
  OwnAvatarError,
  removeOwnAvatar,
  uploadOwnAvatar,
  withViewerAvatar,
} from "@/lib/person-avatars";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useStore } from "@/state/store";
import { InitialsAvatar } from "../Avatar";
import { ConfirmDialog } from "../ConfirmDialog";
import { DIALOG, DialogCloseButton, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { AnchoredPopover } from "@/components/AnchoredPopover";

const ERROR_KEYS: Record<string, LocaleKey> = {
  avatar_session_only: "settings.profile.photoError.sessionOnly",
  avatar_sign_in_again: "settings.profile.photoError.signIn",
  avatar_type: "settings.profile.photoError.type",
  avatar_unreadable: "settings.profile.photoError.unreadable",
  avatar_too_large: "settings.profile.photoError.tooLarge",
  avatar_rejected: "settings.profile.photoError.rejected",
  avatar_perspicax_outdated: "settings.profile.photoError.outdated",
  avatar_unreachable: "settings.profile.photoError.unreachable",
  network: "settings.profile.photoError.unreachable",
};

/** The sentence shown for a failed upload or removal. */
export function ownAvatarErrorText(error: unknown): string {
  const code = error instanceof OwnAvatarError ? error.code : "avatar_unreadable";
  return t(ERROR_KEYS[code] ?? "settings.profile.photoError.unreachable");
}

export type OwnAvatarStatus = { kind: "idle" } | { kind: "busy" } | { kind: "error"; text: string } | { kind: "done"; text: string };

export function OwnAvatarField({ principalId, avatarUrl, initials, onStatus }: {
  principalId: string;
  avatarUrl?: string;
  initials: string;
  /** Saving, done or what went wrong, for the line under the account row. */
  onStatus: (status: OwnAvatarStatus) => void;
}) {
  const { state, dispatch } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuElRef = useRef<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<{ url: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [status, setLocalStatus] = useState<OwnAvatarStatus>({ kind: "idle" });
  const busy = status.kind === "busy";
  const setStatus = (next: OwnAvatarStatus) => {
    setLocalStatus(next);
    onStatus(next);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && (event.target as Node | null)?.parentElement?.closest("[data-own-avatar]")) return;
      if (event instanceof MouseEvent && menuElRef.current?.contains(event.target as Node | null)) return;
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const applied = (url: string | null, done: string) => {
    const change = { principalId, avatarUrl: url };
    const config = state.config;
    const next = config ? withViewerAvatar(config, change) : config;
    if (next && next !== config) dispatch({ type: "configStatus", config: next });
    announcePersonAvatar(change);
    setStatus({ kind: "done", text: done });
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setStatus({ kind: "error", text: t("settings.profile.photoError.type") });
      return;
    }
    setStatus({ kind: "idle" });
    setPending({ url: URL.createObjectURL(file) });
  };

  const closeCrop = () => {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  };

  const upload = (blob: Blob) => {
    closeCrop();
    setStatus({ kind: "busy" });
    void uploadOwnAvatar(blob).then(
      (url) => applied(url, t("settings.profile.photoSaved")),
      (error) => setStatus({ kind: "error", text: ownAvatarErrorText(error) }),
    );
  };

  const remove = () => {
    setConfirmRemove(false);
    setStatus({ kind: "busy" });
    void removeOwnAvatar().then(
      () => applied(null, t("settings.profile.photoRemoved")),
      (error) => setStatus({ kind: "error", text: ownAvatarErrorText(error) }),
    );
  };

  const open = () => {
    if (busy) return;
    if (avatarUrl) setMenuOpen((value) => !value);
    else fileRef.current?.click();
  };

  return (
    <div className="relative shrink-0" data-own-avatar="">
      <button
        ref={buttonRef}
        type="button"
        onClick={open}
        disabled={busy}
        aria-label={t("settings.profile.changePhoto")}
        title={t("settings.profile.changePhoto")}
        aria-haspopup={avatarUrl ? "menu" : undefined}
        aria-expanded={avatarUrl ? menuOpen : undefined}
        data-own-avatar-button=""
        className="group relative flex size-9 items-center justify-center overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-60"
      >
        {avatarUrl
          ? <img src={avatarUrl} alt="" width={36} height={36} className="size-9 rounded-full object-cover" />
          : <InitialsAvatar initials={initials} size={36} />}
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
          <Camera size={14} />
        </span>
      </button>
      {menuOpen && (
        <AnchoredPopover anchorRef={buttonRef} popoverRef={menuElRef} role="menu" gap={8} className="flex min-w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px]">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} className="block w-full rounded-md px-2 py-1.5 text-left text-ink hover:bg-hover">
            {t("settings.profile.changePhoto")}
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmRemove(true); }} className="block w-full rounded-md px-2 py-1.5 text-left text-danger hover:bg-hover">
            {t("settings.profile.removePhoto")}
          </button>
        </AnchoredPopover>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={CROP_ACCEPT}
        hidden
        aria-label={t("settings.profile.uploadPhoto")}
        onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }}
      />
      {pending && <CropDialog url={pending.url} onCancel={closeCrop} onApply={upload} />}
      <ConfirmDialog
        open={confirmRemove}
        title={t("settings.profile.photoRemoveTitle")}
        body={t("settings.profile.photoRemoveBody")}
        confirmLabel={t("settings.profile.removePhoto")}
        tone="danger"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
        returnFocusRef={buttonRef}
      />
    </div>
  );
}

/** One line under the account row: saving, done, or what went wrong. */
export function OwnAvatarStatusLine({ status }: { status: OwnAvatarStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "error") return <p role="alert" className="mt-2 text-[12px] leading-4 text-danger" data-own-avatar-status="">{status.text}</p>;
  const text = status.kind === "busy" ? t("settings.profile.photoSaving") : status.text;
  return <p role="status" className="mt-2 text-[12px] leading-4 text-ink-secondary" data-own-avatar-status="">{text}</p>;
}

function CropDialog({ url, onCancel, onApply }: { url: string; onCancel: () => void; onApply: (blob: Blob) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState<string | null>(null);
  useModalDialog(dialogRef, onCancel);

  const move = (x: number, y: number, nextZoom = zoom) => setPan(clampPan(natural.w, natural.h, nextZoom, x, y));
  const layout = cropLayout(natural.w, natural.h, zoom, pan.x, pan.y);

  const apply = async () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) {
      setFailed(t("settings.profile.photoError.unreadable"));
      return;
    }
    try {
      onApply(await encodeAvatar(img, cropView(img.naturalWidth, img.naturalHeight, zoom, pan.x, pan.y)));
    } catch {
      setFailed(t("settings.profile.photoError.tooLarge"));
    }
  };

  const onKeyNudge = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 20 : 4;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    move(pan.x + delta[0], pan.y + delta[1]);
  };

  return createPortal(
    <div className={DIALOG.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="own-avatar-crop-title"
        aria-describedby="own-avatar-crop-body"
        tabIndex={-1}
        data-own-avatar-crop=""
        className={cn(DIALOG.frame, DIALOG.width.sm)}
      >
        <DialogCloseButton label={t("common.close")} onClick={onCancel} />
        <div className={DIALOG.header}>
          <h2 id="own-avatar-crop-title" className={DIALOG.title}>{t("settings.profile.photoCropTitle")}</h2>
          <p id="own-avatar-crop-body" className={DIALOG.subtitle}>{t("settings.profile.photoCropBody")}</p>
        </div>
        <div className={DIALOG.body}>
          <div
            tabIndex={0}
            role="img"
            aria-label={t("settings.profile.photoCropTitle")}
            onKeyDown={onKeyNudge}
            className="relative mx-auto overflow-hidden rounded-[10px] bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            style={{ width: CROP_STAGE, height: CROP_STAGE, cursor: "grab", touchAction: "none" }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              move(drag.current.px + (event.clientX - drag.current.x), drag.current.py + (event.clientY - drag.current.y));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          >
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
              onError={() => setFailed(t("settings.profile.photoError.unreadable"))}
              className="pointer-events-none absolute max-w-none select-none"
              style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full"
              style={{
                left: CROP_INSET,
                top: CROP_INSET,
                width: CROP_CIRCLE,
                height: CROP_CIRCLE,
                boxShadow: "0 0 0 999px rgb(0 0 0 / 0.5)",
                border: "1px solid rgb(255 255 255 / 0.8)",
              }}
            />
          </div>
          <label className="flex items-center gap-3 text-[13px] text-ink-secondary">
            <span className="shrink-0">{t("settings.profile.photoZoom")}</span>
            <input
              type="range"
              min={CROP_ZOOM_MIN}
              max={CROP_ZOOM_MAX}
              step={0.05}
              value={zoom}
              onChange={(event) => {
                const next = Number(event.target.value);
                setZoom(next);
                move(pan.x, pan.y, next);
              }}
              className="min-w-0 flex-1 accent-[var(--color-accent)]"
            />
          </label>
          {failed && <p role="alert" className="text-[12px] text-danger">{failed}</p>}
        </div>
        <div className={DIALOG.footer}>
          <button type="button" onClick={onCancel} className={PILL}>{t("common.cancel")}</button>
          <button type="button" onClick={() => void apply()} disabled={!natural.w} data-own-avatar-apply="" className={PRIMARY_PILL}>
            {t("settings.profile.photoApply")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
