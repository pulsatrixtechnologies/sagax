// A published page, open (2026-10-28, the reference design's page view):
// over its conversation as a full panel (ChatView), or in a system window of
// its own (ArtifactStandaloneWindow). Where it opens is decided in one place,
// openPage (src/lib/open-page.ts), for the card, the Library, Settings and
// « Open in a window ». Never a window drawn inside Sagax. One surface for
// both, and one frame (PageFrame, also the card's thumbnail), so they show
// the same page and offer the same actions:
//   - top left, a round × that closes it (back to the conversation, at the
//     same place: the conversation stays mounted under the panel);
//   - top centre, the title pill: a click turns it into a field (pencil),
//     Enter renames, Escape cancels;
//   - top right, « ⋯ » (versions, annotate, present, edit, comments,
//     decline a proposed version) and Share;
//   - the page itself, whole and interactive, in the app's theme.
// Earlier lots (Grok Bot parity R8, chat rows 31 to 34) are all still here:
// rename, versions, the person's own edit, comments, the annotation mode
// that sends numbered notes to the bot, and Present. Sharing is the Share
// popover (src/components/PageShare.tsx), the one place for it.
//
// The page is always the server's preview wrapper and its sandboxed frame
// (shared/published-pages.ts): never a srcdoc. Inside the app the wrapper
// draws no banner (the app's own frame names the page) and keeps the page's
// place: its frame reports how far down it is (a number, only from that very
// frame), and a redraw (the bot's new version) starts there again. In
// annotation mode the frame runs the server's annotation script, which only
// posts to this window; a message counts only when it comes from that very
// frame, and its fields are plain text (parseAnnotationMessage). Nothing
// reaches a bot until the person presses Send.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { BarChart3, Check, Ellipsis, Highlighter, History, Loader2, MessageSquare, Pencil, Play, Save, Send, Share, Trash2, X, XCircle } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { pagePlace, rememberPagePlace } from "@/lib/open-page";
import { acceptPageOpen } from "@/lib/sandboxed-open";
import { api, useStore } from "@/state/store";
import {
  annotationPrompt,
  PAGE_KINDS,
  PAGE_LIMITS,
  parseAnnotationMessage,
  parseScrollMessage,
  type PageAnchor,
  type PageComment,
  type PageKind,
  type PublishedPageSummary,
  type ReaderComment,
} from "../../shared/published-pages";
import { ACCESS_LABEL, needsLinkConfirm, pageErrorText, pageGone, previewSrc, usePagesPolicy, when } from "./page-controls";
import { PageSharePopover } from "./PageShare";
import { SwitchRow } from "./SettingsPrimitives";
import { useWidgetTheme } from "./WidgetFrame";
import { encodeSkinTokens } from "@/lib/page-theme";
import { MenuItem, PopoverMenu } from "./bot-settings/FilesSection";

export { needsLinkConfirm, pageErrorText };

/** The viewer keeps at most this many annotations (and sends no more). */
export const MAX_ANNOTATIONS = PAGE_LIMITS.annotations;

export interface Annotation {
  n: number;
  anchor: PageAnchor;
  note: string;
}

/** A message from the preview: kept only when it comes from the frame inside
 * this viewer's wrapper and parses; the same number twice is one. Pure. */
export function acceptAnnotation(list: Annotation[], event: { source: unknown; data: unknown }, frame: Window | null): Annotation[] {
  if (!frame || event.source !== frame) return list;
  const parsed = parseAnnotationMessage(event.data);
  if (!parsed || list.length >= MAX_ANNOTATIONS || list.some((entry) => entry.n === parsed.n)) return list;
  const { n, ...anchor } = parsed;
  return [...list, { n, anchor, note: "" }];
}

/** A scroll report from the preview: kept only when it comes from the frame
 * inside this viewer's wrapper. Pure. */
export function acceptScroll(event: { source: unknown; data: unknown }, frame: Window | null): number | null {
  if (!frame || event.source !== frame) return null;
  return parseScrollMessage(event.data);
}

/** Publish a version the person just saved with the page's own access, and
 * its expiry while still ahead. Pure. */
export function republishBody(page: Pick<PublishedPageSummary, "access" | "expiresAt">, version: number, now = Date.now()) {
  return { version, access: page.access, expiresAt: page.expiresAt !== null && page.expiresAt > now ? page.expiresAt : null };
}

/** The version a page opens on: the one asked for, else the newest the bot
 * or the person made (the page as it is now), else none. Pure. */
