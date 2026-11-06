// Settings > Appearance > App icon: the Pulsatrix logo (default), the Sagax
// owl, the owl in its skins, a
// shape, Trombi, Bunbu, the person's Primary Bot or an uploaded picture, each drawn
// through the system's icon template so it sits in the Dock (or the taskbar)
// like the other apps' icons. The desktop app keeps and shows the result
// (electron/app-icon.mjs); a browser has no app icon, so no picker.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Upload } from "lucide-react";
import { appIconLock, reportAchievement, useUnlocks } from "@/lib/achievements";
import "@/components/achievements/achievements.css";
import { BotAvatar } from "@/components/Avatar";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import {
  APP_ICON_CHOICES,
  DEFAULT_APP_ICON_ID,
  UPLOAD_APP_ICON,
  appIconHintKey,
  appIconTargets,
  withPrimaryChoice,
  type AppIconChoice,
} from "@/lib/app-icon-choices";
import { appIconGlyphSvg } from "@/lib/app-icon-glyphs";
import { elementToArt, fileToArt, loadImage, renderAppIcon, type IconArt } from "@/lib/app-icon-render";
import { stageBot } from "@/lib/app-icon-apply";
import { readableError } from "@/lib/plain-error";

const STAGE = 256;
const TILE = 128;
const UPLOAD_TYPES = "image/png,image/jpeg,image/webp,image/gif";

export function appIconAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.ogb?.appIcon);
}

