// A PDF a bot sends, read in the app: pages drawn by pdf.js (loaded only
// when a PDF opens, its worker bundled with the app, nothing fetched from
// the network), page navigation, zoom (steps, fit width), a text search that
// jumps between pages with matches, Save a copy, and (desktop app) Open in
// the default app. pdf.js data files (CMaps, standard fonts, wasm decoders)
// are served by the app too (pdfjsAssetOptions), so every PDF renders offline. The bytes come through the exact-message file route like every
// other attachment, bounded by fileMaxBytes() and checked for the PDF
// signature before pdf.js sees them.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, ExternalLink, LoaderCircle, MoveHorizontal, Search, ZoomIn, ZoomOut } from "lucide-react";

import { bufferedPreviewMaxBytes as fileMaxBytes, soloAttachmentCeilings } from "@/lib/composer-attachments";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { clampPdfZoom, isPdfBytes, pdfFitWidthScale, pdfjsAssetOptions, pdfSearchPages, pdfZoomStep, readBoundedBytes } from "@/lib/pdf-view";
import { requestMessageFile, saveFailureText, useLocalFileSave, type MessageAttachmentContext } from "./AttachmentPreview";
import { ViewerDialog } from "./ViewerDialog";

type Pdfjs = typeof import("pdfjs-dist");
let pdfjsLoad: Promise<Pdfjs> | null = null;

/** pdf.js and its worker, once per window. The worker file is the package's
 * own build, emitted by Vite as a same-origin asset. */
export function loadPdfjs(): Promise<Pdfjs> {
  pdfjsLoad ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")])
    .then(([pdfjs, worker]) => {
      if (!pdfjs.GlobalWorkerOptions.workerPort) {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(worker.default, { type: "module", name: "pdfjs" });
      }
      return pdfjs;
    })
    .catch((error: unknown) => {
      pdfjsLoad = null;
      throw error;
    });
  return pdfjsLoad;
}

/** The app's root URL (Vite's base), not the current route: a chat page's
 * own URL is /chat/..., and the data files live under the root's assets/. */
function appRoot(): string {
  return new URL(import.meta.env.BASE_URL || "/", document.baseURI).href;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; reason: "size" | "invalid" | "password" | "load" }
  | { kind: "ready"; doc: PDFDocumentProxy; pageSize: { width: number; height: number } };

export interface PdfViewerProps {
  path: string;
  name: string;
  message: MessageAttachmentContext;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

export function PdfViewer({ path, name, message, onClose, returnFocus }: PdfViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ query: string; hits: { page: number; count: number }[]; index: number; busy: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageTexts = useRef<Map<number, string>>(new Map());
  const save = useLocalFileSave(path, name, message);
  const openExternally = useOpenInDefaultApp(path, name, message);

  useEffect(() => {
    const controller = new AbortController();
    let loaded: PDFDocumentProxy | null = null;
    let destroyTask: (() => void) | null = null;
    setState({ kind: "loading" });
    pageTexts.current = new Map();
    void (async () => {
      try {
        const response = await requestMessageFile(path, message, controller.signal);
        const bytes = await readBoundedBytes(response, controller.signal, fileMaxBytes());
        if (!isPdfBytes(bytes)) throw new Error("invalid");
        const pdfjs = await loadPdfjs();
        controller.signal.throwIfAborted();
        // No XFA forms, no scripting: the page pixels and their text only.
        const task = pdfjs.getDocument({ data: bytes, enableXfa: false, stopAtErrors: false, ...pdfjsAssetOptions(pdfjs.version, appRoot()) });
        destroyTask = () => void task.destroy();
        const doc = await task.promise;
        loaded = doc;
        if (controller.signal.aborted) return void doc.loadingTask.destroy();
        const first = await doc.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (controller.signal.aborted) return;
        setState({ kind: "ready", doc, pageSize: { width: viewport.width, height: viewport.height } });
      } catch (error) {
        if (controller.signal.aborted) return;
        const reason = error instanceof Error
          ? error.message === "size" ? "size"
            : error.message === "invalid" || error.name === "InvalidPDFException" ? "invalid"
              : error.name === "PasswordException" ? "password" : "load"
          : "load";
        setState({ kind: "error", reason });
      }
    })();
    return () => {
      controller.abort();
      if (loaded) void loaded.loadingTask.destroy();
      else destroyTask?.();
    };
  }, [path, message.threadId, message.messageId, attempt]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.kind]);

