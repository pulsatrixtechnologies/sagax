import { createContext, useContext, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link2, Link2Off, Pin } from "lucide-react";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { threadLinkUrl } from "../../shared/thread-link";
import { navigateThreadMenu } from "./BotProjects";
import { cn } from "@/lib/cn";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE, useMenuInWindow } from "./menu-look";

export const ThreadLinkContext = createContext<{ link?: string; assign: (link: string | null) => void } | null>(null);


export function useThreadLinkMenu(href: string | undefined) {
  const thread = useContext(ThreadLinkContext);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuInWindow(menuRef, at);
  useEffect(() => {
    if (!at) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: Event) => { if (!(event.target instanceof Node && menuRef.current?.contains(event.target))) setAt(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); };
  }, [at]);
  const url = threadLinkUrl(href);
  if (!thread || !url) return { onContextMenu: undefined, menu: null };
  const assigned = thread.link === url;
  const run = (action: () => void) => () => { setAt(null); action(); };
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setAt({ left: event.clientX, top: event.clientY });
    },
    // The thread menu's look (menu-look.tsx): Copy link first, then the thread's own
    // link (2026-10-16), with the arrows moving between them.
    menu: at && createPortal(<div ref={menuRef} role="menu" aria-label={url} style={at} data-thread-link-menu=""
      className={cn(MENU_SURFACE, MENU_FIT_ROW, "fixed z-50")}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAt(null); }
        else navigateThreadMenu(event);
      }}>
      <button type="button" role="menuitem" onClick={run(() => void copyText(url))} className={MENU_ROW}><Link2 size={12} />{t("task.copyLink")}</button>
      <button type="button" role="menuitem" onClick={run(() => thread.assign(assigned ? null : url))} className={MENU_ROW}>
        {assigned ? <Link2Off size={12} /> : <Pin size={12} />}{t(assigned ? "task.unassignLink" : "task.assignLink")}
      </button>
    </div>, document.body),
  };
}
