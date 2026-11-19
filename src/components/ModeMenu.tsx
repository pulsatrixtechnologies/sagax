// The composer's mode menu (#4900, owner decision 2026-11-18: what the
// reference app does). Five rows, no model list: Auto, Fast, Expert, Heavy, Build. A hovered
// or focused row opens a small tooltip beside the menu: what the mode does,
// then which model backs it ("Quick responses · Grok 4.7"). The models are
// not the person's to pick here: Sagax maps each mode to the best ones they
// can use (server/models/model-mode.ts). The full engine list stays one row
// away ("All models", the models window), and a model the person pinned there
// shows as the checked row until they pick a mode again.
//
// The look is the menu family's (menu-look.tsx): 32px rows, 14/20 type, 10px
// corners, the glyph in its 18px slot, the current row at 8% of the ink.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Brain, Check, ChevronRight, Hammer, Layers, Sparkles, Zap } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { modeBlurb, modeModelsLine, modeName, modeTooltip, offeredModes, type ModelMode } from "@/lib/model-mode";
import type { ModeResolution } from "../../shared/model-mode";
import { MENU_BOX, MENU_ROW_SHAPE, MenuDivider, MenuGlyph } from "./menu-look";
import { POPOVER_LAYER } from "./AnchoredPopover";

/** The menu's width: the account menu's floor, the longest mode name never cut. */
export const MODE_MENU_WIDTH = 236;
const TIP_GAP = 6;
const TIP_WIDTH = 340;

/** A focus the keyboard made (the tooltip follows it). One a click made, or the menu's own
 * opening after a click, stays quiet: src/lib/input-modality.ts marks it before this runs. */
function keyboardFocus(element: HTMLElement): boolean {
  return !("pointerFocus" in element.dataset);
}

const GLYPHS: Record<ModelMode, typeof Sparkles> = { auto: Sparkles, fast: Zap, expert: Brain, heavy: Layers, build: Hammer };

export interface ModeMenuProps {
  /** The mode in use; null while the person's own pinned model runs. */
  current: ModelMode | null;
  /** The pinned model's name, drawn as the checked first row while `current` is null. */
  pinnedLabel?: string;
  /** What each mode runs for this person (GET /api/bots/:id/auto-model); absent while loading. */
  resolutions?: Record<ModelMode, ModeResolution>;
  disabled?: boolean;
  onPick: (mode: ModelMode) => void;
  /** The footer row: the models window, where every engine and model stays. */
  manage?: { onManage?: () => void; turnedOff: number };
}

