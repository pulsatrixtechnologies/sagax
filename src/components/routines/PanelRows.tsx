// The routine panel's rows (2026-11-03, JC: Grok Bot's routine panel): a muted
// label at the left with a short hint under it, the value or the control at
// the right. One height, one font, one divider. The longer explanation stays
// on the label's tooltip and is read by assistive technology, never behind a
// "?" bubble. View mode shows the same rows with their values as text.
// docs/design/ux-reference-grokbot-cursor.md, 2.7.
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PillSelect, Switch, type PillOption } from "../SettingsPrimitives";

/** A muted section label: "Instruction", "When to run", "Webhook". */
export const PANEL_LABEL = "text-[12.5px] leading-5 text-ink-tertiary";
const ROW_LABEL = "text-[13px] leading-5 text-ink-secondary";
const ROW_HINT = "mt-0.5 block text-[11.5px] leading-4 text-ink-tertiary";

/** Rows separated by one hairline each. */
export function PanelRows({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string>) {
  return <div {...rest} className={cn("flex min-w-0 flex-col divide-y divide-hairline/30", className)}>{children}</div>;
}

export function PanelRow({ label, hint, help, children, below, className, ...rest }: {
  label: ReactNode;
  /** Short muted text under the label. */
  hint?: ReactNode;
  /** The longer explanation: the label's tooltip and its accessible description. */
  help?: string;
  children?: ReactNode;
  /** Full-width content under the row (chips, a sub-form). */
  below?: ReactNode;
  className?: string;
} & Record<`data-${string}`, string>) {
  const id = useId();
  return <div {...rest} data-panel-row="" className={cn("min-w-0 py-2", className)}>
    <div className="flex min-h-8 min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 flex-1" title={help}>
        <span className={ROW_LABEL}>{label}</span>
        {hint && <span className={ROW_HINT}>{hint}</span>}
        {help && <span id={`${id}-help`} className="sr-only">{help}</span>}
      </span>
      {children !== undefined && children !== null && children !== false && <span className="flex min-w-0 max-w-[62%] shrink-0 items-center justify-end gap-1 text-[13px] leading-5 text-ink">{children}</span>}
    </div>
    {below && <div className="mt-2 min-w-0">{below}</div>}
  </div>;
}

/** A value shown read-only at the right of a row. */
export function PanelValue({ children, muted = false, className }: { children: ReactNode; muted?: boolean; className?: string }) {
  return <span data-panel-value="" className={cn("min-w-0 truncate text-right text-[13px] leading-5", muted ? "text-ink-tertiary" : "text-ink", className)}>{children}</span>;
}

export function onOff(on: boolean): string {
  return on ? t("routineEditor.on") : t("routineEditor.off");
}

/** A switch row: the switch at the right, or On/Off when viewing. */
export function PanelToggle({ label, hint, help, checked, onChange, viewing = false, disabled, ...rest }: {
  label: string;
  hint?: ReactNode;
  help?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  viewing?: boolean;
  disabled?: boolean;
} & Record<`data-${string}`, string>) {
  return <PanelRow {...rest} label={label} hint={hint} help={help}>
    {viewing ? <PanelValue>{onOff(checked)}</PanelValue> : <Switch checked={checked} disabled={disabled} aria-label={label} onClick={() => onChange(!checked)} />}
  </PanelRow>;
}

/** A choice row: the app's pill menu at the right, or the chosen label when viewing. */
export function PanelSelect<T extends string>({ label, hint, help, value, options, onChange, viewing = false, disabled, ariaLabel, ...rest }: {
  label: string;
  hint?: ReactNode;
  help?: string;
  value: T;
  options: ReadonlyArray<PillOption<T>>;
  onChange: (next: T) => void;
  viewing?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
} & Record<`data-${string}`, string>) {
  return <PanelRow {...rest} label={label} hint={hint} help={help}>
    {viewing
      ? <PanelValue>{options.find((option) => option.value === value)?.label ?? value}</PanelValue>
      : <PillSelect ariaLabel={ariaLabel ?? label} value={value} options={options} onChange={onChange} disabled={disabled} />}
  </PanelRow>;
}

/** A text action ("+ Add a time", "Add"). */
export const PANEL_TEXT_ACTION = "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-accent-text hover:bg-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** A compact pill (a time, an attachment) with an optional ×. */
export function PanelChip({ children, onRemove, removeLabel, ...rest }: { children: ReactNode; onRemove?: () => void; removeLabel?: string } & Record<`data-${string}`, string>) {
  return <span {...rest} className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-full bg-inset pl-2.5 pr-1 text-[12.5px] tabular-nums text-ink">
    <span className="min-w-0 truncate">{children}</span>
    {onRemove
      ? <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel} className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink">
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      : <span className="w-1.5" />}
  </span>;
}

/** A bare input styled like the rows' values (a mail tag, minutes). */
export const PANEL_INPUT = "h-7 min-w-0 rounded-md bg-inset px-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus:ring-2 focus:ring-accent/50";
