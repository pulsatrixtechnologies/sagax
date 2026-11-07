import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WireVideoWidget } from "../../../shared/video-widget.ts";
import { t } from "@/lib/i18n";
import { formatMediaTime, MediaPlayerChrome, type MediaChromeActions, type MediaLiveWindow } from "./MediaPlayerChrome";
import { ExpiredLinkPanel, runStageKey, VideoExtraControls, type QualityLevel } from "./VideoPlayerParts";
import { useMediaLoader, useRetryTimer } from "./useMediaLoader";
import { useSourceFallback } from "./useSourceFallback";
import { useVideoClocks } from "./useVideoClocks";
import { useVideoStage } from "./useVideoStage";
import {
  clampLiveSeek,
  hasDvr,
  isBehindLive,
  isExpiredAt,
  liveLatency,
  liveWindowOf,
  loadResumePosition,
  resumeKey,
  saveResumePosition,
  SEEK_STEP_SECONDS,
  uptimeMs,
} from "./video-player-state";

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
  const actionsRef = useRef<MediaChromeActions | null>(null);
  const lastSaved = useRef(0);

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
  const { expanded, zoom, pan, setZoomTo, setExpand, pointerProps } = useVideoStage({
    shellRef,
    cardRef,
    showcase,
    initialExpanded: showcaseState?.expanded,
  });

  const isLive = video.kind === "live";
  const title = video.title ?? video.streamer ?? t("video.untitled");
  const key = useMemo(() => resumeKey(video), [video]);

  const { clearRetry, scheduleRetry } = useRetryTimer();

  const markExpired = useCallback(() => {
    clearRetry();
    setExpired(true);
    setError(null);
    setLoading(false);
  }, [clearRetry]);

  const showError = useCallback(() => {
    setError(t("video.playbackError"));
    setLoading(false);
  }, []);
  const { src, directUrl, failSource, expireOrFallBack, resetSource } = useSourceFallback({
    playbackUrl: video.playbackUrl,
    directUrl: video.directUrl,
    onFail: showError,
    onExpired: markExpired,
  });

  const { hlsRef, resumeApplied, loadMedia, onNativeError } = useMediaLoader({
    videoRef,
    src,
    playbackUrl: video.playbackUrl,
    format: video.format,
    expiresAt: video.expiresAt,
    isLive,
    clearRetry,
    scheduleRetry,
    markExpired,
    failSource,
    expireOrFallBack,
    setExpired,
    setLoading,
    setError,
    setLevels,
  });

  /** Retry button: start over from the proxied source. */
  const retry = useCallback(() => {
    if (!resetSource()) loadMedia();
  }, [resetSource, loadMedia]);

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

  const now = useVideoClocks({ videoRef, isLive, startedAt: video.startedAt, expiresAt: video.expiresAt, expired, showcase, markExpired });

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
  }, [hlsRef]);

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

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    runStageKey(e, {
      el: videoRef.current,
      actions: actionsRef.current,
      isLive,
      expanded,
      zoom,
      menuOpen,
      togglePlay,
      seekTo,
      goLive,
      setExpand,
      setZoomTo,
      closeMenu: () => setMenuOpen(false),
    });
  }, [togglePlay, seekTo, setExpand, expanded, isLive, goLive, setZoomTo, zoom, menuOpen]);

  const stageProps: React.HTMLAttributes<HTMLDivElement> = { tabIndex: 0, onKeyDown, ...pointerProps };

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
    <ExpiredLinkPanel canRequest={Boolean(onRequestRefresh)} refreshAsked={refreshAsked} onRequest={requestRefresh} onRetry={retry} />
  ) : undefined;

  const extraControls = (
    <VideoExtraControls
      menuOpen={menuOpen}
      setMenuOpen={setMenuOpen}
      levels={showcase ? [{ index: 1, label: "1080p" }, { index: 0, label: "720p" }] : levels}
      level={level}
      onPickLevel={(index) => {
        setLevel(index);
        if (hlsRef.current) hlsRef.current.currentLevel = index;
        setMenuOpen(false);
      }}
      zoom={zoom}
      setZoomTo={setZoomTo}
      expanded={expanded}
      setExpand={setExpand}
    />
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
      onRetry={retry}
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
        // The pop-out and the error's link open the original URL when the
        // card plays through the proxy.
        playbackUrl: directUrl ?? video.playbackUrl,
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
            onError={onNativeError}
          />
        )}
      </div>
    </MediaPlayerChrome>
  );
});
