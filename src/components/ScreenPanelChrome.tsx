// Shared docked-panel chrome for the screen side panel (#4452) and for
// surfaces that reuse it (artifacts in the same column). One top row for
// every place (M-20261127-181): the place's own part on the left (the
// browser's page tabs, the VM's name), then always the same buttons in the
// same order on the right: Take control, place selector, Mark up, Detach
// (own window), Expand (large takeover), Close. A button never moves when the
// person switches between Browser and VM: Take control, the one button a
// place may lack (a Local VM, a browser not connected yet), sits left of the
// place selector, so the tabs under the pointer and the tools never shift.
//
// Sizes are the app's own (M-20261127-179): the chat header's round control
// (CIRCLE_BUTTON, 36px) and glyph (CIRCLE_ICON, 18px), 8px apart as there,
// on a top row of the frame's shared header height (--app-topbar-height),
// so the panel's circles sit on the chat header's centre line. A narrow bar
// folds labels (ScreenBar), never the order.
import { createElement, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ExternalLink, Hand, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CIRCLE_BUTTON, CIRCLE_ICON, CIRCLE_LABEL_BUTTON } from "@/lib/circle-button";

/** The panel's top row: the chat header's height, 12px gutters, a hairline under it. */
export const SCREEN_PANEL_TOP_ROW = "flex min-h-(--app-topbar-height) shrink-0 items-center gap-2 border-b border-hairline/40 px-3";
/** A docked panel's title (the artifact panel, the VM and remote row). */
export const SCREEN_PANEL_TITLE = "min-w-0 flex-1 truncate text-[13.5px] font-medium leading-5 text-ink";
/** A round control of the panel: the chat header's, dimmed while it cannot act. */
export const SCREEN_PANEL_TOOL = cn(CIRCLE_BUTTON, "disabled:cursor-not-allowed disabled:opacity-40");

// A row that holds more labelled controls than a narrow panel can (the
// address row, the shared top row) is a ScreenBar: it measures itself and
// folds labels, never sizes and never a control, only while its controls do
// not fit: first the place tabs to their icons, then the labelled chips
// (Take control) to their 36px circle. Every label stays in the
// accessible name and the tooltip. The fold is the row's `data-fold`; these
// classes read it (plain literals, so Tailwind's scanner sees them).
export type ScreenBarFold = "none" | "places" | "all";
const FOLDS: readonly ScreenBarFold[] = ["none", "places", "all"];
/** A place tab's label: shown until the place tabs fold. */
export const FOLD_TAB_LABEL = "group-data-[fold=places]/screenbar:sr-only group-data-[fold=all]/screenbar:sr-only";
/** A place tab's icon: shown once the place tabs fold. */
export const FOLD_TAB_ICON = "hidden group-data-[fold=places]/screenbar:block group-data-[fold=all]/screenbar:block";
/** A labelled chip folds to its 36px circle... */
export const FOLD_CHIP = "group-data-[fold=all]/screenbar:w-9 group-data-[fold=all]/screenbar:justify-center group-data-[fold=all]/screenbar:gap-0 group-data-[fold=all]/screenbar:px-0";
/** ...and its label is only read out. */
export const FOLD_CHIP_LABEL = "group-data-[fold=all]/screenbar:sr-only";

/** The fold a row takes: the first, from no fold at all, that `fits`. */
export function chooseFold(fits: (fold: ScreenBarFold) => boolean): ScreenBarFold {
  return FOLDS.find(fits) ?? "all";
}

/**
 * A ScreenBar row (`as` a div or the address form). Its flexible child
 * (`data-screen-bar-flex`: the address field, the place's title) keeps at
 * least `min` px; the row folds while it would not, or while it overflows.
 */
