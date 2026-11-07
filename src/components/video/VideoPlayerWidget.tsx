import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Maximize, Minimize, MoreHorizontal, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";

import { isHlsVideo, type WireVideoWidget } from "../../../shared/video-widget.ts";
import { t } from "@/lib/i18n";
import { formatMediaTime, MediaPlayerChrome, type MediaChromeActions, type MediaLiveWindow } from "./MediaPlayerChrome";
import {
  clampLiveSeek,
  clampPan,
  clampZoom,
  hasDvr,
  isBehindLive,
  isExpiredAt,
  isExpiredStatus,
  keyAction,
  liveLatency,
  liveWindowOf,
  loadResumePosition,
  planHlsError,
  reloadBackoffMs,
  RELOAD_MAX_ATTEMPTS,
  resumeKey,
  saveResumePosition,
  SEEK_STEP_SECONDS,
  uptimeMs,
  ZOOM_STEP,
} from "./video-player-state";

type HlsLike = {
  levels: { height?: number; bitrate?: number }[];
  currentLevel: number;
  liveSyncPosition?: number | null;
  startLoad: () => void;
  recoverMediaError: () => void;
  destroy: () => void;
};

type QualityLevel = { index: number; label: string };

/** Frozen states of the gallery (screenshots), never used in a chat. */
export type VideoShowcaseState = {
  expired?: boolean;
  behindLive?: boolean;
  menuOpen?: boolean;
  expanded?: boolean;
  current?: number;
};

const RESUME_SAVE_EVERY_S = 5;

