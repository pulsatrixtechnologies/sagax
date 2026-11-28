// Settings panel for the bot page banner (M-20261127-183): own image,
// ready-made backgrounds, effects, generate from a phrase, reset.
import { useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type RefObject } from "react";
import { ImagePlus, Sparkles, RotateCcw } from "lucide-react";

import { AnchoredPopover } from "@/components/AnchoredPopover";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { avatarFileProblem, avatarImageFrom, dragMayCarryImage } from "@/lib/avatar-input";
import { generateBotBanner } from "@/lib/banner-generate-client";
import { cn } from "@/lib/cn";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import type { Bot } from "@/state/store";
import { botAvatarUrlFromStoredPath } from "../../../shared/bot-avatar";
import {
  BANNER_FOCUS_CENTER,
  BANNER_ZOOM_MIN,
  BOT_BANNER_EFFECTS,
  BOT_BANNER_PRESETS,
  defaultBannerPatch,
  normalizeBannerEffects,
  type BotBannerEffect,
  type BotBannerEffects,
  type BotBannerPreset,
} from "../../../shared/bot-banner";
import type { BotPatch } from "../bot-settings/useBotSettingsDerived";

const PRESET_SWATCH: Record<BotBannerPreset, string> = {
  default: "linear-gradient(180deg, #c6c9ce, #dcdee1)",
  mascot: "linear-gradient(180deg, #8fb89a, #c5dcc9)",
  "mascot-deep": "linear-gradient(180deg, #3d5a45, #6f8f78)",
  dots: "radial-gradient(circle at 20% 30%, #9aa3ad 1.5px, transparent 2px), linear-gradient(180deg, #c6c9ce, #dcdee1)",
  grid: "linear-gradient(#9aa3ad33 1px, transparent 1px), linear-gradient(90deg, #9aa3ad33 1px, transparent 1px), linear-gradient(180deg, #c6c9ce, #dcdee1)",
  waves: "repeating-linear-gradient(135deg, #b7bec6 0 8px, #cfd4d9 8px 16px)",
};

function effectLabel(effect: BotBannerEffect): string {
  return t(`botProfile.banner.effect.${effect}`);
}

function presetLabel(preset: BotBannerPreset): string {
  return t(`botProfile.banner.preset.${preset}`);
}

type Containing = { contains(target: unknown): boolean };

function useBannerDismissRoot(trigger: RefObject<HTMLElement | null>, popover: RefObject<HTMLElement | null>): RefObject<Containing | null> {
  return useMemo(
    () => ({
      get current(): Containing {
        return {
          contains: (target: unknown) => Boolean(trigger.current?.contains(target as Node) || popover.current?.contains(target as Node)),
        };
      },
    }),
    [trigger, popover],
  );
}

