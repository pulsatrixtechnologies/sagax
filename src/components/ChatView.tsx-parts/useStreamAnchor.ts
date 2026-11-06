import { useEffect } from "react";
import { offscreenAnchorShift } from "@/hooks/use-offscreen-row-anchor";

/** How far above its end a topic may grow and still move the reader with
 * it: a reader whose view starts within this band of the topic's end (the
 * top of the live topic, or a topic's last lines) reads below the growth. */
export const STREAM_ANCHOR_BAND = 120;

/** The earlier topics load and grow above the live one, and the scroller
 * has the browser's scroll anchoring off (the transcript anchors its own
 * prepends): a topic that grows (its first page, an older page, a late
 * answer) while the reader is below it moves scrollTop by the growth, so the
 * rows being read stay still. The reader following the bottom is pinned by
 * bottom-follow already. */
export function useStreamAnchor(
  scrollRef: React.RefObject<HTMLElement | null>,
  wrapperRef: React.RefObject<HTMLElement | null>,
  followRef: React.RefObject<boolean>,
  active: boolean,
) {
  useEffect(() => {
    const scroller = scrollRef.current;
    const wrapper = wrapperRef.current;
    if (!active) return;
    if (!scroller || !wrapper || typeof ResizeObserver === "undefined") return;
    const heights = new WeakMap<Element, number>();
    const resize = new ResizeObserver((entries) => {
      const changes: Array<{ top: number; previousHeight: number; height: number }> = [];
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previousHeight = heights.get(entry.target);
        heights.set(entry.target, height);
        if (previousHeight === undefined || previousHeight === height) continue;
        changes.push({ top: entry.target.getBoundingClientRect().top - origin, previousHeight, height });
      }
      if (!changes.length || followRef.current) return;
      const shift = offscreenAnchorShift(changes, scroller.scrollTop + STREAM_ANCHOR_BAND);
      if (shift) scroller.scrollTop += shift;
    });
    const watch = (node: Node) => {
      if (node instanceof Element && node.matches("[data-stream-segment], [data-stream-earlier]")) resize.observe(node);
    };
    wrapper.childNodes.forEach(watch);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(watch);
        record.removedNodes.forEach((node) => { if (node instanceof Element) resize.unobserve(node); });
      }
    });
    mutations.observe(wrapper, { childList: true });
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [scrollRef, wrapperRef, followRef, active]);
}
