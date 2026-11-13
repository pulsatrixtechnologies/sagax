// The full-window Tools pages of the content frame: Automations
// (RoutineCalendarPage.tsx), Memory, Team map, Remote sessions and
// Achievements draw from these pieces, so they stay sister pages. The header
// is the Team map standard (2026-11-06): icon, 17px title and a grey count,
// a grey subtitle, outlined buttons on the right, the page's own controls in
// a toolbar row under it (PageHeader). Then a
// body in a centred 4xl column with a 16px heading and a 12px line under
// it, sections with a 16px heading, rows that light on hover and a dashed
// empty state. Under 60rem of header the labels of the segment and Filters
// fold to their icons (a tooltip keeps the name).
import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { Check, ChevronRight, Menu, Search, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useDesktopCapabilities } from "./DesktopCapabilities";

/** A header control: a 36px square outlined icon button (Team map standard, 2026-11-06). A labelled control adds w-auto, px-3 and gap-1.5. */
export const PAGE_HEADER_BUTTON = "flex size-9 shrink-0 cursor-pointer list-none items-center justify-center rounded-lg border border-hairline/50 bg-panel text-ink-secondary transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden";
/** The header's primary action ("+ Add", "+ New"): outlined, never filled, as tall and round as PAGE_HEADER_BUTTON. */
export const PAGE_ACTION_BUTTON = "flex h-9 shrink-0 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-3 text-[12px] font-medium text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-details-marker]:hidden";
/** A popover under a header control (Filters, ☰, New). */
export const PAGE_POPOVER = "absolute right-0 top-full z-40 mt-1.5 flex flex-col rounded-xl border-[0.5px] border-border popover-surface bg-elevated text-[13px] leading-[18px]";
/** An entry of the ☰ menu. */
export const PAGE_MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover";
/** A field's label inside Filters. */
export const PAGE_FIELD_LABEL = "mb-1 block text-[12px] font-medium text-ink-secondary";
/** A select inside Filters. */
export const PAGE_SELECT = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong";
/** A small count on the right of a ☰ entry. */
export const PAGE_MENU_COUNT = "ml-auto rounded-full bg-raised px-1.5 text-[11px] text-ink-secondary";
/** An indicator of the header's right group (a count with its icon). */
export const PAGE_INDICATOR = "flex h-9 items-center gap-1 px-1.5 text-[12px] tabular-nums";
/** Filters' "Clear filters". */
export const PAGE_FILTER_RESET = "self-start rounded-md text-[12px] text-accent hover:underline";
/** The body's scroller and its centred column. */
export const PAGE_SCROLL = "min-h-0 flex-1 overflow-y-auto";
export const PAGE_COLUMN = "mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6";
/** A row of a list: lights on hover. */
export const PAGE_ROW = "flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-hover";
/** Nothing to list. */
export const PAGE_EMPTY = "rounded-xl border border-dashed border-hairline/50 p-6 text-center text-[13px] text-ink-secondary";

