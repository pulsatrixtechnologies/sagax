import { Fragment, useId, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, CircleHelp, Copy, ExternalLink, X } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SWITCH_OFF, SWITCH_ON, SWITCH_THUMB_OFF, SWITCH_THUMB_ON } from "@/lib/status-tones";
import { useCopyFeedback } from "@/lib/copy-text";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "./AnchoredPopover";

export function Switch({
  checked,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children" | "role" | "aria-checked"> & { checked: boolean }) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative h-5 w-11 shrink-0 cursor-pointer rounded-full transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        checked ? SWITCH_ON : SWITCH_OFF,
        className,
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-1/2 h-4 w-[26px] -translate-y-1/2 rounded-full transition-transform motion-reduce:transition-none",
          checked ? `translate-x-[14px] ${SWITCH_THUMB_ON}` : `translate-x-0 ${SWITCH_THUMB_OFF}`,
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
    <label className={cn("flex min-w-0 items-center justify-between gap-4 text-[13px] text-ink", disabled ? "cursor-not-allowed" : "cursor-pointer", className)}>
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

const CARD_STATE_KEY = "openmausbot.settingsCards.v1";

type CardStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): CardStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readCardStates(storage: CardStorage | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(CARD_STATE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

/** The remembered open state of a settings card, or `fallback` when this
 * device never toggled it (or storage is unavailable). */
export function loadCardOpen(id: string, fallback: boolean, storage: CardStorage | null = defaultStorage()): boolean {
  return readCardStates(storage)[id] ?? fallback;
}

export function saveCardOpen(id: string, open: boolean, storage: CardStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(CARD_STATE_KEY, JSON.stringify({ ...readCardStates(storage), [id]: open }));
  } catch {
    /* private windows and full quotas keep the in-memory state only */
  }
}

// One shared store of explicit choices (toggles, remembered states, deep
// links), read from storage once. A card without a choice follows its
// `defaultOpen`, which may change once the card's data loads. Keeping the
// state here rather than in component state lets a deep link open a card
// that has not mounted yet, with no event wiring.
let cardChoices: Record<string, boolean> | null = null;
const ANONYMOUS_CARD = "anonymous:";
const cardListeners = new Set<() => void>();

function choices(): Record<string, boolean> {
  return (cardChoices ??= readCardStates(defaultStorage()));
}

function subscribeCards(listener: () => void): () => void {
  cardListeners.add(listener);
  return () => cardListeners.delete(listener);
}

function chooseCardOpen(id: string, open: boolean): void {
  cardChoices = { ...choices(), [id]: open };
  // A card without a cardId still folds, for this session only.
  if (!id.startsWith(ANONYMOUS_CARD)) saveCardOpen(id, open);
  for (const listener of cardListeners) listener();
}

/** Opens the collapsible settings card `id` and scrolls it into view, now if
 * it is mounted or as soon as it mounts (a deep link opens Settings first). */
export function requestSettingsCard(id: string): void {
  lastRequestedCard = id;
  chooseCardOpen(id, true);
  let frames = 0;
  const reveal = () => {
    try {
      const card = [...document.querySelectorAll<HTMLElement>("[data-settings-card]")].find((node) => node.dataset.settingsCard === id);
      if (card) {
        card.scrollIntoView?.({ block: "nearest" });
        if (lastRequestedCard === id) lastRequestedCard = null;
      } else if (++frames < 30) requestAnimationFrame(reveal);
      else if (lastRequestedCard === id) lastRequestedCard = null;
    } catch {
      /* no document outside the renderer */
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
}

let lastRequestedCard: string | null = null;

/** The card a link asked for last, read once: Settings uses it to send a
 * link to a moved card where that card is shown on this computer. */
export function takeRequestedSettingsCard(): string | null {
  const id = lastRequestedCard;
  lastRequestedCard = null;
  return id;
}

/** Test seam: drop the in-memory choices so storage is read again. */
export function resetSettingsCards(): void {
  cardChoices = null;
  lastRequestedCard = null;
}

function useCardOpen(id: string, defaultOpen: boolean) {
  const read = () => choices()[id];
  const chosen = useSyncExternalStore(subscribeCards, read, read);
  const open = chosen ?? defaultOpen;
  const toggle = () => chooseCardOpen(id, !open);
  return [open, toggle] as const;
}

/** A folding row's open state, remembered like a collapsible card's and
 * opened by `requestSettingsCard(id)` (a search, a deep link). */
export function useSettingsCardOpen(id: string, defaultOpen: boolean) {
  return useCardOpen(id, defaultOpen);
}

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
export function Card(props: CardProps) {
  // A plain card stays hook-free; only a collapsible one needs state.
  if (props.collapsible && props.title) return <CollapsibleCard {...props} title={props.title} />;
  const { title, subtitle, children, cardId } = props;
  return (
    <div data-settings-card={cardId} className="rounded-[14px] border-[0.5px] border-border px-3.5 py-3">
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
  return (
    <div data-settings-card={cardId} data-open={open ? "true" : "false"} className="rounded-[14px] border-[0.5px] border-border">
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
    <div role="group" aria-labelledby={titleId} className={cn("setting-row px-3.5 py-2.5", className)}>
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

/** A titled group of settings, as Grok Bot's settings pages draw them: a
 * grey heading outside the card (Account, Appearance, System), then one
 * rounded card of compact rows. An empty group draws nothing. */
export function SettingsGroup({
  title,
  groupId,
  accessory,
  plain,
  children,
}: {
  title: string;
  /** `data-settings-group`, for tests and deep links */
  groupId: string;
  /** Shown after the heading, as Grok Bot's "Your computer · <name>". */
  accessory?: React.ReactNode;
  /** The children are cards of their own (forms with several fields): the
   * heading only, no card around them. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-settings-group={groupId} className="flex flex-col gap-2 has-[>div:empty]:hidden">
      <div className="flex min-w-0 items-center gap-1.5 px-1">
        <h3 id={headingId} className="shrink-0 text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>
        {accessory}
      </div>
      <div className={plain ? "flex flex-col gap-2 empty:hidden" : "flex flex-col rounded-xl border-[0.5px] border-border bg-elevated py-1.5 empty:hidden"}>{children}</div>
    </section>
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

/** Grok Bot's count pill ("2 ⌄"): how many items a row holds, and the
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
  return (
    <span
      data-unit-field=""
      className={cn(
        "inline-flex h-7 min-h-[44px] items-center gap-1 rounded-lg border-[0.5px] bg-inset pl-2 pr-2.5 md:min-h-0",
        invalid ? "border-danger/60" : "border-border focus-within:border-focus",
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

/** Grok Bot's grey pill button, 44 px tall on a touch screen. */
export const PILL = "ui-button min-h-[44px] disabled:opacity-50 md:min-h-0";

/** `group` heads a run of options in the open list (a native <optgroup>):
 * a grey line the arrows skip. `disabled` keeps a choice listed but not
 * choosable (an engine that is not ready, a saved value that is gone). */
export type PillOption<T extends string> = { value: T; label: string; group?: string; disabled?: boolean };

/** Grok Bot's borderless pill menu ("Follow System ⌄"): the current value
 * and a chevron; the choices open in a small list under it. A listbox, so
 * arrows, Home/End, Enter and Escape work as in a native select. */
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: T;
  options: ReadonlyArray<PillOption<T>>;
  onChange: (next: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const current = options.find((option) => option.value === value);
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
    if (next !== value) onChange(next);
  };
  return (
    <div ref={rootRef} className="relative inline-flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        title={current?.label}
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
        className="inline-flex h-7 max-w-[240px] items-center gap-1 rounded-full px-2.5 text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-hover motion-reduce:transition-none"
      >
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      </button>
      {open && (
        <AnchoredPopover
          as="ul"
          anchorRef={triggerRef}
          popoverRef={listRef}
          align="end"
          maxHeight={280}
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
export function CompactRow({ label, children, className, rowId }: { label: string; children: React.ReactNode; className?: string; rowId?: string }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} data-settings-row={rowId} className={cn("flex min-h-[44px] items-center justify-between gap-5 px-3.5 py-2", className)}>
      <div id={labelId} className="min-w-0 text-[13px] leading-[18px] text-ink">{label}</div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** A Grok-style row that keeps one short grey line under its label (the
 * Computer page): label and explanation at the left, the control at the
 * right. `below` holds what the row opens (a list, a screen, steps). */
export function DescribedRow({
  label,
  description,
  help,
  icon,
  children,
  below,
  rowId,
}: {
  label: string;
  description?: React.ReactNode;
  /** The longer explanation, behind an info button after the label. */
  help?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  below?: React.ReactNode;
  rowId?: string;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} data-settings-row={rowId} className="px-3.5 py-2.5">
      <div className="flex min-h-[28px] flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-[240px] items-start gap-2">
          {icon && <span aria-hidden="true" className="mt-px shrink-0 text-ink-secondary">{icon}</span>}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <div id={labelId} className="text-[13px] leading-[18px] text-ink">{label}</div>
              {help && <HelpTip label={t("settings.moreAbout", { title: label })}>{help}</HelpTip>}
            </div>
            {description && <div className="mt-0.5 text-[12px] leading-4 text-ink-secondary">{description}</div>}
          </div>
        </div>
        {children && <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>}
      </div>
      {below}
    </div>
  );
}

/** Grok Bot's filled red pill, for a reset that erases. */
export const DANGER_PILL = "ui-button bg-danger font-medium text-danger-ink enabled:hover:brightness-110 disabled:opacity-50";

/** A row of a settings group that folds what it holds under a count pill
 * (Grok Bot's "Other computers 1 ⌄", a CountPill). `cardId` remembers the choice on this
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

/** Grok Bot's filled pill for the one action a window is for ("Update",
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

/** A window drawn like Settings (2026-10-16, JC: every window of the app
 * follows Settings): its frame (14 px corners, hairline border, the app
 * background), the title at the top left in the Settings heading type, the
 * round close button at the top right, a body of grey-headed groups and
 * the pills at the bottom right. The widths are Grok Bot's dialog steps
 * (400, 480) plus Settings' own column (`xl`, the release notes). */
export const DIALOG = {
  backdrop: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6",
  frame: "relative flex max-h-[calc(100dvh-48px)] w-full flex-col overflow-hidden rounded-[14px] border border-border bg-app text-ink outline-none",
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

/** A window's backdrop, portalled to the end of <body> (2026-10-18, JC:
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
      {children && <div className={wide ? DIALOG.bodyWide : DIALOG.body}>{children}</div>}
      {footer && <div className={DIALOG.footer}>{footer}</div>}
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
    <label data-settings-row={rowId} className="flex min-w-0 flex-col gap-1.5 px-3.5 py-2.5">
      <span className="text-[13px] leading-[18px] text-ink">{label}</span>
      {children}
      {hint && <span id={hintId} className="text-[12px] leading-4 text-ink-secondary">{hint}</span>}
    </label>
  );
}

/** A destructive action asked twice, in place: a grey pill with red words,
 * then, once clicked, Grok Bot's filled red pill that does it. Leaving the
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
