import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ExternalLink,
  Maximize2,
  Radio,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import "./video-player.css";

export function formatMediaTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type MediaChromeHeader = {
  title: string;
  streamer?: string;
  source?: string;
  avatarUrl?: string;
  live?: boolean;
  viewerCount?: number;
  /** Game or topic, after the streamer. */
  category?: string;
  tags?: readonly string[];
  /** Elapsed live time, already formatted ("1:02:03"). */
  uptime?: string;
  /** The stream is being recorded: REC badge. */
  recording?: boolean;
};

export type MediaChapter = { startMs: number; title: string };

/** A live stream's seekable window (DVR), in media seconds. */
export type MediaLiveWindow = { start: number; end: number };

export type NativeVideoControls = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isLive: boolean;
  duration: number;
  current: number;
  setCurrent: (n: number) => void;
  playing: boolean;
  muted: boolean;
  volume: number;
  playbackUrl: string;
  /** Live with a DVR window: the scrubber spans it and shows the delay. */
  liveWindow?: MediaLiveWindow | null;
  /** Live, the playhead is behind the edge: "Back to live" is offered. */
  behindLive?: boolean;
  /** Seconds behind the live edge (shown as "-0:23"). */
  liveLatency?: number;
  onGoLive?: () => void;
  /** Seek (seconds) through the player, which clamps it; else currentTime. */
  onSeek?: (seconds: number) => void;
  /** Back / forward buttons (seconds per step). */
  seekStep?: number;
  chapters?: readonly MediaChapter[];
};

/** Fullscreen and PiP, for a player's keyboard shortcuts. */
export type MediaChromeActions = { toggleFullscreen: () => void; togglePiP: () => void };

type ChromeProps = {
  header: MediaChromeHeader;
  stageRef: React.RefObject<HTMLDivElement | null>;
  labelId?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Shown when paused (native video or delegated play). */
  onPlayToggle?: () => void;
  playing?: boolean;
  /** Native video controls; omit for embed-only chrome (e.g. YouTube). */
  native?: NativeVideoControls;
  /** Extra actions in the control bar (transcript, send to bot). */
  footerActions?: ReactNode;
  /** Below the stage: transcript drawer content. */
  drawer?: ReactNode;
  drawerOpen?: boolean;
  /**
   * The media draws its own controls (the YouTube embed): nothing is laid
   * over the stage (video-player.css hides the overlays), and the title and
   * `footerActions` sit in a row under it.
   */
  embedControls?: boolean;
  /** Replaces the error panel (an expired share link and its refresh). */
  errorPanel?: ReactNode;
  /** Controls before full screen (quality menu, expand). */
  extraControls?: ReactNode;
  /** Keyboard, wheel and pointer handlers of the stage (zoom, pan, shortcuts). */
  stageProps?: React.HTMLAttributes<HTMLDivElement>;
  /** The card element (the expanded view moves it to the top layer). */
  cardRef?: React.Ref<HTMLDivElement>;
  expanded?: boolean;
  actionsRef?: React.MutableRefObject<MediaChromeActions | null>;
  children: ReactNode;
};

const CONTROLS_IDLE_MS = 2800;