  const doc = state.kind === "ready" ? state.doc : null;
  const pages = doc?.numPages ?? 0;
  const fitScale = state.kind === "ready" ? pdfFitWidthScale(state.pageSize.width, width || 800) : 1;
  const scale = zoom === "fit" ? fitScale : zoom;

  const goTo = useCallback((page: number) => {
    const target = Math.min(Math.max(1, page), pages || 1);
    scroller.current?.querySelector<HTMLElement>(`[data-pdf-page="${target}"]`)?.scrollIntoView({ block: "start" });
    setCurrent(target);
    setPageInput(String(target));
  }, [pages]);

  // The page most in view is the current page.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !pages || typeof IntersectionObserver === "undefined") return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) ratios.set(Number((entry.target as HTMLElement).dataset.pdfPage), entry.intersectionRatio);
      let best = 0, bestRatio = 0;
      for (const [page, ratio] of ratios) if (ratio > bestRatio) { best = page; bestRatio = ratio; }
      if (best) { setCurrent(best); setPageInput(String(best)); }
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    root.querySelectorAll("[data-pdf-page]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pages, scale]);

  const zoomTo = (next: number | "fit") => setZoom(next === "fit" ? "fit" : clampPdfZoom(next));
  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!doc) return;
    const text = query.trim();
    if (!text) return setSearch(null);
    if (search && search.query === text && search.hits.length) {
      const index = (search.index + 1) % search.hits.length;
      setSearch({ ...search, index });
      goTo(search.hits[index]!.page + 1);
      return;
    }
    setSearch({ query: text, hits: [], index: 0, busy: true });
    const texts: string[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      let value = pageTexts.current.get(number);
      if (value === undefined) {
        try {
          const page = await doc.getPage(number);
          const content = await page.getTextContent();
          value = content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
        } catch {
          value = "";
        }
        pageTexts.current.set(number, value);
      }
      texts.push(value);
    }
    const hits = pdfSearchPages(texts, text);
    setSearch({ query: text, hits, index: 0, busy: false });
    if (hits.length) goTo(hits[0]!.page + 1);
  };
  const stepSearch = (direction: 1 | -1) => {
    if (!search?.hits.length) return;
    const index = (search.index + direction + search.hits.length) % search.hits.length;
    setSearch({ ...search, index });
    goTo(search.hits[index]!.page + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomTo(pdfZoomStep(scale, 1)); }
    else if (event.key === "-") { event.preventDefault(); zoomTo(pdfZoomStep(scale, -1)); }
    else if (event.key === "0") { event.preventDefault(); zoomTo("fit"); }
    else if (event.key === "f") { event.preventDefault(); document.getElementById("pdf-viewer-search")?.focus(); }
  };

  const total = search?.hits.reduce((sum, hit) => sum + hit.count, 0) ?? 0;
  const actions = (
    <>
      {doc && (
        <>
          <form onSubmit={(event) => void runSearch(event)} role="search" className="flex items-center gap-1 rounded-md border border-hairline/50 bg-inset/60 px-1.5 focus-within:ring-2 focus-within:ring-accent/50">
            <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <input id="pdf-viewer-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("pdf.search")} aria-label={t("pdf.search")}
              className="w-28 min-w-0 bg-transparent py-1 text-xs text-ink outline-none placeholder:text-ink-tertiary sm:w-40" />
            {search && (
              <span className="shrink-0 text-[11px] tabular-nums text-ink-secondary" role="status">
                {search.busy ? t("pdf.searching") : search.hits.length ? t("pdf.searchHits", { count: total, page: search.hits[search.index]!.page + 1 }) : t("pdf.noMatch")}
              </span>
            )}
            <button type="button" className="table-action" disabled={!search?.hits.length} onClick={() => stepSearch(-1)} aria-label={t("pdf.previousMatch")} title={t("pdf.previousMatch")}><ChevronUp size={14} /></button>
            <button type="button" className="table-action" disabled={!search?.hits.length} onClick={() => stepSearch(1)} aria-label={t("pdf.nextMatch")} title={t("pdf.nextMatch")}><ChevronDown size={14} /></button>
          </form>
          <span className="mx-1 h-5 w-px bg-hairline/60" aria-hidden="true" />
          <button type="button" className="table-action" disabled={current <= 1} onClick={() => goTo(current - 1)} aria-label={t("pdf.previousPage")} title={t("pdf.previousPage")}><ChevronLeft size={15} /></button>
          <form onSubmit={(event) => { event.preventDefault(); goTo(Number(pageInput) || current); }} className="flex items-center gap-1 text-xs text-ink-secondary">
            <input value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label={t("pdf.page")}
              className="w-10 rounded border border-hairline/50 bg-inset/60 px-1 py-0.5 text-center tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
            <span className="tabular-nums">{t("pdf.ofPages", { count: pages })}</span>
          </form>
          <button type="button" className="table-action" disabled={current >= pages} onClick={() => goTo(current + 1)} aria-label={t("pdf.nextPage")} title={t("pdf.nextPage")}><ChevronRight size={15} /></button>
          <span className="mx-1 h-5 w-px bg-hairline/60" aria-hidden="true" />
          <button type="button" className="table-action" onClick={() => zoomTo(pdfZoomStep(scale, -1))} aria-label={t("viewer.zoomOut")} title={t("viewer.zoomOut")}><ZoomOut size={15} /></button>
          <output className="min-w-11 text-center text-xs tabular-nums text-ink-secondary" aria-live="polite">{Math.round(scale * 100)} %</output>
          <button type="button" className="table-action" onClick={() => zoomTo(pdfZoomStep(scale, 1))} aria-label={t("viewer.zoomIn")} title={t("viewer.zoomIn")}><ZoomIn size={15} /></button>
          <button type="button" className="table-action" aria-pressed={zoom === "fit"} onClick={() => zoomTo("fit")} aria-label={t("pdf.fitWidth")} title={t("pdf.fitWidth")}><MoveHorizontal size={15} /></button>
          <span className="mx-1 h-5 w-px bg-hairline/60" aria-hidden="true" />
        </>
      )}
      {openExternally.available && (
        <button type="button" className="table-action gap-1 px-1.5 text-xs" disabled={openExternally.busy} onClick={() => void openExternally.open()}
          aria-label={t("pdf.openDefaultAria", { name })} title={t("pdf.openDefaultHint")}>
          {openExternally.busy ? <LoaderCircle size={15} className="animate-spin" /> : <ExternalLink size={15} />}
          <span className="hidden md:inline">{t("pdf.openDefault")}</span>
        </button>
      )}
      <button type="button" className="table-action gap-1 px-1.5 text-xs" disabled={save.state === "saving"} onClick={() => void save.save()}
        aria-label={t("pdf.saveCopy", { name })} title={save.state === "saved" && save.savedTo ? t("attach.savedTo", { path: save.savedTo }) : t("pdf.saveCopyHint")}>
        {save.state === "saving" ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
        <span className="hidden md:inline">{save.state === "saved" ? t("attach.downloaded") : t("pdf.save")}</span>
      </button>
    </>
  );

  return (
    <ViewerDialog title={name} onClose={onClose} returnFocus={returnFocus} actions={actions} bodyClassName="flex flex-col bg-inset">
      {openExternally.error && <p role="alert" className="shrink-0 border-b border-hairline/40 px-4 py-2 text-xs text-danger">{openExternally.error}</p>}
      {save.state === "failed" && <p role="alert" className="shrink-0 border-b border-hairline/40 px-4 py-2 text-xs text-danger">{saveFailureText(save)}</p>}
      {state.kind === "loading" && (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-secondary"><LoaderCircle size={16} className="animate-spin" />{t("pdf.loading")}</div>
      )}
      {state.kind === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm">
          <p role="alert" className="max-w-md text-ink-secondary">{t(state.reason === "size" ? (soloAttachmentCeilings() ? "pdf.tooLargeSolo" : "pdf.tooLarge") : state.reason === "invalid" ? "pdf.invalid" : state.reason === "password" ? "pdf.password" : "pdf.loadFailed")}</p>
          {state.reason === "load" && <button type="button" className="rounded-lg border border-hairline px-3 py-2 hover:bg-raised" onClick={() => setAttempt(attempt + 1)}>{t("chat.retry")}</button>}
        </div>
      )}
      {state.kind === "ready" && (
        <div ref={scroller} tabIndex={0} onKeyDown={onKeyDown} role="document" aria-label={t("pdf.document", { name })}
          className="min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-none">
          <div className="flex min-w-fit flex-col items-center gap-4 p-4">
            {Array.from({ length: state.doc.numPages }, (_unused, index) => (
              <PdfPage key={index + 1} doc={state.doc} number={index + 1} scale={scale} estimate={state.pageSize} root={scroller.current}
                active={search?.hits[search.index]?.page === index} />
            ))}
          </div>
        </div>
      )}
    </ViewerDialog>
  );
}

