// A bot-written interactive widget (```widget fence): HTML, CSS and JS run
// in an iframe sandboxed to "allow-scripts" only. No same-origin, so the
// widget has an opaque origin and cannot read the app, its storage or its
// cookies; no forms, popups, top navigation or downloads; and the document
// opens with a CSP that forbids every network request. The only channel back
// is a height number the parent clamps. If the widget navigates its own frame
// away (the one thing a sandbox cannot forbid), the frame is reset.
//
// The widget blends into the bubble: the document carries the shadcn/ui kit
// (src/lib/widget-kit.ts) themed from the active skin, the frame has no
// ground and no header of its own, and the tools (source, restart, full
// screen) are icons that show in the corner on hover or focus. A skin change
// posts the new theme to the frame instead of reloading it.
import { memo, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Code, Maximize2, RotateCcw, X } from "lucide-react";
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  buildWidgetDocument,
  clampWidgetHeight,
  WIDGET_MESSAGE,
  WIDGET_SANDBOX,
} from "@/lib/rich-blocks";
import { readWidgetTheme, WIDGET_THEME_MESSAGE, widgetFontFace, type WidgetTheme } from "@/lib/widget-kit";

const DEFAULT_HEIGHT = 120;
const FONT_FACE = widgetFontFace(geistLatin);

/** The widget theme of the skin `ref` sits in, kept current: a skin change
 * anywhere (data-skin, class or data-theme) is read again. */
export function useWidgetTheme(ref: RefObject<Element | null>): WidgetTheme {
  const [theme, setTheme] = useState<WidgetTheme>(() => readWidgetTheme(typeof document === "undefined" ? null : document.documentElement));
  useEffect(() => {
    const read = () => {
      const next = readWidgetTheme(ref.current);
      setTheme((current) => current.css === next.css ? current : next);
    };
    read();
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { subtree: true, attributeFilter: ["data-skin", "class", "data-theme"] });
    return () => observer.disconnect();
  }, [ref]);
  return theme;
}

/** Hand a frame its theme. The frame has an opaque origin, hence "*"; the
 * message carries only the theme rule. */
export function postWidgetTheme(frame: HTMLIFrameElement | null, theme: WidgetTheme): void {
  frame?.contentWindow?.postMessage({ type: WIDGET_THEME_MESSAGE, css: theme.css }, "*");
}

/** Attributes every widget iframe carries. Exported for the tests. */
export function widgetFrameAttributes(srcDoc: string, title: string) {
  return {
    sandbox: WIDGET_SANDBOX,
    srcDoc,
    title,
    referrerPolicy: "no-referrer" as const,
    allow: "",
    loading: "lazy" as const,
  };
}