export function pageVersionToShow(page: Pick<PublishedPageSummary, "versions" | "currentVersion"> | null, asked?: number | null): number | null {
  if (!page) return asked ?? null;
  if (asked && page.versions.some((entry) => entry.n === asked)) return asked;
  return page.versions.at(-1)?.n ?? page.currentVersion ?? null;
}

/** A newer version than the one on screen, when the conversation names one
 * (the bot changed the open page): the page is drawn again with it. Pure. */
export function newerVersion(shown: number | null, latest: number | undefined): number | null {
  return latest !== undefined && (shown === null || latest > shown) ? latest : null;
}

/** The title a rename sends: one line, trimmed; null for nothing to send
 * (empty, or the same title). Pure. */
export function renameTitle(draft: string, current: string): string | null {
  const title = draft.replace(/\s+/g, " ").trim().slice(0, PAGE_LIMITS.title);
  return title && title !== current ? title : null;
}

const KIND_LABEL: Record<PageKind, "pages.kind.html" | "pages.kind.markdown" | "pages.kind.presentation"> = {
  html: "pages.kind.html",
  markdown: "pages.kind.markdown",
  presentation: "pages.kind.presentation",
};

type Panel = "edit" | "comments" | "annotate" | "versions" | null;

const BUTTON = "inline-flex items-center gap-1.5 rounded-lg border border-hairline/60 px-2.5 py-1 text-[12.5px] text-ink hover:bg-raised disabled:opacity-40";
const PRIMARY = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40";
const ROUND = "flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline/50 bg-raised text-ink shadow-sm hover:bg-raised-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const PILL = "inline-flex h-9 items-center gap-1.5 rounded-full border border-hairline/50 bg-raised px-3.5 text-[13px] font-medium text-ink shadow-sm hover:bg-raised-hover disabled:opacity-40";

const errorText = pageErrorText;

/** The page's icon: a small coloured chart, the same on the card, the
 * panel's title pill, the Library and a message about the page. */
export function PageGlyph({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden="true" data-page-glyph
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[6px] bg-gradient-to-br from-sky-500 to-indigo-500 text-white", className)}
      style={{ width: size, height: size }}>
      <BarChart3 size={Math.round(size * 0.62)} strokeWidth={2.4} />
    </span>
  );
}

/** The title pill: a click turns it into a field; Enter saves, Escape or
 * leaving it without a change cancels. */
export function PageTitlePill({ title, busy, onRename }: { title: string; busy?: boolean; onRename(title: string): Promise<boolean> | boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = async () => {
    const next = draft === null ? null : renameTitle(draft, title);
    if (next === null) return setDraft(null);
    if (await onRename(next)) setDraft(null);
  };
  if (draft === null) {
    return (
      <button type="button" data-page-title aria-label={t("pages.rename")} title={t("pages.rename")} onClick={() => setDraft(title)}
        className="flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border border-hairline/50 bg-raised px-3 text-[13px] font-medium text-ink shadow-sm hover:bg-raised-hover">
        <PageGlyph size={18} />
        <span className="min-w-0 truncate">{title || t("pages.untitled")}</span>
      </button>
    );
  }
  return (
    <form data-page-title-edit className="flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border border-accent/60 bg-raised px-3 shadow-sm"
      onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <PageGlyph size={18} />
      <input autoFocus aria-label={t("pages.rename")} value={draft} maxLength={PAGE_LIMITS.title} disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); } }}
        onBlur={() => { if (renameTitle(draft, title) === null) setDraft(null); }}
        onFocus={(event) => event.currentTarget.select()}
        className="w-[min(40vw,320px)] min-w-0 bg-transparent text-[13px] font-medium text-ink outline-none" />
      <Pencil size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </form>
  );
}

/**
 * The one frame a published page is drawn in, wherever it is shown: the
 * open page (PageSurface, over a conversation or in a window of its own)
 * and the card's thumbnail. Only a preview address previewSrc accepted is
 * ever given to it. No referrer (the bundled UI handler must never take the
 * page for the app's own request), no permissions, a transparent box in the
 * app's colour scheme. A thumbnail is inert: no focus, no pointer, lazy.
 */