export function AppIconPicker() {
  const bridge = typeof window !== "undefined" ? window.ogb?.appIcon : undefined;
  const { state } = useStore();
  const [platform, setPlatform] = useState<string>(() => (typeof window !== "undefined" ? (window.ogb?.platform ?? "darwin") : "darwin"));
  const [current, setCurrent] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const stage = useRef<Record<string, HTMLDivElement | null>>({});
  const arts = useRef<Record<string, IconArt | null>>({});
  const upload = useRef<HTMLInputElement>(null);

  // icons drawing a locked mascot, or rewarded by an achievement, wait for it
  const unlocks = useUnlocks();
  const viewer = viewerActorId(state.config);
  const primary = state.bots.find((bot) => isViewersPrimaryBot(bot, viewer)) ?? null;
  const choices = useMemo(() => withPrimaryChoice(primary), [primary]);
  const { template, sizes } = appIconTargets(platform);

  useEffect(() => {
    let alive = true;
    void bridge?.get().then((saved) => {
      if (!alive) return;
      setPlatform(saved.platform);
      setCurrent(saved.id ?? DEFAULT_APP_ICON_ID);
    }).catch(() => { if (alive) setCurrent(DEFAULT_APP_ICON_ID); });
    return () => { alive = false; };
  }, [bridge]);

  // Draw every tile once the characters are on the (hidden) stage.
  useEffect(() => {
    let alive = true;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        const next: Record<string, string> = {};
        for (const choice of choices) {
          try {
            const art = await artFor(choice);
            arts.current[choice.id] = art;
            next[choice.id] = renderAppIcon(template, TILE, art, choice).toDataURL("image/png");
          } catch {
            // a character that cannot be drawn simply has no tile
          }
        }
        if (alive) setPreviews((previous) => ({ ...previous, ...next }));
      })();
    });
    return () => { alive = false; cancelAnimationFrame(frame); };
    // template follows platform
  }, [choices, template]);

  async function artFor(choice: AppIconChoice): Promise<IconArt | null> {
    if (choice.art.kind === "default") {
      const image = await loadImage("/app-icon.svg");
      return { image, width: 1024, height: 1024 };
    }
    if (choice.art.kind === "image") {
      const image = await loadImage(choice.art.src);
      return { image, width: 1024, height: 1024 };
    }
    if (choice.art.kind === "glyph") {
      const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(appIconGlyphSvg(choice.art.glyph))}`);
      return { image, width: 512, height: 512 };
    }
    if (choice.art.kind === "upload") return arts.current[choice.id] ?? null;
    const node = stage.current[choice.id];
    return node ? elementToArt(node, STAGE * 3) : null;
  }

  async function apply(choice: AppIconChoice, art: IconArt | null) {
    if (!bridge || busy) return;
    setBusy(choice.id);
    setError("");
    try {
      if (choice.id === DEFAULT_APP_ICON_ID) {
        await bridge.reset();
        setCurrent(DEFAULT_APP_ICON_ID);
        return;
      }
      const images = sizes.map((size) => ({ size, png: renderAppIcon(template, size, art, choice).toDataURL("image/png") }));
      const saved = await bridge.set({ id: choice.id, images });
      setCurrent(saved.id ?? DEFAULT_APP_ICON_ID);
      reportAchievement("appicon.changed");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    try {
      const art = await fileToArt(file);
      arts.current[UPLOAD_APP_ICON.id] = art;
      setPreviews((previous) => ({ ...previous, [UPLOAD_APP_ICON.id]: renderAppIcon(template, TILE, art, UPLOAD_APP_ICON).toDataURL("image/png") }));
      await apply(UPLOAD_APP_ICON, art);
    } catch {
      setError(t("settings.appIcon.uploadFailed"));
    }
  }

  if (!bridge) return null;
  const tiles = (previews[UPLOAD_APP_ICON.id] ? [...choices, UPLOAD_APP_ICON] : choices).filter((choice) => {
    if (choice.id === current) return true;
    return !appIconLock(unlocks, choice.id, choice.art as { kind: string; skin?: string }).locked;
  });
  return (
    <div className="flex flex-col gap-3" data-app-icon-picker data-platform={platform}>
      <div role="radiogroup" aria-label={t("settings.appIcon.title")} className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
        {tiles.map((choice) => {
          const selected = current === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-app-icon={choice.id}
              disabled={busy !== null || !previews[choice.id]}
              onClick={() => void apply(choice, arts.current[choice.id] ?? null)}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-xl p-2 text-[12px] leading-tight text-ink-secondary hover:bg-control/60 disabled:cursor-default",
                selected && "bg-control text-ink ring-1 ring-accent",
              )}
            >
              <span className="flex size-16 items-center justify-center">
                {previews[choice.id] ? <img src={previews[choice.id]} alt="" width={64} height={64} draggable={false} className="size-16" /> : <Loader2 size={16} className="animate-spin" />}
              </span>
              <span className="max-w-full truncate">{t(choice.labelKey)}</span>
              {selected && <Check size={13} className="absolute right-1.5 top-1.5 text-accent" aria-hidden="true" />}
              {busy === choice.id && <Loader2 size={13} className="absolute left-1.5 top-1.5 animate-spin" aria-hidden="true" />}
            </button>
          );
        })}
        <button
          type="button"
          data-app-icon-upload
          disabled={busy !== null}
          onClick={() => upload.current?.click()}
          className="flex flex-col items-center gap-1 rounded-xl p-2 text-[12px] leading-tight text-ink-secondary hover:bg-control/60"
        >
          <span className="flex size-16 items-center justify-center rounded-[15px] border border-dashed border-border-strong"><Upload size={18} /></span>
          <span>{t("settings.appIcon.uploadAction")}</span>
        </button>
        <input ref={upload} type="file" accept={UPLOAD_TYPES} hidden onChange={(event) => { void onUpload(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] leading-snug text-ink-secondary">{t(appIconHintKey(platform))}</p>
        <button
          type="button"
          data-app-icon-reset
          disabled={busy !== null || current === DEFAULT_APP_ICON_ID}
          onClick={() => void apply(APP_ICON_CHOICES[0], null)}
          className="shrink-0 rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-40"
        >
          {t("settings.appIcon.reset")}
        </button>
      </div>
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {/* The characters, drawn by the app's own avatar component off screen,
          then copied into each tile through the template. */}
      <div aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, width: STAGE, pointerEvents: "none" }}>
        {choices.map((choice) => {
          const bot = stageBot(choice.art, state.bots);
          if (!bot) return null;
          return (
            <div key={choice.id} ref={(node) => { stage.current[choice.id] = node; }} style={{ width: STAGE, height: STAGE }}>
              <BotAvatar bot={bot} size={STAGE} animated={false} label="" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
