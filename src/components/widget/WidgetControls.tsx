// The controls a chat widget can hold, and the form state they share. One
// WidgetMessage owns the state; a control reads and writes it by field name.
// Select and DatePicker are the platform's own controls dressed as the
// widget's field, so they keep the system menu, the calendar, the keyboard
// and a screen reader's reading of them with no code here. TimePicker and
// DayPicker have no platform control that fits (WidgetTimePicker,
// WidgetDayPicker); WidgetFields lays any of them out with its label.
import { createContext, useContext } from "react";
import { Calendar, Check, ChevronsUpDown, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { WIDGET_LIMITS, widgetNumber, widgetString, type WidgetActionEntry, type WidgetField, type WidgetNode, type WidgetValues } from "../../../shared/widget";
import { isWidgetDot, widgetIcon, widgetIconFilled } from "./widget-icons";

export interface WidgetForm {
  /** Unique per widget on the page: field ids and radio names hang off it. */
  uid: string;
  values: WidgetValues;
  setValue: (name: string, value: string | boolean) => void;
  /** Sending, settled or read-only: nothing takes input. */
  locked: boolean;
  /** The required field a press stopped on. */
  invalid?: string;
  /** The alert line that says why, for `aria-describedby`. */
  errorId: string;
  /** Every field in the widget by name, with the label it goes by. */
  fields: ReadonlyMap<string, WidgetField>;
  actions: ReadonlyMap<string, WidgetActionEntry>;
  /** The ref being sent, or waiting for its settle. */
  pendingRef?: string;
  /** The ref whose press just went through without settling the widget. */
  sentRef?: string;
  /** The ref whose press settled the widget (the booked slot of a Booking). */
  settledRef?: string;
  press: (ref: string) => void;
  /** Remote images wait for a click, as they do in a bot's Markdown. */
  imagesAllowed: boolean;
  allowImages: () => void;
  /** The fields a Label node in the widget names: their own `label` is not drawn a second time. */
  labelled: ReadonlySet<string>;
  /** The card is too narrow for a label and its field side by side (WIDGET_COMPACT_BELOW):
   * such a row stacks, and its field takes the whole width. */
  compact: boolean;
  /** What the card is called, for a table it holds (its expanded view and its download). */
  name: string;
}

/** Under this card width, in px, a row of a label and a field stacks. */
export const WIDGET_COMPACT_BELOW = 400;

const INERT: WidgetForm = {
  uid: "widget", values: {}, setValue: () => {}, locked: true, errorId: "widget-error", fields: new Map(), actions: new Map(),
  press: () => {}, imagesAllowed: false, allowImages: () => {}, labelled: new Set(), compact: false, name: "",
};
const WidgetFormContext = createContext<WidgetForm>(INERT);
export const WidgetFormProvider = WidgetFormContext.Provider;
export const useWidgetForm = (): WidgetForm => useContext(WidgetFormContext);

export const widgetFieldId = (form: WidgetForm, name: string): string => `${form.uid}-field-${name}`;

/** Whether a press on this action does anything now. A link still opens from
 * a settled card; everything else waits for an unlocked one. */
export function widgetCanPress(form: WidgetForm, entry: WidgetActionEntry | undefined): entry is WidgetActionEntry {
  if (!entry) return false;
  return entry.client ? form.pendingRef === undefined : !form.locked;
}

/** An icon by its canonical name, in the 1.8 stroke the widget is drawn in. */
export function WidgetGlyph({ name, size = 16, className }: { name: unknown; size?: number; className?: string }) {
  if (isWidgetDot(name)) {
    return (
      <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
        <span className="size-[7px] rounded-full bg-current" />
      </span>
    );
  }
  const Icon = widgetIcon(name);
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} fill={widgetIconFilled(name) ? "currentColor" : "none"} className={cn("shrink-0", className)} />;
}

// ── Buttons ─────────────────────────────────────────────────────────────────

const BUTTON =
  "inline-flex h-9 max-w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-medium leading-5 transition-[background-color,color,filter,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-45 aria-busy:opacity-100";

/** `outline` is the cancel under the card: the card's own surface and ring,
 * on the page. Inside a card that fill would vanish (the surface is the
 * same), so `secondary` is a tint of the ink, as on the approval row.
 * The ring is `inset-ring`, never `ring-inset`: this theme has a colour
 * named `inset`, so `ring-inset` also paints the ring in it. */
