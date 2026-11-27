// The composer's mode menu (#4900, #5088; owner 2026-11-26, M-20261126-104,
// M-20261126-103): 280 px wide, at the top of the one model menu
// (ModelPanel.tsx): Auto, Fast, Expert, Heavy, then Custom (the model the
// person picks by hand: its row names it, whole, and opens the model list
// beside the menu), a hairline, then Effort (the level in use, opening the
// levels of the model in use; greyed with the imposed level under a mode that
// sets its own; no level beside it under Auto until the person clicks one,
// D-20261126-017). No "All models" row and no footer: Manage models sits at
// the foot of the list Custom opens. The mockup gives "about 240 px"; the menu
// is 280 px so a model's name reads whole beside "Custom" (an agent's choice).
// A hovered or focused mode opens a small tooltip beside the menu: what the
// mode does, then which model backs it ("Quick responses · Grok 4.7"). The
// models are not the person's to pick here: Sagax maps each mode to the best
// ones they can use (server/models/model-mode.ts). Custom and Effort open
// their level beside the menu (#5338, D-20261125-012), on a click, a rest of
// the pointer or the right arrow; the row says so while its level is open.
// The modes and their order are shared/mode-menu.ts (the same as the Perspicax
// console's); the Custom and Effort rows are the desktop's own.
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Brain, Check, ChevronRight, Gauge, Layers, SlidersHorizontal, Sparkles, Zap, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { modeBlurb, modeModelsLine, modeName, modeTooltip, offeredModes, type ModelMode } from "@/lib/model-mode";
import { isModelMode, type ModeResolution } from "../../shared/model-mode";
import { menuRows, type ReasoningRow } from "../../shared/mode-menu";
import { MENU_BOX } from "./menu-look";
import { POPOVER_LAYER } from "./AnchoredPopover";

const TIP_GAP = 6;
const TIP_WIDTH = 340;
// the panel's own icon slot (ModelPanel.tsx ROW_ICON_SLOT), kept in step by its test: the row's one icon
// (the check of the mode in use, the chevron of Custom and Effort) falls on the same centre on every row
const ICON_SLOT = "flex size-7 shrink-0 items-center justify-center";

/** A focus the keyboard made (the tooltip follows it). One a click made, or the menu's own
 * opening after a click, stays quiet: src/lib/input-modality.ts marks it before this runs. */
function keyboardFocus(element: HTMLElement): boolean {
  return !("pointerFocus" in element.dataset);
}

export const MODE_GLYPHS: Record<ModelMode, LucideIcon> = { auto: Sparkles, fast: Zap, expert: Brain, heavy: Layers };
/** Custom's icon (an agent's choice, the mockup's sliders) and Effort's. */
export const CUSTOM_GLYPH: LucideIcon = SlidersHorizontal;
export const EFFORT_GLYPH: LucideIcon = Gauge;
/** The menu's width (M-20261126-104: about 240 px; 280 so Custom's row names its model whole). */
export const MODE_MENU_WIDTH = 280;
/** The hairline between the groups of the menu and of its levels. */
export const MENU_SEPARATOR = "mx-2 my-1 border-t border-popover-hairline";
/** A name longer than this may be cut in the middle (its start and its end stay). */
const MIDDLE_CUT_FROM = 14;
const MIDDLE_CUT_TAIL = 7;

/** A name that never loses its end: whole while it fits, else cut in the
 * middle ("Claude Sonnet 5 (1M co…ontext)"), the whole name in the row's
 * tooltip. The text read by a screen reader or a test is the whole name. */
export function MiddleCut({ text, className, ...rest }: { text: string; className?: string } & Record<`data-${string}`, string>) {
  const cut = text.length > MIDDLE_CUT_FROM ? text.length - MIDDLE_CUT_TAIL : text.length;
  return (
    <span {...rest} className={cn("flex min-w-0 justify-end whitespace-pre", className)}>
      {/* whitespace-pre on both halves: the space at the cut is drawn */}
      <span className="min-w-0 overflow-hidden text-ellipsis">{text.slice(0, cut)}</span>
      {cut < text.length && <span className="shrink-0">{text.slice(cut)}</span>}
    </span>
  );
}

export interface ModeMenuProps {
  /** The mode in use; null while a model the person pinned in All models runs. */
  current: ModelMode | null;
  /** What each mode runs for this person (GET /api/bots/:id/auto-model); absent while loading. */
  resolutions?: Record<ModelMode, ModeResolution>;
  disabled?: boolean;
  onPick: (mode: ModelMode) => void;
  /** Effort: the row's state (shared/mode-menu.ts reasoningRow), how a
   * level reads, and what opens its levels. Absent: no row. `open`: its
   * levels are on screen beside the menu; `onRest`: the pointer came on the row. */
  effort?: { row: ReasoningRow; label: (level: string | undefined) => string; onOpen: () => void; open?: boolean; onRest?: (event: PointerEvent) => void };
  /** Custom: opens the model list. `label` is the model picked by hand (the
   * one a turn off the modes runs), `title` its whole name (provider,
   * account); `open`: the list is on screen. */
  custom?: { label?: string; title?: string; onOpen: () => void; open?: boolean; onRest?: (event: PointerEvent) => void };
  /** The pointer came on a mode: what is open beside the menu closes. */
  onModeRest?: (event: PointerEvent) => void;
}

