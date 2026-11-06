// A file name in a bot message that names a file the conversation touched
// (#file-links). Click opens it: the default app on this computer in the
// desktop app, the HTML viewer for a page served by another computer, a
// download otherwise. Right click: Open, Show in Finder / Explorer (or
// Download when the file is on another computer), Copy path.
import { useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, ExternalLink, FileText, FolderOpen } from "lucide-react";

import { t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { useThreadFileLink, type ThreadFileLink } from "@/lib/thread-file-links";
import { wrapCodeChildren } from "@/lib/code-wrap";
import { copyablePath, downloadThreadFile } from "./bot-settings/FilesSection";
import { HtmlFileDialog, isHtmlFile } from "./HtmlFilePreview";
import { navigateThreadMenu } from "./BotProjects";

const ITEM_CLASS = "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised";

function localBridge() {
  const ogb = window.ogb;
  return ogb && !ogb.remoteClient?.active ? ogb : undefined;
}

function revealLabel(): string {
  const platform = window.ogb?.platform;
  return t(platform === "darwin" ? "fileLink.showInFinder" : platform === "win32" ? "fileLink.showInExplorer" : "fileLink.showInFolder");
}

export function ChatFileLink({ link, children, code = true }: { link: ThreadFileLink; children: ReactNode; code?: boolean }) {
  const { file, threadId, localPath } = link;
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [viewer, setViewer] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const bridge = localBridge();
  const local = Boolean(localPath && bridge?.openLocalFile);
  const path = localPath ?? file.localPath ?? file.path;
  const copyable = copyablePath(path) ?? (path.startsWith("~") ? path : null) ?? file.path;

  useEffect(() => {
    if (!at) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: Event) => { if (!(event.target instanceof Node && menuRef.current?.contains(event.target))) setAt(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); };
  }, [at]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const download = () => {
    if (!file.available) { setError(t("fileLink.missing")); return; }
    void downloadThreadFile(threadId, file).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t("attach.downloadFailed")));
  };

  const open = () => {
    if (local) {
      void bridge!.openLocalFile!(localPath!).then((result) => {
        if (result !== "opened") setError(t(result === "missing" ? "fileLink.missing" : "fileLink.openFailed"));
      }, () => setError(t("fileLink.openFailed")));
      return;
    }
    if (isHtmlFile(file.name) && file.available) { setViewer(true); return; }
    download();
  };

  const reveal = () => {
    void bridge!.revealInFolder!(localPath!).then((result) => {
      if (result !== "shown") setError(t(result === "missing" ? "fileLink.missing" : "fileLink.openFailed"));
    }, () => setError(t("fileLink.openFailed")));
  };

  const run = (action: () => void) => () => { setAt(null); action(); };
  const label = t("fileLink.openAria", { name: file.name });

  return <>
    <button
      ref={trigger}
      type="button"
      data-file-link=""
      title={copyable}
      aria-label={label}
      aria-haspopup="menu"
      onClick={open}
      onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        setAt({ left: Math.max(8, Math.min(event.clientX, window.innerWidth - 228)), top: Math.max(8, Math.min(event.clientY, window.innerHeight - 130)) });
      }}
      className={`${code ? "ui-code-chip" : ""} inline cursor-pointer break-words text-start underline decoration-ink-tertiary/60 decoration-dotted underline-offset-[3px] hover:decoration-solid hover:decoration-accent [unicode-bidi:isolate]`}
      dir="ltr"
    >
      <FileText size={12} aria-hidden className="me-1 inline-block align-[-1px] opacity-70" />{children}
    </button>
    {error && <span role="status" className="ms-1 text-[12px] text-danger">{error}</span>}
    {viewer && <HtmlFileDialog path={file.path} name={file.name} message={{ threadId, messageId: file.messageId }} returnFocus={trigger.current} onClose={() => setViewer(false)} />}
    {at && createPortal(<div ref={menuRef} role="menu" aria-label={file.name} style={at} data-file-link-menu=""
      className="fixed z-50 w-[220px] rounded-lg border border-hairline/50 bg-card p-1 shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAt(null); trigger.current?.focus(); }
        else navigateThreadMenu(event);
      }}>
      <button type="button" role="menuitem" onClick={run(open)} className={ITEM_CLASS}><ExternalLink size={12} />{t("fileLink.open")}</button>
      {local && bridge?.revealInFolder
        ? <button type="button" role="menuitem" onClick={run(reveal)} className={ITEM_CLASS}><FolderOpen size={12} />{revealLabel()}</button>
        : <button type="button" role="menuitem" onClick={run(download)} className={ITEM_CLASS}><Download size={12} />{t("fileLink.download")}</button>}
      <button type="button" role="menuitem" onClick={run(() => void copyText(copyable))} className={ITEM_CLASS}><Copy size={12} />{t("fileLink.copyPath")}</button>
    </div>, document.body)}
  </>;
}

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  return "";
}

/** Inline code in a bot message: a link when it names a file the
 * conversation touched, the usual code chip otherwise (no dead links). */
export function ChatCodeSpan({ threadId, children }: { threadId?: string; children?: ReactNode }) {
  const link = useThreadFileLink(threadId, plainText(children));
  if (link) return <ChatFileLink link={link}>{wrapCodeChildren(children)}</ChatFileLink>;
  return <code dir="ltr" className="ui-code-chip break-words [unicode-bidi:isolate]">{wrapCodeChildren(children)}</code>;
}

/** A relative link the bot wrote ([rapport](rapport.html)): a file link when
 * the conversation has that file, else `fallback`. */
export function ChatFileHref({ threadId, href, children, fallback }: { threadId?: string; href: string; children?: ReactNode; fallback: ReactNode }) {
  const link = useThreadFileLink(threadId, href);
  if (link) return <ChatFileLink link={link} code={false}>{children}</ChatFileLink>;
  return <>{fallback}</>;
}