const BUTTON_LOOK: Record<string, string> = {
  primary: "bg-accent text-accent-ink enabled:hover:brightness-110",
  secondary: "bg-ink/[0.07] text-ink enabled:hover:bg-ink/[0.12]",
  outline: "bg-composer text-ink inset-ring inset-ring-composer-ring enabled:hover:bg-raised-hover",
  quiet: "px-2.5 text-ink-secondary enabled:hover:bg-ink/[0.07] enabled:hover:text-ink",
  danger: "bg-danger text-danger-ink enabled:hover:brightness-110",
};

/** The address an `open_url` press opens, when it is one a browser takes. */
export function widgetActionUrl(entry: WidgetActionEntry | undefined): string | undefined {
  const payload = entry?.client ? entry.action.payload : undefined;
  const url = payload && typeof payload === "object" && !Array.isArray(payload) ? payload.url : undefined;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined;
}

/** One pressable action: a Button node, or the confirm and cancel under the
 * card. It shows its own press: a spinner while it is sent, a tick after. */
export function WidgetButton({ actionRef, label, look, iconStart, iconEnd, block = false, disabled = false }: {
  actionRef: string;
  label?: string;
  look: string;
  iconStart?: unknown;
  iconEnd?: unknown;
  block?: boolean;
  disabled?: boolean;
}) {
  const form = useWidgetForm();
  const entry = form.actions.get(actionRef);
  const pending = form.pendingRef === actionRef;
  const sent = form.sentRef === actionRef;
  return (
    <button
      type="button"
      data-widget-ref={actionRef}
      // a button with nothing behind it presses nothing
      disabled={disabled || !widgetCanPress(form, entry)}
      aria-busy={pending || undefined}
      aria-label={label ? undefined : entry?.label}
      // the label in full, since the pill clips a long one; under it, where a link goes
      title={[label, widgetActionUrl(entry)].filter(Boolean).join("\n") || undefined}
      onClick={(event) => {
        event.stopPropagation();
        form.press(actionRef);
      }}
      className={cn(BUTTON, BUTTON_LOOK[look] ?? BUTTON_LOOK.secondary, block && "flex w-full", !label && "w-9 px-0")}
    >
      {pending ? <LoaderCircle aria-hidden="true" size={14} className="shrink-0 animate-spin" />
        : sent ? <Check aria-hidden="true" size={14} className="shrink-0" />
          : iconStart ? <WidgetGlyph name={iconStart} size={14} /> : null}
      {label && <span dir="auto" className="min-w-0 truncate">{label}</span>}
      {iconEnd ? <WidgetGlyph name={iconEnd} size={14} /> : null}
    </button>
  );
}

// ── Fields ──────────────────────────────────────────────────────────────────

/** The app's own field (Settings, dialogs): the inset well with a faint
 * hairline, the skin's `rounded-lg`, 36px to sit level with a button. A
 * focused field paints its border in the focus colour (styles.css); one a
 * press stopped on keeps a danger border, and so does one the person left
 * outside its `pattern` or its type (an email that is not one). */
export const WIDGET_FIELD =
  "block h-9 w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 text-[14px] leading-5 text-ink placeholder:text-ink-tertiary disabled:cursor-not-allowed disabled:opacity-60 user-invalid:border-danger aria-[invalid=true]:border-danger";
/** Beside its label in a row a picker drops the box and shows its value alone. */
export const WIDGET_BARE =
  "h-9 min-w-0 max-w-full cursor-pointer rounded-lg border border-transparent bg-transparent text-[14px] font-medium leading-5 text-ink enabled:hover:bg-ink/[0.07] disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";
/** The small round action beside a field: clear it. */
export const WIDGET_FIELD_ACTION =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export type WidgetFieldControl = ReturnType<typeof useWidgetField>;

/** A field's value and everything every element that draws it carries. */
export function useWidgetField(node: WidgetNode) {
  const form = useWidgetForm();
  const name = widgetString(node, "name") ?? "";
  const invalid = form.invalid === name;
  const disabled = form.locked || node.disabled === true;
  const required = node.required === true;
  return {
    form, name, disabled, invalid,
    set: (value: string | boolean) => form.setValue(name, value),
    text: typeof form.values[name] === "string" ? form.values[name] as string : "",
    /** What every control of the field carries, whatever element draws it. */
    control: {
      id: widgetFieldId(form, name),
      name,
      disabled,
      required,
      "data-widget-field": name,
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? form.errorId : undefined,
      "aria-label": spokenName(node, form.fields.get(name)?.label, name),
    },
  };
}

