// The Files tab: every file of the open conversation, the person's uploads
// and what the bot attached, linked or wrote, newest first. The server lists
// them (GET /api/threads/:id/files) because the transcript here may hold only
// its newest page, and it serves each one by an opaque id under the same
// roots the message file route uses. Nothing in this tab turns a host path
// into a request.
import { copyText } from "@/lib/copy-text";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Download,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  List,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Music,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { useAdvancedMode } from "@/lib/interface-mode";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { formatSize } from "@/lib/composer-attachments";
import {
  classifyFile,
  countByFilter,
  FILE_FILTERS,
  filesSignature,
  threadFileUrl,
  visibleFiles,
  type FileFilter,
  type FileKind,
  type FileOrigin,
  type FileSort,
  type ThreadFile,
} from "@/lib/chat-files";
import { filePreviewKind, loadTextPreview } from "@/lib/file-preview";
import { AttachmentPreviewDialog, canonicalDownloadFilename, startMessageFileDownload, type PreviewImage } from "../AttachmentPreview";
import { HoverCard, type AnchorProps } from "../LinkHoverCard";
import { AnchoredPopover } from "@/components/AnchoredPopover";

export const KIND_ICON: Record<FileKind, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  code: FileCode,
  archive: FileArchive,
  other: FileIcon,
};

const VIEW_KEY = "omb-files-view";
const REFRESH_DELAY_MS = 400;

function readView(): "grid" | "list" | null {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return stored === "grid" || stored === "list" ? stored : null;
  } catch {
    return null;
  }
}

export function formatWhen(at: number): string {
  try {
    return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(at);
  } catch {
    return new Date(at).toLocaleString(activeLocale());
  }
}

/** A readable local path the person can paste somewhere: an absolute POSIX
 * or Windows path, or a file:// URL. Relative spellings are not offered. */
export function copyablePath(path: string): string | null {
  if (/^file:\/\//i.test(path)) {
    try { return decodeURIComponent(new URL(path).pathname).replace(/^\/([a-z]:[\\/])/i, "$1"); } catch { return null; }
  }
  return path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") ? path : null;
}

export async function downloadThreadFile(threadId: string, file: ThreadFile): Promise<void> {
  const url = threadFileUrl(threadId, file.id);
  // Verify current authorization and availability without buffering the file.
  // The browser download manager then streams the opaque same-origin GET.
  const response = await fetch(url, {
    headers: file.size === 0 ? undefined : { range: "bytes=0-0" },
  });
  const emptyRange = response.status === 416 && response.headers.get("content-range") === "bytes */0";
  if (!response.ok && !emptyRange) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? t("attach.downloadFailed"));
  }
  await response.body?.cancel().catch(() => undefined);
  const name = canonicalDownloadFilename({
    contentDisposition: response.headers.get("content-disposition"),
    fallback: file.name,
    source: file.name,
    mime: response.headers.get("content-type"),
  });
  startMessageFileDownload(url, name);
}

/** One video or audio file streamed from its opaque authorized URL. Native
 * media range requests make seek independent of the full file size. */
