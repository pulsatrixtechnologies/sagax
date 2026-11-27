// Pinned published pages, one click from the chat top bar: named chips while
// the bar has room, otherwise one menu listing them. Distinct from Library pin.
import { AppWindow } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openPage, useOpenPage } from "@/lib/open-page";
import { useWebPanels } from "@/lib/web-panel-preferences";
import type { WebPanel } from "@/lib/web-panels";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

/** A page named in the bar: same height as a round control, room to read the name. */
const PAGE_CHIP =
  "flex h-9 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-full border border-circle-ring bg-circle px-2.5 text-[12.5px] font-medium text-circle-glyph transition-colors hover:bg-circle-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** Whether every pinned page's name fits in the free left side of the chat bar.
 * `pagesLeft` is where the names start inside the bar, `pagesWidth` what they need. */
export function pagesFitInBar(
  barWidth: number,
  reservedCenter: number,
  reservedRight: number,
  pagesLeft: number,
  pagesWidth: number,
): boolean {
  if (!(barWidth > 0) || !(pagesWidth > 0)) return false;
  const free = Math.max(0, barWidth - reservedCenter - reservedRight - pagesLeft);
  // 8 px keeps a name from touching the title pill.
  return pagesWidth <= free - 8;
}

/** The pinned pages in the chat header: chips while they fit, else a menu. */
export function ChatPinnedPages() {
  const panels = useWebPanels();
  const open = useOpenPage();
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(false);

  useLayoutEffect(() => {
    if (!panels.length) return;
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;
    const decide = () => {
      const bar = wrap.closest("[data-chat-header-bar]") as HTMLElement | null;
      if (!bar) return setRoomy(false);
      const barBox = bar.getBoundingClientRect();
      const center = bar.querySelector<HTMLElement>("[data-chat-header-center]");
      const controls = bar.querySelector<HTMLElement>("[data-chathead-controls]");
      const centerWidth = center?.getBoundingClientRect().width ?? 0;
      const rightWidth = controls?.getBoundingClientRect().width ?? 0;
      const left = wrap.getBoundingClientRect().left - barBox.left;
      const needed = measure.getBoundingClientRect().width;
      setRoomy(pagesFitInBar(barBox.width, centerWidth, rightWidth, left, needed));
    };
    decide();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(decide);
    const bar = wrap.closest("[data-chat-header-bar]");
    if (bar) observer.observe(bar);
    const center = bar?.querySelector("[data-chat-header-center]");
    if (center) observer.observe(center);
    const controls = bar?.querySelector("[data-chathead-controls]");
    if (controls) observer.observe(controls);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [panels]);

  if (!panels.length) return null;

  const activeId = open?.pageId;
  const openPanel = (panel: WebPanel) => {
    void openPage({
      pageId: panel.page.pageId,
      botId: panel.page.botId,
      threadId: panel.page.threadId,
      title: panel.name,
    });
  };
  const items: SidebarMenuItem[] = panels.map((panel) => ({
    key: panel.id,
    label: panel.name,
    icon: <AppWindow size={16} aria-hidden="true" />,
    active: panel.page.pageId === activeId,
    onSelect: () => openPanel(panel),
  }));

  return (
    <div ref={wrapRef} data-chat-pinned-pages className="relative flex min-w-0 items-center gap-1">
      {roomy ? (
        panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            data-chat-pinned-page={panel.id}
            aria-label={panel.name}
            title={panel.name}
            aria-pressed={panel.page.pageId === activeId}
            onClick={() => openPanel(panel)}
            className={cn(PAGE_CHIP, panel.page.pageId === activeId && "text-accent")}
          >
            <AppWindow size={14} aria-hidden="true" />
            <span className="min-w-0 truncate">{panel.name}</span>
          </button>
        ))
      ) : (
        <SidebarPopoverMenu
          items={items}
          ariaLabel={t("chat.pinnedPages.label")}
          placement="below"
          renderTrigger={() => (
            <span
              data-chat-pinned-pages-menu
              title={t("chat.pinnedPages.label")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-circle-ring bg-circle text-circle-glyph transition-colors hover:bg-circle-hover"
            >
              <AppWindow size={16} aria-hidden="true" />
            </span>
          )}
        />
      )}
      <MeasureRow refEl={measureRef} panels={panels} />
    </div>
  );
}

/** The names at their natural width, invisible and out of the bar's layout. */
function MeasureRow({
  refEl,
  panels,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  panels: WebPanel[];
}): ReactNode {
  return (
    <div
      ref={refEl}
      aria-hidden="true"
      data-chat-pinned-pages-measure
      className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap"
    >
      {panels.map((panel) => (
        <span key={panel.id} className={PAGE_CHIP}>
          <AppWindow size={14} aria-hidden="true" />
          <span>{panel.name}</span>
        </span>
      ))}
    </div>
  );
}
