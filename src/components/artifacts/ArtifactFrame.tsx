// One artifact drawn in a sandboxed iframe, the same sandbox and CSP as a
// chat widget (WidgetFrame.tsx): scripts only, opaque origin, no network,
// no cookies or storage of the app. The document is built once per version
// of the widget; fresh data from the source is posted into the frame, so a
// refresh never reloads it (and never loses what the person scrolled to).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";

import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { clampWidgetHeight, WIDGET_MESSAGE } from "@/lib/rich-blocks";
import { acceptWidgetOpen } from "@/lib/sandboxed-open";
import { widgetFontFace } from "@/lib/widget-kit";
import { buildArtifactDocument } from "@/lib/artifact-document";
import { ARTIFACT_ERROR_MESSAGE, ARTIFACT_START_LIMIT_MS, nextArtifactProblem, type ArtifactProblem } from "@/lib/artifact-frame";
import { postWidgetTheme, useWidgetTheme, widgetFrameAttributes } from "../WidgetFrame";
import { ARTIFACT_DATA_MESSAGE, type Artifact } from "../../../shared/artifacts";

const FONT_FACE = widgetFontFace(geistLatin);
const DEFAULT_HEIGHT = 160;

/** Hand the frame its data. The frame has an opaque origin, hence "*"; the
 * message carries only the source's JSON, which the person's own bot saved. */
export function postArtifactData(frame: HTMLIFrameElement | null, data: Artifact["data"]): void {
  if (!data) return;
  frame?.contentWindow?.postMessage({ type: ARTIFACT_DATA_MESSAGE, data: data.value, at: data.at }, "*");
}

type FullscreenArtifact = Pick<Artifact, "id" | "title" | "html" | "data" | "rev">;

// The full-screen view belongs to the app, not to the frame that asked for it:
// a frame inside a floating window (z-40) used to portal it from inside that
// window, so it sat in the window's lifetime and closed with it. One slot,
// drawn by ArtifactFullscreenHost (always mounted) above every floating window.
let fullscreenArtifact: FullscreenArtifact | null = null;
const fullscreenListeners = new Set<() => void>();
function setFullscreenArtifact(next: FullscreenArtifact | null): void {
  fullscreenArtifact = next;
  for (const listener of fullscreenListeners) listener();
}
function subscribeFullscreen(listener: () => void): () => void {
  fullscreenListeners.add(listener);
  return () => { fullscreenListeners.delete(listener); };
}
const currentFullscreen = () => fullscreenArtifact;

// Own-window hosts ask the OS for full screen on enter (#1495, #2043). The
// flag is set when ArtifactFullscreenHost mounts with windowFullscreen.
let osFullscreenOnEnter = false;

/** Open the full-screen layer. When the host is an artifact's own window,
 * ask the OS for full screen in the same click (user gesture): a request from
 * a later effect is refused, and only the in-window overlay would remain
 * (#2043). Where the system refuses, the layer still fills the window. */
export function enterArtifactFullscreen(artifact: FullscreenArtifact): void {
  if (osFullscreenOnEnter && typeof document !== "undefined" && !document.fullscreenElement) {
    const root = document.documentElement;
    if (typeof root.requestFullscreen === "function") {
      void Promise.resolve(root.requestFullscreen()).catch(() => {});
    }
  }
  setFullscreenArtifact(artifact);
}

/** In an artifact's own window the layer tracks the OS full screen (#1495):
 * leaving it (Escape, the window's own control) closes the layer. The enter
 * request itself is made from the click (enterArtifactFullscreen, #2043). */