export function MediaPreviewDialog({ threadId, file, kind, onClose }: { threadId: string; file: ThreadFile; kind: "video" | "audio"; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("botPanel.files.previewAria", { name: file.name })}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/70 shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <span className="min-w-0 truncate text-[13px] font-medium text-white">{file.name}</span>
          <button type="button" onClick={onClose} aria-label={t("attach.close")} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <X size={19} />
          </button>
        </header>
        <div className="flex min-h-[160px] items-center justify-center p-4">
          {error ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p role="alert" className="text-[13px] text-white/70">{error}</p>
              <button
                type="button"
                onClick={() => void downloadThreadFile(threadId, file).catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : t("attach.downloadFailed")))}
                className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-[13px] text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <Download size={15} aria-hidden="true" /> {t("attach.download")}
              </button>
            </div>
          ) : kind === "video" ? (
            <div className="relative flex min-h-[160px] w-full items-center justify-center">
              <video
                src={threadFileUrl(threadId, file.id, true)}
                controls
                playsInline
                preload="metadata"
                className="max-h-[75vh] max-w-full rounded-lg"
                aria-label={file.name}
                onLoadedMetadata={() => setLoading(false)}
                onCanPlay={() => setLoading(false)}
                onWaiting={() => setLoading(true)}
                onPlaying={() => setLoading(false)}
                onError={() => { setLoading(false); setError(t("attach.videoUnavailable")); }}
              />
              {loading && <span role="status" className="pointer-events-none absolute flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-[13px] text-white/75"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> {t("botPanel.files.previewLoading")}</span>}
            </div>
          ) : (
            <div className="relative flex min-h-[80px] w-full items-center justify-center">
              <audio
                src={threadFileUrl(threadId, file.id, true)}
                controls
                preload="metadata"
                className="w-full max-w-md"
                aria-label={file.name}
                onLoadedMetadata={() => setLoading(false)}
                onCanPlay={() => setLoading(false)}
                onWaiting={() => setLoading(true)}
                onPlaying={() => setLoading(false)}
                onError={() => { setLoading(false); setError(t("attach.audioUnavailable")); }}
              />
              {loading && <span role="status" className="pointer-events-none absolute flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-[13px] text-white/75"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> {t("botPanel.files.previewLoading")}</span>}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Thumbnail({ threadId, file, kind, className, iconSize = 20 }: { threadId: string; file: ThreadFile; kind: FileKind; className?: string; iconSize?: number }) {
  const [failed, setFailed] = useState(false);
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("relative flex items-center justify-center overflow-hidden bg-inset text-ink-secondary", className)}>
      {kind === "image" && file.available && !failed ? (
        <img
          src={threadFileUrl(threadId, file.id, true)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <Icon size={iconSize} aria-hidden="true" />
      )}
    </span>
  );
}

/** The hover card of a library file (reference design): a fixed-size card,
 * so nothing moves while its text loads. Text is read only once it opens. */
