import { createContext, Fragment, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, CircleHelp, Copy, ExternalLink, X } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SWITCH_OFF, SWITCH_ON, SWITCH_THUMB_OFF, SWITCH_THUMB_ON } from "@/lib/status-tones";
import { useCopyFeedback } from "@/lib/copy-text";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, enclosingWindowBounds, useAnchoredDismissRoot } from "./AnchoredPopover";

export function Switch({
  checked,
  mixed = false,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children" | "role" | "aria-checked"> & {
  checked: boolean;
  /** Bulk edit: bots differ; neither on nor off (#1701). */
  mixed?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={mixed ? "mixed" : checked}
      className={cn(
        "relative h-5 w-8 shrink-0 cursor-pointer rounded-full transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55 disabled:saturate-50 motion-reduce:transition-none",
        mixed ? "bg-control ring-1 ring-inset ring-hairline" : checked ? SWITCH_ON : SWITCH_OFF,
        className,
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-1/2 size-4 -translate-y-1/2 rounded-full transition-transform motion-reduce:transition-none",
          mixed ? `translate-x-1.5 ${SWITCH_THUMB_OFF}` : checked ? `translate-x-3 ${SWITCH_THUMB_ON}` : `translate-x-0 ${SWITCH_THUMB_OFF}`,
        )}
      />
    </button>
  );
}

/** A standalone on/off setting: label (and optional description) at the left,
 * the Switch at the right. The whole row is a <label>, so a click on the text
 * toggles and Space on the focused switch toggles. */
