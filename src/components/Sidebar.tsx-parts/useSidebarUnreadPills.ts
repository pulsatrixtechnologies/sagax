import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import type { AppState } from "@/state/store";
import { offscreenUnread } from "@/lib/bot-unread";
import { scrollMotion } from "@/lib/motion";

/** Unread bots scrolled out of the list: the "more unread" pills. */
export function useSidebarUnreadPills({
  listRef,
  state,
  selecting,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  state: AppState;
  selecting: boolean;
}) {
  const [moreUnread, setMoreUnread] = useState({ above: 0, below: 0 });
  const measureUnread = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const view = list.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-sidebar-bot-row]")).map((row) => {
      const box = row.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, unread: row.hasAttribute("data-sidebar-unread") };
    });
    const { above, below } = offscreenUnread(rows, { top: view.top, bottom: view.bottom });
    setMoreUnread((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
  }, [listRef]);
  const jumpToUnread = (direction: "above" | "below") => {
    const list = listRef.current;
    if (!list) return;
    const view = list.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-sidebar-bot-row][data-sidebar-unread]"));
    const offscreen = rows.filter((row) => {
      const box = row.getBoundingClientRect();
      const middle = (box.top + box.bottom) / 2;
      return direction === "above" ? middle < view.top : middle > view.bottom;
    });
    const target = direction === "above" ? offscreen[offscreen.length - 1] : offscreen[0];
    target?.scrollIntoView({ block: "center", behavior: scrollMotion() });
  };
  // The pills follow the list: bots changing, the window resizing, a row
  // opening or closing. Plain scrolling is measured by the list's onScroll.
  useLayoutEffect(() => {
    measureUnread();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureUnread);
    observer.observe(list);
    for (const child of Array.from(list.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measureUnread, state.bots, state.groups, selecting, listRef]);

  return { moreUnread, measureUnread, jumpToUnread };
}