export function ScreenBar({ as = "div", min = 160, className, children, ...rest }: { as?: "div" | "form"; min?: number } & ComponentPropsWithoutRef<"form">) {
  const row = useRef<HTMLElement>(null);
  const [fold, setFold] = useState<ScreenBarFold>("none");
  useLayoutEffect(() => {
    const node = row.current;
    if (!node) return;
    const fits = (level: ScreenBarFold) => {
      node.dataset.fold = level;
      const flexible = node.querySelector<HTMLElement>("[data-screen-bar-flex]");
      return node.scrollWidth <= node.clientWidth + 1 && (!flexible || flexible.getBoundingClientRect().width >= min);
    };
    // Not laid out (a hidden panel, a test without layout): keep the labels.
    const measure = () => { if (node.clientWidth > 0) setFold(chooseFold(fits)); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(node);
    const flexible = node.querySelector<HTMLElement>("[data-screen-bar-flex]");
    if (flexible) observer.observe(flexible);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [min]);
  return createElement(as, { ...rest, ref: row, "data-fold": fold, className: cn("group/screenbar", className) }, children);
}

export type ScreenPanelChromeProps = {
  /** Shown as the close / expand tooltip stem (bot or artifact name). */
  title: string;
  onClose: () => void;
  onDetach?: () => void;
  onExpand?: () => void;
  /** Extra tools before Detach (Mark up). */
  leading?: ReactNode;
  /** Extra tools after Expand, before Close. */
  trailing?: ReactNode;
  className?: string;
};

/** Icon actions every docked screen surface shares. */
export function ScreenPanelChrome({
  title,
  onClose,
  onDetach,
  onExpand,
  leading,
  trailing,
  className,
}: ScreenPanelChromeProps) {
  return (
    <div data-screen-panel-chrome="" className={cn("flex shrink-0 items-center gap-2", className)}>
      {leading}
      {onDetach && (
        <button
          type="button"
          data-screen-panel-detach=""
          onClick={onDetach}
          aria-label={t("screenPanel.detach")}
          title={t("screenPanel.detach")}
          className={SCREEN_PANEL_TOOL}
        >
          <ExternalLink {...CIRCLE_ICON} aria-hidden="true" />
        </button>
      )}
      {onExpand && (
        <button
          type="button"
          data-screen-panel-expand=""
          onClick={onExpand}
          aria-label={t("screenPanel.expand")}
          title={t("screenPanel.expand")}
          className={SCREEN_PANEL_TOOL}
        >
          <Maximize2 {...CIRCLE_ICON} aria-hidden="true" />
        </button>
      )}
      {trailing}
      <button
        type="button"
        data-screen-panel-close=""
        onClick={onClose}
        aria-label={t("screenPanel.close")}
        title={title ? `${t("screenPanel.close")} · ${title}` : t("screenPanel.close")}
        className={SCREEN_PANEL_TOOL}
      >
        <X {...CIRCLE_ICON} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Who drives the place, and the one switch that changes it. */
export type ScreenControlState = {
  /** The person drives the place now. */
  on: boolean;
  onChange: (next: boolean) => void;
  /** A take is under way (the browser waits for the bot's step). */
  disabled?: boolean;
  /** The tooltip: who has the place, or what handing it back does. */
  title?: string | undefined;
  /** The place's own test and capture hooks. */
  attributes?: Record<`data-${string}`, string>;
};

/** Take control | You have control: the one switch of the browser, the VM and
 * the remote computer, at the same spot of the bar in every place. The top
 * bar's 36px labelled button (M-20261127-179); a narrow panel folds it to its
 * circle (ScreenBar), so the page tabs keep room. */
export function ControlSwitch({ on, onChange, disabled = false, title, attributes }: ScreenControlState) {
  const label = t(on ? "sandboxDesktop.controlling" : "sandboxDesktop.takeControl");
  return (
    <button
      type="button"
      {...attributes}
      data-screen-control={on ? "driving" : "watching"}
      aria-pressed={on}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        CIRCLE_LABEL_BUTTON,
        FOLD_CHIP,
        "disabled:opacity-50",
        on
          ? "border-accent-border bg-accent/15 text-accent-text hover:bg-accent/25"
          : "border-transparent bg-accent text-accent-ink hover:bg-accent hover:brightness-110",
      )}
    >
      <Hand {...CIRCLE_ICON} className="shrink-0" aria-hidden="true" />
      <span className={cn("max-w-[8rem] truncate", FOLD_CHIP_LABEL)}>{label}</span>
    </button>
  );
}

/** What a place puts in the shared top row. */
export type ScreenPanelBarSlots = {
  /** The place's own part, on the left: the browser's page tabs, the VM's name. */
  leading: ReactNode;
  /** Take control, when the person may take this place. */
  control?: ScreenControlState | null;
};

/** The screen panel's one top row, the same component in every place. */
export function ScreenPanelBar({ leading, control, places, tools }: ScreenPanelBarSlots & {
  /** Browser | VM | Remote computer, when the bot has several places. */
  places?: ReactNode;
  /** Mark up, Detach, Expand, Close (ScreenPanelChrome). */
  tools: ReactNode;
}) {
  return (
    <ScreenBar data-screen-panel-bar="" min={120} className={SCREEN_PANEL_TOP_ROW}>
      <div data-screen-bar-leading="" className="flex min-w-0 flex-1 items-center gap-2">{leading}</div>
      {control && <ControlSwitch {...control} />}
      {places}
      {tools}
    </ScreenBar>
  );
}
