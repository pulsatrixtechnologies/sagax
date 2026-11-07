import { useCallback, useRef, type RefObject, type SyntheticEvent } from "react";

import { isHlsVideo, type WireVideoWidget } from "../../../shared/video-widget.ts";
import { HLS_MANIFEST_LOAD_POLICY, probeExpiry, qualityLevelsOf, type QualityLevel } from "./VideoPlayerParts";
import { isExpiredAt, planHlsError, reloadBackoffMs, RELOAD_MAX_ATTEMPTS } from "./video-player-state";

export type HlsLike = {
  levels: { height?: number; bitrate?: number }[];
  currentLevel: number;
  liveSyncPosition?: number | null;
  startLoad: () => void;
  recoverMediaError: () => void;
  destroy: () => void;
};

/** One pending reload at a time: a new schedule replaces the previous one. */
export function useRetryTimer() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRetry = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const scheduleRetry = useCallback((run: () => void, ms: number) => {
    clearRetry();
    timer.current = setTimeout(run, ms);
  }, [clearRetry]);
  return { clearRetry, scheduleRetry };
}

/**
 * Attaches the source to the <video>: hls.js when the browser has no native
 * HLS, the plain src otherwise. Owns the hls.js instance, the reload budget
 * and the native element's error recovery (#484, #2505).
 */
export function useMediaLoader({
  videoRef,
  src,
  playbackUrl,
  format,
  expiresAt,
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
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  /** Reloads when the bot sends a new link, even if the played src is unchanged. */
  playbackUrl: string;
  format: WireVideoWidget["format"];
  expiresAt: WireVideoWidget["expiresAt"];
  isLive: boolean;
  clearRetry: () => void;
  scheduleRetry: (run: () => void, ms: number) => void;
  markExpired: () => void;
  failSource: () => void;
  expireOrFallBack: () => void;
  setExpired: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setLevels: (v: QualityLevel[]) => void;
}) {
  const hlsRef = useRef<HlsLike | null>(null);
  const attempts = useRef({ network: 0, media: 0 });
  const resumeApplied = useRef(false);

  const loadMedia = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    clearRetry();
    // a retry replaces the previous hls.js instance
    hlsRef.current?.destroy();
    hlsRef.current = null;
    attempts.current = { network: 0, media: 0 };
    resumeApplied.current = false;
    if (isExpiredAt(expiresAt)) {
      markExpired();
      return;
    }
    setExpired(false);
    setLoading(true);
    setError(null);
    let disposed = false;
    // Decided from the source before the media proxy hid its extension.
    const isHls = isHlsVideo({ format, playbackUrl: src });
    if (isHls && !el.canPlayType("application/vnd.apple.mpegurl")) {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed || !videoRef.current) return;
        if (!Hls.isSupported()) {
          failSource();
          return;
        }
        const instance = new Hls({
          enableWorker: true,
          lowLatencyMode: isLive,
          backBufferLength: isLive ? 300 : 90,
          manifestLoadPolicy: HLS_MANIFEST_LOAD_POLICY,
        });
        hlsRef.current = instance as unknown as HlsLike;
        instance.loadSource(src);
        instance.attachMedia(videoRef.current);
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          setLevels(qualityLevelsOf(instance.levels));
        });
        instance.on(Hls.Events.FRAG_LOADED, () => {
          attempts.current = { network: 0, media: 0 };
        });
        instance.on(Hls.Events.ERROR, (_event: unknown, data: Parameters<typeof planHlsError>[0]) => {
          const plan = planHlsError(data, attempts.current);
          if (plan === "ignore") return;
          if (plan === "expired") {
            if (data.fatal || data.details === "manifestLoadError" || data.details === "levelLoadError") {
              instance.destroy();
              if (hlsRef.current === (instance as unknown as HlsLike)) hlsRef.current = null;
              expireOrFallBack();
            }
            return;
          }
          if (plan === "reload") {
            const n = attempts.current.network++;
            setLoading(true);
            scheduleRetry(() => instance.startLoad(), reloadBackoffMs(n));
            return;
          }
          if (plan === "recover-media") {
            attempts.current.media++;
            instance.recoverMediaError();
            return;
          }
          instance.destroy();
          if (hlsRef.current === (instance as unknown as HlsLike)) hlsRef.current = null;
          if (!disposed) failSource();
        });
      }).catch(() => {
        if (!disposed) failSource();
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
  }, [videoRef, src, playbackUrl, format, expiresAt, isLive, clearRetry, scheduleRetry, markExpired, failSource, expireOrFallBack, setExpired, setLoading, setError, setLevels]);

  /** Native <video> error (direct play or Safari HLS): probe expiry, then reload with backoff. */
  const onNativeError = useCallback((e: SyntheticEvent<HTMLVideoElement>) => {
    if (hlsRef.current) return; // hls.js reports its own errors
    const el = e.currentTarget;
    setLoading(true);
    void probeExpiry(src).then((isExpired) => {
      if (isExpired) {
        expireOrFallBack();
        return;
      }
      const n = attempts.current.network;
      if (n < RELOAD_MAX_ATTEMPTS) {
        attempts.current.network = n + 1;
        scheduleRetry(() => {
          el.src = src;
          el.load();
        }, reloadBackoffMs(n));
        return;
      }
      failSource();
    });
  }, [src, setLoading, expireOrFallBack, scheduleRetry, failSource]);

  return { hlsRef, resumeApplied, loadMedia, onNativeError };
}