export function ModeMenu({ current, resolutions, disabled = false, onPick, effort, custom, onModeRest }: ModeMenuProps) {
  const modes = offeredModes(resolutions);
  // the modes and their order are the shared definition's; Custom and Effort follow them here
  const rows = menuRows({ offered: modes, reasoning: false, all: false });
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
  const pinned = current === null;
  // the value at a row's right takes all the room its name leaves
  const value = "min-w-0 flex-1 text-right text-[12px] text-popover-ink-secondary";
  return (
    <div ref={rootRef} data-mode-menu="" className="contents">
      {rows.map((row) => {
        // the shared rows may name a mode Sagax retired (Build, D-20261126-005): never drawn
        if (row.kind !== "mode" || !isModelMode(row.id)) return null;
        const mode = row.id;
        const on = current === mode;
        return (
          <div key={mode} className={rowShape}>
            <button type="button" role="radio" aria-checked={on} disabled={disabled}
              data-mode-row={mode} data-model-panel-row={`mode:${mode}`} data-mode-current={on ? "" : undefined}
              aria-describedby={tipFor === mode ? tipId : undefined}
              aria-label={`${modeName(mode)}. ${modeTooltip(mode, resolutions?.[mode])}`}
              tabIndex={on || (current === null && !custom && mode === modes[0]) ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={(event) => { setTipFor(mode); onModeRest?.(event); }}
              onPointerLeave={() => setTipFor((open) => (open === mode ? null : open))}
              onFocus={(event) => { if (keyboardFocus(event.currentTarget)) setTipFor(mode); }}
              onBlur={() => setTipFor((open) => (open === mode ? null : open))}
              onClick={() => onPick(mode)}
              className={buttonShape}>
              {glyph(MODE_GLYPHS[mode], on)}
              <span className="min-w-0 flex-1 truncate">{modeName(mode)}</span>
              <span aria-hidden="true" className={ICON_SLOT}>{on && <Check size={14} className="text-popover-accent" />}</span>
            </button>
          </div>
        );
      })}
      {custom && (
        // the row keeps the hook `all` (the cascade it opens was "All models"; the e2e suites read it)
        <div className={cn(rowShape, custom.open && "bg-popover-hover")}>
          <button type="button" role="radio" aria-checked={pinned} aria-haspopup="menu" aria-expanded={Boolean(custom.open)} disabled={disabled}
            data-mode-row="all" data-model-panel-row="mode:all" data-mode-current={pinned ? "" : undefined}
            aria-label={custom.label ? `${t("model.mode.custom.name")}. ${custom.label}` : t("model.mode.custom.name")}
            title={custom.title ?? custom.label ?? undefined}
            tabIndex={pinned ? 0 : -1}
            onMouseDown={(event) => event.preventDefault()}
            onPointerEnter={custom.onRest}
            onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); custom.onOpen(); } }}
            onClick={() => custom.onOpen()}
            className={buttonShape}>
            {glyph(CUSTOM_GLYPH, pinned)}
            <span className="shrink-0">{t("model.mode.custom.name")}</span>
            {/* the model's name keeps every pixel "Custom" leaves; the check and the chevron follow it, never over it */}
            {custom.label ? <MiddleCut data-mode-pinned-model="" text={custom.label} className={value} /> : <span className="min-w-0 flex-1" />}
            {pinned && <Check size={14} aria-hidden="true" data-mode-custom-check="" className="shrink-0 text-popover-accent" />}
            <span aria-hidden="true" className={ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
          </button>
        </div>
      )}
      {effort?.row.shown && (
        <>
          <div role="separator" data-mode-separator="" className={MENU_SEPARATOR} />
          {/* the row keeps the hook `reasoning` (its state is shared/mode-menu.ts reasoningRow) */}
          <div className={cn(rowShape, effort.open && "bg-popover-hover")}>
            <button type="button" aria-haspopup="menu" aria-expanded={Boolean(effort.open)} disabled={effort.row.disabled}
              data-mode-row="reasoning" data-model-panel-row="mode:reasoning" data-mode-reasoning-imposed={effort.row.disabled ? "" : undefined}
              title={effort.row.disabled ? t("model.mode.effort.imposed") : undefined}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={effort.onRest}
              onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); effort.onOpen(); } }}
              onClick={() => effort.onOpen()}
              className={buttonShape}>
              {glyph(EFFORT_GLYPH, false)}
              <span className="shrink-0">{t("model.effort")}</span>
              {/* D-20261126-017: no level beside Effort while Auto decides (the label is empty) */}
              {effort.label(effort.row.value) ? <span data-mode-reasoning-value="" className={cn(value, "truncate")}>{effort.label(effort.row.value)}</span> : <span className="min-w-0 flex-1" />}
              <span aria-hidden="true" className={ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
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