export function BotBannerEditPanel({
  bot,
  open,
  onOpenChange,
  anchorRef,
  onPatch,
  imageGenConfigured,
}: {
  bot: Bot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  onPatch: (patch: BotPatch) => void;
  /** True when the app's image generator is ready (reuse, do not invent). */
  imageGenConfigured: boolean;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const popoverId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [dropping, setDropping] = useState(false);
  const dismissRoot = useBannerDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(open, dismissRoot, () => onOpenChange(false));

  const effects = normalizeBannerEffects(bot.bannerEffects);
  const preset = (bot.bannerPreset && (BOT_BANNER_PRESETS as readonly string[]).includes(bot.bannerPreset) ? bot.bannerPreset : "default") as BotBannerPreset;
  const zoom = bot.bannerZoom ?? BANNER_ZOOM_MIN;
  const focusX = bot.bannerFocusX ?? BANNER_FOCUS_CENTER;
  const focusY = bot.bannerFocusY ?? BANNER_FOCUS_CENTER;

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    const problem = avatarFileProblem(file);
    if (problem) {
      setError(t(problem === "size" ? "botPanel.avatar.tooLarge" : "botPanel.avatar.chooseImage"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await imageAttachmentFromFile(file);
      const bannerUrl = saved ? botAvatarUrlFromStoredPath(saved.path) : null;
      if (!bannerUrl) throw new Error(t("botPanel.avatar.badImage"));
      onPatch({
        bannerUrl,
        bannerPreset: null,
        bannerZoom: BANNER_ZOOM_MIN,
        bannerFocusX: BANNER_FOCUS_CENTER,
        bannerFocusY: BANNER_FOCUS_CENTER,
      });
    } catch (uploadError) {
      setError(readableError(uploadError));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void upload(file);
  };

  const onDrop = (event: DragEvent) => {
    setDropping(false);
    const file = avatarImageFrom(event.dataTransfer);
    if (!file) return;
    event.preventDefault();
    void upload(file);
  };

  const setEffect = (effect: BotBannerEffect, on: boolean) => {
    const next: BotBannerEffects = { ...effects, [effect]: on || undefined };
    onPatch({ bannerEffects: next });
  };

  const generate = async () => {
    if (!imageGenConfigured || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { bannerUrl } = await generateBotBanner(bot.id, prompt.trim());
      onPatch({
        bannerUrl,
        bannerPreset: null,
        bannerZoom: BANNER_ZOOM_MIN,
        bannerFocusX: BANNER_FOCUS_CENTER,
        bannerFocusY: BANNER_FOCUS_CENTER,
      });
      setPrompt("");
    } catch (genError) {
      setError(readableError(genError));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={popoverRef}
      align="end"
      gap={6}
      id={popoverId}
      role="dialog"
      aria-labelledby={titleId}
      data-bot-banner-panel=""
      className="w-[min(420px,calc(100vw-32px))] max-h-[min(70vh,560px)] overflow-y-auto rounded-2xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-ink shadow-xl"
    >
      <h2 id={titleId} className="text-[15px] font-medium leading-5 text-ink">{t("botProfile.banner.title")}</h2>
      <p className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("botProfile.banner.intro")}</p>

      <section className="mt-4" data-bot-banner-section="image">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{t("botProfile.banner.image")}</h3>
        <div
          data-bot-banner-drop=""
          data-avatar-dropping={dropping ? "" : undefined}
          onDragOver={(event) => {
            if (busy || !dragMayCarryImage(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
          className={cn(
            "mt-2 flex flex-col items-stretch gap-2 rounded-xl border border-dashed border-border bg-hover/40 p-3",
            dropping && "ring-2 ring-accent",
          )}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-circle px-3 py-2 text-[13px] font-medium text-ink hover:bg-circle-hover disabled:opacity-50"
          >
            <ImagePlus size={16} aria-hidden="true" />
            {t("botProfile.banner.upload")}
          </button>
          <p className="text-center text-[11px] text-ink-secondary">{t("botPanel.avatar.dropOrPaste")}</p>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={onFile} />
        </div>
        {bot.bannerUrl && (
          <div className="mt-3 grid grid-cols-3 gap-2" data-bot-banner-framing="">
            <label className="col-span-3 text-[11px] text-ink-secondary">{t("botProfile.banner.focus")}</label>
            <label className="text-[11px] text-ink-secondary">
              X
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={focusX}
                onChange={(event) => onPatch({ bannerFocusX: Number(event.target.value) })}
                className="mt-1 w-full"
                aria-label={t("botProfile.banner.focusX")}
              />
            </label>
            <label className="text-[11px] text-ink-secondary">
              Y
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={focusY}
                onChange={(event) => onPatch({ bannerFocusY: Number(event.target.value) })}
                className="mt-1 w-full"
                aria-label={t("botProfile.banner.focusY")}
              />
            </label>
            <label className="text-[11px] text-ink-secondary">
              {t("botProfile.banner.zoom")}
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(event) => onPatch({ bannerZoom: Number(event.target.value) })}
                className="mt-1 w-full"
                aria-label={t("botProfile.banner.zoom")}
              />
            </label>
          </div>
        )}
      </section>

      <section className="mt-4" data-bot-banner-section="presets">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{t("botProfile.banner.presets")}</h3>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {BOT_BANNER_PRESETS.map((id) => {
            const selected = !bot.bannerUrl && preset === id;
            return (
              <button
                key={id}
                type="button"
                data-bot-banner-preset={id}
                data-selected={selected ? "" : undefined}
                aria-pressed={selected}
                title={presetLabel(id)}
                onClick={() => onPatch({ bannerUrl: null, bannerPreset: id === "default" ? null : id })}
                className={cn(
                  "flex h-14 flex-col overflow-hidden rounded-lg border border-border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  selected && "ring-2 ring-accent",
                )}
              >
                <span
                  aria-hidden="true"
                  className="min-h-0 flex-1"
                  style={{
                    backgroundImage: PRESET_SWATCH[id],
                    backgroundSize: id === "dots" ? "12px 12px, auto" : id === "grid" ? "12px 12px, 12px 12px, auto" : "auto",
                  }}
                />
                <span className="truncate bg-elevated px-1.5 py-1 text-[10px] leading-3 text-ink-secondary">{presetLabel(id)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-4" data-bot-banner-section="effects">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{t("botProfile.banner.effects")}</h3>
        <div className="mt-2 flex flex-col gap-1.5">
          {BOT_BANNER_EFFECTS.map((effect) => {
            const on = effects[effect] === true;
            return (
              <label key={effect} data-bot-banner-effect={effect} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-hover">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(event) => setEffect(effect, event.target.checked)}
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                {effectLabel(effect)}
              </label>
            );
          })}
        </div>
      </section>

      <section className="mt-4" data-bot-banner-section="generate">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{t("botProfile.banner.generate")}</h3>
        {imageGenConfigured ? (
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="text"
              value={prompt}
              maxLength={400}
              disabled={busy}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("botProfile.banner.generatePlaceholder")}
              aria-label={t("botProfile.banner.generatePlaceholder")}
              className="rounded-lg border border-border bg-app px-3 py-2 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void generate()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={16} aria-hidden="true" />
              {busy ? t("botProfile.banner.generating") : t("botProfile.banner.generateAction")}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-ink-secondary">{t("botProfile.banner.generateUnavailable")}</p>
        )}
      </section>

      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          data-bot-banner-reset=""
          disabled={busy}
          onClick={() => onPatch(defaultBannerPatch())}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          <RotateCcw size={14} aria-hidden="true" />
          {t("botProfile.banner.reset")}
        </button>
      </div>

      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AnchoredPopover>
  );
}
