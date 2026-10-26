// The full-page viewer of a published page (Grok Bot parity, lot R8, chat
// rows 31 to 34): « Ouvrir en pleine page », rename, versions, the person's
// own edit, comments, the annotation mode (« Annoter la page ») that sends
// numbered notes to the bot, sharing (who can see it, the public link,
// Unpublish) and Present (a presentation, or any page, full screen).
//
// The page is always the server's preview wrapper (banner, no script) and its
// sandboxed frame (shared/published-pages.ts): never a srcdoc. In annotation
// mode the frame runs the server's annotation script, which only posts to
// this window; a message counts only when it comes from that very frame, and
// its fields are plain text (parseAnnotationMessage). Nothing reaches a bot
// until the person presses Send.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Highlighter, Loader2, MessageSquare, Pencil, Play, Save, Send, Share2, Trash2, X, XCircle } from "lucide-react";

import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import {
  annotationPrompt,
  PAGE_KINDS,
  PAGE_LIMITS,
  parseAnnotationMessage,
  type PageAccess,
  type PageAnchor,
  type PageComment,
  type PageKind,
  type PublishedPageSummary,
  type ReaderComment,
} from "../../shared/published-pages";
import { AccessPicker, ACCESS_LABEL, ExpirySelect, expiryFromHours, LinkRow, needsLinkConfirm, pageErrorText, previewSrc, usePagesPolicy, when } from "./page-controls";
import { SwitchRow } from "./SettingsPrimitives";

export { needsLinkConfirm, pageErrorText };

/** The viewer keeps at most this many annotations (and sends no more). */
export const MAX_ANNOTATIONS = PAGE_LIMITS.annotations;
import { ViewerDialog } from "./ViewerDialog";

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

/** Publish a version the person just saved with the page's own access, and
 * its expiry while still ahead. Pure. */
export function republishBody(page: Pick<PublishedPageSummary, "access" | "expiresAt">, version: number, now = Date.now()) {
  return { version, access: page.access, expiresAt: page.expiresAt !== null && page.expiresAt > now ? page.expiresAt : null };
}

const KIND_LABEL: Record<PageKind, "pages.kind.html" | "pages.kind.markdown" | "pages.kind.presentation"> = {
  html: "pages.kind.html",
  markdown: "pages.kind.markdown",
  presentation: "pages.kind.presentation",
};

type Panel = "edit" | "comments" | "share" | "annotate" | null;

const BUTTON = "inline-flex items-center gap-1.5 rounded-lg border border-hairline/60 px-2.5 py-1 text-[12.5px] text-ink hover:bg-raised disabled:opacity-40";
const PRIMARY = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40";

const errorText = pageErrorText;

