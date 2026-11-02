import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { api, ApiError } from "@/state/store";
import { usePageVisible } from "@/lib/page-visible";
import { listenLiveFrames } from "@/lib/live-events";
import { isRemoteScreenshotContention } from "@/lib/remote-desktop";
import { readableError } from "@/lib/plain-error";
import { LocalizedPanelError } from "./errors";
import type { ComputerPending, Phase } from "./types";

/** Screenshot and live-frame polling for the computer panel preview. Frame
 * state stays in the panel so phase resolve can clear it on reconnect. */
export function useComputerPreview(args: {
  botId: string;
  botThreadId: string;
  botBusy: boolean | undefined;
  botComputer: string | undefined;
  phase: Phase;
  cloudPreviewReady: boolean;
  computerStatusCurrent: boolean;
  cloudBackend: string;
  viewerOpen: boolean;
  pending: ComputerPending;
  controlPending: boolean;
  previewRetry: number;
  isLinux: boolean;
  vmViewerUrl: string | null;
  polledFrame: { png: string; mime: string } | null;
  vmFrame: string | null;
  localFrame: string | null;
  threadPath: (suffix: string) => string;
  setPolledFrame: Dispatch<SetStateAction<{ png: string; mime: string } | null>>;
  setPreviewError: Dispatch<SetStateAction<Error | string | null>>;
  setPreviewRefreshing: Dispatch<SetStateAction<boolean>>;
  setVmFrame: Dispatch<SetStateAction<string | null>>;
  setLocalFrame: Dispatch<SetStateAction<string | null>>;
  setLocalMisses: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<Error | string | null>>;
}) {
  const {
    botId, botThreadId, botBusy, botComputer, phase, cloudPreviewReady, computerStatusCurrent,
    cloudBackend, viewerOpen, pending, controlPending, previewRetry, isLinux, vmViewerUrl,
    polledFrame, vmFrame, localFrame, threadPath,
    setPolledFrame, setPreviewError, setPreviewRefreshing, setVmFrame, setLocalFrame,
    setLocalMisses, setError,
  } = args;

  // Live frames of this conversation's screen come straight from the app's
  // stream, never through the store. Only a frame heard while this preview is
  // up may replace it, and the poll below waits while they keep coming.
  const pageVisible = usePageVisible();
  const lastLiveAt = useRef(0);
  const previewBusy = useRef(botBusy);
  useEffect(() => { previewBusy.current = botBusy; }, [botBusy]);
  useEffect(() => {
    lastLiveAt.current = 0;
    if (!cloudPreviewReady) return;
    return listenLiveFrames({
      onFrame: (frame) => {
        if (frame.kind !== "screen" || frame.botId !== botId || frame.threadId !== botThreadId) return;
        lastLiveAt.current = Date.now();
        setPolledFrame({ png: frame.png, mime: frame.mime ?? "image/png" });
        setPreviewError(null);
        setPreviewRefreshing(false);
      },
    });
  }, [cloudPreviewReady, botId, botThreadId, setPolledFrame, setPreviewError, setPreviewRefreshing]);

  useEffect(() => {
    if (!cloudPreviewReady || viewerOpen || !pageVisible || pending || controlPending) return;
    let inFlight = false;
    let lastAttemptAt = -Infinity;
    let retryDelay: number | null = null;
    let contentionSince: number | null = null;
    const controller = new AbortController();
    setPreviewError(null);
    setPreviewRefreshing(true);
    const shoot = async () => {
      if (inFlight || controller.signal.aborted) return;
      if (Date.now() - lastAttemptAt < (retryDelay ?? (previewBusy.current ? 4000 : 30_000))) return;
      // Resume polling if a busy bot stops publishing frames. A single old
      // SSE event is not evidence of a working stream for the whole turn.
      if (previewBusy.current && Date.now() - lastLiveAt.current < 10_000) return;
      inFlight = true;
      retryDelay = null;
      const startedAt = Date.now();
      try {
        const { png, format } = await api(threadPath("computer/screenshot"), {
          method: "POST",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
        });
        if (!controller.signal.aborted && lastLiveAt.current <= startedAt) {
          if (typeof png !== "string" || !png.trim()) throw new LocalizedPanelError("computer.err.emptyFrame");
          setPolledFrame({ png, mime: format === "jpeg" ? "image/jpeg" : "image/png" });
          setPreviewError(null);
          setPreviewRefreshing(false);
          contentionSince = null;
        }
      } catch (e) {
        if (!controller.signal.aborted && lastLiveAt.current <= startedAt) {
          // A canceled client request can leave its capture running on the
          // host. Contention is temporary, not a disconnected computer.
          if (e instanceof ApiError && isRemoteScreenshotContention(e)) {
            retryDelay = 1000;
            contentionSince ??= Date.now();
            const prolonged = Date.now() - contentionSince >= 10_000;
            setPreviewError(prolonged ? e : null);
            setPreviewRefreshing(!prolonged);
          } else {
            contentionSince = null;
            setPreviewRefreshing(false);
            setPreviewError(e instanceof Error && e.name === "TimeoutError"
              ? new LocalizedPanelError("computer.err.frameTimeout")
              : e instanceof Error ? e : new LocalizedPanelError("computer.err.screenUnavailable"));
          }
        }
      } finally {
        inFlight = false;
        lastAttemptAt = Date.now();
      }
    };
    void shoot();
    // Read the current cadence without aborting a capture on every busy
    // transition. Only connection/action changes replace its generation.
    const timer = setInterval(shoot, 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [cloudPreviewReady, threadPath, cloudBackend, viewerOpen, pageVisible, pending, controlPending, previewRetry, setPolledFrame, setPreviewError, setPreviewRefreshing]);

  // Local VM preview comes directly from Cua Driver through the harness. It
  // does not use the password-protected noVNC viewer or cloud endpoints.
  useEffect(() => {
    if (phase !== "vm" || !computerStatusCurrent || viewerOpen || !pageVisible) return;
    const controller = new AbortController();
    let inFlight = false;
    let lastAttemptAt = -Infinity;
    let retryDelay: number | null = null;
    let initialAttempt = true;
    const shoot = async () => {
      if (inFlight || controller.signal.aborted) return;
      if (Date.now() - lastAttemptAt < (retryDelay ?? (botBusy ? 3000 : 30_000))) return;
      inFlight = true;
      retryDelay = null;
      try {
        const { image } = await api(threadPath("local-computer/screenshot"), { method: "POST", signal: controller.signal });
        if (!controller.signal.aborted && typeof image === "string") {
          setVmFrame(image);
          setPreviewError(null);
        }
      } catch (e) {
        // The first miss leaves the pane with nothing to show, so it stays a
        // panel error. Later transient misses are the preview's own retry
        // business — they keep the last frame, back off, and never rewrite
        // the panel banner every tick.
        if (!controller.signal.aborted) {
          retryDelay = 5000;
          if (initialAttempt) setError(readableError(e));
          else setPreviewError(e instanceof Error ? e : new LocalizedPanelError("computer.err.screenUnavailable"));
        }
      } finally {
        inFlight = false;
        initialAttempt = false;
        lastAttemptAt = Date.now();
      }
    };
    void shoot();
    const timer = window.setInterval(() => void shoot(), botBusy ? 3000 : 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [phase, computerStatusCurrent, threadPath, viewerOpen, pageVisible, botBusy, setError, setPreviewError, setVmFrame]);

  // local preview: frames from the Electron main process. The FIRST capture
  // attempt is what makes macOS show the Screen Recording prompt (there is
  // no reliable pre-grant flow on macOS 15+), so repeated empty frames mean
  // the user denied — surface the Settings repair path instead of spinning.
  useEffect(() => {
    if (phase !== "local" || !computerStatusCurrent || !window.ogb || isLinux || !pageVisible) return;
    let alive = true;
    setLocalMisses(0);
    const shoot = async () => {
      try {
        const url = await window.ogb!.screenFrame();
        if (alive && url) setLocalFrame(url);
        else if (alive) setLocalMisses((n) => n + 1);
      } catch {
        if (alive) setLocalMisses((n) => n + 1);
      }
    };
    void shoot();
    // A real ScreenCaptureKit capture + PNG encode per tick: idle bots get a
    // slow heartbeat, working ones the live cadence.
    const timer = setInterval(shoot, botBusy ? 3000 : 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, computerStatusCurrent, isLinux, pageVisible, botBusy, botId, botThreadId, setLocalFrame, setLocalMisses]);

  const frameSrc = !computerStatusCurrent ? null :
    phase === "vm"
      ? vmFrame
      : phase === "local" && !isLinux
      ? localFrame
      : cloudPreviewReady || (botComputer === "cloud" && phase === "starting")
        ? polledFrame && `data:${polledFrame.mime};base64,${polledFrame.png}`
        : null;
  const previewOpensDesktop = Boolean(
    frameSrc &&
      ((phase === "vm" && vmViewerUrl) || cloudPreviewReady),
  );

  return { lastLiveAt, frameSrc, previewOpensDesktop, pageVisible };
}