export function PageFrame({ src, title = "", theme, thumbnail = false, frameRef, className }: {
  src: string;
  title?: string;
  theme: "light" | "dark";
  thumbnail?: boolean;
  frameRef?: Ref<HTMLIFrameElement>;
  className?: string;
}) {
  return (
    <iframe
      // a new address (mode, theme, a new version) draws the frame again
      key={src}
      ref={frameRef}
      data-page-viewer-frame={thumbnail ? undefined : ""}
      data-page-thumb-frame={thumbnail ? "" : undefined}
      title={title}
      src={src}
      referrerPolicy="no-referrer"
      allow=""
      {...(thumbnail ? { tabIndex: -1, loading: "lazy" as const } : {})}
      className={cn("border-0 bg-transparent", className)}
      style={{ colorScheme: theme }}
    />
  );
}

export interface PageSurfaceProps {
  pageId: string;
  /** The version to show first; else the newest. */
  version?: number;
  /** The title the card knew, shown until the page answers. */
  initialTitle?: string;
  /** The newest version the conversation names for this page: when the bot
   * proposes a new one, the page is drawn again with it, at the same place. */
  latestVersion?: number;
  onClose(): void;
  onChange?(page: PublishedPageSummary): void;
  /** Extra entries of « ⋯ » (Open in a window). */
  moreItems?(close: () => void): ReactNode;
  /** Drawn over the page, at the bottom (the conversation's composer). */
  footer?: ReactNode;
  /** A window of its own, with no conversation beside it: the page is asked
   * again now and then, so a new version from the bot is drawn in place. */
  follow?: boolean;
  className?: string;
}

export const PAGE_FOLLOW_MS = 5_000;