/** The desktop app's "Open in default app": fetch the PDF again (pdf.js
 * keeps the bytes it was given) and hand them to main, which writes a new
 * private temp .pdf and opens it (electron/open-pdf.mjs). Absent in a
 * browser and in a window paired to another computer. */
function openPdfBridge(): NonNullable<Window["ogb"]>["openPdf"] {
  const ogb = typeof window === "undefined" ? undefined : window.ogb;
  return ogb?.remoteClient?.active ? undefined : ogb?.openPdf;
}

function useOpenInDefaultApp(path: string, name: string, message: MessageAttachmentContext) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bridge = openPdfBridge();
  const open = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    setError("");
    try {
      const signal = AbortSignal.timeout(60_000);
      const response = await requestMessageFile(path, message, signal);
      const bytes = await readBoundedBytes(response, signal, fileMaxBytes());
      if (!isPdfBytes(bytes)) throw new Error("invalid");
      await bridge(bytes, name);
    } catch (problem) {
      // main's own wording is English; the person reads theirs
      const reason = problem instanceof Error ? problem.message : "";
      setError(t(reason === "size" ? (soloAttachmentCeilings() ? "pdf.tooLargeSolo" : "pdf.tooLarge") : reason === "invalid" ? "pdf.invalid" : "pdf.openDefaultFailed"));
    } finally {
      setBusy(false);
    }
  }, [bridge, path, name, message]);
  return { available: Boolean(bridge), busy, error, open };
}

