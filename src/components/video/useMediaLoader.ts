import { useCallback, useRef, type RefObject, type SyntheticEvent } from "react";

import { isHlsVideo, type WireVideoWidget } from "../../../shared/video-widget.ts";
import { HLS_MANIFEST_LOAD_POLICY, probeExpiry, qualityLevelsOf, type QualityLevel } from "./VideoPlayerParts";
import { isExpiredAt, planHlsError, reloadBackoffMs, RELOAD_MAX_ATTEMPTS } from "./video-player-state";
import { isAppOriginAddress } from "./media-source-guard";

/** How long a natively played HLS stream may take to show its first frame. */
export const NATIVE_HLS_START_MS = 12_000;

/** The hls.js loader class (playlists, segments, keys alike). */
type LoaderClass = new (config: unknown) => {
  load: (context: { url: string }, config: unknown, callbacks: { onError: (error: { code: number; text: string }, context: unknown, networkDetails: unknown, stats: unknown) => void }) => void;
};

/** hls.js's own loader, except that an address of the app's own origin is
 * answered as a refusal (400) without a request: a playlist read straight
 * from its server may name any address for a segment or a key. */
export function guardedLoader(Base: LoaderClass): LoaderClass {
  return class GuardedLoader extends Base {
    load(...args: Parameters<InstanceType<LoaderClass>["load"]>) {
      const [context, , callbacks] = args;
      if (isAppOriginAddress(context.url)) {
        const stats = { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0, loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
        callbacks.onError({ code: 400, text: "refused" }, context, null, stats);
        return;
      }
      super.load(...args);
    }
  };
}

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
  failNow,
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
  /** The source answered for good (a 404): the error, no other source. */
  failNow: () => void;
  expireOrFallBack: () => void;
  setExpired: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setLevels: (v: QualityLevel[]) => void;
}) {
  const hlsRef = useRef<HlsLike | null>(null);
  const attempts = useRef({ network: 0, media: 0 });
  const fragmentLoaded = useRef(false);
  const resumeApplied = useRef(false);

  const loadMedia = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    clearRetry();
    // a retry replaces the previous hls.js instance
    hlsRef.current?.destroy();
    hlsRef.current = null;
    attempts.current = { network: 0, media: 0 };
    fragmentLoaded.current = false;
    resumeApplied.current = false;
    if (isExpiredAt(expiresAt)) {
      markExpired();
      return;
    }
    setExpired(false);
    setLoading(true);
    setError(null);
    let disposed = false;
    let stopWatchdog = () => {};
    // An absolute address of the app's own origin, from a message: never
    // loaded (media-source-guard.ts), so it says it cannot be played.
    if (isAppOriginAddress(src)) {
      setError(null);
      failNow();
      return;
    }
    // Decided from the source before the media proxy hid its extension.
    const isHls = isHlsVideo({ format, playbackUrl: src });
    const nativeHls = Boolean(el.canPlayType("application/vnd.apple.mpegurl"));
    // A playlist read straight from its server (not the proxy, which rewrites
    // every URI) goes through hls.js where it runs, whose loader refuses a
    // segment aimed at the app's own origin; native playback could not.
    const direct = !src.startsWith("/");
    const playNatively = (el: HTMLVideoElement) => {
      el.src = src;
      // Native HLS (Safari, recent Chrome) reports a stream whose segments
      // are missing by never starting, without an error event: a stream
      // that shows no frame in time is checked, then said unplayable.
      if (isHls && !isLive) {
        const started = () => clearTimeout(watchdog);
        const watchdog = setTimeout(() => {
          el.removeEventListener("canplay", started);
          // nothing parsed, or asked to play and still no frame to show
          if (disposed || (el.readyState >= 1 && (el.paused || el.readyState >= 3))) return;
          void probeExpiry(src).then((expired) => {
            if (disposed) return;
            if (expired) expireOrFallBack();
            else failNow();
          });
        }, NATIVE_HLS_START_MS);
        el.addEventListener("canplay", started, { once: true });
        stopWatchdog = () => {
          clearTimeout(watchdog);
          el.removeEventListener("canplay", started);
        };
      }
    };
    if (isHls && (!nativeHls || direct)) {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed || !videoRef.current) return;
        if (!Hls.isSupported()) {
          if (nativeHls) playNatively(videoRef.current);
          else failSource();
          return;
        }
        const Base = (Hls as unknown as { DefaultConfig?: { loader?: LoaderClass } }).DefaultConfig?.loader;
        const instance = new Hls({
          enableWorker: true,
          lowLatencyMode: isLive,
          backBufferLength: isLive ? 300 : 90,
          manifestLoadPolicy: HLS_MANIFEST_LOAD_POLICY,
          ...(Base ? { loader: guardedLoader(Base) as never } : {}),
        });
        hlsRef.current = instance as unknown as HlsLike;
        instance.loadSource(src);
        instance.attachMedia(videoRef.current);
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          setLevels(qualityLevelsOf(instance.levels));
        });
        instance.on(Hls.Events.FRAG_LOADED, () => {
          fragmentLoaded.current = true;
          attempts.current = { network: 0, media: 0 };
        });
        instance.on(Hls.Events.ERROR, (_event: unknown, data: Parameters<typeof planHlsError>[0]) => {
          const plan = planHlsError(data, attempts.current, { fragmentLoaded: fragmentLoaded.current });
          if (plan === "ignore") return;
          if (plan === "expired") {
            if (data.fatal || data.details === "manifestLoadError" || data.details === "levelLoadError") {
              instance.destroy();
              if (hlsRef.current === (instance as unknown as HlsLike)) hlsRef.current = null;
              expireOrFallBack();
            }
            return;
          }
          if (plan === "unplayable") {
            instance.destroy();
            if (hlsRef.current === (instance as unknown as HlsLike)) hlsRef.current = null;
            if (!disposed) failNow();
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
      playNatively(el);
    }
    return () => {
      disposed = true;
      stopWatchdog();
      clearRetry();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [videoRef, src, playbackUrl, format, expiresAt, isLive, clearRetry, scheduleRetry, markExpired, failSource, failNow, expireOrFallBack, setExpired, setLoading, setError, setLevels]);

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