export function ModeMenu({ current, pinnedLabel, resolutions, disabled = false, onPick, manage }: ModeMenuProps) {
  const modes = offeredModes(resolutions);
  const [tipFor, setTipFor] = useState<ModelMode | null>(null);
  const [tipAt, setTipAt] = useState<{ side: "right" | "left"; x: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  // the focus lands on the row in use (the first one when a pinned model runs)
  useEffect(() => {
    const root = rootRef.current;
    (root?.querySelector<HTMLElement>('[data-mode-row][aria-checked="true"]') ?? root?.querySelector<HTMLElement>("[data-mode-row]"))?.focus({ preventScroll: true });
  }, []);

  // the tooltip hangs off the menu's side, level with its row; the left side when the window has no room on the right
  useLayoutEffect(() => {
    if (!tipFor) {
      setTipAt(null);
      return;
    }
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-mode-row="${tipFor}"]`);
    const box = rootRef.current?.closest<HTMLElement>("[data-model-menu]") ?? rootRef.current;
    if (!row || !box) return;
    const rowRect = row.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const width = typeof window === "undefined" ? 1024 : window.innerWidth;
    // the right side when the window has room for the widest tooltip, else the left, close to the menu either way
    const right = width - boxRect.right >= TIP_WIDTH + TIP_GAP + 8;
    setTipAt(right ? { side: "right", x: boxRect.right + TIP_GAP, top: rowRect.top } : { side: "left", x: width - boxRect.left + TIP_GAP, top: rowRect.top });
  }, [tipFor]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-mode-row]:not([disabled])") ?? [])];
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const to = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
      : (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    event.preventDefault();
    event.stopPropagation();
    rows[to]?.focus();
  };

  const tipModels = tipFor ? modeModelsLine(tipFor, resolutions?.[tipFor]) : null;
  return (
    <div ref={rootRef} data-mode-menu="" className="flex min-h-0 flex-col text-ink">
      <div role="menu" aria-label={t("model.mode.menu")} onKeyDown={onKeyDown} className="flex flex-col gap-0.5 p-1.5">
        {current === null && pinnedLabel && (
          <button type="button" role="menuitemradio" aria-checked="true" data-mode-row="pinned" data-mode-pinned=""
            title={t("model.mode.pinnedHint")}
            onClick={manage?.onManage}
            className={cn(MENU_ROW_SHAPE, "bg-menu-active text-ink outline-none")}>
            <MenuGlyph active><Sparkles /></MenuGlyph>
            <span className="min-w-0 flex-1 truncate">{pinnedLabel}</span>
            <Check size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          </button>
        )}
        {modes.map((mode) => {
          const Glyph = GLYPHS[mode];
          const on = current === mode;
          return (
            <button key={mode} type="button" role="menuitemradio" aria-checked={on} disabled={disabled}
              data-mode-row={mode} data-mode-current={on ? "" : undefined}
              aria-describedby={tipFor === mode ? tipId : undefined}
              aria-label={`${modeName(mode)}. ${modeTooltip(mode, resolutions?.[mode])}`}
              tabIndex={on || (current === null && mode === modes[0]) ? 0 : -1}
              onPointerEnter={() => setTipFor(mode)}
              onPointerLeave={() => setTipFor((open) => (open === mode ? null : open))}
              onFocus={(event) => { if (keyboardFocus(event.currentTarget)) setTipFor(mode); }}
              onBlur={() => setTipFor((open) => (open === mode ? null : open))}
              onClick={() => onPick(mode)}
              className={cn(MENU_ROW_SHAPE, "text-ink outline-none hover:bg-menu-hover focus-visible:bg-menu-hover", on && "bg-menu-active")}>
              <MenuGlyph active={on}><Glyph /></MenuGlyph>
              <span className="min-w-0 flex-1 truncate">{modeName(mode)}</span>
              {on && <Check size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
            </button>
          );
        })}
      </div>
      {manage?.onManage && (
        <>
          <MenuDivider />
          <div className="p-1.5 pt-0.5">
            <button type="button" data-mode-manage="" onClick={manage.onManage}
              className={cn(MENU_ROW_SHAPE, "justify-between text-ink-secondary outline-none hover:bg-menu-hover hover:text-ink focus-visible:bg-menu-hover")}>
              <span className="truncate">{t("model.mode.allModels")}</span>
              <span className="flex shrink-0 items-center gap-1">
                {manage.turnedOff > 0 && <span data-model-manage-off="" className="text-[12px]">{t(manage.turnedOff === 1 ? "model.manageOffOne" : "model.manageOff", { count: manage.turnedOff })}</span>}
                <ChevronRight size={14} aria-hidden="true" />
              </span>
            </button>
          </div>
        </>
      )}
      {tipFor && tipAt && typeof document !== "undefined" && createPortal(
        <div id={tipId} role="tooltip" data-mode-tooltip={tipFor}
          style={{ ...(tipAt.side === "right" ? { left: tipAt.x } : { right: tipAt.x }), top: tipAt.top, maxWidth: TIP_WIDTH }}
          className={cn("pointer-events-none fixed w-max px-3 py-1.5 text-[13px] leading-5 text-ink", POPOVER_LAYER, MENU_BOX, "popover-surface")}>
          <span>{modeBlurb(tipFor)}</span>
          {tipModels && <span data-mode-tooltip-models="" className="text-ink-secondary"> · {tipModels}</span>}
        </div>,
        document.body,
      )}
    </div>
  );
}