export function PageSurface({ pageId, version: initialVersion, initialTitle = "", latestVersion, onClose, onChange, moreItems, footer, follow = false, className }: PageSurfaceProps) {
  const { dispatch } = useStore();
  const policy = usePagesPolicy();
  const [page, setPage] = useState<PublishedPageSummary | null>(null);
  const [version, setVersion] = useState<number | null>(initialVersion ?? null);
  const [panel, setPanel] = useState<Panel>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [sent, setSent] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [sharing, setSharing] = useState(false);
  // the page was deleted (or is not this person's): said once, no spinner
  const [gone, setGone] = useState(false);
  // the page or its version could not be asked: no endless spinner either
  const [failed, setFailed] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const look = useWidgetTheme(rootRef);
  const theme = look.scheme;
  // the person's skin goes with the theme: the page's default theme takes it
  const skin = useMemo(() => encodeSkinTokens(look.tokens), [look]);

  // the caller's handler may change on every render: read it from a ref, so
  // loading the page never runs again because of it
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const update = useCallback((next: PublishedPageSummary) => {
    setPage(next);
    onChangeRef.current?.(next);
  }, []);

  const load = useCallback((asked?: number | null) => {
    let live = true;
    api<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(pageId)}`)
      .then((answer) => {
        if (!live) return;
        update(answer.page);
        setVersion((current) => pageVersionToShow(answer.page, asked ?? current));
      })
      .catch((cause) => {
        if (!live) return;
        if (pageGone(cause)) setGone(true);
        else { setError(errorText(cause)); setFailed(true); }
      });
    return () => { live = false; };
  }, [pageId, update]);
  useEffect(() => load(initialVersion ?? null), [load, initialVersion]);

  // in a window of its own: the newest version, asked now and then
  const [followed, setFollowed] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!follow) return;
    let live = true;
    const ask = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      api<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(pageId)}`)
        .then((answer) => { if (live) setFollowed(answer.page.versions.at(-1)?.n); })
        .catch(() => { /* the next ask tries again */ });
    };
    const timer = setInterval(ask, PAGE_FOLLOW_MS);
    return () => { live = false; clearInterval(timer); };
  }, [follow, pageId]);

  // the bot changed this page: show its new version, at the same place
  const newer = newerVersion(version, latestVersion ?? followed);
  useEffect(() => {
    if (newer === null || !page) return;
    return load(newer);
  }, [newer, page === null, load]);

  useEffect(() => {
    if (version === null) return;
    let live = true;
    api<{ version: { previewPath: string } }>(`/api/pages/${encodeURIComponent(pageId)}/versions/${version}`)
      .then((answer) => {
        if (!live) return;
        // only the page's own preview address is ever framed (previewSrc)
        if (previewSrc(answer.version.previewPath)) { setPreviewPath(answer.version.previewPath); setFailed(false); }
        else setFailed(true);
      })
      .catch((cause) => {
        // a deleted page is said by the page's own answer (gone wins)
        if (live) { setError(errorText(cause)); setFailed(true); }
      });
    return () => { live = false; };
  }, [pageId, version, reloads]);

  const annotating = panel === "annotate";
  const innerFrame = () => {
    // the page's own frame, inside this viewer's wrapper, and nothing else
    try {
      return frameRef.current?.contentWindow?.frames[0] ?? null;
    } catch {
      return null;
    }
  };
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (acceptPageOpen(event)) return;
      const frame = innerFrame();
      const y = acceptScroll(event, frame);
      if (y !== null) rememberPagePlace(pageId, y);
      else if (annotating) setAnnotations((list) => acceptAnnotation(list, event, frame));
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [annotating, pageId]);

  const call = async <T,>(path: string, init: RequestInit): Promise<T | null> => {
    setBusy(true);
    setError("");
    try {
      return await api<T>(`/api/pages/${encodeURIComponent(pageId)}${path}`, init);
    } catch (cause) {
      setError(errorText(cause));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const rename = async (title: string) => {
    const answer = await call<{ page: PublishedPageSummary }>("", { method: "PATCH", body: JSON.stringify({ title }) });
    if (answer) update(answer.page);
    return Boolean(answer);
  };

  const present = () => {
    const frame = frameRef.current;
    if (frame && typeof frame.requestFullscreen === "function") void frame.requestFullscreen().catch(() => { /* refused: the frame stays as is */ });
  };

  const toggle = (next: Panel) => {
    setPanel((current) => (current === next ? null : next));
    setSent(false);
    if (next !== "annotate") setAnnotations([]);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // the target may be the window or the document (focus nowhere):
      // Escape still closes, it never throws
      const target = event.target;
      // The empty composer docked on the page (stage chat, lot 5) is the
      // exception: there Escape is the way back to the chat, as from the
      // page itself. Its own Escapes (menus, reply, stop) prevent default.
      const emptyStageComposer = typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement
        && target.value === "" && target.closest("[data-page-stage-chat]") !== null;
      if (!emptyStageComposer && typeof Element !== "undefined" && target instanceof Element && target.closest("input,textarea,select,[role=menu],dialog")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = page?.versions.find((entry) => entry.n === version);
  // the place is read once per drawing: scrolling never reloads the frame
  const src = useMemo(
    () => (previewPath ? previewSrc(previewPath, { annotate: annotating, bare: true, theme, skin, y: pagePlace(pageId) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewPath, annotating, theme, skin, pageId, reloads],
  );
  const title = page?.title ?? initialTitle;
  const proposed = page && shown && shown.state === "proposed" && page.currentVersion !== shown.n;

  return (
    // window-no-drag: the page covers the conversation's header, a window
    // drag region in the desktop app (styles.css). Without it the drag region
    // under the page took every click on × and the round buttons (0.8.11:
    // no way out of a page). The page runs to the top edge, so none of it
    // drags the window.
    <div ref={rootRef} data-page-surface={pageId} className={cn("window-no-drag relative flex h-full min-h-0 w-full min-w-0 flex-col bg-app text-ink", className)}>
      {/* floats over the page, as the reference design draws it: the page
          runs to the top edge; only the round buttons and the pill catch
          the pointer */}
      {/* @container: on a narrow page (a phone, a split pane) Share keeps only
          its icon and the title pill takes the room between the buttons, so
          the pill never runs under « … » (390 px, lot 5). */}
      <header className="@container/pagehead pointer-events-none absolute inset-x-0 top-0 z-[2] flex h-14 items-center gap-2 px-3 [&>*]:pointer-events-auto">
        <button type="button" data-page-close aria-label={t("pages.backToChat")} title={t("pages.backToChat")} onClick={onClose} className={cn(ROUND, "window-no-drag")}>
          <X size={17} />
        </button>
        <div className="!pointer-events-none absolute inset-x-28 flex justify-center @max-[34rem]/pagehead:start-14 @max-[34rem]/pagehead:end-[6.5rem]">
          <div className="pointer-events-auto min-w-0 max-w-full">
            <PageTitlePill title={title} busy={busy} onRename={rename} />
          </div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {page && (
            <PopoverMenu label={t("pages.more")} menuLabel={t("pages.more")} icon={<Ellipsis size={17} />} buttonClass={ROUND} data-page-more="">
              {(close) => (
                <>
                  {page.versions.length > 1 && <MenuItem icon={<History size={14} />} label={t("pages.versions", { count: String(page.versions.length) })} onClick={() => { close(); toggle("versions"); }} />}
                  <MenuItem icon={<Highlighter size={14} />} label={annotating ? t("pages.annotate.exit") : t("pages.annotate.start")} onClick={() => { close(); toggle("annotate"); }} />
                  <MenuItem icon={<Play size={14} />} label={t("pages.present")} onClick={() => { close(); present(); }} />
                  <MenuItem icon={<Pencil size={14} />} label={t("pages.edit")} onClick={() => { close(); toggle("edit"); }} />
                  <MenuItem icon={<MessageSquare size={14} />} label={`${t("pages.comments.title")}${page.comments ? ` (${page.comments})` : ""}`} onClick={() => { close(); toggle("comments"); }} />
                  {proposed && (
                    <MenuItem icon={<XCircle size={14} />} label={t("pages.decline")} onClick={() => {
                      close();
                      void call<{ page: PublishedPageSummary }>("/decline", { method: "POST", body: JSON.stringify({ version: shown.n }) }).then((answer) => { if (answer) update(answer.page); });
                    }} />
                  )}
                  {moreItems?.(close)}
                </>
              )}
            </PopoverMenu>
          )}
          <button type="button" data-page-share aria-expanded={sharing} aria-haspopup="dialog" disabled={!page || version === null} className={cn(PILL, "@max-[34rem]/pagehead:px-2.5")} onClick={() => setSharing((open) => !open)}>
            <Share size={14} /><span className="@max-[34rem]/pagehead:sr-only">{t("pages.share")}</span>
          </button>
          {sharing && page && version !== null && (
            <PageSharePopover page={page} version={version} linkOff={!policy.linkSharing} onChange={update} onClose={() => setSharing(false)}
              className="absolute right-3 top-[52px]" />
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {(annotating || error) && !gone && !(failed && !src) && (
            <div className="mt-14">
              {annotating && <p role="status" className="border-y border-hairline/30 bg-accent/10 px-3 py-1.5 text-[12px] text-ink">{t("pages.annotate.hint")}</p>}
              {error && <p role="alert" className="px-3 py-1.5 text-[12px] text-danger">{error}</p>}
            </div>
          )}
          {gone ? (
            <PageUnavailable kind="gone" onClose={onClose} />
          ) : failed && !src ? (
            <PageUnavailable kind="failed" detail={error} onClose={onClose} />
          ) : src ? (
            <PageFrame src={src} frameRef={frameRef} title={t("pages.previewTitle", { title })} theme={theme} className="min-h-0 w-full flex-1" />
          ) : (
            <div className="flex flex-1 items-center justify-center"><Loader2 size={16} className="animate-spin text-ink-secondary" /></div>
          )}
          {footer}
        </div>
        {page && panel && (
          <aside data-page-side={panel} className="flex w-[min(380px,40vw)] shrink-0 flex-col gap-3 overflow-y-auto border-l border-hairline/40 bg-panel p-3 pt-16 text-[12.5px]">
            {panel === "annotate" && (
              <AnnotationPanel annotations={annotations} setAnnotations={setAnnotations} sent={sent} busy={busy}
                message={annotationPrompt({ title, version: version ?? 0, items: annotations, lang: document.documentElement.lang.startsWith("en") ? "en" : "fr" })}
                onSend={() => {
                  const text = annotationPrompt({ title, version: version ?? 0, items: annotations, lang: document.documentElement.lang.startsWith("en") ? "en" : "fr" });
                  dispatch({ type: "send", botId: page.botId, threadId: page.threadId, text });
                  setSent(true);
                  setAnnotations([]);
                }}
                onComment={async (item) => {
                  const answer = await call<{ comment: PageComment }>("/comments", { method: "POST", body: JSON.stringify({ text: item.note || item.anchor.text || item.anchor.tag, version, anchor: item.anchor }) });
                  if (answer) update({ ...page, comments: (page.comments ?? 0) + 1 });
                  return Boolean(answer);
                }} />
            )}
            {panel === "versions" && (
              <VersionsPanel page={page} version={version} onPick={(n) => { setVersion(n); setAnnotations([]); }} />
            )}
            {panel === "edit" && shown && (
              <PageEditor pageId={pageId} version={shown.n} page={page} busy={busy} call={call}
                onSaved={(next, n) => { update(next); setVersion(n); setReloads((count) => count + 1); }} />
            )}
            {panel === "comments" && <CommentsPanel pageId={pageId} version={version} call={call} onCount={(count) => update({ ...page, comments: count })} />}
          </aside>
        )}
      </div>
    </div>
  );
}

/** In place of the page when it cannot be drawn: deleted, or its preview
 * could not be asked. A neutral line and Close, never a spinner that does
 * not end, never the app. */
export function PageUnavailable({ kind, detail, onClose }: { kind: "gone" | "failed"; detail?: string; onClose(): void }) {
  return (
    <div data-page-unavailable={kind} role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <PageGlyph size={36} className="rounded-xl opacity-60" />
      <p className="text-[14px] font-medium text-ink">{kind === "gone" ? t("pages.gone") : t("pages.previewUnavailable")}</p>
      {kind === "failed" && detail ? <p className="max-w-md text-[12px] text-ink-secondary">{detail}</p> : null}
      <button type="button" data-page-unavailable-close onClick={onClose}
        className="window-no-drag rounded-full border border-hairline/60 bg-raised px-4 py-1.5 text-[13px] font-medium text-ink hover:bg-raised-hover">
        {t("pages.close")}
      </button>
    </div>
  );
}

function VersionsPanel({ page, version, onPick }: { page: PublishedPageSummary; version: number | null; onPick(n: number): void }) {
  return (
    <section aria-label={t("pages.versionPick")} className="flex flex-col gap-1">
      <h3 className="mb-1 text-[13px] font-medium text-ink">{t("pages.versions", { count: String(page.versions.length) })}</h3>
      {page.versions.slice().reverse().map((entry) => (
        <button key={entry.n} type="button" aria-pressed={entry.n === version} onClick={() => onPick(entry.n)}
          className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover", entry.n === version && "bg-raised")}>
          <Check size={13} aria-hidden="true" className={entry.n === version ? "text-ink" : "invisible"} />
          <span className="flex-1 text-ink">{t("pages.versionN", { n: String(entry.n) })}</span>
          <span className="text-ink-tertiary">{when(entry.createdAt)}</span>
          {page.currentVersion === entry.n && <span className="text-success">{t("pages.status.published")}</span>}
          {entry.state === "declined" && <span className="text-ink-tertiary">{t("pages.status.declined")}</span>}
        </button>
      ))}
    </section>
  );
}

function AnnotationPanel({ annotations, setAnnotations, sent, busy, message, onSend, onComment }: {
  annotations: Annotation[];
  /** Exactly what Send writes in the conversation, shown before it goes. */
  message: string;
  setAnnotations(update: (list: Annotation[]) => Annotation[]): void;
  sent: boolean;
  busy: boolean;
  onSend(): void;
  onComment(item: Annotation): Promise<boolean>;
}) {
  return (
    <section aria-label={t("pages.annotate.start")} className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-ink">{t("pages.annotate.count", { count: String(annotations.length) })}</h3>
      {sent && <p role="status" className="text-success">{t("pages.annotate.sent")}</p>}
      {annotations.length === 0 && !sent && <p className="text-ink-secondary">{t("pages.annotate.empty")}</p>}
      <ol className="flex flex-col gap-2">
        {annotations.map((item) => (
          <li key={item.n} data-page-annotation={item.n} className="space-y-1 rounded-lg bg-raised/45 p-2">
            <div className="flex items-start gap-2">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">{item.n}</span>
              <span className="min-w-0 flex-1 truncate text-ink-secondary" title={item.anchor.path}>
                &lt;{item.anchor.tag}&gt; {item.anchor.text}
              </span>
              <button type="button" className="table-action" aria-label={t("pages.annotate.remove")} title={t("pages.annotate.remove")}
                onClick={() => setAnnotations((list) => list.filter((entry) => entry.n !== item.n))}><X size={13} /></button>
            </div>
            <textarea aria-label={t("pages.annotate.note", { n: String(item.n) })} placeholder={t("pages.annotate.placeholder")} value={item.note} rows={2} maxLength={2000}
              onChange={(event) => { const note = event.target.value; setAnnotations((list) => list.map((entry) => (entry.n === item.n ? { ...entry, note } : entry))); }}
              className="w-full rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]" />
            <button type="button" disabled={busy} className="text-[12px] text-accent hover:underline disabled:opacity-40" onClick={() => void onComment(item)}>
              {t("pages.annotate.asComment")}
            </button>
          </li>
        ))}
      </ol>
      {annotations.length >= MAX_ANNOTATIONS && <p className="text-warning">{t("pages.annotate.full", { max: String(MAX_ANNOTATIONS) })}</p>}
      {annotations.length > 0 && (
        <details open className="rounded-lg border border-hairline/40 p-2">
          <summary className="cursor-pointer text-ink-secondary">{t("pages.annotate.messagePreview")}</summary>
          <pre data-page-annotation-message className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-[12px] text-ink">{message}</pre>
        </details>
      )}
      <button type="button" data-page-annotation-send disabled={annotations.length === 0} className={PRIMARY} onClick={onSend}>
        <Send size={13} />{t("pages.annotate.send")}
      </button>
    </section>
  );
}

type Call = <T>(path: string, init: RequestInit) => Promise<T | null>;

function PageEditor({ pageId, version, page, busy, call, onSaved }: {
  pageId: string;
  version: number;
  page: PublishedPageSummary;
  busy: boolean;
  call: Call;
  onSaved(page: PublishedPageSummary, version: number): void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [kind, setKind] = useState<PageKind>("html");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let live = true;
    setSource(null);
    api<{ version: { kind: PageKind }; content: string }>(`/api/pages/${encodeURIComponent(pageId)}/versions/${version}/source`)
      .then((answer) => { if (live) { setSource(answer.content); setKind(answer.version.kind); } })
      .catch(() => { if (live) setSource(""); });
    return () => { live = false; };
  }, [pageId, version]);
  const save = async (publish: boolean) => {
    setSaved("");
    const answer = await call<{ page: PublishedPageSummary; version: number }>("/versions", { method: "POST", body: JSON.stringify({ kind, content: source ?? "" }) });
    if (!answer) return;
    let next = answer.page;
    if (publish) {
      const published = await call<{ page: PublishedPageSummary }>("/publish", { method: "POST", body: JSON.stringify(republishBody(page, answer.version)) });
      if (published) next = published.page;
    }
    onSaved(next, answer.version);
    setSaved(publish ? t("pages.editor.savedPublished", { n: String(answer.version) }) : t("pages.editor.saved", { n: String(answer.version) }));
  };
  if (source === null) return <Loader2 size={14} className="animate-spin text-ink-secondary" />;
  const live = page.status === "published";
  return (
    <section aria-label={t("pages.edit")} className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="text-ink-secondary">{t("pages.editor.intro")}</p>
      <label className="flex items-center gap-2 text-ink">
        {t("pages.editor.kind")}
        <select value={kind} onChange={(event) => setKind(event.target.value as PageKind)} className="rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]">
          {PAGE_KINDS.map((entry) => <option key={entry} value={entry}>{t(KIND_LABEL[entry])}</option>)}
        </select>
      </label>
      <textarea data-page-editor aria-label={t("pages.edit")} spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)}
        className="min-h-[320px] flex-1 resize-none rounded-md border border-hairline/50 bg-panel p-2 font-mono text-[12px] leading-relaxed" />
      {kind === "presentation" && <p className="text-[11.5px] text-ink-tertiary">{t("pages.editor.presentationHint")}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !source.trim()} className={BUTTON} onClick={() => void save(false)}><Save size={13} />{t("pages.editor.save")}</button>
        {live && (
          <button type="button" disabled={busy || !source.trim()} className={PRIMARY} onClick={() => void save(true)}>
            {t("pages.editor.savePublish", { access: t(ACCESS_LABEL[page.access]) })}
          </button>
        )}
      </div>
      {saved && <p role="status" className="text-success">{saved}</p>}
    </section>
  );
}

function CommentsPanel({ pageId, version, call, onCount }: { pageId: string; version: number | null; call: Call; onCount(count: number): void }) {
  const [comments, setComments] = useState<PageComment[] | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    let live = true;
    api<{ comments: PageComment[] }>(`/api/pages/${encodeURIComponent(pageId)}/comments`)
      .then((answer) => { if (live) setComments(answer.comments); })
      .catch(() => { if (live) setComments([]); });
    return () => { live = false; };
  }, [pageId]);
  const add = async () => {
    const body = text.trim();
    if (!body) return;
    const answer = await call<{ comment: PageComment }>("/comments", { method: "POST", body: JSON.stringify({ text: body, ...(version !== null ? { version } : {}) }) });
    if (!answer) return;
    const next = [...(comments ?? []), answer.comment];
    setComments(next);
    onCount(next.length);
    setText("");
  };
  const remove = async (id: string) => {
    const answer = await call<{ ok: true }>(`/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!answer) return;
    const next = (comments ?? []).filter((entry) => entry.id !== id);
    setComments(next);
    onCount(next.length);
  };
  return (
    <section aria-label={t("pages.comments.title")} className="flex flex-col gap-2">
      <p className="text-ink-secondary">{t("pages.comments.intro")}</p>
      {comments === null && <Loader2 size={14} className="animate-spin text-ink-secondary" />}
      {comments?.length === 0 && <p className="text-ink-tertiary">{t("pages.comments.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {(comments ?? []).map((comment) => (
          <li key={comment.id} className="space-y-0.5 rounded-lg bg-raised/45 p-2">
            <div className="flex items-center gap-2 text-[11.5px] text-ink-tertiary">
              <span className="flex-1">{when(comment.at)}{comment.version ? ` · ${t("pages.versionN", { n: String(comment.version) })}` : ""}</span>
              <button type="button" className="table-action" aria-label={t("pages.comments.delete")} title={t("pages.comments.delete")} onClick={() => void remove(comment.id)}><Trash2 size={12} /></button>
            </div>
            {comment.anchor && <p className="truncate text-[11.5px] text-ink-secondary" title={comment.anchor.path}>&lt;{comment.anchor.tag}&gt; {comment.anchor.text}</p>}
            <p className="whitespace-pre-wrap text-ink">{comment.text}</p>
          </li>
        ))}
      </ul>
      <ReaderComments pageId={pageId} call={call} />
      <textarea aria-label={t("pages.comments.add")} placeholder={t("pages.comments.placeholder")} value={text} rows={3} maxLength={2000} onChange={(event) => setText(event.target.value)}
        className="w-full rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]" />
      <button type="button" disabled={!text.trim()} className={PRIMARY} onClick={() => void add()}>{t("pages.comments.add")}</button>
    </section>
  );
}

/** Readers' comments on a published page (2026-10-21): off unless the
 * person turns them on, and only while the organization allows them. A
 * reader's comment waits here until the person approves it. */
function ReaderComments({ pageId, call }: { pageId: string; call: Call }) {
  const [state, setState] = useState<{ comments: ReaderComment[]; enabled: boolean; allowed: boolean } | null>(null);
  const load = useCallback(() => {
    api<{ comments: ReaderComment[]; enabled: boolean; allowed: boolean }>(`/api/pages/${encodeURIComponent(pageId)}/reader-comments`)
      .then(setState)
      .catch(() => setState(null));
  }, [pageId]);
  useEffect(load, [load]);
  if (!state) return null;
  const toggle = async (next: boolean) => {
    const answer = await call<{ page: PublishedPageSummary }>("", { method: "PATCH", body: JSON.stringify({ readerComments: next }) });
    if (answer) setState({ ...state, enabled: next });
  };
  const act = async (path: string, init: RequestInit) => {
    if (await call<{ ok: true }>(path, init)) load();
  };
  const pending = state.comments.filter((entry) => entry.status === "pending");
  const approved = state.comments.filter((entry) => entry.status === "approved");
  const row = (comment: ReaderComment) => (
    <li key={comment.id} data-reader-comment={comment.status} className="space-y-1 rounded-lg bg-raised/45 p-2">
      <div className="flex items-center gap-2 text-[11.5px] text-ink-tertiary">
        <span className="min-w-0 flex-1 truncate"><span className="font-medium text-ink">{comment.name}</span> · {when(comment.at)}</span>
        {comment.status === "pending" && (
          <button type="button" className="table-action" aria-label={t("pages.readers.approve")} title={t("pages.readers.approve")}
            onClick={() => void act(`/reader-comments/${encodeURIComponent(comment.id)}/approve`, { method: "POST", body: "{}" })}><Check size={13} /></button>
        )}
        <button type="button" className="table-action" aria-label={t("pages.comments.delete")} title={t("pages.comments.delete")}
          onClick={() => void act(`/reader-comments/${encodeURIComponent(comment.id)}`, { method: "DELETE" })}><Trash2 size={12} /></button>
      </div>
      <p className="whitespace-pre-wrap text-ink">{comment.text}</p>
    </li>
  );
  return (
    <section aria-label={t("pages.readers.title")} className="flex flex-col gap-2 border-t border-hairline/30 pt-2">
      <SwitchRow label={t("pages.readers.title")} description={state.allowed ? t("pages.readers.hint") : t("pages.readers.forbidden")}
        checked={state.enabled && state.allowed} disabled={!state.allowed} onChange={(next) => void toggle(next)} />
      {pending.length > 0 && <h4 className="text-[12px] font-medium text-ink">{t("pages.readers.pending", { count: String(pending.length) })}</h4>}
      <ul className="flex flex-col gap-2">{pending.map(row)}</ul>
      {approved.length > 0 && <h4 className="text-[12px] font-medium text-ink">{t("pages.readers.approved", { count: String(approved.length) })}</h4>}
      <ul className="flex flex-col gap-2">{approved.map(row)}</ul>
    </section>
  );
}