function useWindowFullscreen(enabled: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    let entered = Boolean(document.fullscreenElement);
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) close.current();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
        void Promise.resolve(document.exitFullscreen()).catch(() => {});
      }
    };
  }, [enabled]);
}
/** The full-screen layer is a modal dialog: Escape and Tab are handled by useModalDialog. */
function FullscreenLayer({ artifact, onClose, windowFullscreen = false }: { artifact: FullscreenArtifact; onClose: () => void; windowFullscreen?: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  useModalDialog(layer, onClose);
  useWindowFullscreen(windowFullscreen, onClose);
  return (
    <div ref={layer} tabIndex={-1} data-artifact-fullscreen-layer className="fixed inset-0 z-[70] flex flex-col bg-panel outline-none" role="dialog" aria-modal="true" aria-label={artifact.title}>
      <div className="flex justify-end p-2">
        <button type="button" data-artifact-exit-fullscreen onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-ink hover:bg-hover">
          {t("artifact.exitFullscreen")}
        </button>
      </div>
      <ArtifactFrame artifact={artifact} fill bare className="min-h-0 flex-1" />
    </div>
  );
}

/** Mounted once per page that draws artifacts: the app (ArtifactsHost) and an
 * artifact's own window (ArtifactStandaloneWindow, #1495). Draws the
 * full-screen artifact in front of everything, independent of the popup that
 * opened it. `windowFullscreen`: the page is the artifact's own window, so the
 * window itself goes full screen too. */
export function ArtifactFullscreenHost({ windowFullscreen = false }: { windowFullscreen?: boolean } = {}) {
  // Sync so a click in the same tick as mount still sees the flag (#2043).
  osFullscreenOnEnter = windowFullscreen;
  useEffect(() => () => { osFullscreenOnEnter = false; }, [windowFullscreen]);
  const artifact = useSyncExternalStore(subscribeFullscreen, currentFullscreen, currentFullscreen);
  if (!artifact || typeof document === "undefined") return null;
  return createPortal(<FullscreenLayer artifact={artifact} windowFullscreen={windowFullscreen} onClose={() => setFullscreenArtifact(null)} />, document.body);
}
export function ArtifactFrame({ artifact, fill = false, className, bare = false }: {
  artifact: Pick<Artifact, "id" | "title" | "html" | "data" | "rev">;
  /** Take the whole box (a window, a dialog); otherwise grow with the widget. */
  fill?: boolean;
  className?: string;
  /** Inside the full-screen layer: skip the open-slot rev sync (the layer owns it). */
  bare?: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useWidgetTheme(holder);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const dataRef = useRef(artifact.data);
  dataRef.current = artifact.data;
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [generation, setGeneration] = useState(0);
  const [escapes, setEscapes] = useState(0);
  const [problem, setProblem] = useState<ArtifactProblem | null>(null);
  const loads = useRef(0);
  const ready = useRef(false);
  // Built per widget version: a theme change is posted, data is posted.
  const firstTheme = useRef(theme);
  const srcDoc = useMemo(
    () => buildArtifactDocument(artifact.html, firstTheme.current, FONT_FACE, dataRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- data rides postMessage, not a reload
    [artifact.html, artifact.id, generation],
  );

  useEffect(() => { postWidgetTheme(frame.current, theme); }, [theme]);
  useEffect(() => { postArtifactData(frame.current, artifact.data); }, [artifact.data]);
  // A newer version of the artifact open full screen follows this frame.
  useEffect(() => {
    if (!bare && fullscreenArtifact?.id === artifact.id && fullscreenArtifact.rev !== artifact.rev) setFullscreenArtifact(artifact);
  }, [bare, artifact]);

  useEffect(() => {
    loads.current = 0;
    ready.current = false;
    setProblem(null);
    const timer = window.setTimeout(() => {
      if (!ready.current) setProblem((current) => nextArtifactProblem(current, "slow"));
    }, ARTIFACT_START_LIMIT_MS);
    const onMessage = (event: MessageEvent) => {
      const source = frame.current?.contentWindow;
      if (acceptWidgetOpen(event, source)) return;
      if (event.source !== source) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data) return;
      if (data.type === ARTIFACT_ERROR_MESSAGE) {
        ready.current = true;
        setProblem((current) => nextArtifactProblem(current, "script"));
        return;
      }
      if (data.type !== WIDGET_MESSAGE) return;
      const next = clampWidgetHeight(data.height);
      if (next === null) return;
      ready.current = true;
      setProblem((current) => nextArtifactProblem(current, "ready"));
      if (!fill) setHeight(next);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [srcDoc, fill]);

  const blocked = escapes >= 2;
  const notice = problem === "script" ? t("artifact.scriptError") : problem === "slow" ? t("artifact.slowStart") : null;
  return (
    <div ref={holder} dir="ltr" data-artifact-frame={artifact.id} className={cn("relative min-w-0", fill && "size-full", className)}>
      {notice && (
        <p role="alert" data-artifact-problem={problem} className="px-2 py-1.5 text-[12px] text-warning">{notice}</p>
      )}
      {blocked ? (
        <p role="alert" className="py-2 text-[12px] text-warning">{t("rich.widget.blocked")}</p>
      ) : (
        <iframe
          key={generation}
          ref={frame}
          {...widgetFrameAttributes(srcDoc, artifact.title)}
          onLoad={() => {
            postWidgetTheme(frame.current, themeRef.current);
            loads.current += 1;
            // the first load is our document; any later one is the widget
            // sending its frame somewhere else: reset it, then stop it
            if (loads.current > 1) {
              setEscapes((value) => value + 1);
              setGeneration((value) => value + 1);
            }
          }}
          style={fill ? { colorScheme: theme.scheme } : { height, colorScheme: theme.scheme }}
          className={fill ? "block size-full border-0 bg-transparent" : "block w-full border-0 bg-transparent"}
        />
      )}
    </div>
  );
}