/** Dashed empty card. `icon` and `action` are optional; callers can still use PAGE_EMPTY alone. */
export function PageEmpty({ icon: Icon, children, action }: { icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={PAGE_EMPTY}>
      {Icon ? <Icon size={18} className="mx-auto mb-2 text-ink-tertiary" aria-hidden="true" /> : null}
      {children}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

type DataAttributes = { [key: `data-${string}`]: string | undefined };

/** Closes the header's popovers on a press outside them. */
export function useDismissMenus(menus: ReadonlyArray<RefObject<HTMLDetailsElement | null>>): void {
  const latest = useRef(menus);
  latest.current = menus;
  useEffect(() => {
    const close = (event: PointerEvent) => {
      for (const ref of latest.current) {
        const menu = ref.current;
        if (menu?.open && !menu.contains(event.target as Node)) menu.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
}

/** The navy band above the header on a macOS inset window or in a browser
 * (Pulsatrix Light; every other skin ignores it). */
export function PageTopStrip() {
  const { capabilities } = useDesktopCapabilities();
  return capabilities.windowChrome === "mac-inset" || capabilities.host.label === "Browser" ? <div className="content-topbar-strip" /> : null;
}

/**
 * The Tools pages' header (Team map standard, owner 2026-11-06): row one is
 * the icon, the title and a small grey count; row two a one-line grey
 * subtitle; on the right, centred, square outlined icon buttons then the
 * outlined primary action (PAGE_ACTION_BUTTON). The page's own controls
 * (segments, search, Filters, dates) sit in a toolbar row under it. `name`
 * sets the data attributes the page's tests and tours find it by
 * (`data-<name>-header`, `-primary`, `-actions`, `-section`).
 */
export function PageHeader({ name, icon: Icon, title, count, subtitle, section, onRoot, primary, actions, below, topbar = false, inset = false, primaryStyle, actionsStyle, titleProps, ...rest }: {
  name: string;
  icon: LucideIcon;
  title: string;
  /** The small grey count after the title ("9 bots"). */
  count?: ReactNode;
  /** The one grey line under the title. */
  subtitle?: ReactNode;
  /** "› <section>" after the title, when the page shows one of its sections. */
  section?: string | null;
  /** With a section shown, the title is a link back to the page's root. */
  onRoot?: () => void;
  /** The toolbar row under the header: a view switch, the dates, a search, Filters. */
  primary?: ReactNode;
  /** The right group: indicators, icon buttons, the ☰ menu, then the action. */
  actions?: ReactNode;
  /** Errors and notices under the rows. */
  below?: ReactNode;
  /** In the content frame: the frame's top bar (and its drag region). */
  topbar?: boolean;
  /** A standalone window on macOS: clear the traffic lights. */
  inset?: boolean;
  primaryStyle?: CSSProperties;
  actionsStyle?: CSSProperties;
  titleProps?: HTMLAttributes<HTMLDivElement> & DataAttributes;
} & Omit<HTMLAttributes<HTMLElement>, "title"> & DataAttributes) {
  const crumb = Boolean(section && onRoot);
  return (
    <header
      {...rest}
      {...{ [`data-${name}-header`]: "" }}
      data-page-header=""
      className={cn(topbar && "content-topbar", "@container/page-header shrink-0 border-b border-hairline/40 bg-app py-4 pr-6", inset ? "pl-[86px]" : "pl-6 max-sm:pl-12", rest.className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div {...titleProps} data-page-title="" className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon size={18} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            {crumb
              ? <h1 className="min-w-0 text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink"><button type="button" data-page-crumb="" {...{ [`data-${name}-crumb`]: "" }} onClick={onRoot} className="rounded-md text-ink-secondary hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{title}</button></h1>
              : <h1 className="min-w-0 truncate text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink">{title}</h1>}
            {section && <span {...{ [`data-${name}-section`]: "" }} aria-current="page" className="flex min-w-0 items-center gap-1 text-[17px] font-semibold leading-6 text-ink"><ChevronRight size={14} className="text-ink-secondary" aria-hidden="true" /><span className="truncate">{section}</span></span>}
            {count != null && count !== false && <span data-page-count="" className="ml-1 shrink-0 text-[11px] tabular-nums text-ink-secondary">{count}</span>}
          </div>
          {subtitle && <p data-page-subtitle="" className="mt-1 text-[12px] text-ink-secondary">{subtitle}</p>}
        </div>
        <div {...{ [`data-${name}-actions`]: "" }} data-page-actions="" className="ml-auto flex shrink-0 items-center gap-2" style={actionsStyle}>{actions}</div>
      </div>
      {primary && <div {...{ [`data-${name}-primary`]: "" }} data-page-toolbar="" className="mt-3 flex min-w-0 flex-wrap items-center gap-2" style={primaryStyle}>{primary}</div>}
      {below}
    </header>
  );
}

/** An on/off pill of the toolbar row ("Active only"). */
export function PageToggle({ pressed, onClick, children, ...rest }: { pressed: boolean; onClick: () => void; children: ReactNode } & DataAttributes) {
  return (
    <button {...rest} type="button" aria-pressed={pressed} onClick={onClick}
      className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors", pressed ? "border-accent/40 bg-accent/10 text-accent" : "border-hairline/50 bg-panel text-ink-secondary hover:bg-raised hover:text-ink")}>
      {children}
    </button>
  );
}

/** A segmented switch of the header (List or Calendar; All, Unlocked or Locked). */
export function PageSegment<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: LucideIcon; title?: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" className="flex shrink-0 items-center rounded-lg border border-hairline/50 bg-panel p-0.5" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button key={String(option.value)} type="button" aria-pressed={value === option.value} title={option.title ?? option.label} onClick={() => onChange(option.value)}
            className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px]", value === option.value ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink")}>
            {Icon && <Icon size={14} aria-hidden="true" />}
            <span className={cn(Icon && "@max-[60rem]/page-header:sr-only")}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A search field of the header row, as tall as its buttons. */
export function PageSearch({ value, onChange, placeholder, label, compact = false, ...rest }: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  /** the reference's search beside a tab row (#4094, the Vault): 32 px
   * tall, 220 px wide so a French placeholder is read whole; on its own
   * full line under the tabs on a phone */
  compact?: boolean;
} & DataAttributes) {
  return (
    <label className={cn("flex min-w-0 items-center gap-1.5 rounded-full border border-hairline/50 bg-panel px-2.5 text-ink focus-within:ring-2 focus-within:ring-accent/60", compact ? "h-8 shrink-0 grow-0 basis-[220px] max-sm:basis-full" : "h-9 max-w-[260px] flex-1")}>
      <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <input {...rest} type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
    </label>
  );
}

/** Filters: one button with the count of what narrows the page, its fields in a popover. */
export function PageFilters({ name, menuRef, activeCount, children }: {
  name: string;
  menuRef?: RefObject<HTMLDetailsElement | null>;
  activeCount: number;
  children: ReactNode;
}) {
  const label = activeCount > 0 ? t("routineCalendar.filtersActive", { count: activeCount }) : t("routineCalendar.filters");
  return (
    <details ref={menuRef} {...{ [`data-${name}-filters`]: "" }} className="relative">
      <summary role="button" aria-label={label} title={label}
        className={cn(PAGE_HEADER_BUTTON, "text-[12px] font-medium", "@min-[60rem]/page-header:h-9 @min-[60rem]/page-header:w-auto @min-[60rem]/page-header:gap-1.5 @min-[60rem]/page-header:px-3", activeCount > 0 && "h-9 w-auto gap-1.5 border-accent/40 px-3 text-accent")}>
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span className="@max-[60rem]/page-header:sr-only">{t("routineCalendar.filters")}</span>
        {activeCount > 0 && <span {...{ [`data-${name}-filter-count`]: "" }} className="min-w-[18px] rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-[18px] text-white">{activeCount}</span>}
      </summary>
      <div role="group" aria-label={t("routineCalendar.filters")} className={cn(PAGE_POPOVER, "w-[280px] gap-3 p-3")}>
        {children}
      </div>
    </details>
  );
}

/** The ☰ menu: the page's sections and its less frequent actions. */
export function PageMenu({ name, menuRef, label, title, badge, children }: {
  name: string;
  menuRef?: RefObject<HTMLDetailsElement | null>;
  label: string;
  title?: string;
  /** A small count on the button (paused routines). */
  badge?: number;
  children: ReactNode;
}) {
  return (
    <details ref={menuRef} {...{ [`data-${name}-menu`]: "" }} className="group relative">
      <summary aria-label={label} title={title ?? label} className={cn(PAGE_HEADER_BUTTON, "relative w-9 justify-center")}>
        <Menu size={16} />
        {badge ? <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-[16px] rounded-full border border-app bg-raised px-1 text-center text-[11px] leading-[14px] text-ink-secondary">{badge}</span> : null}
      </summary>
      <div role="menu" className={cn(PAGE_POPOVER, "w-[240px] min-w-[200px] gap-0.5 p-1.5")}>
        {children}
      </div>
    </details>
  );
}

/** An entry of the ☰ menu: its icon, its name, then its count or a check when it is the section shown. */
export function PageMenuItem({ icon: Icon, children, current, trailing, onClick, ...rest }: {
  icon: LucideIcon;
  children: ReactNode;
  /** The section on screen: aria-current and a check (unless `trailing` shows a count). */
  current?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
} & Omit<HTMLAttributes<HTMLButtonElement>, "onClick"> & DataAttributes) {
  return (
    <button {...rest} type="button" role="menuitem" aria-current={current ? "page" : undefined} onClick={onClick} className={PAGE_MENU_ITEM}>
      <Icon size={16} className="text-ink" />{children}
      {trailing ?? (current && <Check size={14} className="ml-auto text-ink-secondary" aria-hidden="true" />)}
    </button>
  );
}

export function PageMenuSeparator() {
  return <div role="separator" className="mx-1 my-1 h-px bg-hairline/50" />;
}

/** The body under the header: the frame's card, a scroller and the centred column. */
export function PageBody({ children, ...rest }: { children: ReactNode } & DataAttributes) {
  return (
    <div className="content-card-body flex min-h-0 flex-1 flex-col">
      <div className={PAGE_SCROLL} {...rest}><div className={PAGE_COLUMN}>{children}</div></div>
    </div>
  );
}

/** The body's heading: 16px, a 12px line under it, and room on the right. */
export function PageHeading({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0"><h2 className="text-[16px] font-semibold text-ink">{title}</h2>{subtitle && <p className="mt-1 text-[12px] text-ink-secondary">{subtitle}</p>}</div>
      {children}
    </div>
  );
}

/** A section of the body: a 16px heading (and its count), then its rows. */
export function PageSection({ title, count, children, ...rest }: { title: string; count?: ReactNode; children: ReactNode } & DataAttributes) {
  return (
    <section {...rest} className="space-y-2" aria-label={title}>
      <h2 className="flex items-baseline gap-2 text-[16px] font-semibold text-ink">{title}{count != null && <span className="text-[12px] font-normal tabular-nums text-ink-secondary">{count}</span>}</h2>
      {children}
    </section>
  );
}