function SandboxedFrame({ srcDoc, title, theme, fill = false, onEscaped }: {
  srcDoc: string;
  title: string;
  theme: WidgetTheme;
  fill?: boolean;
  onEscaped: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // a skin change after load: the frame swaps its theme rule in place
  useEffect(() => {
    postWidgetTheme(frame.current, theme);
  }, [theme]);

  useEffect(() => {
    loads.current = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== WIDGET_MESSAGE) return;
      const next = clampWidgetHeight(data.height);
      if (next !== null) setHeight(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc]);

  return (
    <iframe
      ref={frame}
      {...widgetFrameAttributes(srcDoc, title)}
      onLoad={() => {
        // the srcdoc was built with the theme of its first render
        postWidgetTheme(frame.current, themeRef.current);
        loads.current += 1;
        // the first load is our srcdoc; any later one is the widget
        // navigating its frame to somewhere else
        if (loads.current > 1) onEscaped();
      }}
      // the frame's color-scheme must match its document's, or Chromium
      // paints an opaque canvas behind a transparent widget
      style={fill ? { colorScheme: theme.scheme } : { height, colorScheme: theme.scheme }}
      className={fill ? "block size-full border-0 bg-transparent" : "block w-full border-0 bg-transparent"}
    />
  );
}

const TOOL = "flex size-6 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40";

function WidgetFrameComponent({ code, pending = false, imperfect = false }: { code: string; pending?: boolean; imperfect?: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const theme = useWidgetTheme(frameRef);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [escapes, setEscapes] = useState(0);
  // built once per code: a skin change is posted to the frame, not reloaded
  const firstTheme = useRef(theme);
  const srcDoc = useMemo(() => buildWidgetDocument(code, firstTheme.current, FONT_FACE), [code]);
  const title = t("rich.widget.title");
  // a widget that keeps leaving its frame is stopped after the second reset
  const blocked = escapes >= 2;
  const reset = () => {
    setEscapes((value) => value + 1);
    setGeneration((value) => value + 1);
  };
  const sourceLabel = showSource ? t("rich.hideSource") : t("rich.viewSource");

  return (
    <div ref={frameRef} dir="ltr" role="group" aria-label={title} data-widget-frame="" className="group/widget relative my-2 min-w-0">
      <div
        data-widget-tools=""
        className="pointer-events-none absolute end-1.5 -top-3 z-10 flex items-center gap-0.5 rounded-lg border border-hairline/40 bg-panel/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity duration-150 group-hover/widget:pointer-events-auto group-hover/widget:opacity-100 group-focus-within/widget:pointer-events-auto group-focus-within/widget:opacity-100 touch:pointer-events-auto touch:opacity-100"
      >
        <button type="button" className={cn(TOOL, showSource && "bg-raised text-ink")} onClick={() => setShowSource((value) => !value)} aria-pressed={showSource} aria-label={sourceLabel} title={sourceLabel}>
          <Code size={13} aria-hidden="true" />
        </button>
        <button type="button" className={TOOL} onClick={() => { setEscapes(0); setGeneration((value) => value + 1); }} aria-label={t("rich.widget.restart")} title={t("rich.widget.restart")} disabled={pending}>
          <RotateCcw size={13} aria-hidden="true" />
        </button>
        <button type="button" className={TOOL} onClick={() => setFullscreen(true)} aria-label={t("rich.fullscreen")} title={t("rich.fullscreen")} disabled={pending || blocked}>
          <Maximize2 size={13} aria-hidden="true" />
        </button>
      </div>
      {pending ? (
        <p role="status" className="py-3 text-[12px] text-ink-secondary">{t("rich.widget.pending")}</p>
      ) : blocked ? null : (
        <SandboxedFrame key={generation} srcDoc={srcDoc} title={title} theme={theme} onEscaped={reset} />
      )}
      {imperfect && !pending && !blocked && <p data-widget-imperfect="" className="pt-1 text-[11px] text-ink-tertiary">{t("rich.widget.imperfect")}</p>}
      {escapes > 0 && <p role="alert" className="py-1.5 text-[11.5px] text-warning">{blocked ? t("rich.widget.blocked") : t("rich.widget.escaped")}</p>}
      {(showSource || pending) && (
        <pre className="mt-1.5 max-h-80 overflow-auto rounded-xl border border-hairline/40 bg-inset p-3 text-[12.5px] leading-relaxed text-ink">{code}</pre>
      )}
      {fullscreen && <WidgetDialog srcDoc={srcDoc} title={title} theme={theme} onClose={() => setFullscreen(false)} />}
    </div>
  );
}

function WidgetDialog({ srcDoc, title, theme, onClose }: { srcDoc: string; title: string; theme: WidgetTheme; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelId} className="flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-panel shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline/30 px-4 py-2.5">
          <span id={labelId} className="text-[13px] font-medium text-ink">{title}</span>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("attach.close")} className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <X size={17} />
          </button>
        </header>
        <div className="min-h-0 flex-1 p-4">
          <SandboxedFrame key={generation} srcDoc={srcDoc} title={title} theme={theme} fill onEscaped={() => setGeneration((value) => value + 1)} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const WidgetFrame = memo(WidgetFrameComponent);
