// The composer's mode menu (#4900, #5088; owner 2026-11-23, M-20261123-040,
// M-20261123-045): the rows of shared/mode-menu.ts, the same in the Perspicax
// console, at the top of the one model menu (ModelPanel.tsx): Auto, Fast,
// Expert, Heavy, Build, a hairline, Reasoning (the level in use, opening the
// levels of the model in use; greyed with the imposed level under a mode that
// sets its own), a hairline, All models (opening provider, account, model).
// A hovered or focused mode opens a small tooltip beside the menu: what the
// mode does, then which model backs it ("Quick responses · Grok 4.7"). The
// models are not the person's to pick here: Sagax maps each mode to the best
// ones they can use (server/models/model-mode.ts). A model the person pinned in
// All models checks that row, which names it. Reasoning and All models open
// their level beside the menu (#5338, D-20261125-012), on a click, a rest of
// the pointer or the right arrow; the row says so while its level is open.
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Brain, Check, ChevronRight, Hammer, Layers, Sparkles, Zap, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { modeBlurb, modeModelsLine, modeName, modeTooltip, offeredModes, type ModelMode } from "@/lib/model-mode";
import type { ModeResolution } from "../../shared/model-mode";
import { menuRows, type ReasoningRow } from "../../shared/mode-menu";
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

export const MODE_GLYPHS: Record<ModelMode, LucideIcon> = { auto: Sparkles, fast: Zap, expert: Brain, heavy: Layers, build: Hammer };

export interface ModeMenuProps {
  /** The mode in use; null while a model the person pinned in All models runs. */
  current: ModelMode | null;
  /** What each mode runs for this person (GET /api/bots/:id/auto-model); absent while loading. */
  resolutions?: Record<ModelMode, ModeResolution>;
  disabled?: boolean;
  onPick: (mode: ModelMode) => void;
  /** Reasoning: the row's state (shared/mode-menu.ts reasoningRow), how a
   * level reads, and what opens its levels. Absent: no row. `open`: its
   * levels are on screen beside the menu; `onRest`: the pointer came on the row. */
  reasoning?: { row: ReasoningRow; label: (level: string | undefined) => string; onOpen: () => void; open?: boolean; onRest?: (event: PointerEvent) => void };
  /** All models: opens the cascade. `label` is the pinned model while it runs. */
  allModels?: { label?: string; onOpen: () => void; open?: boolean; onRest?: (event: PointerEvent) => void };
  /** The pointer came on a mode: what is open beside the menu closes. */
  onModeRest?: (event: PointerEvent) => void;
}

export function ModeMenu({ current, resolutions, disabled = false, onPick, reasoning, allModels, onModeRest }: ModeMenuProps) {
  const modes = offeredModes(resolutions);
  const rows = menuRows({ offered: modes, reasoning: Boolean(reasoning?.row.shown), all: Boolean(allModels) });
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
  const separator = (key: string) => <div key={key} role="separator" data-mode-separator="" className="mx-2 my-1 border-t border-popover-hairline" />;
  const pinned = current === null;
  return (
    <div ref={rootRef} data-mode-menu="" className="contents">
      {rows.map((row, index) => {
        if (row.kind === "separator") return separator(`separator-${index}`);
        if (row.kind === "reasoning" && reasoning) {
          const { row: state } = reasoning;
          return (
            <div key="reasoning" className={cn(rowShape, reasoning.open && "bg-popover-hover")}>
              <button type="button" aria-haspopup="menu" aria-expanded={Boolean(reasoning.open)} disabled={disabled || state.disabled}
                data-mode-row="reasoning" data-model-panel-row="mode:reasoning" data-mode-reasoning-imposed={state.disabled ? "" : undefined}
                title={state.disabled ? t("model.mode.reasoning.imposed") : undefined}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={reasoning.onRest}
                onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); reasoning.onOpen(); } }}
                onClick={() => reasoning.onOpen()}
                className={buttonShape}>
                <span className="min-w-0 flex-1 truncate">{t("model.reasoning")}</span>
                <span data-mode-reasoning-value="" className="max-w-[55%] shrink-0 truncate pl-1 text-right text-[12px] text-popover-ink-secondary">{reasoning.label(state.value)}</span>
                <span aria-hidden="true" className={SIDE_SLOT} />
                <span aria-hidden="true" className={ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
              </button>
            </div>
          );
        }
        if (row.kind === "all" && allModels) {
          return (
            <div key="all" className={cn(rowShape, allModels.open && "bg-popover-hover")}>
              <button type="button" role="radio" aria-checked={pinned} aria-haspopup="menu" aria-expanded={Boolean(allModels.open)} disabled={disabled}
                data-mode-row="all" data-model-panel-row="mode:all" data-mode-current={pinned ? "" : undefined}
                aria-label={pinned && allModels.label ? `${t("model.auto.rail")}. ${allModels.label}` : t("model.auto.rail")}
                tabIndex={pinned ? 0 : -1}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={allModels.onRest}
                onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); allModels.onOpen(); } }}
                onClick={() => allModels.onOpen()}
                className={buttonShape}>
                <span className="min-w-0 flex-1 truncate">{t("model.auto.rail")}</span>
                {pinned && allModels.label && (
                  <span data-mode-pinned-model="" className="max-w-[55%] shrink-0 truncate pl-1 text-right text-[12px] text-popover-ink-secondary">{allModels.label}</span>
                )}
                <span aria-hidden="true" className={SIDE_SLOT}>{pinned && <Check size={14} className="text-popover-accent" />}</span>
                <span aria-hidden="true" className={ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
              </button>
            </div>
          );
        }
        if (row.kind !== "mode") return null;
        const mode = row.id;
        const Glyph = MODE_GLYPHS[mode];
        const on = current === mode;
        return (
          <div key={mode}>
            <div className={rowShape}>
              <button type="button" role="radio" aria-checked={on} disabled={disabled}
                data-mode-row={mode} data-model-panel-row={`mode:${mode}`} data-mode-current={on ? "" : undefined}
                aria-describedby={tipFor === mode ? tipId : undefined}
                aria-label={`${modeName(mode)}. ${modeTooltip(mode, resolutions?.[mode])}`}
                tabIndex={on || (current === null && !allModels && mode === modes[0]) ? 0 : -1}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={(event) => { setTipFor(mode); onModeRest?.(event); }}
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
          </div>
        );
      })}
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
