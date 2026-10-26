// One artifact drawn in a sandboxed iframe, the same sandbox and CSP as a
// chat widget (WidgetFrame.tsx): scripts only, opaque origin, no network,
// no cookies or storage of the app. The document is built once per version
// of the widget; fresh data from the source is posted into the frame, so a
// refresh never reloads it (and never loses what the person scrolled to).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";

import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { clampWidgetHeight, WIDGET_MESSAGE } from "@/lib/rich-blocks";
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

/** The full-screen layer is a modal dialog: Escape and Tab are handled by useModalDialog. */
function FullscreenLayer({ artifact, onClose }: { artifact: Pick<Artifact, "id" | "title" | "html" | "data" | "rev">; onClose: () => void }) {
  const layer = useRef<HTMLDivElement>(null);
  useModalDialog(layer, onClose);
  return (
    <div ref={layer} tabIndex={-1} className="fixed inset-0 z-50 flex flex-col bg-panel outline-none" role="dialog" aria-modal="true" aria-label={artifact.title}>
      <div className="flex justify-end p-2">
        <button type="button" data-artifact-exit-fullscreen onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-ink hover:bg-hover">
          {t("artifact.exitFullscreen")}
        </button>
      </div>
      <ArtifactFrame artifact={artifact} fill bare className="min-h-0 flex-1" />
    </div>
  );
}

export function ArtifactFrame({ artifact, fill = false, className, bare = false }: {
  artifact: Pick<Artifact, "id" | "title" | "html" | "data" | "rev">;
  /** Take the whole box (a window, a dialog); otherwise grow with the widget. */
  fill?: boolean;
  className?: string;
  /** Inside the full-screen layer: no second full-screen button. */
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
  const [full, setFull] = useState(false);
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

  useEffect(() => {
    loads.current = 0;
    ready.current = false;
    setProblem(null);
    const timer = window.setTimeout(() => {
      if (!ready.current) setProblem((current) => nextArtifactProblem(current, "slow"));
    }, ARTIFACT_START_LIMIT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
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
      {!bare && !blocked && (
        <button
          type="button"
          data-artifact-fullscreen
          onClick={() => setFull(true)}
          className="absolute end-1 top-1 z-10 rounded-md bg-panel/90 px-2 py-0.5 text-[11px] text-ink-secondary hover:text-ink"
        >
          {t("artifact.fullscreen")}
        </button>
      )}
      {full && typeof document !== "undefined" && createPortal(
        <FullscreenLayer artifact={artifact} onClose={() => setFull(false)} />,
        document.body,
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
