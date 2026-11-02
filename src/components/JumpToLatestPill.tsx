// "Jump to latest": one tap back to the end of a transcript read in
// scrollback. Drawn over the transcript above the composer, so it steps
// aside from any chip marked `data-jump-pill-avoid` (the stacked
// "N conversations with ..." chip): beside it when there is room, hidden
// while it would cover it. Shared by bot chats and rooms.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { placeJumpPill, type JumpPillPlace } from "@/lib/jump-pill-place";

export function JumpToLatestPill({
  onClick,
  bottom,
  scrollRef,
}: {
  onClick: () => void;
  /** Distance from the pane's bottom (above the composer). */
  bottom: number;
  /** The transcript scroller whose chips the pill keeps clear of. */
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<JumpPillPlace>({ mode: "center" });

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const pill = ref.current;
      const pane = pill?.offsetParent;
      const scroller = scrollRef.current;
      if (!pill || !(pane instanceof HTMLElement) || !scroller) return;
      const paneBox = pane.getBoundingClientRect();
      const box = pill.getBoundingClientRect();
      const width = pill.offsetWidth || box.width;
      const left = paneBox.left + paneBox.width / 2 - width / 2;
      const view = scroller.getBoundingClientRect();
      const obstacles = [...scroller.querySelectorAll<HTMLElement>("[data-jump-pill-avoid]")]
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.bottom > view.top && rect.top < view.bottom);
      const next = placeJumpPill({
        pane: { left: paneBox.left, right: paneBox.right },
        pill: { left, right: left + width, top: box.top, bottom: box.bottom },
        obstacles,
      });
      setPlace((current) =>
        current.mode === next.mode && (next.mode !== "beside" || (current.mode === "beside" && Math.round(current.left) === Math.round(next.left)))
          ? current
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    const scroller = scrollRef.current;
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const mutations = typeof MutationObserver === "function" && scroller ? new MutationObserver(schedule) : null;
    if (mutations && scroller) mutations.observe(scroller, { childList: true, subtree: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mutations?.disconnect();
    };
  }, [scrollRef, bottom]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={t("chat.jumpToLatestAria")}
      data-jump-pill={place.mode}
      aria-hidden={place.mode === "hidden" || undefined}
      tabIndex={place.mode === "hidden" ? -1 : undefined}
      className={cn(
        "animate-pop-in absolute z-10 flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised px-3 py-1.5 text-[12.5px] text-ink shadow-lg hover:bg-raised-hover",
        place.mode === "beside" ? "" : "left-1/2 -translate-x-1/2",
        place.mode === "hidden" && "invisible",
      )}
      style={{ bottom, ...(place.mode === "beside" ? { left: place.left } : {}) }}
    >
      <ArrowDown size={13} /> {t("chat.jumpToLatest")}
    </button>
  );
}
