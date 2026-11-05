// Fit a detached page window to its content (#2051). Size math plus the
// renderer observe loop: the page frame posts sagax-page-size; this module
// turns that into an outer window size and asks the desktop bridge to apply it.

import { PAGE_SIZE_ASK, parseSizeMessage } from "../../shared/published-pages";

export const PAGE_WINDOW_FIT_MIN = Object.freeze({ width: 320, height: 240 });
/** First-open width when the person has not sized this page yet. */
export const PAGE_WINDOW_FIT_DEFAULT_WIDTH = 720;

export type PageWindowSize = { width: number; height: number };
export type WorkArea = { x: number; y: number; width: number; height: number };
export type PageWindowFitBridge = {
  fitContent(size: PageWindowSize): Promise<unknown> | unknown;
};

/** Outer BrowserWindow size from the page content height (and optional width). */
export function pageWindowOuterSize(input: {
  contentHeight: number;
  width?: number;
  chromeHeight?: number;
}): PageWindowSize {
  const chrome = Number.isFinite(input.chromeHeight) ? Math.max(0, Math.round(input.chromeHeight!)) : 0;
  const height = Math.max(1, Math.round(input.contentHeight) + chrome);
  const width = Number.isFinite(input.width) && (input.width as number) > 0
    ? Math.round(input.width as number)
    : PAGE_WINDOW_FIT_DEFAULT_WIDTH;
  return { width, height };
}

/** Keep a proposed size inside the fit minimum and the display work area. */
export function clampPageWindowSize(size: PageWindowSize, workArea: WorkArea): PageWindowSize {
  const maxW = Math.max(PAGE_WINDOW_FIT_MIN.width, Math.round(workArea.width));
  const maxH = Math.max(PAGE_WINDOW_FIT_MIN.height, Math.round(workArea.height));
  return {
    width: Math.min(maxW, Math.max(PAGE_WINDOW_FIT_MIN.width, Math.round(size.width))),
    height: Math.min(maxH, Math.max(PAGE_WINDOW_FIT_MIN.height, Math.round(size.height))),
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Apply a fitted size at the current top-left, pulled back into the work area. */
export function fitPageWindowBounds(
  current: { x: number; y: number; width: number; height: number },
  size: PageWindowSize,
  workArea: WorkArea,
): { x: number; y: number; width: number; height: number } {
  const next = clampPageWindowSize(size, workArea);
  return {
    x: clamp(Math.round(current.x), workArea.x, workArea.x + workArea.width - next.width),
    y: clamp(Math.round(current.y), workArea.y, workArea.y + workArea.height - next.height),
    width: next.width,
    height: next.height,
  };
}

/** The desktop bridge for this page window, or null in a browser tab. */
export function readPageWindowFitBridge(
  win: { artifactWindowSelf?: PageWindowFitBridge } | null | undefined = typeof window === "undefined" ? undefined : window,
): PageWindowFitBridge | null {
  const bridge = win?.artifactWindowSelf;
  return bridge && typeof bridge.fitContent === "function" ? bridge : null;
}

/** Content height from a page frame size message, or null. */
export function contentHeightFromSizeMessage(data: unknown): number | null {
  const size = parseSizeMessage(data);
  return size ? size.h : null;
}

/** Wait for document fonts (and a paint) so the first measure is stable. */
export async function settlePageWindowFonts(
  fonts: { ready?: Promise<unknown> } | null | undefined = typeof document === "undefined" ? undefined : document.fonts,
): Promise<void> {
  try {
    await fonts?.ready;
  } catch {
    // fonts API missing or failed: measure with what is loaded
  }
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });
}

/**
 * Observe the page root and its preview frame; report outer sizes to the
 * desktop bridge until stopped. Sets the frame's height from sagax-page-size
 * so the root can shrink-wrap the content.
 */
export function startPageWindowFit(options: {
  root: HTMLElement;
  getFrame: () => HTMLIFrameElement | null;
  bridge: PageWindowFitBridge;
  width?: number;
  onContentHeight?: (height: number) => void;
}): () => void {
  const { root, getFrame, bridge, onContentHeight } = options;
  const width = options.width && options.width > 0 ? Math.round(options.width) : PAGE_WINDOW_FIT_DEFAULT_WIDTH;
  let contentHeight: number | null = null;
  let stopped = false;
  let reportTimer: ReturnType<typeof setTimeout> | null = null;

  const report = () => {
    if (stopped || contentHeight == null) return;
    const size = pageWindowOuterSize({ contentHeight, width });
    void Promise.resolve(bridge.fitContent(size)).catch(() => {});
  };
  const reportSoon = () => {
    if (reportTimer) clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      reportTimer = null;
      report();
    }, 50);
  };

  const applyHeight = (height: number) => {
    if (contentHeight === height) {
      reportSoon();
      return;
    }
    contentHeight = height;
    onContentHeight?.(height);
    const frame = getFrame();
    if (frame) {
      frame.style.height = `${height}px`;
      frame.style.flex = "none";
    }
    report();
  };

  const onMessage = (event: MessageEvent) => {
    const frame = getFrame();
    if (!frame || event.source !== frame.contentWindow) return;
    const height = contentHeightFromSizeMessage(event.data);
    if (height != null) applyHeight(height);
  };
  window.addEventListener("message", onMessage);

  const ask = () => {
    const frame = getFrame();
    try {
      frame?.contentWindow?.postMessage({ type: PAGE_SIZE_ASK, v: 1 }, "*");
    } catch {
      // frame not ready
    }
  };
  ask();
  const frame = getFrame();
  frame?.addEventListener("load", ask);

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => {
      if (contentHeight == null) return;
      reportSoon();
    });
    observer.observe(root);
  }

  void settlePageWindowFonts().then(() => {
    if (!stopped) {
      ask();
      reportSoon();
    }
  });

  return () => {
    stopped = true;
    if (reportTimer) clearTimeout(reportTimer);
    window.removeEventListener("message", onMessage);
    frame?.removeEventListener("load", ask);
    observer?.disconnect();
  };
}
