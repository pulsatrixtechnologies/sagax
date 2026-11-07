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
};

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
};

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

  const popOut = useCallback(() => {
    if (!native?.playbackUrl) return;
    const url = new URL(native.playbackUrl, window.location.origin).href;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [native]);

  const seekFromClientX = useCallback((clientX: number) => {
    if (!native || native.isLive) return;
    const bar = scrubRef.current;
    if (!bar || !native.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = ratio * native.duration;
    native.videoRef.current!.currentTime = t;
    native.setCurrent(t);
  }, [native]);

  const showCenterPlay = !embedControls && !loading && !error && !playing && onPlayToggle;
  const chromeOn = controlsVisible || !playing;
  const viewers = header.viewerCount != null && header.viewerCount > 0
    ? header.viewerCount.toLocaleString()
    : null;

  return (
    <div className="vpc-card" role="group" aria-labelledby={labelId} data-vpc="1" data-embed-controls={embedControls ? "true" : undefined}>
      <div
        ref={stageRef}
        className="vpc-stage"
        onMouseMove={bumpControls}
        onMouseLeave={() => setControlsVisible(false)}
        onFocus={bumpControls}
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
              {(header.streamer || header.source) && (
                <p className="vpc-sub">
                  {[header.streamer, header.source].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
          {header.live && (
            <span className="vpc-live">
              <span className="vpc-live-dot" aria-hidden />
              {t("video.live")}
              {viewers && <span className="vpc-live-count">· {t("video.viewers", { count: viewers })}</span>}
            </span>
          )}
        </div>

        {loading && <div className="vpc-shimmer" aria-hidden />}

        {error && (
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
        )}

        {showCenterPlay && (
          <button type="button" className="vpc-play" onClick={onPlayToggle} aria-label={t("video.play")}>
            <Play size={30} fill="currentColor" />
          </button>
        )}

        <div className="vpc-bottom" data-hidden={chromeOn ? "false" : "true"}>
          {native && !native.isLive && (
            <div
              ref={scrubRef}
              className="vpc-scrub"
              role="slider"
              aria-label={t("video.seek")}
              aria-valuemin={0}
              aria-valuemax={native.duration || 0}
              aria-valuenow={native.current}
              onMouseMove={(e) => {
                const bar = scrubRef.current;
                if (!bar || !native.duration) return;
                const rect = bar.getBoundingClientRect();
                const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                setScrubHover({ ratio, left: e.clientX - rect.left });
              }}
              onMouseLeave={() => setScrubHover(null)}
              onClick={(e) => seekFromClientX(e.clientX)}
            >
              <div
                className="vpc-scrub-fill"
                style={{ width: `${native.duration ? (native.current / native.duration) * 100 : 0}%` }}
              />
              {scrubHover && native.duration > 0 && (
                <span className="vpc-scrub-tip" style={{ left: scrubHover.left }}>
                  {formatMediaTime(scrubHover.ratio * native.duration * 1000)}
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
                <span className="vpc-time">
                  {native.isLive
                    ? t("video.live")
                    : `${formatMediaTime(native.current * 1000)} / ${formatMediaTime((native.duration || 0) * 1000)}`}
                </span>
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