export const VideoPlayerWidget = memo(function VideoPlayerWidget({
  video,
  showcase,
  showcaseState,
  onRequestRefresh,
}: {
  video: WireVideoWidget;
  /** Static poster + chrome for screenshots (no media decode). */
  showcase?: boolean;
  showcaseState?: VideoShowcaseState;
  /**
   * Asks the bot for a fresh share link (the message text is given). Without
   * it, an expired link only offers "Try again".
   */
  onRequestRefresh?: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const actionsRef = useRef<MediaChromeActions | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef({ network: 0, media: 0 });
  const lastSaved = useRef(0);
  const resumeApplied = useRef(false);
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(video.durationMs ? video.durationMs / 1000 : 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(() => isExpiredAt(video.expiresAt));
  const [refreshAsked, setRefreshAsked] = useState(false);
  const [liveWindow, setLiveWindow] = useState<MediaLiveWindow | null>(null);
  const [liveEdge, setLiveEdge] = useState<number | null>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [level, setLevel] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(Boolean(showcaseState?.menuOpen));
  const [expanded, setExpanded] = useState(Boolean(showcaseState?.expanded));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [now, setNow] = useState(() => Date.now());

  const isLive = video.kind === "live";
  const title = video.title ?? video.streamer ?? t("video.untitled");
  const key = useMemo(() => resumeKey(video), [video]);

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };

  const markExpired = useCallback(() => {
    clearRetry();
    setExpired(true);
    setError(null);
    setLoading(false);
  }, []);

  /** A plain media error: probe the URL once, an auth status means the link expired. */
  const probeExpiry = useCallback(async (src: string): Promise<boolean> => {
    try {
      const res = await fetch(src, { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" });
      void res.body?.cancel().catch(() => {});
      return isExpiredStatus(res.status);
    } catch {
      return false;
    }
  }, []);

  const loadMedia = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    clearRetry();
    // a retry replaces the previous hls.js instance
    hlsRef.current?.destroy();
    hlsRef.current = null;
    attempts.current = { network: 0, media: 0 };
    resumeApplied.current = false;
    if (isExpiredAt(video.expiresAt)) {
      markExpired();
      return;
    }
    setExpired(false);
    setLoading(true);
    setError(null);
    let disposed = false;
    const src = video.playbackUrl;
    // Decided from the source before the media proxy hid its extension.
    const isHls = isHlsVideo({ format: video.format, playbackUrl: src });
    if (isHls && !el.canPlayType("application/vnd.apple.mpegurl")) {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed || !videoRef.current) return;
        if (!Hls.isSupported()) {
          setError(t("video.playbackError"));
          setLoading(false);
          return;
        }
        const instance = new Hls({ enableWorker: true, lowLatencyMode: isLive, backBufferLength: isLive ? 300 : 90 });
        hlsRef.current = instance as unknown as HlsLike;
        instance.loadSource(src);
        instance.attachMedia(videoRef.current);
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          const found = (instance.levels ?? [])
            .map((l: { height?: number; bitrate?: number }, index: number) => ({
              index,
              label: l.height ? `${l.height}p` : l.bitrate ? `${Math.round(l.bitrate / 1000)} kbps` : `${index + 1}`,
            }))
            .reverse();
          setLevels(found.length > 1 ? found : []);
        });
        instance.on(Hls.Events.FRAG_LOADED, () => {
          attempts.current = { network: 0, media: 0 };
        });
        instance.on(Hls.Events.ERROR, (_event: unknown, data: Parameters<typeof planHlsError>[0]) => {
          const plan = planHlsError(data, attempts.current);
          if (plan === "ignore") return;
          if (plan === "expired") {
            if (data.fatal || data.details === "manifestLoadError" || data.details === "levelLoadError") markExpired();
            return;
          }
          if (plan === "reload") {
            const n = attempts.current.network++;
            setLoading(true);
            clearRetry();
            retryTimer.current = setTimeout(() => instance.startLoad(), reloadBackoffMs(n));
            return;
          }
          if (plan === "recover-media") {
            attempts.current.media++;
            instance.recoverMediaError();
            return;
          }
          setError(t("video.playbackError"));
          setLoading(false);
        });
      }).catch(() => {
        setError(t("video.playbackError"));
        setLoading(false);
      });
    } else {
      el.src = src;
    }
    return () => {
      disposed = true;
      clearRetry();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [video.playbackUrl, video.format, video.expiresAt, isLive, markExpired]);

  useEffect(() => {
    if (showcase) {
      setLoading(false);
      setError(null);
      setDuration(video.durationMs ? video.durationMs / 1000 : 312);
      if (isLive) {
        setLiveWindow({ start: 0, end: 1800 });
        setLiveEdge(1800);
      }
      return;
    }
    return loadMedia();
  }, [loadMedia, showcase, isLive, video.durationMs]);

  // Live uptime, once a second while it shows.
  useEffect(() => {
    if (!isLive || !video.startedAt || showcase) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isLive, video.startedAt, showcase]);

  // A link that expires while the card sits idle: flip to the refresh panel.
  useEffect(() => {
    if (showcase || !video.expiresAt || expired) return;
    const left = video.expiresAt - Date.now();
    if (left <= 0 || left > 2 ** 31 - 1) return;
    const timer = setTimeout(() => {
      if (videoRef.current?.paused !== false) markExpired();
    }, left);
    return () => clearTimeout(timer);
  }, [video.expiresAt, expired, showcase, markExpired]);

  const seekTo = useCallback((target: number) => {
    const el = videoRef.current;
    if (!el) return;
    const next = isLive ? clampLiveSeek(target, liveWindowOf(el.seekable)) : Math.max(0, Math.min(duration || target, target));
    el.currentTime = next;
    setCurrent(next);
  }, [isLive, duration]);

  const goLive = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const sync = hlsRef.current?.liveSyncPosition;
    const window = liveWindowOf(el.seekable);
    const target = sync != null && Number.isFinite(sync) ? sync : window ? window.end - 3 : null;
    if (target != null) el.currentTime = target;
    if (el.paused) void el.play().catch(() => {});
  }, []);

  const togglePlay = useCallback(() => {
    if (showcase) {
      setPlaying((p) => !p);
      return;
    }
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setError(t("video.playbackError")));
    else el.pause();
  }, [showcase]);

  const setZoomTo = useCallback((next: number) => {
    const z = clampZoom(next);
    setZoom(z);
    const box = shellRef.current?.getBoundingClientRect();
    setPan((p) => clampPan(p, z, { width: box?.width ?? 0, height: box?.height ?? 0 }));
  }, []);

  // Expand: the same card in the top layer (Popover API), so the <video> is
  // never remounted; data-expanded alone is the fallback without popovers.
  const setExpand = useCallback((next: boolean) => {
    const card = cardRef.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (card && typeof card.showPopover === "function") {
      try {
        if (next) {
          card.setAttribute("popover", "manual");
          card.showPopover();
        } else if (card.hasAttribute("popover")) {
          card.hidePopover?.();
          card.removeAttribute("popover");
        }
      } catch {
        /* already in the requested state */
      }
    }
    setExpanded(next);
    if (!next) setZoomTo(1);
  }, [setZoomTo]);

  useEffect(() => {
    if (!expanded || showcase) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpand(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, showcase, setExpand]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [role='menu']")) return;
    const action = keyAction(e.key, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey });
    if (!action) return;
    const el = videoRef.current;
    const handled = (() => {
      switch (action) {
        case "toggle-play":
          if (target.closest("button")) return false;
          togglePlay();
          return true;
        case "seek-back":
          if (el) seekTo(el.currentTime - SEEK_STEP_SECONDS);
          return true;
        case "seek-forward":
          if (el) seekTo(el.currentTime + SEEK_STEP_SECONDS);
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
          actionsRef.current?.toggleFullscreen();
          return true;
        case "toggle-expand":
          setExpand(!expanded);
          return true;
        case "toggle-pip":
          actionsRef.current?.togglePiP();
          return true;
        case "go-live":
          if (!isLive) return false;
          goLive();
          return true;
        case "zoom-in":
          setZoomTo(zoom + ZOOM_STEP);
          return true;
        case "zoom-out":
          setZoomTo(zoom - ZOOM_STEP);
          return true;
        case "zoom-reset":
          setZoomTo(1);
          return true;
        case "escape":
          if (menuOpen) {
            setMenuOpen(false);
            return true;
          }
          if (expanded) {
            setExpand(false);
            return true;
          }
          return false;
      }
    })();
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [togglePlay, seekTo, setExpand, expanded, isLive, goLive, setZoomTo, zoom, menuOpen]);

  const stageProps: React.HTMLAttributes<HTMLDivElement> = {
    tabIndex: 0,
    onKeyDown,
    onWheel: (e) => {
      // pinch (ctrl+wheel on a trackpad) or Cmd/Ctrl+wheel zooms
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomTo(zoom - Math.sign(e.deltaY) * ZOOM_STEP);
    },
    onDoubleClick: (e) => {
      if ((e.target as HTMLElement).closest("button, [role='slider'], input, [role='menu']")) return;
      setZoomTo(zoom > 1 ? 1 : 2);
      if (zoom > 1) setPan({ x: 0, y: 0 });
    },
    onPointerDown: (e) => {
      if (zoom <= 1 || (e.target as HTMLElement).closest("button, [role='slider'], input, [role='menu']")) return;
      panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const drag = panDrag.current;
      if (!drag) return;
      const box = shellRef.current?.getBoundingClientRect();
      setPan(clampPan(
        { x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y },
        zoom,
        { width: box?.width ?? 0, height: box?.height ?? 0 },
      ));
    },
    onPointerUp: (e) => {
      panDrag.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
  };

  const requestRefresh = useCallback(() => {
    if (!onRequestRefresh) return;
    onRequestRefresh(t("video.refreshRequest", { title }));
    setRefreshAsked(true);
  }, [onRequestRefresh, title]);

  const showExpired = showcase ? Boolean(showcaseState?.expired) : expired;
  const behind = showcase
    ? Boolean(showcaseState?.behindLive)
    : isLive && isBehindLive(current, liveWindow, liveEdge);
  const latency = showcase ? (showcaseState?.behindLive ? 42 : 0) : liveLatency(current, liveWindow, liveEdge);
  const uptime = isLive ? uptimeMs(video.startedAt, showcase ? Date.parse(video.startedAt ?? "") + 5_025_000 : now) : null;
  const shownCurrent = showcase ? (showcaseState?.current ?? (isLive ? (behind ? 1758 : 1800) : 48)) : current;

  const expiredPanel = showExpired ? (
    <div className="vpc-error" data-expired="true">
      <Clock3 size={22} aria-hidden />
      <p>{t("video.linkExpired")}</p>
      <div className="vpc-error-actions">
        {onRequestRefresh && (
          <button type="button" className="vpc-chip" data-primary="true" onClick={requestRefresh} disabled={refreshAsked}>
            <RefreshCw size={16} />
            {refreshAsked ? t("video.refreshRequested") : t("video.requestNewLink")}
          </button>
        )}
        <button type="button" className="vpc-chip" onClick={loadMedia}>
          {t("video.retry")}
        </button>
      </div>
    </div>
  ) : undefined;

  const extraControls = (
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
            {(levels.length > 0 || showcase) && (
              <>
                <p className="vpc-menu-label">{t("video.quality")}</p>
                {[{ index: -1, label: t("video.qualityAuto") }, ...(showcase ? [{ index: 1, label: "1080p" }, { index: 0, label: "720p" }] : levels)].map((q) => (
                  <button
                    key={q.index}
                    type="button"
                    role="menuitemradio"
                    aria-checked={level === q.index}
                    className="vpc-menu-item"
                    onClick={() => {
                      setLevel(q.index);
                      if (hlsRef.current) hlsRef.current.currentLevel = q.index;
                      setMenuOpen(false);
                    }}
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

  return (
    <MediaPlayerChrome
      header={{
        title,
        streamer: video.streamer,
        source: video.source,
        avatarUrl: video.avatarUrl,
        live: isLive,
        viewerCount: video.viewerCount,
        category: video.category,
        tags: video.tags,
        uptime: uptime != null ? formatMediaTime(uptime) : undefined,
        recording: video.recording,
      }}
      stageRef={shellRef}
      cardRef={cardRef}
      expanded={expanded}
      actionsRef={actionsRef}
      loading={loading && !showExpired}
      error={showExpired ? null : error}
      errorPanel={expiredPanel}
      onRetry={loadMedia}
      playing={playing}
      onPlayToggle={showExpired ? undefined : togglePlay}
      stageProps={stageProps}
      extraControls={extraControls}
      native={{
        videoRef,
        isLive,
        duration: showcase ? (video.durationMs ? video.durationMs / 1000 : 312) : duration,
        current: shownCurrent,
        setCurrent,
        playing,
        muted,
        volume,
        playbackUrl: video.playbackUrl,
        liveWindow: isLive && hasDvr(liveWindow) ? liveWindow : null,
        behindLive: behind,
        liveLatency: latency,
        onGoLive: goLive,
        onSeek: seekTo,
        seekStep: !isLive || hasDvr(liveWindow) ? SEEK_STEP_SECONDS : undefined,
        chapters: video.chapters,
      }}
    >
      {video.posterUrl && (
        <div
          className="vpc-backdrop"
          style={{ backgroundImage: `url(${video.posterUrl})` }}
          aria-hidden
        />
      )}
      <div
        className="vpc-zoom"
        data-zoomed={zoom > 1 ? "true" : undefined}
        style={zoom > 1 ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } : undefined}
      >
        {showcase ? (
          <img src={video.posterUrl} alt="" />
        ) : (
          <video
            ref={videoRef}
            poster={video.posterUrl}
            playsInline
            controls={false}
            onPlay={() => { setPlaying(true); setLoading(false); }}
            onPause={(e) => {
              setPlaying(false);
              if (!isLive) saveResumePosition(key, e.currentTarget.currentTime, e.currentTarget.duration);
            }}
            onWaiting={() => setLoading(true)}
            onPlaying={() => { setLoading(false); setError(null); }}
            onLoadedData={() => setLoading(false)}
            onLoadedMetadata={(e) => {
              if (isLive || resumeApplied.current) return;
              resumeApplied.current = true;
              const at = loadResumePosition(key);
              const d = e.currentTarget.duration;
              if (at != null && (!Number.isFinite(d) || at < d - 5)) e.currentTarget.currentTime = at;
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              setCurrent(el.currentTime);
              if (isLive) {
                setLiveWindow(liveWindowOf(el.seekable));
                const sync = hlsRef.current?.liveSyncPosition;
                setLiveEdge(sync != null && Number.isFinite(sync) ? sync : null);
              } else if (Math.abs(el.currentTime - lastSaved.current) >= RESUME_SAVE_EVERY_S) {
                lastSaved.current = el.currentTime;
                saveResumePosition(key, el.currentTime, el.duration);
              }
            }}
            onEnded={(e) => {
              if (!isLive) saveResumePosition(key, e.currentTarget.duration, e.currentTarget.duration);
            }}
            onDurationChange={(e) => {
              if (!isLive && Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
            }}
            onVolumeChange={(e) => {
              setVolume(e.currentTarget.volume);
              setMuted(e.currentTarget.muted);
            }}
            onError={(e) => {
              if (hlsRef.current) return; // hls.js reports its own errors
              const el = e.currentTarget;
              const src = video.playbackUrl;
              setLoading(true);
              void probeExpiry(src).then((isExpired) => {
                if (isExpired) {
                  markExpired();
                  return;
                }
                const n = attempts.current.network;
                if (n < RELOAD_MAX_ATTEMPTS) {
                  attempts.current.network = n + 1;
                  clearRetry();
                  retryTimer.current = setTimeout(() => {
                    el.src = src;
                    el.load();
                  }, reloadBackoffMs(n));
                  return;
                }
                setError(t("video.playbackError"));
                setLoading(false);
              });
            }}
          />
        )}
      </div>
    </MediaPlayerChrome>
  );
});