export function PageViewerDialog({ pageId, version: initialVersion, onClose, returnFocus, onChange }: {
  pageId: string;
  /** The version to show first; else the published one, else the latest. */
  version?: number;
  onClose(): void;
  returnFocus: HTMLElement | null;
  onChange?(page: PublishedPageSummary): void;
}) {
  const { dispatch } = useStore();
  const policy = usePagesPolicy();
  const [page, setPage] = useState<PublishedPageSummary | null>(null);
  const [version, setVersion] = useState<number | null>(initialVersion ?? null);
  const [panel, setPanel] = useState<Panel>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [sent, setSent] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const update = useCallback((next: PublishedPageSummary) => {
    setPage(next);
    onChange?.(next);
  }, [onChange]);

  useEffect(() => {
    let live = true;
    api<{ page: PublishedPageSummary }>(`/api/pages/${encodeURIComponent(pageId)}`)
      .then((answer) => {
        if (!live) return;
        setPage(answer.page);
        setVersion((current) => current ?? answer.page.currentVersion ?? answer.page.versions.at(-1)?.n ?? null);
      })
      .catch((cause) => { if (live) setError(errorText(cause)); });
    return () => { live = false; };
  }, [pageId]);

  useEffect(() => {
    if (version === null) return;
    let live = true;
    setPreviewPath(null);
    api<{ version: { previewPath: string } }>(`/api/pages/${encodeURIComponent(pageId)}/versions/${version}`)
      .then((answer) => { if (live) setPreviewPath(answer.version.previewPath); })
      .catch((cause) => { if (live) setError(errorText(cause)); });
    return () => { live = false; };
  }, [pageId, version]);

  const annotating = panel === "annotate";
  useEffect(() => {
    if (!annotating) return;
    const listen = (event: MessageEvent) => {
      // the page's own frame, inside this viewer's wrapper, and nothing else
      let frame: Window | null = null;
      try {
        frame = frameRef.current?.contentWindow?.frames[0] ?? null;
      } catch {
        frame = null;
      }
      setAnnotations((list) => acceptAnnotation(list, event, frame));
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [annotating]);

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

  const rename = async () => {
    const title = renaming?.trim();
    if (!title) return setRenaming(null);
    const answer = await call<{ page: PublishedPageSummary }>("", { method: "PATCH", body: JSON.stringify({ title }) });
    if (answer) {
      update(answer.page);
      setRenaming(null);
    }
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

  const shown = page?.versions.find((entry) => entry.n === version);
  const src = previewPath ? previewSrc(previewPath, { annotate: annotating }) : null;
  const title = page?.title ?? "";

  const actions = page && (
    <>
      {renaming === null ? (
        <button type="button" className="table-action" aria-label={t("pages.rename")} title={t("pages.rename")} onClick={() => setRenaming(title)}><Pencil size={15} /></button>
      ) : (
        <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
          <input autoFocus aria-label={t("pages.rename")} value={renaming} maxLength={120} onChange={(event) => setRenaming(event.target.value)}
            className="w-48 rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]" />
          <button type="submit" disabled={busy} className={BUTTON}>{t("pages.renameSave")}</button>
          <button type="button" className="table-action" aria-label={t("pages.cancel")} onClick={() => setRenaming(null)}><X size={14} /></button>
        </form>
      )}
      {page.versions.length > 1 && (
        <select aria-label={t("pages.versionPick")} value={version ?? ""} onChange={(event) => { setVersion(Number(event.target.value)); setAnnotations([]); }}
          className="rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]">
          {page.versions.slice().reverse().map((entry) => (
            <option key={entry.n} value={entry.n}>
              {t("pages.versionN", { n: String(entry.n) })}{page.currentVersion === entry.n ? ` · ${t("pages.status.published")}` : ""}
            </option>
          ))}
        </select>
      )}
      <button type="button" data-page-annotate aria-pressed={annotating} className={BUTTON} onClick={() => toggle("annotate")}>
        <Highlighter size={13} />{annotating ? t("pages.annotate.exit") : t("pages.annotate.start")}
      </button>
      <button type="button" data-page-present className={BUTTON} onClick={present}><Play size={13} />{t("pages.present")}</button>
      <button type="button" aria-pressed={panel === "edit"} className={BUTTON} onClick={() => toggle("edit")}><Pencil size={13} />{t("pages.edit")}</button>
      <button type="button" aria-pressed={panel === "comments"} className={BUTTON} onClick={() => toggle("comments")}>
        <MessageSquare size={13} />{t("pages.comments.title")}{page.comments ? ` (${page.comments})` : ""}
      </button>
      <button type="button" aria-pressed={panel === "share"} className={BUTTON} onClick={() => toggle("share")}><Share2 size={13} />{t("pages.share")}</button>
    </>
  );

  return (
    <ViewerDialog title={title || t("pages.untitled")} onClose={onClose} returnFocus={returnFocus} actions={actions} bodyClassName="flex min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {annotating && <p role="status" className="border-b border-hairline/30 bg-accent/10 px-3 py-1.5 text-[12px] text-ink">{t("pages.annotate.hint")}</p>}
        {error && <p role="alert" className="px-3 py-1.5 text-[12px] text-danger">{error}</p>}
        {src ? (
          // a new address on mode change reloads the frame with or without the script
          <iframe key={src} ref={frameRef} data-page-viewer-frame title={t("pages.previewTitle", { title })} src={src}
            referrerPolicy="no-referrer" allow="" className="min-h-0 w-full flex-1 border-0 bg-white" />
        ) : (
          <div className="flex flex-1 items-center justify-center"><Loader2 size={16} className="animate-spin text-ink-secondary" /></div>
        )}
      </div>
      {page && panel && (
        <aside className="flex w-[min(380px,40vw)] shrink-0 flex-col gap-3 overflow-y-auto border-l border-hairline/40 p-3 text-[12.5px]">
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
          {panel === "edit" && shown && (
            <PageEditor pageId={pageId} version={shown.n} page={page} busy={busy} call={call}
              onSaved={(next, n) => { update(next); setVersion(n); }} />
          )}
          {panel === "comments" && <CommentsPanel pageId={pageId} version={version} call={call} onCount={(count) => update({ ...page, comments: count })} />}
          {panel === "share" && version !== null && (
            <SharePanel page={page} version={version} busy={busy} linkOff={!policy.linkSharing} call={call} onChange={update} />
          )}
        </aside>
      )}
    </ViewerDialog>
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

function SharePanel({ page, version, busy, linkOff, call, onChange }: {
  page: PublishedPageSummary;
  version: number;
  busy: boolean;
  linkOff: boolean;
  call: Call;
  onChange(page: PublishedPageSummary): void;
}) {
  const [access, setAccess] = useState<PageAccess>("private");
  const [hours, setHours] = useState(0);
  const [confirmLink, setConfirmLink] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [pendingAccess, setPendingAccess] = useState<PageAccess | null>(null);
  const live = page.status === "published";
  const act = async (path: string, init: RequestInit) => {
    const answer = await call<{ page: PublishedPageSummary }>(path, init);
    if (answer) onChange(answer.page);
    setConfirmLink(false);
    setConfirmUnpublish(false);
    setPendingAccess(null);
  };
  const changeAccess = (next: PageAccess) => {
    if (needsLinkConfirm(page.access, next)) return setPendingAccess(next);
    void act("", { method: "PATCH", body: JSON.stringify({ access: next }) });
  };
  const shown = page.versions.find((entry) => entry.n === version);
  return (
    <section aria-label={t("pages.share")} className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium text-ink">{t("pages.whoCanAccess")}</h3>
      {live ? (
        <>
          <LinkRow page={page} />
          <label className="flex items-center gap-2 text-ink">
            {t("pages.whoCanSee")}
            <select value={pendingAccess ?? page.access} disabled={busy} onChange={(event) => changeAccess(event.target.value as PageAccess)}
              className="rounded-md border border-hairline/50 bg-panel px-2 py-1 text-[12.5px]">
              {(["private", "org", "link"] as const).map((entry) => (
                <option key={entry} value={entry} disabled={entry === "link" && linkOff && page.access !== "link"}>{t(ACCESS_LABEL[entry])}</option>
              ))}
            </select>
          </label>
          {pendingAccess && (
            <div role="alert" className="flex flex-col gap-2">
              <p className="text-warning">{t("pages.confirmLinkChange")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={PRIMARY} onClick={() => void act("", { method: "PATCH", body: JSON.stringify({ access: pendingAccess }) })}>{t("pages.publishConfirm")}</button>
                <button type="button" className={BUTTON} onClick={() => setPendingAccess(null)}>{t("pages.cancel")}</button>
              </div>
            </div>
          )}
          {linkOff && page.access === "link" && <p className="text-warning">{t("pages.linkOffActive")}</p>}
          <ExpirySelect value={-1} disabled={busy} onChange={(next) => void act("", { method: "PATCH", body: JSON.stringify({ expiresAt: expiryFromHours(next) }) })} />
          {page.currentVersion !== version && shown?.state !== "declined" && (
            <button type="button" disabled={busy} className={BUTTON} onClick={() => void act("/publish", { method: "POST", body: JSON.stringify(republishBody(page, version)) })}>
              {t("pages.publishThis")}
            </button>
          )}
          {confirmUnpublish ? (
            <div role="alert" className="flex flex-wrap items-center gap-2">
              <span>{t("pages.unpublishConfirm", { name: page.title })}</span>
              <button type="button" disabled={busy} className="rounded px-1.5 py-1 text-danger hover:bg-danger/10" onClick={() => void act("/revoke", { method: "POST", body: "{}" })}>{t("pages.unpublish")}</button>
              <button type="button" className="rounded px-1.5 py-1 text-ink-secondary hover:bg-hover" onClick={() => setConfirmUnpublish(false)}>{t("pages.cancel")}</button>
            </div>
          ) : (
            <button type="button" data-page-unpublish className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-1 text-danger hover:bg-danger/10" onClick={() => setConfirmUnpublish(true)}>
              <XCircle size={13} />{t("pages.unpublish")}
            </button>
          )}
        </>
      ) : shown?.state === "declined" ? (
        <p className="text-ink-secondary">{t("pages.declined")}</p>
      ) : (
        <>
          <p className="text-ink-secondary">{t("pages.reviewIntro")}</p>
          <AccessPicker value={access} onChange={(next) => { setAccess(next); setConfirmLink(false); }} name={`page-share-${page.id}`} disabled={busy} linkOff={linkOff} />
          <ExpirySelect value={hours} onChange={setHours} disabled={busy} />
          {confirmLink && <p role="alert" className="text-warning">{t("pages.confirmLink")}</p>}
          <button type="button" disabled={busy} className={PRIMARY}
            onClick={() => {
              if (access === "link" && !confirmLink) return setConfirmLink(true);
              void act("/publish", { method: "POST", body: JSON.stringify({ version, access, expiresAt: expiryFromHours(hours) }) });
            }}>
            {confirmLink ? t("pages.publishConfirm") : t("pages.publish")}
          </button>
        </>
      )}
    </section>
  );
}

/** Readers' comments on a published page (JC 2026-10-21): off unless the
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
