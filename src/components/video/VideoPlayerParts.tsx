import { Check, Clock3, Maximize, Minimize, MoreHorizontal, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";

import { t } from "@/lib/i18n";
import type { MediaChromeActions } from "./MediaPlayerChrome";
import { isExpiredStatus, keyAction, SEEK_STEP_SECONDS, ZOOM_STEP } from "./video-player-state";

export type QualityLevel = { index: number; label: string };

/** hls.js manifest policy: a live share link may still be starting (503
 * while it warms up), so the playlist is asked for a while before giving up. */
export const HLS_MANIFEST_LOAD_POLICY = {
  default: {
    maxTimeToFirstByteMs: 20_000,
    maxLoadTimeMs: 30_000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 1_000, maxRetryDelayMs: 4_000 },
    errorRetry: { maxNumRetry: 4, retryDelayMs: 1_000, maxRetryDelayMs: 4_000 },
  },
};

/** The quality menu of an hls.js level list, highest first; one level is no choice. */
export function qualityLevelsOf(levels: { height?: number; bitrate?: number }[] | undefined): QualityLevel[] {
  const found = (levels ?? [])
    .map((l, index) => ({
      index,
      label: l.height ? `${l.height}p` : l.bitrate ? `${Math.round(l.bitrate / 1000)} kbps` : `${index + 1}`,
    }))
    .reverse();
  return found.length > 1 ? found : [];
}

/** A plain media error: probe the URL once, an auth status means the link expired. */
export async function probeExpiry(src: string): Promise<boolean> {
  try {
    const res = await fetch(src, { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" });
    void res.body?.cancel().catch(() => {});
    return isExpiredStatus(res.status);
  } catch {
    return false;
  }
}

export type StageKeyContext = {
  el: HTMLVideoElement | null;
  actions: MediaChromeActions | null;
  isLive: boolean;
  expanded: boolean;
  zoom: number;
  menuOpen: boolean;
  togglePlay: () => void;
  seekTo: (target: number) => void;
  goLive: () => void;
  setExpand: (next: boolean) => void;
  setZoomTo: (next: number) => void;
  closeMenu: () => void;
};

/** The stage's keyboard shortcuts; a handled key stops there. */
export function runStageKey(e: React.KeyboardEvent<HTMLDivElement>, ctx: StageKeyContext): void {
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select, [role='menu']")) return;
  const action = keyAction(e.key, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey });
  if (!action) return;
  const { el } = ctx;
  const handled = (() => {
    switch (action) {
      case "toggle-play":
        if (target.closest("button")) return false;
        ctx.togglePlay();
        return true;
      case "seek-back":
        if (el) ctx.seekTo(el.currentTime - SEEK_STEP_SECONDS);
        return true;
      case "seek-forward":
        if (el) ctx.seekTo(el.currentTime + SEEK_STEP_SECONDS);
        return true;
      case "volume-up":
      case "volume-down":
        if (el) {
          el.volume = Math.min(1, Math.max(0, el.volume + (action === "volume-up" ? 0.1 : -0.1)));
          el.muted = el.volume === 0;
        }
        return true;
      case "toggle-mute":
        if (el) el.muted = !el.muted;
        return true;
      case "toggle-fullscreen":
        ctx.actions?.toggleFullscreen();
        return true;
      case "toggle-expand":
        ctx.setExpand(!ctx.expanded);
        return true;
      case "toggle-pip":
        ctx.actions?.togglePiP();
        return true;
      case "go-live":
        if (!ctx.isLive) return false;
        ctx.goLive();
        return true;
      case "zoom-in":
        ctx.setZoomTo(ctx.zoom + ZOOM_STEP);
        return true;
      case "zoom-out":
        ctx.setZoomTo(ctx.zoom - ZOOM_STEP);
        return true;
      case "zoom-reset":
        ctx.setZoomTo(1);
        return true;
      case "escape":
        if (ctx.menuOpen) {
          ctx.closeMenu();
          return true;
        }
        if (ctx.expanded) {
          ctx.setExpand(false);
          return true;
        }
        return false;
    }
  })();
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** The expired-link panel: ask the bot for a new link, or try again. */
export function ExpiredLinkPanel({
  canRequest,
  refreshAsked,
  onRequest,
  onRetry,
}: {
  canRequest: boolean;
  refreshAsked: boolean;
  onRequest: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="vpc-error" data-expired="true">
      <Clock3 size={22} aria-hidden />
      <p>{t("video.linkExpired")}</p>
      <div className="vpc-error-actions">
        {canRequest && (
          <button type="button" className="vpc-chip" data-primary="true" onClick={onRequest} disabled={refreshAsked}>
            <RefreshCw size={16} />
            {refreshAsked ? t("video.refreshRequested") : t("video.requestNewLink")}
          </button>
        )}
        <button type="button" className="vpc-chip" onClick={onRetry}>
          {t("video.retry")}
        </button>
      </div>
    </div>
  );
}

/** The "more" menu (quality, zoom) and the expand button of the control bar. */
export function VideoExtraControls({
  menuOpen,
  setMenuOpen,
  levels,
  level,
  onPickLevel,
  zoom,
  setZoomTo,
  expanded,
  setExpand,
}: {
  menuOpen: boolean;
  setMenuOpen: (update: (open: boolean) => boolean) => void;
  /** Empty: no quality section. */
  levels: QualityLevel[];
  level: number;
  onPickLevel: (index: number) => void;
  zoom: number;
  setZoomTo: (next: number) => void;
  expanded: boolean;
  setExpand: (next: boolean) => void;
}) {
  return (
    <>
      <div className="vpc-menu-wrap">
        <button
          type="button"
          className="vpc-icon"
          aria-label={t("video.moreOptions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <MoreHorizontal size={18} />
        </button>
        {menuOpen && (
          <div className="vpc-menu" role="menu" aria-label={t("video.moreOptions")}>
            {levels.length > 0 && (
              <>
                <p className="vpc-menu-label">{t("video.quality")}</p>
                {[{ index: -1, label: t("video.qualityAuto") }, ...levels].map((q) => (
                  <button
                    key={q.index}
                    type="button"
                    role="menuitemradio"
                    aria-checked={level === q.index}
                    className="vpc-menu-item"
                    onClick={() => onPickLevel(q.index)}
                  >
                    <span>{q.label}</span>
                    {level === q.index && <Check size={14} aria-hidden />}
                  </button>
                ))}
              </>
            )}
            <p className="vpc-menu-label">{t("video.zoom")}</p>
            <div className="vpc-menu-row">
              <button type="button" role="menuitem" className="vpc-icon" aria-label={t("video.zoomOut")} onClick={() => setZoomTo(zoom - ZOOM_STEP)} disabled={zoom <= 1}>
                <ZoomOut size={16} />
              </button>
              <button type="button" role="menuitem" className="vpc-menu-zoom" aria-label={t("video.zoomReset")} onClick={() => setZoomTo(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" role="menuitem" className="vpc-icon" aria-label={t("video.zoomIn")} onClick={() => setZoomTo(zoom + ZOOM_STEP)} disabled={zoom >= 4}>
                <ZoomIn size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        className="vpc-icon"
        aria-label={expanded ? t("video.collapse") : t("video.expand")}
        onClick={() => setExpand(!expanded)}
      >
        {expanded ? <Minimize size={18} /> : <Maximize size={18} />}
      </button>
    </>
  );
}
