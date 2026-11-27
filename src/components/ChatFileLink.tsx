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
import { useLocalAbsoluteFileLink, useThreadFileLink, type ThreadFileLink } from "@/lib/thread-file-links";
import { wrapCodeChildren } from "@/lib/code-wrap";
import { copyablePath, downloadThreadFile } from "./bot-settings/FilesSection";
import { HtmlFileDialog, isHtmlFile } from "./HtmlFilePreview";
import { navigateThreadMenu } from "./BotProjects";
import { cn } from "@/lib/cn";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE, useMenuInWindow } from "./menu-look";


function localBridge() {
  const ogb = window.ogb;
  return ogb && !ogb.remoteClient?.active ? ogb : undefined;
}

/** The platform's name for its file manager, shared with the outside-workspace chip. */
export function revealLabel(): string {
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
  useMenuInWindow(menuRef, at);
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
        setAt({ left: event.clientX, top: event.clientY });
      }}
      className={`${code ? "ui-code-chip" : ""} inline cursor-pointer break-words text-start underline decoration-ink-tertiary/60 decoration-dotted underline-offset-[3px] hover:decoration-solid hover:decoration-accent [unicode-bidi:isolate]`}
      dir="ltr"
    >
      <FileText size={12} aria-hidden className="me-1 inline-block align-[-1px] opacity-70" />{children}
    </button>
    {error && <span role="status" className="ms-1 text-[12px] text-danger">{error}</span>}
    {viewer && <HtmlFileDialog path={file.path} name={file.name} message={{ threadId, messageId: file.messageId }} returnFocus={trigger.current} onClose={() => setViewer(false)} />}
    {at && createPortal(<div ref={menuRef} role="menu" aria-label={file.name} style={at} data-file-link-menu=""
      className={cn(MENU_SURFACE, MENU_FIT_ROW, "fixed z-50")}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAt(null); trigger.current?.focus(); }
        else navigateThreadMenu(event);
      }}>
      <button type="button" role="menuitem" onClick={run(open)} className={MENU_ROW}><ExternalLink size={12} />{t("fileLink.open")}</button>
      {local && bridge?.revealInFolder
        ? <button type="button" role="menuitem" onClick={run(reveal)} className={MENU_ROW}><FolderOpen size={12} />{revealLabel()}</button>
        : <button type="button" role="menuitem" onClick={run(download)} className={MENU_ROW}><Download size={12} />{t("fileLink.download")}</button>}
      <button type="button" role="menuitem" onClick={run(() => void copyText(copyable))} className={MENU_ROW}><Copy size={12} />{t("fileLink.copyPath")}</button>
    </div>, document.body)}
  </>;
}

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  return "";
}

/** Inline code in a bot message: a link when it names a file the
 * conversation touched, or an absolute local path the desktop app can open
 * (#5393, spaces included); the usual code chip otherwise. */
export function ChatCodeSpan({ threadId, children }: { threadId?: string; children?: ReactNode }) {
  const text = plainText(children);
  const link = useThreadFileLink(threadId, text);
  const absolute = useLocalAbsoluteFileLink(text);
  if (link) return <ChatFileLink link={link}>{wrapCodeChildren(children)}</ChatFileLink>;
  if (absolute) return <ChatFileLink link={absolute}>{wrapCodeChildren(children)}</ChatFileLink>;
  return <code dir="ltr" className="ui-code-chip break-words [unicode-bidi:isolate]">{wrapCodeChildren(children)}</code>;
}

/** A relative link the bot wrote ([rapport](rapport.html)): a file link when
 * the conversation has that file, else `fallback`. */
export function ChatFileHref({ threadId, href, children, fallback }: { threadId?: string; href: string; children?: ReactNode; fallback: ReactNode }) {
  const link = useThreadFileLink(threadId, href);
  if (link) return <ChatFileLink link={link} code={false}>{children}</ChatFileLink>;
  return <>{fallback}</>;
}