export function FilePreviewCard({ threadId, file }: { threadId: string; file: ThreadFile }) {
  const kind = classifyFile(file);
  const preview = filePreviewKind(file);
  const Icon = KIND_ICON[kind];
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (preview !== "text") return;
    const controller = new AbortController();
    loadTextPreview(threadFileUrl(threadId, file.id), controller.signal)
      .then((value) => { if (!controller.signal.aborted) setText(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [preview, threadId, file.id]);
  return (
    <div data-file-preview-card={preview} className="w-72 overflow-hidden rounded-2xl bg-composer text-ink shadow-lg ring-1 ring-hairline/40">
      <div className="flex h-40 items-center justify-center overflow-hidden bg-inset text-ink-secondary">
        {preview === "image" && !failed ? (
          <img src={threadFileUrl(threadId, file.id, true)} alt="" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
        ) : preview === "text" && text !== null && !failed ? (
          <pre dir="auto" className="size-full overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-left font-mono text-[11px] leading-[13px] text-ink-secondary">{text || " "}</pre>
        ) : preview === "text" && !failed ? (
          <LoaderCircle size={18} aria-label={t("botPanel.files.previewLoading")} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Icon size={32} aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 px-3 py-2.5">
        <div className="truncate text-[13px] font-semibold leading-5">{file.name}</div>
        <div className="truncate text-[11.5px] leading-4 text-ink-secondary">{file.available ? meta(file) : t("botPanel.files.unavailable")}</div>
      </div>
    </div>
  );
}

/** A file's open button with its hover card. */
export function FileHover({ threadId, file, children }: { threadId: string; file: ThreadFile; children: (anchor: AnchorProps | null) => ReactNode }) {
  if (!file.available) return <>{children(null)}</>;
  return <HoverCard kind="file-preview" card={() => <FilePreviewCard threadId={threadId} file={file} />}>{(anchor) => children(anchor)}</HoverCard>;
}

function meta(file: ThreadFile): string {
  return [t(`botPanel.files.source.${file.source}`), file.size === null ? null : formatSize(file.size), formatWhen(file.at)]
    .filter(Boolean)
    .join(" · ");
}

/** The open conversation's files: the fetch, the live refresh and the jump
 * back into the chat. Shared by the Files section and the Library tab. */
export function useThreadFiles(bot: Bot): {
  threadId: string;
  files: ThreadFile[] | null;
  error: boolean;
  reload: () => void;
  jump: (file: ThreadFile) => void;
  /** Apply a change the person just made before the next listing lands. */
  patch: (id: string, change: Partial<ThreadFile>) => void;
} {
  const { state, dispatch } = useStore();
  const threadId = bot.threadId;
  const [files, setFiles] = useState<ThreadFile[] | null>(null);
  const [error, setError] = useState(false);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const request = useRef(0);
  const loadedOnce = useRef(false);

  const load = useCallback(() => {
    const id = ++request.current;
    return api<{ files: ThreadFile[] }>(`/api/threads/${encodeURIComponent(threadId)}/files`)
      .then((body) => {
        if (id !== request.current) return;
        loadedOnce.current = true;
        setFiles(Array.isArray(body.files) ? body.files : []);
        setError(false);
      })
      .catch(() => {
        if (id === request.current) setError(true);
      });
  }, [threadId]);

  // A different conversation starts from nothing, not from the last one's list.
  useEffect(() => {
    loadedOnce.current = false;
    setFiles(null);
    setError(false);
  }, [threadId]);

  // Live: refetch shortly after the transcript changes in a way that can add
  // a file (a message, a tool settling, an attachment), so files appear
  // while the chat runs without a request per streamed token.
  const signature = useMemo(() => filesSignature(bot.messages), [bot.messages]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), loadedOnce.current ? REFRESH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [load, signature]);
  useEffect(() => () => { request.current++; }, []);

  // A jump to a message older than the loaded page pulls earlier pages in
  // until the message is there; ChatView then scrolls to it and flashes it.
  useEffect(() => {
    if (!pendingJump) return;
    if (bot.messages.some((message) => message.id === pendingJump) || !bot.hasMore) {
      setPendingJump(null);
      return;
    }
    if (!state.loadingOlder[threadId]) dispatch({ type: "loadOlderMessages", threadId });
  }, [pendingJump, bot.messages, bot.hasMore, state.loadingOlder, threadId, dispatch]);

  const jump = (file: ThreadFile) => {
    dispatch({ type: "focusMessage", threadId, messageId: file.messageId });
    if (!bot.messages.some((message) => message.id === file.messageId)) setPendingJump(file.messageId);
    // Below the desktop breakpoint this panel covers the chat.
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      dispatch({ type: "toggleSettings", open: false });
    }
  };

  const patch = useCallback((id: string, change: Partial<ThreadFile>) => {
    setFiles((current) => current && current.map((file) => file.id === id ? { ...file, ...change } : file));
  }, []);

  return { threadId, files, error, reload: () => void load(), jump, patch };
}

/** The open conversation's files, with filters, search and sort. */
export function FilesSection({ bot }: { bot: Bot }) {
  const advanced = useAdvancedMode();
  const { threadId, files, error, reload, jump } = useThreadFiles(bot);
  return <FilesBrowser key={threadId} threadId={threadId} files={files} error={error} onRetry={reload} onJump={jump} advanced={advanced} />;
}

/** Filters, search, sort, grid or list, and each file's actions. */
export function FilesBrowser({ threadId, files, error, onRetry, onJump, initialFilter = "all", initialView, advanced = false, openMenus }: {
  threadId: string;
  /** null while the first load is in flight. */
  files: ThreadFile[] | null;
  error: boolean;
  onRetry: () => void;
  onJump: (file: ThreadFile) => void;
  initialFilter?: FileFilter;
  initialView?: "grid" | "list";
  /** Advanced mode: each file's menu also offers Copy path. */
  advanced?: boolean;
  /** Tests: render the Filter menu, or every menu, already open. */
  openMenus?: "filter" | "all";
}) {
  const [filter, setFilter] = useState<FileFilter>(initialFilter);
  const [origin, setOrigin] = useState<FileOrigin>("all");
  const [sort, setSort] = useState<FileSort>("newest");
  const [search, setSearch] = useState("");
  const [pickedView, setPickedView] = useState<"grid" | "list" | null>(() => initialView ?? readView());
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const [media, setMedia] = useState<{ file: ThreadFile; kind: "video" | "audio" } | null>(null);

  useEffect(() => {
    if (!status || status.tone === "error") return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const all = useMemo(() => files ?? [], [files]);
  const counts = useMemo(() => countByFilter(all, { origin, search }), [all, origin, search]);
  // Only kinds that have files get a chip, and the row shows only when there
  // is something to choose between (two kinds or more); the selected chip stays.
  const visibleFilters = useMemo(() => {
    const kinds = FILE_FILTERS.filter((id) => id !== "all" && (counts[id] > 0 || filter === id));
    return kinds.length >= 2 ? (["all", ...kinds] as const satisfies readonly string[]) : [];
  }, [counts, filter]);
  // With no chips on screen the list is never narrowed by a hidden filter.
  const activeFilter: FileFilter = visibleFilters.length > 0 ? filter : "all";
  const shown = useMemo(() => visibleFiles(all, { filter: activeFilter, origin, search, sort }), [all, activeFilter, origin, search, sort]);
  // Grid suits pictures; a chosen view sticks.
  const view = pickedView ?? (filter === "image" || filter === "video" ? "grid" : "list");
  const images = useMemo(() => shown.filter((file) => file.available && classifyFile(file) === "image"), [shown]);
  const previews = useMemo<PreviewImage[]>(() => images.map((file) => ({
    src: threadFileUrl(threadId, file.id, true),
    name: file.name,
    downloadUrl: threadFileUrl(threadId, file.id),
    downloadName: canonicalDownloadFilename({ fallback: file.name, source: file.name, mime: file.mime }),
  })), [images, threadId]);

  const chooseView = (next: "grid" | "list") => {
    setPickedView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* this session only */ }
  };

  const download = (file: ThreadFile) => {
    setStatus(null);
    void downloadThreadFile(threadId, file).catch((reason: unknown) =>
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : t("attach.downloadFailed") }));
  };

  const open = (file: ThreadFile) => {
    if (!file.available) return;
    const kind = classifyFile(file);
    if (kind === "image") {
      const index = images.findIndex((candidate) => candidate.id === file.id);
      if (index >= 0) setImageIndex(index);
      return;
    }
    if (kind === "video" || kind === "audio") {
      setMedia({ file, kind });
      return;
    }
    download(file);
  };

  const copyPath = (path: string) => {
    void copyText(path).then((result) => setStatus(result === "copied"
      ? { tone: "ok", text: t("botPanel.files.copied") }
      : { tone: "error", text: t("attach.saveFailed") }));
  };

  const actionButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40";

  // One "..." per file: Show in chat, Download, and Copy path in Advanced.
  const actions = (file: ThreadFile, className?: string) => {
    const path = advanced && file.available ? copyablePath(file.localPath ?? file.path) : null;
    return (
      <PopoverMenu
        className={className}
        buttonClass={actionButton}
        label={t("botPanel.files.moreAria", { name: file.name })}
        icon={<MoreHorizontal size={14} />}
        menuLabel={file.name}
        defaultOpen={openMenus === "all"}
        data-file-menu={file.id}
      >
        {(close) => (
          <>
            <MenuItem icon={<MessageSquare size={14} />} label={t("botPanel.files.jump")} onClick={() => { close(); onJump(file); }} />
            <MenuItem icon={<Download size={14} />} label={t("attach.download")} ariaLabel={t("botPanel.files.downloadAria", { name: file.name })} disabled={!file.available} onClick={() => { close(); download(file); }} />
            {path && <MenuItem icon={<Copy size={14} />} label={t("botPanel.files.copyPath")} title={path} onClick={() => { close(); copyPath(path); }} />}
          </>
        )}
      </PopoverMenu>
    );
  };

  const emptyText = search.trim()
    ? t("botPanel.files.noMatch", { query: search.trim() })
    : t(`botPanel.files.empty.${activeFilter}`);
  // The filter button says when something narrows or reorders the list.
  const narrowed = activeFilter !== "all" || origin !== "all" || sort !== "newest";

  return (
    <div className="flex flex-col gap-3" data-files-section>
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline-weak bg-elevated px-2.5 py-1.5">
          <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.stopPropagation();
                setSearch("");
              }
            }}
            placeholder={t("botPanel.files.search")}
            aria-label={t("botPanel.files.search")}
            className="w-full min-w-0 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </label>
        {/* One Filter button: type, origin, sort and view in one menu. */}
        <PopoverMenu
          buttonClass={cn("relative flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-hairline-weak px-2.5 text-[12.5px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", narrowed && "text-ink")}
          label={t("botPanel.files.filterButton")}
          icon={<><SlidersHorizontal size={14} aria-hidden="true" /><span>{t("botPanel.files.filterButton")}</span>{narrowed && <span data-files-narrowed className="size-1.5 rounded-full bg-accent" aria-hidden="true" />}</>}
          menuLabel={t("botPanel.files.filterButton")}
          defaultOpen={openMenus === "filter" || openMenus === "all"}
          data-files-filter=""
          wide
        >
          {() => (
            <>
              {visibleFilters.length > 0 && (
                <MenuGroup label={t("botPanel.files.filterAria")}>
                  {visibleFilters.map((id) => (
                    <MenuRadio key={id} checked={filter === id} onClick={() => setFilter(id)} data-files-type={id}>
                      <span className="flex-1">{t(`botPanel.files.filter.${id}`)}</span>
                      <span className="tabular-nums text-ink-tertiary">{counts[id]}</span>
                    </MenuRadio>
                  ))}
                </MenuGroup>
              )}
              <MenuGroup label={t("botPanel.files.originAria")}>
                {(["all", "bot", "you"] as const).map((id) => (
                  <MenuRadio key={id} checked={origin === id} onClick={() => setOrigin(id)} data-files-origin={id}>{t(`botPanel.files.origin.${id}`)}</MenuRadio>
                ))}
              </MenuGroup>
              <MenuGroup label={t("botPanel.files.sortAria")}>
                {(["newest", "name", "size"] as const).map((id) => (
                  <MenuRadio key={id} checked={sort === id} onClick={() => setSort(id)} data-files-sort={id}>{t(`botPanel.files.sort.${id}`)}</MenuRadio>
                ))}
              </MenuGroup>
              <MenuGroup label={t("botPanel.files.viewAria")}>
                {(["list", "grid"] as const).map((mode) => (
                  <MenuRadio key={mode} checked={view === mode} onClick={() => chooseView(mode)} data-files-view-choice={mode}>
                    {mode === "grid" ? <LayoutGrid size={14} aria-hidden="true" /> : <List size={14} aria-hidden="true" />}
                    {t(mode === "grid" ? "botPanel.files.viewGrid" : "botPanel.files.viewList")}
                  </MenuRadio>
                ))}
              </MenuGroup>
            </>
          )}
        </PopoverMenu>
      </div>

      <p className="sr-only" aria-live="polite">{files ? t("botPanel.files.count", { count: shown.length }) : ""}</p>
      {status && (
        <p role={status.tone === "error" ? "alert" : "status"} className={cn("flex items-center gap-1.5 text-[12px]", status.tone === "error" ? "text-danger" : "text-success")}>
          {status.tone === "ok" && <Check size={13} aria-hidden="true" />} {status.text}
        </p>
      )}

      {files === null && !error ? (
        <div role="status" className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-secondary">
          <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("botPanel.files.loading")}
        </div>
      ) : files === null && error ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-[13px] text-ink-secondary">
          <span role="alert">{t("botPanel.files.error")}</span>
          <button type="button" onClick={onRetry} className="flex items-center gap-1.5 rounded-md border border-hairline-weak px-2.5 py-1 text-[12px] text-ink hover:bg-hover">
            <RotateCcw size={12} /> {t("chat.retry")}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-ink-secondary">
          <FolderOpen size={20} aria-hidden="true" />
          <span className="text-[13px]">{emptyText}</span>
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2" data-files-view="grid">
          {shown.map((file) => {
            const kind = classifyFile(file);
            return (
              <li key={file.id} className={cn("group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-hairline-weak", !file.available && "opacity-60")}>
                <FileHover threadId={threadId} file={file}>{(anchor) => <button
                  type="button"
                  {...(anchor ?? {})}
                  onClick={(event) => { anchor?.onClick(event); if (!event.defaultPrevented) open(file); }}
                  disabled={!file.available}
                  aria-label={t("botPanel.files.openAria", { name: file.name })}
                  title={file.available ? undefined : t("botPanel.files.unavailableHint")}
                  className="block aspect-square w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:cursor-default"
                >
                  <Thumbnail threadId={threadId} file={file} kind={kind} className="size-full" iconSize={24} />
                </button>}</FileHover>
                <div className="min-w-0 px-2 py-1.5">
                  <div className="truncate text-[12px] text-ink" title={file.name}>{file.name}</div>
                  <div className="truncate text-[10.5px] text-ink-secondary">
                    {file.available ? (file.size === null ? t(`botPanel.files.source.${file.source}`) : formatSize(file.size)) : t("botPanel.files.unavailable")}
                  </div>
                </div>
                {actions(file, "absolute right-1 top-1 rounded-lg bg-panel/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 touch:opacity-100 motion-reduce:transition-none")}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="flex flex-col" data-files-view="list">
          {shown.map((file) => {
            const kind = classifyFile(file);
            return (
              <li key={file.id} className="flex min-w-0 items-center gap-2.5 border-b border-hairline-weak py-2 last:border-b-0">
                <FileHover threadId={threadId} file={file}>{(anchor) => <button
                  type="button"
                  {...(anchor ?? {})}
                  onClick={(event) => { anchor?.onClick(event); if (!event.defaultPrevented) open(file); }}
                  disabled={!file.available}
                  aria-label={t("botPanel.files.openAria", { name: file.name })}
                  title={file.available ? undefined : t("botPanel.files.unavailableHint")}
                  className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default", !file.available && "opacity-60")}
                >
                  <Thumbnail threadId={threadId} file={file} kind={kind} className="size-10 shrink-0 rounded-lg" iconSize={17} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] text-ink">{file.name}</span>
                    <span className="truncate text-[11px] text-ink-secondary">
                      {file.available ? meta(file) : `${t("botPanel.files.unavailable")} · ${formatWhen(file.at)}`}
                    </span>
                  </span>
                </button>}</FileHover>
                {actions(file)}
              </li>
            );
          })}
        </ul>
      )}

      {imageIndex !== null && previews[imageIndex] && (
        <AttachmentPreviewDialog image={previews[imageIndex]} images={previews} initialIndex={imageIndex} onClose={() => setImageIndex(null)} />
      )}
      {media && <MediaPreviewDialog threadId={threadId} file={media.file} kind={media.kind} onClose={() => setMedia(null)} />}
    </div>
  );
}

