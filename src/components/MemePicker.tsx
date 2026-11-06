// Compact Memes picker (#2121): search, trending on open, masonry of
// animated previews. Click materializes through the server and hands the
// attachment to the composer. Without a provider key, Imgflip templates
// still show and local GIF upload remains available.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ImagePlay, LoaderCircle, Search, Upload } from "lucide-react";

import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { materializeMeme, searchMemes, type MemeSearchHit } from "@/lib/memes";
import { readableErrorMessage } from "@/lib/readable-error";
import { SECONDARY_CIRCLE } from "./ComposerControls";

export interface MemeAttachmentPick {
  kind: "image";
  path: string;
  mime: string;
  name?: string;
  meme?: {
    provider: "giphy" | "tenor" | "imgflip" | "upload";
    attribution: string;
    caption?: string;
    sourceId?: string;
  };
}

export interface MemePickerProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (attachment: MemeAttachmentPick) => void;
  onUploadLocal?: () => void;
}

export function MemePicker({ open, onClose, anchorRef, onPick, onUploadLocal }: MemePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemeSearchHit[]>([]);
  const [keyConfigured, setKeyConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const inside = useRef({
    contains: (target: unknown) => {
      const root = rootRef.current;
      if (!root || !(target instanceof Node)) return false;
      if (root.contains(target)) return true;
      const button = target instanceof Element ? target.closest("[data-composer-memes]") : null;
      return Boolean(button && anchorRef.current?.contains(button));
    },
  });
  usePopoverDismiss(open, inside, onClose);
  useAnchoredPopover(open, anchorRef, rootRef, { prefer: "above", align: "start" });

  const load = useCallback(async (q: string) => {
    const id = ++req.current;
    setBusy(true);
    setError(null);
    try {
      const res = await searchMemes(q);
      if (id !== req.current) return;
      setHits(res.hits);
      setKeyConfigured(res.keyConfigured);
    } catch (failure) {
      if (id !== req.current) return;
      setHits([]);
      setError(readableErrorMessage(failure, t("memes.loadError")));
    } finally {
      if (id === req.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void load("");
    const tmr = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(tmr);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => void load(query), 220);
    return () => window.clearTimeout(handle);
  }, [query, open, load]);

  if (!open) return null;

  const pick = async (hit: MemeSearchHit) => {
    setSending(hit.id);
    setError(null);
    try {
      const { attachment } = await materializeMeme(hit);
      onPick(attachment);
      onClose();
    } catch (failure) {
      setError(readableErrorMessage(failure, t("memes.sendError")));
    } finally {
      setSending(null);
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t("memes.title")}
      data-meme-picker=""
      className="fixed left-0 top-0 z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-hidden rounded-2xl border-[0.5px] border-border popover-surface bg-elevated p-2 shadow-xl"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[13px] font-medium text-popover-ink">{t("memes.title")}</p>
        {onUploadLocal && (
          <button
            type="button"
            data-meme-upload=""
            onClick={() => { onUploadLocal(); onClose(); }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-popover-ink-secondary hover:bg-hover"
          >
            <Upload size={12} aria-hidden="true" />
            {t("memes.upload")}
          </button>
        )}
      </div>
      <label className="flex items-center gap-1.5 rounded-xl border border-border bg-panel px-2 py-1.5">
        <Search size={14} className="text-ink-tertiary" aria-hidden="true" />
        <input
          ref={inputRef}
          data-meme-search=""
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("memes.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
      </label>
      {!keyConfigured && (
        <p data-meme-setup-hint="" className="px-1 text-[11.5px] leading-snug text-ink-secondary">
          {t("memes.setupHint")}
        </p>
      )}
      {error && <p className="px-1 text-[12px] text-danger">{error}</p>}
      <div
        role="listbox"
        aria-label={t("memes.results")}
        data-meme-grid=""
        className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto p-0.5"
      >
        {busy && hits.length === 0 && (
          <div className="col-span-3 flex items-center justify-center gap-2 py-8 text-[12px] text-ink-tertiary">
            <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("memes.loading")}
          </div>
        )}
        {!busy && hits.length === 0 && !error && (
          <p className="col-span-3 px-1 py-6 text-center text-[12px] text-ink-tertiary">{t("memes.none")}</p>
        )}
        {hits.map((hit) => (
          <button
            key={hit.id}
            type="button"
            role="option"
            data-meme-hit={hit.id}
            disabled={sending !== null}
            aria-label={hit.title}
            title={hit.title}
            onClick={() => void pick(hit)}
            className={cn(
              "relative aspect-square overflow-hidden rounded-lg bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60",
              sending === hit.id && "opacity-60",
            )}
          >
            <img
              src={hit.previewUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
              data-meme-preview={hit.still ? "still" : "gif"}
            />
            {sending === hit.id && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                <LoaderCircle size={16} className="animate-spin text-white motion-reduce:animate-none" aria-hidden="true" />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="px-1 pb-0.5 text-[10.5px] text-ink-tertiary">{t("memes.attributionNote")}</p>
    </div>
  );
}

export function MemePickerButton({
  open,
  onToggle,
  buttonRef,
  disabled,
}: {
  open: boolean;
  onToggle: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-composer-memes=""
      aria-label={t("memes.button")}
      title={t("memes.button")}
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
      className={SECONDARY_CIRCLE}
    >
      {/* #2295: the composer's own icon button, the same as the + beside it */}
      <ImagePlay size={15} strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