export function SwitchRow({
  label,
  description,
  help,
  checked,
  disabled,
  onChange,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** The longer explanation, behind an info button after the label. */
  help?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <label data-settings-rowkind="switch" className={cn("flex min-w-0 items-center justify-between gap-4 text-[13px] text-ink", disabled ? "cursor-not-allowed" : "cursor-pointer", className)}>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 leading-[18px]">
          <span className="min-w-0">{label}</span>
          {help && <HelpTip label={t("settings.moreAbout", { title: typeof label === "string" ? label : "" })}>{help}</HelpTip>}
        </span>
        {description && <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-secondary">{description}</span>}
      </span>
      {/* The label wraps the help button too, so without its own name the
          switch would read "X More about X". */}
      <Switch checked={checked} disabled={disabled} onClick={() => onChange(!checked)} aria-label={help && typeof label === "string" ? label : undefined} />
    </label>
  );
}

type CountKey = "servers" | "people" | "devices" | "backups" | "turns" | "computers" | "entries" | "workspaces" | "profiles" | "ready" | "models";

/** "1 person" / "3 people" for a collapsed card's summary, by the active
 * language's plural rule (French says "0 personne"). */
export function cardCount(key: CountKey, count: number): string {
  let one = count === 1;
  try {
    one = new Intl.PluralRules(activeLocale()).select(count) === "one";
  } catch {
    /* an unknown locale keeps the English rule */
  }
  return one ? t(`settings.card.${key}One`, { count }) : t(`settings.card.${key}`, { count });
}

import { useCardOpen, ANONYMOUS_CARD } from "./settings-card-state";
export { loadCardOpen, saveCardOpen, requestSettingsCard, takeRequestedSettingsCard, peekRequestedSettingsCard, resetSettingsCards, useSettingsCardOpen } from "./settings-card-state";

type CardProps = {
  title?: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  collapsible?: boolean;
  cardId?: string;
  defaultOpen?: boolean;
  summary?: React.ReactNode;
};

/** A settings form card. With `collapsible`, the title becomes a disclosure
 * button: collapsed it shows one `summary` line, open it shows the subtitle
 * and the body. The body stays mounted while collapsed so drafts, saves and
 * loads are unaffected. `cardId` keys the remembered state on this device
 * and is the target of `requestSettingsCard`. */
/** How the surfaces of a settings page draw (#2313, the bot's profile):
 * "bordered" is Settings' thin outline over the page's background; "plain"
 * is the profile page's one filled card (rounded, no border, the
 * background of Channels and Bot accounts), every group, card and editor
 * alike, so a page reads as one system. */
export type SettingsSurface = "bordered" | "plain";
const SettingsSurfaceContext = createContext<SettingsSurface>("bordered");
export function SettingsSurfaceProvider({ surface, children }: { surface: SettingsSurface; children: React.ReactNode }) {
  return <SettingsSurfaceContext.Provider value={surface}>{children}</SettingsSurfaceContext.Provider>;
}
export function useSettingsSurface(): SettingsSurface {
  return useContext(SettingsSurfaceContext);
}
/** The plain surface: one filled rounded card, no border. */
export const PLAIN_CARD = "flex flex-col rounded-2xl bg-card py-1";
/** A text field inside a plain card: filled, no outline, a focus ring. */
export const PLAIN_FIELD = "min-h-[44px] w-full min-w-0 rounded-lg bg-inset px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0";

export function Card(props: CardProps) {
  // A plain card stays hook-free; only a collapsible one needs state.
  if (props.collapsible && props.title) return <CollapsibleCard {...props} title={props.title} />;
  return <PlainAwareCard {...props} />;
}

function PlainAwareCard({ title, subtitle, children, cardId }: CardProps) {
  const plain = useSettingsSurface() === "plain";
  return (
    <div data-settings-card={cardId} data-settings-surface="" className={plain ? "rounded-2xl bg-card px-4 py-3" : "rounded-[14px] border-[0.5px] border-border px-3.5 py-3"}>
      {title && (
        <div className="text-[13px] font-normal leading-[18px] text-ink">{title}</div>
      )}
      {subtitle && <div className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{subtitle}</div>}
      {children && <div className={title || subtitle ? "mt-2.5" : undefined}>{children}</div>}
    </div>
  );
}

function CollapsibleCard({ title, subtitle, children, cardId, defaultOpen = true, summary }: CardProps & { title: string }) {
  const bodyId = useId();
  const [open, toggle] = useCardOpen(cardId ?? `${ANONYMOUS_CARD}${bodyId}`, defaultOpen);
  const plain = useSettingsSurface() === "plain";
  return (
    <div data-settings-card={cardId} data-open={open ? "true" : "false"} data-settings-surface="" className={plain ? "rounded-2xl bg-card" : "rounded-[14px] border-[0.5px] border-border"}>
      <h3 className="text-[13px] font-normal leading-[18px]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex w-full min-w-0 items-center gap-3 rounded-[14px] px-3.5 py-3 text-left text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none"
        >
          <span className="min-w-0 truncate">{title}</span>
          {!open && summary ? (
            <span data-card-summary className="ml-auto min-w-0 truncate text-right text-[12.5px] text-ink-secondary">{summary}</span>
          ) : (
            <span className="ml-auto" />
          )}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")}
          />
        </button>
      </h3>
      <div id={bodyId} hidden={!open} className="px-3.5 pb-3">
        {subtitle && <div className="-mt-1 mb-2.5 text-[13px] leading-[18px] text-ink-secondary">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

/** The longer explanation behind a short setting line, on demand: a
 * keyboard-reachable disclosure rather than a hover-only title. */
export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="relative inline-block align-middle">
      <summary
        aria-label={label}
        title={label}
        className="flex size-5 cursor-pointer list-none items-center justify-center rounded-md text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 [&::-webkit-details-marker]:hidden"
      >
        <CircleHelp size={13} aria-hidden="true" />
      </summary>
      <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-hairline popover-surface bg-panel p-3 text-[12px] leading-[17px] text-ink-secondary shadow-xl">
        {children}
      </div>
    </details>
  );
}

/** Simple preferences share an aligned row; forms with several fields keep a Card.
 * `help` keeps the subtitle to one short line and moves the detail behind a HelpTip. */
export function SettingRow({
  title,
  subtitle,
  help,
  children,
  message,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  help?: React.ReactNode;
  children: React.ReactNode;
  message?: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} data-settings-rowkind="setting" className={cn("setting-row px-3.5 py-2.5", className)}>
      <div className="grid min-w-0 grid-cols-1 items-center gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div id={titleId} className="text-[13px] font-normal leading-[18px] text-ink">{title}</div>
            {help && <HelpTip label={t("settings.moreAbout", { title })}>{help}</HelpTip>}
          </div>
          {subtitle && <div className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{subtitle}</div>}
        </div>
        <div className="min-w-0 sm:max-w-[240px]">{children}</div>
      </div>
      {message && <div className="mt-2 text-[12px]">{message}</div>}
    </div>
  );
}

/** A command the user is meant to run, with one-click copy. */
export function CommandLine({ command, copyLabel = "Copy command" }: { command: string; copyLabel?: string }) {
  // The command stays select-all when clipboard permission is denied.
  const { state, copy } = useCopyFeedback(command);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2">
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={state === "failed" ? t("common.copyFailed") : copyLabel}
        className="ui-icon-button shrink-0"
      >
        {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

type AdvancedFold = {
  /** Where the folded cards are drawn (the fold's body), once it is mounted. */
  target: HTMLElement | null;
  register: (title: string) => () => void;
};

/** Set by SettingsAdvancedScope while Simple mode folds a page's `advanced`
 * cards under "Advanced" (#2080). Without it the cards draw in place. */
const AdvancedFoldContext = createContext<AdvancedFold | null>(null);

/** A titled group of settings, as the reference design's settings pages draw them: a
 * grey heading outside the card (Account, Appearance, System), then one
 * rounded card of compact rows. An empty group draws nothing. */
export function SettingsGroup({
  title,
  groupId,
  accessory,
  plain,
  advanced,
  children,
}: {
  /** The grey heading; a group without one is its card alone. */
  title?: string;
  /** `data-settings-group`, for tests and deep links */
  groupId: string;
  /** Shown after the heading, as the reference design's "Your computer · <name>". */
  accessory?: React.ReactNode;
  /** The children are cards of their own (forms with several fields): the
   * heading only, no card around them. */
  plain?: boolean;
  /** A technical card: in Simple mode it moves into the page's "Advanced"
   * fold (SettingsAdvancedScope) instead of being hidden (#2080). */
  advanced?: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  const fold = useContext(AdvancedFoldContext);
  const surface = useSettingsSurface();
  const folded = Boolean(advanced && fold);
  const register = fold?.register;
  const foldTitle = title ?? groupId;
  useLayoutEffect(() => (folded && register ? register(foldTitle) : undefined), [folded, register, foldTitle]);
  const card = surface === "plain" ? `${PLAIN_CARD} empty:hidden` : "flex flex-col rounded-xl border-[0.5px] border-border bg-elevated py-1.5 empty:hidden";
  const section = (
    <section aria-labelledby={title ? headingId : undefined} data-settings-group={groupId} data-settings-advanced={advanced ? "" : undefined} className="flex flex-col gap-2 has-[>div:empty]:hidden">
      {(title || accessory) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-1">
          {title && <h3 id={headingId} className="shrink-0 text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>}
          {accessory}
        </div>
      )}
      <div data-settings-surface={plain ? undefined : ""} className={plain ? "flex flex-col gap-2 empty:hidden" : card}>{children}</div>
    </section>
  );
  if (!folded) return section;
  return fold?.target ? createPortal(section, fold.target) : null;
}

/** A page's "Advanced" fold (#2080). In Simple mode (`fold`), every
 * `SettingsGroup advanced` inside moves into one fold at the bottom of the
 * page: a row whose grey line names what it holds and whose count pill opens
 * it, remembered per page. A search opens it. In Advanced mode, or with no
 * such card, it draws its children alone. */
export function SettingsAdvancedScope({ pageId, fold, searching, children }: {
  pageId: string;
  fold: boolean;
  /** A search is on: the folded cards show, so a match can be found. */
  searching?: boolean;
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [titles, setTitles] = useState<Array<{ key: number; title: string }>>([]);
  const nextKey = useRef(0);
  const register = useCallback((title: string) => {
    const key = nextKey.current++;
    setTitles((prev) => [...prev, { key, title }]);
    return () => setTitles((prev) => prev.filter((entry) => entry.key !== key));
  }, []);
  const value = useMemo<AdvancedFold>(() => ({ target, register }), [target, register]);
  // not `${pageId}.advanced`: some pages (Providers) already hold a card of that id
  const cardId = `${pageId}.advancedFold`;
  const [chosenOpen, toggle] = useCardOpen(cardId, false);
  const open = chosenOpen || Boolean(searching);
  const bodyId = useId();
  if (!fold) return <>{children}</>;
  return (
    <AdvancedFoldContext.Provider value={value}>
      {children}
      <section data-settings-group="advanced" data-settings-card={cardId} data-open={open ? "true" : "false"} hidden={titles.length === 0} className="flex flex-col gap-2">
        <div className={GROUP_CARD} data-settings-surface="">
          <DescribedRow label={t("settings.advanced.title")} description={titles.map((entry) => entry.title).join(", ")} rowId="advanced">
            <CountPill open={open} onToggle={toggle} label={t("settings.advanced.title")} count={titles.length} controls={bodyId} />
          </DescribedRow>
        </div>
        <div id={bodyId} ref={setTarget} hidden={!open} className="flex flex-col gap-3" />
      </section>
    </AdvancedFoldContext.Provider>
  );
}

/** A page's opening sentence, under its title and level with it (no
 * inset: the grey group headings sit inset over their cards, the title
 * and this line do not). One per page at most. */
export function SettingsIntro({ children }: { children: React.ReactNode }) {
  return <p data-settings-intro="" className="pb-1 text-[13px] leading-[18px] text-ink-secondary">{children}</p>;
}

const NOTICE_TONE = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  neutral: "text-ink-secondary",
} as const;

/** A page's message (an error, a warning, a done): a card of its own,
 * one row, the words at the left and at most one action at the right, as
 * the rows of the groups. Errors and warnings are announced. */
export function SettingsNotice({ tone = "neutral", children, action }: {
  tone?: keyof typeof NOTICE_TONE;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      data-settings-notice={tone}
      className={cn(GROUP_CARD, "flex-row flex-wrap items-center justify-between gap-x-5 gap-y-2 px-3.5 py-2.5")}
    >
      <p className={cn("min-w-0 flex-1 basis-[240px] text-[13px] leading-[18px]", NOTICE_TONE[tone])}>{children}</p>
      {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A line of explanation inside a group's card, with a row's insets (the
 * sentence that heads a list of switches). */
export function SettingsTextRow({ tone = "neutral", live, children }: { tone?: keyof typeof NOTICE_TONE; /** announce it (a state that changes) */ live?: boolean; children: React.ReactNode }) {
  return (
    <p role={tone === "warning" || tone === "danger" ? "alert" : live ? "status" : undefined} className={cn("px-3.5 py-2.5 text-[12px] leading-4", NOTICE_TONE[tone])}>
      {children}
    </p>
  );
}

/** The reference design's count pill ("2 ⌄"): how many items a row holds, and the
 * button that unfolds them under the row. */
export function CountPill({ count, open, onToggle, label, controls }: {
  /** Without a count the pill shows the chevron alone. */
  count?: number;
  open: boolean;
  onToggle: () => void;
  label: string;
  /** The id of what it unfolds. */
  controls?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      onClick={onToggle}
      data-count-pill=""
      className="inline-flex h-7 min-h-[44px] items-center gap-1 rounded-full px-2.5 text-[13px] text-ink tabular-nums transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 aria-expanded:bg-hover motion-reduce:transition-none md:min-h-0"
    >
      {count}
      <ChevronDown size={13} aria-hidden="true" className={cn("text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")} />
    </button>
  );
}

/** A part of a row that opens on demand (#2080): a grey label with the
 * chevron of a CountPill, never a raw `<details>` triangle. The body stays
 * mounted while folded, as a `<details>` body did. */
export function InlineFold({ label, defaultOpen = false, className, children }: {
  label: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div data-inline-fold={open ? "open" : "closed"} className={cn("min-w-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-md text-[12px] font-medium text-ink-secondary outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none md:min-h-[28px]"
      >
        {label}
        <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div id={bodyId} hidden={!open} className="mt-1">{children}</div>
    </div>
  );
}

/** A small number field with its unit ("5 min"), for a row's right side.
 * It saves on blur and on Enter, as the forms it replaces did. */
export function UnitField({
  id,
  value,
  unit,
  label,
  min,
  max,
  step = 1,
  decimal,
  disabled,
  invalid,
  describedBy,
  onChange,
  onCommit,
}: {
  id?: string;
  value: string;
  unit: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  decimal?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  // In a plain card (bot profile) the field is a filled well, no outline;
  // focus and the invalid state show as a ring instead of a border.
  const plain = useSettingsSurface() === "plain";
  return (
    <span
      data-unit-field=""
      className={cn(
        "inline-flex h-7 min-h-[44px] items-center gap-1 rounded-lg bg-inset pl-2 pr-2.5 md:min-h-0",
        plain
          ? invalid ? "ring-1 ring-danger/60" : "focus-within:ring-1 focus-within:ring-focus"
          : invalid ? "border-[0.5px] border-danger/60" : "border-[0.5px] border-border focus-within:border-focus",
        disabled && "opacity-50",
      )}
    >
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        inputMode={decimal ? "decimal" : "numeric"}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-14 min-w-0 bg-transparent text-right text-[13px] tabular-nums text-ink focus:outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span aria-hidden="true" className="text-[13px] text-ink-secondary">{unit}</span>
    </span>
  );
}

/** A control that fills a Settings table cell (Settings > Models): the
 * value at the left, the chevron at the cell's right edge. */
export const TABLE_CELL_CONTROL = "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-hover motion-reduce:transition-none";

/** The reference design's grey pill button, 44 px tall on a touch screen. */
export const PILL = "ui-button min-h-[44px] disabled:opacity-50 md:min-h-0";

/** `group` heads a run of options in the open list (a native <optgroup>):
 * a grey line the arrows skip. `disabled` keeps a choice listed but not
 * choosable (an engine that is not ready, a saved value that is gone). */
export type PillOption<T extends string> = { value: T; label: string; group?: string; disabled?: boolean };

/** The reference design's borderless pill menu ("Follow System ⌄"): the current value
 * and a chevron; the choices open in a small list under it. A listbox, so
 * arrows, Home/End, Enter and Escape work as in a native select. */
/** A page's own bottom bar (Cancel / Save) stays uncovered: the menu flips
 * above or shrinks before it reaches the bar (#2320). */
function barFloor(anchor: HTMLElement): number | null {
  const bar = anchor.closest("[data-popover-floor-scope]")?.querySelector("[data-popover-floor]");
  return bar ? bar.getBoundingClientRect().top : null;
}

export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  mixed = false,
  mixedLabel,
  fill = false,
  bordered = false,
}: {
  value: T | undefined;
  options: ReadonlyArray<PillOption<T>>;
  onChange: (next: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Bulk edit: bots differ; no choice looks selected (#1701). */
  mixed?: boolean;
  mixedLabel?: string;
  /** Fill a table cell (Settings > Models): the value at the left, the
   * chevron at the cell's right edge, the same width on every row. */
  fill?: boolean;
  /** The bot panel's Voice chat (#2125): a thin border around a compact pill. */
  bordered?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const current = mixed || value === undefined ? undefined : options.find((option) => option.value === value);
  const close = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };
  // The list is portalled out of rootRef, so a press in it must still count as inside.
  const dismissRoot = useAnchoredDismissRoot(rootRef, listRef);
  usePopoverDismiss(open, dismissRoot, () => close(true));
  const focusOption = (index: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
  };
  const show = () => {
    setOpen(true);
    const selected = Math.max(0, options.findIndex((option) => option.value === value));
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => focusOption(selected));
  };
  const choose = (next: T) => {
    if (options.find((option) => option.value === next)?.disabled) return;
    close(true);
    // Mixed / unset: any pick counts, including one bot's current value.
    if (mixed || value === undefined || next !== value) onChange(next);
  };
  const shown = current?.label ?? (mixed ? (mixedLabel ?? t("bulkEdit.mixed")) : value);
  return (
    <div ref={rootRef} className={fill ? "relative flex w-full min-w-0" : "relative inline-flex justify-end"}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        title={typeof shown === "string" ? shown : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
        data-pill-select=""
        data-pill-mixed={mixed || value === undefined ? "" : undefined}
        className={fill ? TABLE_CELL_CONTROL : cn("inline-flex h-7 max-w-[240px] items-center gap-1 rounded-full px-2.5 text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-hover motion-reduce:transition-none", bordered && "h-6 border border-[var(--bot-panel-pill-border)] px-2")}
      >
        <span className={cn("min-w-0 truncate", fill && "flex-1 text-left", (mixed || value === undefined) && "text-ink-secondary")}>{shown}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      </button>
      {open && (
        <AnchoredPopover
          as="ul"
          anchorRef={triggerRef}
          popoverRef={listRef}
          align={fill ? "start" : "end"}
          maxHeight={280}
          bounds={fill ? enclosingWindowBounds : undefined}
          floor={barFloor}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={(event) => {
            const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "ArrowDown") { event.preventDefault(); focusOption(index + 1); }
            else if (event.key === "ArrowUp") { event.preventDefault(); focusOption(index - 1); }
            else if (event.key === "Home") { event.preventDefault(); focusOption(0); }
            else if (event.key === "End") { event.preventDefault(); focusOption(items.length - 1); }
            else if (event.key === "Tab") close();
            else if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              // Handled here, before the Settings modal's own Escape (a
              // window listener that skips a handled event): close the
              // menu, not Settings.
              event.preventDefault();
              close(true);
            }
          }}
          className="popover-surface flex w-max min-w-[180px] max-w-[min(18rem,calc(100vw-2rem))] flex-col gap-0.5 overflow-y-auto rounded-xl border-[0.5px] border-border bg-elevated p-1.5"
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const heading = option.group && option.group !== options[index - 1]?.group ? option.group : null;
            return (
              <Fragment key={option.value}>
              {heading && (
                <li role="presentation" data-pill-group="" className="px-2 pb-0.5 pt-1.5 text-[11.5px] leading-4 text-ink-secondary first:pt-0.5">{heading}</li>
              )}
              <li
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                tabIndex={-1}
                onClick={() => choose(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option.value);
                  }
                }}
                className="flex min-h-[30px] cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] leading-[18px] text-ink hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:text-ink-secondary"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <Check size={14} aria-hidden="true" className={cn("shrink-0 text-ink-secondary", !selected && "invisible")} />
              </li>
              </Fragment>
            );
          })}
        </AnchoredPopover>
      )}
    </div>
  );
}

/** A compact Grok-style row: the label at the left, the control at the
 * right, no help text. */
export function CompactRow({ label, children, className, rowId, keywords }: { label: string; children: React.ReactNode; className?: string; rowId?: string; keywords?: string }) {
  const labelId = useId();
  // The plain surface (the bot's profile page): the Channels row's type,
  // 14px titles in a 16px gutter.
  const plain = useSettingsSurface() === "plain";
  return (
    <div role="group" aria-labelledby={labelId} data-settings-row={rowId} data-settings-rowkind="compact" data-settings-keywords={keywords} className={cn("flex min-h-[44px] items-center justify-between gap-5 py-2", plain ? "px-4" : "px-3.5", className)}>
      <div id={labelId} className={cn("min-w-0 text-ink", plain ? "text-[14px] leading-5" : "text-[13px] leading-[18px]")}>{label}</div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** A Grok-style row that keeps one short grey line under its label (the
 * Computer page): label and explanation at the left, the control at the
 * right. `below` holds what the row opens (a list, a screen, steps). */
/** The small square an icon sits in at the start of a settings row (the
 * reference's row: icon tile, label, grey line, control at the right; JC
 * 2026-11-07). Every row icon goes through it, never a bare glyph. */
export const SETTINGS_ICON_TILE = "flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-border bg-panel text-ink-secondary";

export function SettingsIconTile({ children }: { children: React.ReactNode }) {
  return <span aria-hidden="true" data-settings-icon="" className={SETTINGS_ICON_TILE}>{children}</span>;
}

export function DescribedRow({
  label,
  description,
  help,
  icon,
  children,
  below,
  rowId,
  keywords,
}: {
  label: string;
  description?: React.ReactNode;
  /** The longer explanation, behind an info button after the label. */
  help?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  below?: React.ReactNode;
  rowId?: string;
  /** Extra search words that are not already in the label (a Dock or taskbar alias). */
  keywords?: string;
}) {
  const labelId = useId();
  // The plain surface (the bot's profile page): the Channels row's type,
  // 14px titles, a 20px line icon in a 16px gutter.
  const plain = useSettingsSurface() === "plain";
  return (
    <div role="group" aria-labelledby={labelId} data-settings-row={rowId} data-settings-rowkind="described" data-settings-keywords={keywords} className={plain ? "px-4 py-2.5" : "px-3.5 py-2.5"}>
      <div className="flex min-h-[28px] flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className={cn("flex min-w-0 flex-1 basis-[240px]", plain ? "items-start gap-3" : icon ? "items-center gap-3" : "items-start gap-2")}>
          {icon && (plain
            ? <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5">{icon}</span>
            : <SettingsIconTile>{icon}</SettingsIconTile>)}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <div id={labelId} className={cn("text-ink", plain ? "text-[14px] leading-5" : "text-[13px] leading-[18px]")}>{label}</div>
              {help && <HelpTip label={t("settings.moreAbout", { title: label })}>{help}</HelpTip>}
            </div>
            {description && <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary">{description}</div>}
          </div>
        </div>
        {children && <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>}
      </div>
      {below && <div data-settings-below="">{below}</div>}
    </div>
  );
}

/** The reference design's filled red pill, for a reset that erases. */
export const DANGER_PILL = "ui-button bg-danger font-medium text-danger-ink enabled:hover:brightness-110 disabled:opacity-50";

/** A row of a settings group that folds what it holds under a count pill
 * (the reference design's "Other computers 1 ⌄", a CountPill). `cardId` remembers the choice on this
 * device and lets a search or a link open it (requestSettingsCard). The body
 * stays mounted while folded, so drafts and saves are unaffected. */
export function FoldRow({ cardId, defaultOpen = false, label, description, help, icon, count, toggleLabel, controls, children }: {
  cardId: string;
  defaultOpen?: boolean;
  label: string;
  description?: React.ReactNode;
  help?: React.ReactNode;
  icon?: React.ReactNode;
  count?: number;
  /** The pill's spoken name; the row's label by default. */
  toggleLabel?: string;
  /** Other controls, before the pill. */
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  const bodyId = useId();
  const [open, toggle] = useCardOpen(cardId, defaultOpen);
  return (
    <div data-settings-card={cardId} data-open={open ? "true" : "false"}>
      <DescribedRow
        label={label}
        description={description}
        help={help}
        icon={icon}
        below={<div id={bodyId} hidden={!open} className="mt-2">{children}</div>}
      >
        {controls}
        <CountPill open={open} onToggle={toggle} label={toggleLabel ?? label} count={count} controls={bodyId} />
      </DescribedRow>
    </div>
  );
}

/** A page section that folds (#2175): the grey heading of a SettingsGroup
 * with its description under it and a count pill at its right; open, what
 * it holds draws below as sibling groups at the same level, each its own
 * card. Never a card around other cards: a settings page draws one card
 * level (docs/design/ux-reference-grokbot-cursor.md, 2.5). `cardId`
 * remembers the choice on this device and lets a search or a link open it
 * (requestSettingsCard). The body stays mounted while folded. */
export function SettingsFoldSection({ cardId, groupId, defaultOpen = false, title, description, count, children }: {
  cardId: string;
  groupId: string;
  defaultOpen?: boolean;
  title: string;
  description?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  const headingId = useId();
  const bodyId = useId();
  const [open, toggle] = useCardOpen(cardId, defaultOpen);
  return (
    <section aria-labelledby={headingId} data-settings-group={groupId} data-settings-card={cardId} data-open={open ? "true" : "false"} className="flex flex-col gap-2">
      <div className="flex min-w-0 items-start gap-1.5 px-1">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>
          {description && <p className="text-[13px] leading-[18px] text-ink-secondary">{description}</p>}
        </div>
        <CountPill open={open} onToggle={toggle} label={title} count={count} controls={bodyId} />
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** The reference design's filled pill for the one action a window is for ("Update",
 * "Call"), beside grey PILLs. */
export const PRIMARY_PILL = `${PILL} ui-button-primary`;

/** The rounded card a SettingsGroup draws around its rows, for a list of
 * rows that needs no grey heading (About's links). */
export const GROUP_CARD = "flex flex-col overflow-clip rounded-xl border-[0.5px] border-border bg-elevated py-1.5";

/** Settings' own window (SettingsModal): the dimmed layer and the
 * 900 x 700 sheet, shrinking with the app window. A window that must be
 * exactly as big as Settings (the task windows, 2026-10-16) reuses these;
 * SettingsModal spells the same classes out (ActivitySection.test.ts keeps
 * the two equal). */
export const SETTINGS_WINDOW = {
  backdrop: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 transition-opacity duration-base ease-out-quint starting:opacity-0 motion-reduce:transition-none sm:p-6",
  frame: "flex h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))] overflow-hidden rounded-[14px] border border-border bg-app outline-none transition-[opacity,scale] duration-base ease-out-quint starting:scale-98 starting:opacity-0 motion-reduce:transition-none",
} as const;

/** A window drawn like Settings (2026-10-16: every window of the app
 * follows Settings): its frame (14 px corners, hairline border, the app
 * background), the title at the top left in the Settings heading type, the
 * round close button at the top right, a body of grey-headed groups and
 * the pills at the bottom right. The widths are the reference design's dialog steps
 * (400, 480) plus Settings' own column (`xl`, the release notes). */
export const DIALOG = {
  // The entrance (#2595), as Settings opens: the scrim fades in, the window
  // fades in from 98 %. Token durations, so reduced motion lands at once.
  backdrop: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 transition-opacity duration-base ease-out-quint starting:opacity-0 sm:p-6",
  frame: "relative flex max-h-[calc(100dvh-48px)] w-full flex-col overflow-hidden rounded-[14px] border border-border bg-app text-ink outline-none transition-[opacity,scale] duration-base ease-out-quint starting:scale-98 starting:opacity-0",
  width: {
    sm: "max-w-[400px]",
    md: "max-w-[440px]",
    lg: "max-w-[560px]",
    xl: "max-w-[700px]",
  },
  header: "shrink-0 px-5 pb-1 pr-12 pt-5",
  headerWide: "shrink-0 px-5 pb-1 pr-12 pt-6 sm:px-8",
  title: "text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink",
  subtitle: "mt-0.5 text-[13px] leading-[18px] text-ink-secondary",
  close: "absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/10 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none touch:size-11",
  body: "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-3",
  bodyWide: "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6 pt-3 sm:px-8",
  footer: "flex shrink-0 flex-wrap items-center justify-end gap-2 px-5 pb-5",
  /** A footer under a long scrolling body: a hairline and the window's own
   * surface, so the pills never float over cut-off content (#3134). */
  footerDivided: "border-t border-hairline/50 bg-inherit pt-3",
} as const;

export type DialogWidth = keyof typeof DIALOG.width;

/** The round close button of a window drawn like Settings. */
export function DialogCloseButton({ label, onClick, buttonRef, disabled }: {
  label: string;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  disabled?: boolean;
}) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} data-dialog-close="" className={cn(DIALOG.close, "disabled:opacity-40")}>
      <X size={18} aria-hidden="true" />
    </button>
  );
}

/** A window's backdrop, portalled to the end of <body> (2026-10-18: 
 * the release notes' X only closed when clicked below it). Electron
 * resolves -webkit-app-region in DOM order: a dialog mounted inside the
 * shell before the chat header (`.content-topbar`, 56 px of drag) has its
 * no-drag cut back out by that later drag region, so a close button in
 * that band swallowed clicks on its upper part. After every header, the
 * dialog's own no-drag (styles.css) wins over the whole button. */
export function DialogLayer({ className, onBackdropMouseDown, children }: {
  className?: string;
  /** a mouse-down on the backdrop itself, not on the window */
  onBackdropMouseDown?: () => void;
  children: React.ReactNode;
}) {
  const layer = (
    <div
      data-dialog-layer=""
      className={cn(DIALOG.backdrop, className)}
      onMouseDown={(event) => event.target === event.currentTarget && onBackdropMouseDown?.()}
    >
      {children}
    </div>
  );
  // Server rendering (the static-markup tests) has no body to portal into.
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}

/** A window's frame drawn like Settings, without its backdrop (each caller
 * keeps its own layer, portal and keyboard): the title (with an optional
 * `leading` avatar or mark and a short grey `subtitle`), the close button,
 * `toolbar` under the title (a version menu), the scrolling body, and
 * `footer` pills. */
export function DialogFrame({
  titleId,
  title,
  subtitle,
  subtitleId,
  leading,
  width = "sm",
  wide,
  role = "dialog",
  closeLabel,
  onClose,
  closeRef,
  closeDisabled,
  frameRef,
  frameProps,
  toolbar,
  footer,
  footerDivider,
  children,
}: {
  titleId: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  subtitleId?: string;
  leading?: React.ReactNode;
  width?: DialogWidth;
  /** Settings' wider side margins (the release notes' reading column). */
  wide?: boolean;
  role?: "dialog" | "alertdialog";
  /** Without it the window has no close button (a confirmation, whose
   * Cancel pill closes it). */
  closeLabel?: string;
  onClose?: () => void;
  closeRef?: React.Ref<HTMLButtonElement>;
  closeDisabled?: boolean;
  frameRef?: React.Ref<HTMLDivElement>;
  /** data-* hooks and aria-describedby / aria-busy for the frame */
  frameProps?: Record<string, string | boolean | undefined>;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  /** A hairline above the footer, for a body long enough to scroll. */
  footerDivider?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      ref={frameRef}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      {...frameProps}
      className={cn(DIALOG.frame, DIALOG.width[width])}
    >
      {closeLabel && onClose && <DialogCloseButton label={closeLabel} onClick={onClose} buttonRef={closeRef} disabled={closeDisabled} />}
      <div className={cn(wide ? DIALOG.headerWide : DIALOG.header, !closeLabel && "pr-5")}>
        <div className="flex min-w-0 items-center gap-3">
          {leading && <span className="shrink-0">{leading}</span>}
          <div className="min-w-0">
            <h2 id={titleId} className={DIALOG.title}>{title}</h2>
            {subtitle && <p id={subtitleId} className={DIALOG.subtitle}>{subtitle}</p>}
          </div>
        </div>
        {toolbar && <div className="mt-3 flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>
      {children && <div data-dialog-body="" className={wide ? DIALOG.bodyWide : DIALOG.body}>{children}</div>}
      {footer && <div data-dialog-footer="" className={cn(DIALOG.footer, footerDivider && DIALOG.footerDivided)}>{footer}</div>}
    </div>
  );
}

/** A row of a card that opens something: the label at the left, an arrow
 * (or the leave-the-app mark for a web page) at the right, the whole row
 * one button. */
export function LinkRow({ label, onClick, external, rowId }: { label: string; onClick: () => void; external?: boolean; rowId?: string }) {
  const Icon = external ? ExternalLink : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      data-link-row={rowId ?? ""}
      data-settings-rowkind="link"
      className="flex min-h-[44px] w-full min-w-0 items-center gap-3 px-3.5 py-2 text-left text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 motion-reduce:transition-none md:min-h-[36px]"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Icon size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </button>
  );
}

/** A text field or text area as Settings draws them. */
export const FIELD = "min-h-[44px] w-full min-w-0 rounded-lg border-[0.5px] border-border bg-inset px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0";

/** A field of a settings group's card: its label above, the control filling
 * the row, and at most one short grey line under it. The whole row is the
 * <label>, so a click on the words focuses the field. */
export function FieldRow({ label, hint, hintId, children, rowId }: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** For the field's aria-describedby. */
  hintId?: string;
  children: React.ReactNode;
  rowId?: string;
}) {
  return (
    <label data-settings-row={rowId} data-settings-rowkind="field" className="flex min-w-0 flex-col gap-1.5 px-3.5 py-2.5">
      <span className="text-[13px] leading-[18px] text-ink">{label}</span>
      {children}
      {hint && <span id={hintId} className="text-[12px] leading-4 text-ink-secondary">{hint}</span>}
    </label>
  );
}

/** A small editor a row opens ("Add a secret", "Add an item"): one compact
 * row per field, the actions at the bottom right, in a thin rounded frame
 * inside the group's card. With `onSubmit` it is a <form> (Enter submits). */
export function EditorBox({ label, actions, onSubmit, className, children, ...data }: {
  /** The editor's spoken name. */
  label: string;
  actions: React.ReactNode;
  onSubmit?: () => void;
  className?: string;
  children: React.ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  const plain = useSettingsSurface() === "plain";
  const body = (
    <>
      <div className="flex flex-col py-1">{children}</div>
      <div className={cn("flex flex-wrap items-center justify-end gap-2 px-3 py-2", !plain && "border-t-[0.5px] border-border")}>{actions}</div>
    </>
  );
  // In a plain card the editor is the card's own rows: no frame inside the
  // frame (#2313), only its actions at the bottom right.
  const frame = cn("flex min-w-0 flex-col", plain ? "rounded-lg" : "rounded-lg border-[0.5px] border-border", className);
  return onSubmit
    ? <form {...data} aria-label={label} className={frame} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>{body}</form>
    : <div {...data} role="group" aria-label={label} className={frame}>{body}</div>;
}

/** A field of an EditorBox: its label (and at most one grey line) at the
 * left, the control at the right, stacked on a narrow window. A text field
 * row is the <label>; a menu row (`menu`, a PillSelect) is a group, so a
 * click on the words does not open the menu. */
export function EditorField({ label, hint, menu, children }: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  menu?: boolean;
  children: React.ReactNode;
}) {
  const labelId = useId();
  const words = (
    <span className="min-w-0">
      <span id={labelId} className="block text-[13px] leading-[18px] text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-[12px] leading-4 text-ink-secondary">{hint}</span>}
    </span>
  );
  const grid = "grid min-w-0 grid-cols-1 items-center gap-1.5 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)] sm:gap-4";
  return menu
    ? <div role="group" aria-labelledby={labelId} data-editor-field="" className={grid}>{words}<div className="flex min-w-0 justify-start sm:justify-end">{children}</div></div>
    : <label data-editor-field="" className={grid}>{words}<span className="flex min-w-0">{children}</span></label>;
}

/** A destructive action asked twice, in place: a grey pill with red words,
 * then, once clicked, the reference design's filled red pill that does it. Leaving the
 * pill (Tab, a click elsewhere) or Escape disarms it. */
export function ConfirmPill({ label, confirmLabel, ariaLabel, title, onConfirm, disabled, children }: {
  label: string;
  /** The armed pill's words ("Remove for good"). */
  confirmLabel: string;
  ariaLabel?: string;
  title?: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** What the unarmed pill shows instead of `label` (an icon). */
  children?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      data-confirm-pill={armed ? "armed" : ""}
      aria-label={armed ? confirmLabel : ariaLabel ?? label}
      title={armed ? confirmLabel : title ?? label}
      onClick={() => {
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && armed) { event.preventDefault(); event.stopPropagation(); setArmed(false); }
      }}
      className={armed
        ? `${DANGER_PILL} min-h-[44px] shrink-0 md:min-h-0`
        : `${PILL} shrink-0 bg-transparent text-danger enabled:hover:bg-danger/10`}
    >
      {armed ? confirmLabel : children ?? label}
    </button>
  );
}

// #2080 (L0): the shared Settings patterns, one import for every page.
export { ExternalLinkPill, StatusText, OrgBand, FilterChips, SelectionBar, SettingsEmpty } from "./settings/SettingsPatterns";
export type { FilterChip } from "./settings/SettingsPatterns";

/** Hide-when-unavailable (JC 2026-11-08: "If option are not available hide them
 * visually"). An option the context makes impossible (organization server, OS,
 * platform, missing feature) is not rendered, never shown as a disabled row with
 * a "Not available" line. Not for a prerequisite the person has yet to fill in:
 * that stays visible and disabled. */
export function Available({ when, children }: { when: boolean; children: React.ReactNode }) {
  return when ? <>{children}</> : null;
}