/** One page: a placeholder of the page's size until it nears the view,
 * then a canvas at the device pixel ratio. Far pages release their pixels. */
function PdfPage({ doc, number, scale, estimate, root, active }: {
  doc: PDFDocumentProxy; number: number; scale: number; estimate: { width: number; height: number }; root: HTMLElement | null; active: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState(estimate);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = holder.current;
    if (!element || typeof IntersectionObserver === "undefined") return setNear(true);
    const observer = new IntersectionObserver(([entry]) => setNear(Boolean(entry?.isIntersecting)), { root, rootMargin: "1200px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) {
      // let the browser free the bitmap of a page far from the view
      if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; }
      return;
    }
    let task: RenderTask | null = null;
    let alive = true;
    setFailed(false);
    void (async () => {
      try {
        const page = await doc.getPage(number);
        if (!alive || !canvas.current) return;
        const viewport = page.getViewport({ scale });
        setSize({ width: viewport.width / scale, height: viewport.height / scale });
        const ratio = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 3);
        const element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        task = page.render({ canvas: element, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await task.promise;
      } catch (error) {
        if (alive && !(error instanceof Error && error.name === "RenderingCancelledException")) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, number, scale, near]);

  const style = useMemo(() => ({ width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) }), [size, scale]);
  return (
    <div ref={holder} data-pdf-page={number} role="img" aria-label={t("pdf.pageLabel", { page: number })}
      className={cn("relative shrink-0 bg-white shadow-md ring-1 ring-black/10", active && "ring-2 ring-accent")} style={style}>
      <canvas ref={canvas} className="block size-full" />
      {failed && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-neutral-500">{t("pdf.pageFailed")}</p>}
    </div>
  );
}

export default PdfViewer;
