// The mascot picker where a bot's look is set (#5369): a panel anchored
// right under the bot's mascot, in the menu family's box, with a small arrow
// that points at the mascot. No window, no backdrop and no preview: the
// mascot above it is the preview. Escape or a press outside closes it; a
// press in one of its own small panels (the skins, the gear, the "+", drawn
// through a portal) is a press inside it.
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { AnchoredPopover } from "@/components/AnchoredPopover";
import { MENU_BOX } from "@/components/menu-look";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { t } from "@/lib/i18n";
import type { MascotPickerProps } from "./MascotPicker";
import "./mascot-picker.css";

// The character registry, its thumbnails and the skins: fetched when the panel first opens.
const MascotPicker = lazy(() => import("./MascotPicker"));

export interface MascotPickerPopoverProps extends MascotPickerProps {
  /** The bot's mascot: the panel hangs under it. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** The bot shows a picture in place of its mascot: the panel says so first, with the way back to the mascot. */
  onUseMascot?: (() => void) | undefined;
}

export function MascotPickerPopover({ anchorRef, onClose, onUseMascot, ...picker }: MascotPickerPopoverProps) {
  const panel = useRef<HTMLElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  // inside: the mascot, the panel, and the panel's own small panels
  const root = useMemo(() => ({
    get current() {
      return {
        contains: (target: unknown) => {
          const node = target as Node | null;
          if (!node) return false;
          if (anchorRef.current?.contains(node) || panel.current?.contains(node)) return true;
          const element = (node as Element).closest ? (node as Element) : node.parentElement;
          return Boolean(element?.closest("[data-mascot-picker-layer]"));
        },
      };
    },
  }), [anchorRef]) as RefObject<{ contains(target: unknown): boolean } | null>;
  usePopoverDismiss(true, root, onClose);

  // the arrow stays under the mascot's centre, wherever the window's edge pushed the panel
  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor || !panel.current || !caret.current) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.current.getBoundingClientRect();
      const x = Math.min(p.width - 28, Math.max(16, a.left + a.width / 2 - p.left - 6));
      caret.current.style.left = `${Math.round(x)}px`;
    };
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  // the panel takes the focus when it opens and gives it back to the mascot
  useEffect(() => {
    const opener = anchorRef.current;
    panel.current?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [anchorRef]);

  return (
    <AnchoredPopover anchorRef={anchorRef} popoverRef={panel} side="bottom" align="start" gap={10} role="dialog" tabIndex={-1} aria-label={t("botProfile.tab.appearance")} data-mascot-picker-popover="" className={`${MENU_BOX} outline-none`}>
      <span ref={caret} className="mp-caret" aria-hidden="true" />
      {onUseMascot && (
        <div className="flex items-center gap-3 px-3 pb-1 pt-3 text-[12.5px] leading-[18px] text-ink-secondary" data-appearance-picture="">
          <span className="min-w-0 flex-1">{t("appearance.pictureInUse")}</span>
          <button type="button" onClick={onUseMascot} className="shrink-0 rounded-full bg-control px-3 py-1.5 text-ink outline-none hover:bg-raised-hover focus-visible:ring-2 focus-visible:ring-accent">
            {t("botPanel.avatar.useMascot")}
          </button>
        </div>
      )}
      <Suspense fallback={<div className="h-[430px] w-[440px] max-w-[calc(100vw-16px)]" />}>
        <MascotPicker {...picker} />
      </Suspense>
    </AnchoredPopover>
  );
}