/** What a screen reader calls a field: the label it is recorded under (its Label node, or its own
 * `label`), and where it has none, the words the bot gave it for this (`ariaLabel`, a placeholder) before its bare name. */
function spokenName(node: WidgetNode, recorded: string | undefined, name: string): string {
  return recorded && recorded !== name ? recorded : widgetString(node, "ariaLabel") ?? widgetString(node, "placeholder") ?? name;
}

function optionsOf(node: WidgetNode): Array<{ label: string; value: string }> {
  const list: unknown[] = Array.isArray(node.options) ? node.options : [];
  return list.flatMap((option) => {
    const record = option && typeof option === "object" ? option as { label?: unknown; value?: unknown } : {};
    return typeof record.value === "string" ? [{ value: record.value, label: typeof record.label === "string" ? record.label : record.value }] : [];
  });
}

export function WidgetSelect({ node, bare }: { node: WidgetNode; bare: boolean }) {
  const field = useWidgetField(node);
  const open = node.clearable === true;
  return (
    <span className={cn("relative min-w-0 items-center", bare ? "inline-flex" : "flex w-full")}>
      <select
        {...field.control}
        value={field.text}
        onChange={(event) => field.set(event.target.value)}
        className={cn(bare ? WIDGET_BARE : WIDGET_FIELD, "appearance-none", bare ? "ps-2 pe-7 text-end [field-sizing:content]" : "pe-9", !field.text && "text-ink-tertiary")}
      >
        {/* the resting line; it can be chosen again only where the field may be cleared */}
        <option value="" disabled={!open} hidden={!open}>{widgetString(node, "placeholder") ?? t("widget.choose")}</option>
        {optionsOf(node).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronsUpDown aria-hidden="true" size={14} className={cn("pointer-events-none absolute text-ink-tertiary", bare ? "end-2" : "end-3")} />
    </span>
  );
}

/** The whole field opens the calendar: Chromium's own indicator is stretched
 * over it and left invisible, and the icon is ours. */
const DATE_INDICATOR =
  "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0";

export function WidgetDatePicker({ node, bare }: { node: WidgetNode; bare: boolean }) {
  const field = useWidgetField(node);
  // an empty date input shows its own dd/mm/yyyy; a placeholder takes its place until the field is focused
  const placeholder = !field.text ? widgetString(node, "placeholder") : undefined;
  return (
    <span className={cn("min-w-0 items-center gap-1", bare ? "inline-flex" : "flex w-full")}>
      <span className={cn("relative flex min-w-0 items-center", !bare && "flex-1")}>
        <Calendar aria-hidden="true" size={14} className={cn("pointer-events-none absolute z-[1] text-ink-secondary", bare ? "start-2" : "start-3")} />
        <input
          {...field.control}
          type="date"
          value={field.text}
          min={widgetString(node, "min")}
          max={widgetString(node, "max")}
          onChange={(event) => field.set(event.target.value)}
          // the calendar and the day segments follow the skin, not the system
          className={cn(
            bare ? WIDGET_BARE : WIDGET_FIELD, "peer relative tabular-nums [color-scheme:var(--code-color-scheme)]", bare ? "ps-7 pe-2" : "ps-8", DATE_INDICATOR,
            placeholder && "text-transparent focus:text-ink",
          )}
        />
        {placeholder && (
          <span aria-hidden="true" className={cn("pointer-events-none absolute truncate text-[14px] leading-5 text-ink-tertiary peer-focus:hidden", bare ? "start-7 end-2" : "start-8 end-3")}>
            {placeholder}
          </span>
        )}
      </span>
      {node.clearable === true && field.text && !field.disabled && (
        <button type="button" aria-label={t("widget.clear", { label: field.control["aria-label"] })} onClick={() => field.set("")} className={WIDGET_FIELD_ACTION}>
          <X aria-hidden="true" size={14} />
        </button>
      )}
    </span>
  );
}

/** The native box and dot stay in the page for the keyboard and for a screen
 * reader; the 18px mark beside each is what is seen. */
const MARK = "shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-focus";
const MARK_IDLE = "shadow-[inset_0_0_0_1.5px_var(--color-ink-tertiary)]";

/** The 18px ring one choice is marked with: empty, or filled with the accent. */
export function WidgetRadioMark({ on, invalid = false }: { on: boolean; invalid?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-[18px] rounded-full", MARK, on ? "shadow-[inset_0_0_0_5.5px_var(--color-accent)]" : invalid ? "shadow-[inset_0_0_0_1.5px_var(--color-danger)]" : MARK_IDLE)}
    />
  );
}

export function WidgetCheckbox({ node }: { node: WidgetNode }) {
  const field = useWidgetField(node);
  const checked = field.form.values[field.name] === true;
  const label = widgetString(node, "label");
  return (
    <label className={cn("relative flex min-h-[44px] min-w-0 items-center gap-3 text-[14px] leading-5 text-ink", field.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <input {...field.control} type="checkbox" checked={checked} onChange={(event) => field.set(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={cn("flex size-[18px] items-center justify-center rounded-[6px]", MARK, checked ? "bg-accent text-accent-ink" : field.invalid ? "shadow-[inset_0_0_0_1.5px_var(--color-danger)]" : MARK_IDLE)}
      >
        {checked && <Check size={12} strokeWidth={2.6} />}
      </span>
      {label && <span dir="auto" className="min-w-0 flex-1">{label}</span>}
    </label>
  );
}

/** `labelledBy` is the caption drawn above the group from its own `label`. */
export function WidgetRadioGroup({ node, labelledBy }: { node: WidgetNode; labelledBy?: string }) {
  const field = useWidgetField(node);
  const { id, "aria-invalid": invalid, "aria-describedby": describedBy, "aria-label": ariaLabel } = field.control;
  return (
    <div
      role="radiogroup"
      id={id}
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      aria-required={field.control.required || undefined}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      className={cn("flex min-w-0", node.direction === "col" ? "flex-col gap-2.5" : "flex-wrap gap-x-[18px] gap-y-2", field.disabled && "opacity-60")}
    >
      {optionsOf(node).map((option, index) => (
        <label key={option.value} className={cn("relative inline-flex min-w-0 items-center gap-2 text-[14px] leading-5 text-ink", field.disabled ? "cursor-not-allowed" : "cursor-pointer")}>
          <input
            type="radio"
            // the group's name on the page, apart from any other widget's
            name={id}
            value={option.value}
            checked={field.text === option.value}
            disabled={field.disabled}
            onChange={() => field.set(option.value)}
            data-widget-field={index === 0 ? field.name : undefined}
            className="peer sr-only"
          />
          <WidgetRadioMark on={field.text === option.value} invalid={field.invalid} />
          <span dir="auto" className="min-w-0">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function WidgetInput({ node, bare }: { node: WidgetNode; bare: boolean }) {
  const field = useWidgetField(node);
  return (
    <input
      {...field.control}
      type={widgetString(node, "inputType") ?? "text"}
      dir="auto"
      value={field.text}
      // the server takes no more than this in one field
      maxLength={WIDGET_LIMITS.fieldValue}
      placeholder={widgetString(node, "placeholder")}
      pattern={widgetString(node, "pattern")}
      onChange={(event) => field.set(event.target.value)}
      // beside its label the field is shorter and reads from the row's end
      className={cn(WIDGET_FIELD, bare && "w-44 max-w-[60%] text-end")}
    />
  );
}

export function WidgetTextarea({ node }: { node: WidgetNode }) {
  const field = useWidgetField(node);
  const grows = node.autoResize === true;
  const maxRows = widgetNumber(node, "maxRows");
  return (
    <textarea
      {...field.control}
      dir="auto"
      rows={widgetNumber(node, "rows") ?? 3}
      value={field.text}
      maxLength={WIDGET_LIMITS.fieldValue}
      placeholder={widgetString(node, "placeholder")}
      onChange={(event) => field.set(event.target.value)}
      className={cn(WIDGET_FIELD, "h-auto resize-none py-2", grows && "[field-sizing:content]")}
      // 20px lines inside 8px of padding and the 1px border, top and bottom
      style={grows && maxRows ? { maxHeight: maxRows * 20 + 18 } : undefined}
    />
  );
}