export const MediaPlayerChrome = memo(function MediaPlayerChrome({
  header,
  stageRef,
  labelId: labelIdProp,
  loading,
  error,
  onRetry,
  onPlayToggle,
  playing = false,
  native,
  footerActions,
  drawer,
  drawerOpen,
  embedControls = false,
  errorPanel,
  extraControls,
  stageProps,
  cardRef,
  expanded,
  actionsRef,
  children,
}: ChromeProps) {
  const autoId = useId();
  const labelId = labelIdProp ?? autoId;
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fs, setFs] = useState(false);
  const [scrubHover, setScrubHover] = useState<{ ratio: number; left: number } | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubRef = useRef<HTMLDivElement>(null);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
  }, []);

  useEffect(() => {
    bumpControls();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [bumpControls]);

  const onFsChange = useCallback(() => {
    setFs(document.fullscreenElement === stageRef.current);
  }, [stageRef]);

  useEffect(() => {
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onFsChange]);

  const toggleFs = useCallback(() => {
    const shell = stageRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell) void document.exitFullscreen();
    else void shell.requestFullscreen();
  }, [stageRef]);

  const togglePiP = useCallback(async () => {
    const el = native?.videoRef.current;
    if (!el || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement === el) await document.exitPictureInPicture();
    else await el.requestPictureInPicture();
  }, [native]);

  if (actionsRef) {
    actionsRef.current = { toggleFullscreen: toggleFs, togglePiP: () => void togglePiP().catch(() => {}) };
  }

  const popOut = useCallback(() => {
    if (!native?.playbackUrl) return;
    const url = new URL(native.playbackUrl, window.location.origin).href;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [native]);

  // The scrubber spans the VOD (0..duration) or the live DVR window.
  const range = native
    ? native.isLive
      ? native.liveWindow ?? null
      : native.duration > 0
        ? { start: 0, end: native.duration }
        : null
    : null;
  const scrubbable = Boolean(native && (!native.isLive || native.liveWindow));
  const dragging = useRef(false);

  const ratioAt = useCallback((clientX: number) => {
    const bar = scrubRef.current;
    if (!bar) return null;
    const rect = bar.getBoundingClientRect();
    if (!rect.width) return null;
    return { ratio: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)), left: clientX - rect.left };
  }, []);

  const seekFromClientX = useCallback((clientX: number) => {
    if (!native || !range) return;
    const at = ratioAt(clientX);
    if (!at) return;
    const target = range.start + at.ratio * (range.end - range.start);
    if (native.onSeek) native.onSeek(target);
    else if (native.videoRef.current) native.videoRef.current.currentTime = target;
    native.setCurrent(target);
  }, [native, range, ratioAt]);

  const showCenterPlay = !embedControls && !loading && !error && !errorPanel && !playing && onPlayToggle;
  const chromeOn = controlsVisible || !playing;
  const viewers = header.viewerCount != null && header.viewerCount > 0
    ? header.viewerCount.toLocaleString()
    : null;

  return (
    <div
      ref={cardRef}
      className="vpc-card"
      role="group"
      aria-labelledby={labelId}
      data-vpc="1"
      data-embed-controls={embedControls ? "true" : undefined}
      data-expanded={expanded ? "true" : undefined}
    >
      <div
        {...stageProps}
        ref={stageRef}
        className="vpc-stage"
        onMouseMove={(e) => {
          bumpControls();
          stageProps?.onMouseMove?.(e);
        }}
        onMouseLeave={(e) => {
          setControlsVisible(false);
          stageProps?.onMouseLeave?.(e);
        }}
        onFocus={(e) => {
          bumpControls();
          stageProps?.onFocus?.(e);
        }}
      >
        <span id={labelId} className="sr-only">{header.title}</span>
        <div className="vpc-media">{children}</div>

        <div className="vpc-top" data-hidden={chromeOn ? "false" : "true"}>
          <div className="vpc-id">
            {header.avatarUrl ? (
              <img src={header.avatarUrl} alt="" className="vpc-avatar" />
            ) : header.streamer ? (
              <span className="vpc-avatar-fallback" aria-hidden>
                {header.streamer.slice(0, 1).toUpperCase()}
              </span>
            ) : null}
            <div className="vpc-titles">
              <p className="vpc-title">{header.title}</p>
              {(header.streamer || header.source || header.category) && (
                <p className="vpc-sub">
                  {[header.streamer, header.category, header.source].filter(Boolean).join(" · ")}
                </p>
              )}
              {header.tags && header.tags.length > 0 && (
                <p className="vpc-tags">
                  {header.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="vpc-tag">{tag}</span>
                  ))}
                </p>
              )}
            </div>
          </div>
          <div className="vpc-badges">
            {header.live && (
              <button
                type="button"
                className="vpc-live"
                data-behind={native?.behindLive ? "true" : undefined}
                disabled={!native?.behindLive || !native.onGoLive}
                onClick={native?.onGoLive}
                aria-label={native?.behindLive ? t("video.backToLive") : t("video.live")}
              >
                <span className="vpc-live-dot" aria-hidden />
                {t("video.live")}
                {viewers && <span className="vpc-live-count">· {t("video.viewers", { count: viewers })}</span>}
              </button>
            )}
            {(header.uptime || header.recording) && (
              <span className="vpc-meta-row">
                {header.recording && (
                  <span className="vpc-rec" title={t("video.recording")}>
                    <span className="vpc-rec-dot" aria-hidden />
                    REC
                  </span>
                )}
                {header.uptime && (
                  <span className="vpc-uptime" title={t("video.uptime")}>{header.uptime}</span>
                )}
              </span>
            )}
          </div>
        </div>

        {loading && <div className="vpc-shimmer" aria-hidden />}

        {errorPanel ?? (error && (
          <div className="vpc-error">
            <p>{error}</p>
            {onRetry && (
              <button type="button" className="vpc-chip" onClick={onRetry}>
                <RotateCcw size={16} />
                {t("video.retry")}
              </button>
            )}
            {/* an unplayable stream still offers its link, never a dead box */}
            {native?.playbackUrl && /^https?:\/\//i.test(native.playbackUrl) && (
              <a className="vpc-chip" href={native.playbackUrl} target="_blank" rel="noopener noreferrer">
                {t("video.popOut")}
              </a>
            )}
          </div>
        ))}

        {showCenterPlay && (
          <button type="button" className="vpc-play" onClick={onPlayToggle} aria-label={t("video.play")}>
            <Play size={30} fill="currentColor" />
          </button>
        )}

        <div className="vpc-bottom" data-hidden={chromeOn ? "false" : "true"}>
          {native && scrubbable && range && (
            <div
              ref={scrubRef}
              className="vpc-scrub"
              role="slider"
              tabIndex={-1}
              aria-label={t("video.seek")}
              aria-valuemin={Math.floor(range.start)}
              aria-valuemax={Math.floor(range.end)}
              aria-valuenow={Math.floor(native.current)}
              data-live={native.isLive ? "true" : undefined}
              onPointerDown={(e) => {
                dragging.current = true;
                e.currentTarget.setPointerCapture?.(e.pointerId);
                seekFromClientX(e.clientX);
              }}
              onPointerMove={(e) => {
                const at = ratioAt(e.clientX);
                if (at) setScrubHover(at);
                if (dragging.current) seekFromClientX(e.clientX);
              }}
              onPointerUp={(e) => {
                dragging.current = false;
                e.currentTarget.releasePointerCapture?.(e.pointerId);
              }}
              onPointerLeave={() => {
                if (!dragging.current) setScrubHover(null);
              }}
            >
              <div
                className="vpc-scrub-fill"
                style={{ width: `${scrubPercent(native.current, range)}%` }}
              />
              {native.chapters?.map((chapter) =>
                !native.isLive && chapter.startMs > 0 && chapter.startMs / 1000 < range.end ? (
                  <span
                    key={`${chapter.startMs}-${chapter.title}`}
                    className="vpc-scrub-mark"
                    style={{ left: `${scrubPercent(chapter.startMs / 1000, range)}%` }}
                    title={chapter.title}
                    aria-hidden
                  />
                ) : null,
              )}
              {scrubHover && range.end > range.start && (
                <span className="vpc-scrub-tip" style={{ left: scrubHover.left }}>
                  {scrubTipLabel(native, range, scrubHover.ratio)}
                </span>
              )}
            </div>
          )}

          <div className="vpc-controls">
            {onPlayToggle && (
              <ChromeIconButton
                label={playing ? t("video.pause") : t("video.play")}
                onClick={onPlayToggle}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </ChromeIconButton>
            )}
            {native && (
              <>
                {native.seekStep ? (
                  <>
                    <ChromeIconButton
                      label={t("video.seekBack", { seconds: native.seekStep })}
                      onClick={() => seekBy(native, -native.seekStep!)}
                    >
                      <span className="vpc-step" aria-hidden>-{native.seekStep}</span>
                    </ChromeIconButton>
                    {(!native.isLive || native.behindLive) && (
                      <ChromeIconButton
                        label={t("video.seekForward", { seconds: native.seekStep })}
                        onClick={() => seekBy(native, native.seekStep!)}
                      >
                        <span className="vpc-step" aria-hidden>+{native.seekStep}</span>
                      </ChromeIconButton>
                    )}
                  </>
                ) : null}
                <span className="vpc-time">
                  {native.isLive
                    ? native.behindLive && native.liveLatency
                      ? `-${formatMediaTime(native.liveLatency * 1000)}`
                      : t("video.live")
                    : `${formatMediaTime(native.current * 1000)} / ${formatMediaTime((native.duration || 0) * 1000)}`}
                </span>
                {native.isLive && native.behindLive && native.onGoLive && (
                  <button type="button" className="vpc-golive" onClick={native.onGoLive}>
                    <Radio size={14} aria-hidden />
                    {t("video.backToLive")}
                  </button>
                )}
                <ChromeIconButton
                  label={native.muted ? t("video.unmute") : t("video.mute")}
                  onClick={() => {
                    const el = native.videoRef.current;
                    if (!el) return;
                    el.muted = !el.muted;
                  }}
                >
                  {native.muted || native.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </ChromeIconButton>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={native.muted ? 0 : native.volume}
                  onChange={(e) => {
                    const el = native.videoRef.current;
                    if (!el) return;
                    const v = Number(e.target.value);
                    el.volume = v;
                    el.muted = v === 0;
                  }}
                  className="vpc-volume"
                  aria-label={t("video.volume")}
                />
                {typeof document !== "undefined" && document.pictureInPictureEnabled && (
                  <ChromeIconButton label={t("video.pip")} onClick={() => void togglePiP()}>
                    <PictureInPicture2 size={18} />
                  </ChromeIconButton>
                )}
                <ChromeIconButton label={t("video.popOut")} onClick={popOut}>
                  <ExternalLink size={18} />
                </ChromeIconButton>
              </>
            )}
            {extraControls}
            <ChromeIconButton
              label={fs ? t("video.exitFullscreen") : t("video.fullscreen")}
              onClick={toggleFs}
            >
              {fs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </ChromeIconButton>
            {footerActions && !embedControls && <div className="vpc-actions">{footerActions}</div>}
          </div>
        </div>
      </div>

      {embedControls && (
        <div className="vpc-footer">
          <div className="vpc-titles">
            <p className="vpc-footer-title">{header.title}</p>
            {(header.streamer || header.source) && (
              <p className="vpc-footer-sub">
                {[header.streamer, header.source].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          {footerActions && <div className="vpc-actions">{footerActions}</div>}
        </div>
      )}

      {drawer && (
        <div className="vpc-drawer" data-open={drawerOpen ? "true" : "false"}>
          <div className="vpc-drawer-inner">{drawer}</div>
        </div>
      )}
    </div>
  );
});

function ChromeIconButton({
  children,
  label,
  onClick,
  className,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn("vpc-icon", className)}
    >
      {children}
    </button>
  );
}

function scrubPercent(at: number, range: MediaLiveWindow): number {
  const span = range.end - range.start;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((at - range.start) / span) * 100));
}

function scrubTipLabel(native: NativeVideoControls, range: MediaLiveWindow, ratio: number): string {
  const at = range.start + ratio * (range.end - range.start);
  if (native.isLive) return `-${formatMediaTime((range.end - at) * 1000)}`;
  const chapter = native.chapters?.filter((c) => c.startMs / 1000 <= at).at(-1);
  const time = formatMediaTime(at * 1000);
  return chapter ? `${time} · ${chapter.title}` : time;
}

function seekBy(native: NativeVideoControls, delta: number): void {
  const el = native.videoRef.current;
  const target = (el?.currentTime ?? native.current) + delta;
  if (native.onSeek) native.onSeek(target);
  else if (el) el.currentTime = Math.max(0, Math.min(native.duration || target, target));
}