/** A button that opens a small menu under it; a click outside or Escape
 * closes it. The menu's items get `close` to shut it after acting. */
export function PopoverMenu({ label, icon, buttonClass, menuLabel, children, className, defaultOpen = false, wide = false, ...data }: {
  label: string;
  icon: React.ReactNode;
  buttonClass: string;
  menuLabel: string;
  children: (close: () => void) => React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  wide?: boolean;
} & Record<`data-${string}`, string>) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !menuElRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className={cn("relative", className)} {...data}>
      <button ref={buttonRef} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={buttonClass}>
        {icon}
      </button>
      {open && (
        <AnchoredPopover anchorRef={buttonRef} popoverRef={menuElRef} role="menu" aria-label={menuLabel} align="end" className={cn("flex flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px] shadow-lg popover-surface", wide ? "w-[220px]" : "w-[200px]")}>
          {children(close)}
        </AnchoredPopover>
      )}
    </div>
  );
}

export function MenuItem({ icon, label, ariaLabel, title, disabled, onClick }: { icon: React.ReactNode; label: string; ariaLabel?: string; title?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} aria-label={ariaLabel} title={title} onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40">
      <span className="shrink-0 text-ink-secondary">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5 border-b border-hairline-weak pb-1 last:border-b-0 last:pb-0">
      <div className="px-2 pt-1 text-[11.5px] leading-4 text-ink-tertiary">{label}</div>
      {children}
    </div>
  );
}

function MenuRadio({ checked, onClick, children, ...data }: { checked: boolean; onClick: () => void; children: React.ReactNode } & Record<`data-${string}`, string>) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-hover" {...data}>
      <Check size={13} aria-hidden="true" className={cn("shrink-0", checked ? "text-ink" : "invisible")} />
      {children}
    </button>
  );
}
