// The composer's mode rows (#4900, back by #5088, owner decision 2026-11-19,
// M-20261119-077): Auto, Fast, Expert, Heavy, then Manual, at the top of the
// one model menu (ModelPanel.tsx), drawn as its rows. A hovered or focused row
// opens a small tooltip beside the menu: what the mode does, then which model
// backs it ("Quick responses · Grok 4.7"). The models are not the person's to
// pick here: Sagax maps each mode to the best ones they can use
// (server/models/model-mode.ts). Manual is the person's own pinned model: its
// row opens every model (the panel's Manual list), and while a pinned model
// runs it is the checked row and names it.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Brain, Check, ChevronRight, Layers, SlidersHorizontal, Sparkles, Zap, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { modeBlurb, modeModelsLine, modeName, modeTooltip, offeredModes, type ModelMode } from "@/lib/model-mode";
import type { ModeResolution } from "../../shared/model-mode";
import { MENU_BOX } from "./menu-look";
import { POPOVER_LAYER } from "./AnchoredPopover";

const TIP_GAP = 6;
const TIP_WIDTH = 340;
// the panel's own row slots (ModelPanel.tsx ROW_SIDE_SLOT, ROW_ICON_SLOT), kept in step by its test
const SIDE_SLOT = "flex w-5 shrink-0 items-center justify-center";
const ICON_SLOT = "flex size-7 shrink-0 items-center justify-center";

/** A focus the keyboard made (the tooltip follows it). One a click made, or the menu's own
 * opening after a click, stays quiet: src/lib/input-modality.ts marks it before this runs. */
function keyboardFocus(element: HTMLElement): boolean {
  return !("pointerFocus" in element.dataset);
}

export const MODE_GLYPHS: Record<ModelMode | "manual", LucideIcon> = { auto: Sparkles, fast: Zap, expert: Brain, heavy: Layers, manual: SlidersHorizontal };

export interface ModeMenuProps {
  /** The mode in use; null while the person's own pinned model runs (Manual). */
  current: ModelMode | null;
  /** What each mode runs for this person (GET /api/bots/:id/auto-model); absent while loading. */
  resolutions?: Record<ModelMode, ModeResolution>;
  disabled?: boolean;
  onPick: (mode: ModelMode) => void;
  /** Manual: opens every model. `label` is the pinned model while it runs. */
  manual?: { label?: string; onOpen: () => void };
  /** What sits under the Auto row while Auto is on (its Optimize choice). */
  autoSetting?: ReactNode;
}

export function ModeMenu({ current, resolutions, disabled = false, onPick, manual, autoSetting }: ModeMenuProps) {
  const modes = offeredModes(resolutions);
  const [tipFor, setTipFor] = useState<ModelMode | null>(null);
  const [tipAt, setTipAt] = useState<{ side: "right" | "left"; x: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  // the focus lands on the row in use
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-mode-row][aria-checked="true"]')?.focus({ preventScroll: true });
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
    const right = width - boxRect.right >= TIP_WIDTH + TIP_GAP + 8;
    setTipAt(right ? { side: "right", x: boxRect.right + TIP_GAP, top: rowRect.top } : { side: "left", x: width - boxRect.left + TIP_GAP, top: rowRect.top });
  }, [tipFor]);

  const tipModels = tipFor ? modeModelsLine(tipFor, resolutions?.[tipFor]) : null;
  const rowShape = "group flex h-9 items-center gap-1 rounded-lg hover:bg-popover-hover focus-within:bg-popover-hover";
  const buttonShape = "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-2 text-left text-[13px] text-popover-ink outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";
  const glyph = (Glyph: LucideIcon, on: boolean) => (
    <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center", on ? "text-popover-ink" : "text-popover-ink-secondary")}>
      <Glyph size={15} strokeWidth={1.75} />
    </span>
  );
  const ManualGlyph = MODE_GLYPHS.manual;
  return (
    <div ref={rootRef} data-mode-menu="" className="contents">
      {modes.map((mode) => {
        const Glyph = MODE_GLYPHS[mode];
        const on = current === mode;
        return (
          <div key={mode}>
            <div className={rowShape}>
              <button type="button" role="radio" aria-checked={on} disabled={disabled}
                data-mode-row={mode} data-model-panel-row={`mode:${mode}`} data-mode-current={on ? "" : undefined}
                aria-describedby={tipFor === mode ? tipId : undefined}
                aria-label={`${modeName(mode)}. ${modeTooltip(mode, resolutions?.[mode])}`}
                tabIndex={on || (current === null && mode === modes[0]) ? 0 : -1}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={() => setTipFor(mode)}
                onPointerLeave={() => setTipFor((open) => (open === mode ? null : open))}
                onFocus={(event) => { if (keyboardFocus(event.currentTarget)) setTipFor(mode); }}
                onBlur={() => setTipFor((open) => (open === mode ? null : open))}
                onClick={() => onPick(mode)}
                className={buttonShape}>
                {glyph(Glyph, on)}
                <span className="min-w-0 flex-1 truncate">{modeName(mode)}</span>
                <span aria-hidden="true" className={SIDE_SLOT} />
                <span aria-hidden="true" className={ICON_SLOT}>{on && <Check size={14} className="text-popover-accent" />}</span>
              </button>
            </div>
            {mode === "auto" && on && autoSetting}
          </div>
        );
      })}
      {manual && (
        <div className={rowShape}>
          <button type="button" role="radio" aria-checked={current === null} disabled={disabled}
            data-mode-row="manual" data-model-panel-row="mode:manual" data-mode-current={current === null ? "" : undefined}
            aria-label={current === null && manual.label ? `${t("model.mode.manual.name")}. ${manual.label}` : t("model.mode.manual.name")}
            title={t("model.mode.manual.blurb")}
            tabIndex={current === null ? 0 : -1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={manual.onOpen}
            className={buttonShape}>
            {glyph(ManualGlyph, current === null)}
            <span className="min-w-0 flex-1 truncate">{t("model.mode.manual.name")}</span>
            {current === null && manual.label && (
              <span data-mode-manual-model="" className="max-w-[55%] shrink-0 truncate pl-1 text-right text-[12px] text-popover-ink-secondary">{manual.label}</span>
            )}
            <span aria-hidden="true" className={SIDE_SLOT}>{current === null && <Check size={14} className="text-popover-accent" />}</span>
            <span aria-hidden="true" className={ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
          </button>
        </div>
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
