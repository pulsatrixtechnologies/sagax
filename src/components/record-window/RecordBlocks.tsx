// The blocks a record window is built of, shared by every kind and every
// plugin (D-20261127-009):
//
// - `RecordWindowTabs`: the record's tabs with their counts, the app's pill
//   tabs; a tab with nothing in it where nothing can be added is not shown
//   (M-20261127-143). It sits out of what scrolls (M-20261127-134).
// - `RecordPod`: a block, a contrasted surface with no border
//   (M-20261127-135), its title and count at the left, its actions at the
//   right (M-20261127-122).
// - `RecordRowActions`: edit and remove at the right of an entry
//   (M-20261127-110, M-20261127-126); removing asks once, in place, never a
//   browser dialog.
// - `RecordAddButton`: the + at the right, alone or opening its menu
//   (a ticket's Meeting, Resource, Activity).
// - `RecordEntryForm`: the input zone a + opens (and an edit), never shown
//   before the click (M-20261127-110).
// - `recordShown`: the one rule of a tab or block that is hidden.
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { PillTabCount, PillTabs } from "@/components/PillTabs";
import { MENU_ROW, MENU_SURFACE } from "@/components/menu-look";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { actionFailure } from "@/lib/record-detail";

/** A tab or a block with nothing in it where nothing can be added is hidden (M-20261127-143). Unknown counts are shown. */
export function recordShown(count: number | undefined, canAdd: boolean): boolean {
  return canAdd || count === undefined || count > 0;
}

/** The record window's 28px icon button: the head's and the rows' (popover tokens). */
export const RECORD_ICON_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-popover-ink-secondary hover:bg-popover-hover hover:text-popover-ink focus-visible:bg-popover-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";
/** A labelled action in a block (Me planifier, + Temps): a soft pill. */
export const RECORD_ACTION = "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-popover-hover px-3 text-[13px] font-medium leading-[18px] text-popover-ink hover:bg-popover-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";
/** The primary action of a form (Send, Save). */
export const RECORD_PRIMARY = "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-popover-ink px-3.5 text-[13px] font-medium leading-[18px] text-popover hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";
/** A quiet text action (Show completed). */
export const RECORD_LINK_ACTION = "inline-flex items-center gap-1 rounded text-[13px] leading-[18px] text-popover-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export interface RecordTab<T extends string> {
  id: T;
  label: string;
  /** the number of entries, beside the label (unknown: no number) */
  count?: number;
  /** the person can add to it: shown even empty */
  canAdd?: boolean;
}

export function RecordWindowTabs<T extends string>({ tabs, tab, onTab, label, idPrefix, className }: {
  tabs: readonly RecordTab<T>[];
  tab: T;
  onTab: (tab: T) => void;
  label: string;
  idPrefix: string;
  className?: string;
}) {
  const shown = tabs.filter((one) => one.id === tab || recordShown(one.count, Boolean(one.canAdd)));
  const byId = new Map(shown.map((one) => [one.id, one]));
  return (
    <PillTabs
      tabs={shown.map((one) => one.id)} tab={tab} onTab={onTab} ariaLabel={label} idPrefix={idPrefix}
      label={(id) => byId.get(id)?.label ?? id}
      after={(id) => byId.get(id)?.count === undefined ? null : <PillTabCount count={byId.get(id)!.count!} />}
      tabAttributes={(id) => ({ "data-record-tab": id })}
      className={cn("gap-y-1 border-b border-popover-hairline px-4 py-2", className)}
      data-record-tabs=""
    />
  );
}

/** A block: a contrasted surface, no border; its head (title, count, then its actions at the right) and its body. */
export function RecordPod({ title, count, actions, collapsible = false, children, className, bodyClassName, ...data }: {
  title?: ReactNode;
  count?: number;
  /** at the right of the head: its actions, then its + */
  actions?: ReactNode;
  collapsible?: boolean;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
} & Record<`data-${string}`, string | undefined>) {
  const [folded, setFolded] = useState(false);
  const id = useId();
  const head = title !== undefined || actions || collapsible;
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-xl bg-popover-field p-4", className)} data-record-pod="" {...data}>
      {head && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {title !== undefined && <h3 className="text-[14px] font-semibold leading-5" id={`${id}-title`}>{title}</h3>}
          {count !== undefined && <PillTabCount count={count} />}
          <span className="ms-auto flex flex-wrap items-center justify-end gap-1.5">
            {actions}
            {collapsible && (
              <button type="button" className={RECORD_ICON_BUTTON} aria-expanded={!folded} aria-controls={`${id}-body`} aria-label={t(folded ? "recordWindow.unfold" : "recordWindow.fold")} title={t(folded ? "recordWindow.unfold" : "recordWindow.fold")} onClick={() => setFolded(!folded)}>
                {folded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
              </button>
            )}
          </span>
        </div>
      )}
      {!folded && children !== undefined && <div id={`${id}-body`} className={cn("flex min-w-0 flex-col", bodyClassName)}>{children}</div>}
    </section>
  );
}

/** Edit and remove, at the right of an entry. Remove asks once, in place. */
export function RecordRowActions({ name, onEdit, onRemove }: {
  /** the entry, for the buttons' names */
  name: string;
  onEdit?: () => void;
  onRemove?: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!onEdit && !onRemove) return null;
  if (asking && onRemove) {
    return (
      <span className="ms-auto flex shrink-0 flex-wrap items-center justify-end gap-1" data-record-row-confirm="">
        <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{error || t("recordWindow.removeAsk")}</span>
        <button type="button" disabled={busy} className={cn(RECORD_ICON_BUTTON, "text-danger hover:text-danger")} aria-label={t("recordWindow.removeConfirm", { name })} title={t("recordWindow.removeConfirm", { name })}
          onClick={() => {
            setBusy(true);
            setError("");
            onRemove().then(() => setAsking(false), (failure: unknown) => setError(actionFailure(failure))).finally(() => setBusy(false));
          }}><Check size={16} aria-hidden="true" /></button>
        <button type="button" disabled={busy} className={RECORD_ICON_BUTTON} aria-label={t("recordWindow.cancel")} title={t("recordWindow.cancel")} onClick={() => { setAsking(false); setError(""); }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setAsking(false); } }}><X size={16} aria-hidden="true" /></button>
      </span>
    );
  }
  return (
    <span className="ms-auto flex shrink-0 items-center gap-0.5" data-record-row-actions="">
      {onEdit && <button type="button" className={RECORD_ICON_BUTTON} aria-label={t("recordWindow.edit", { name })} title={t("recordWindow.edit", { name })} onClick={onEdit} data-record-edit=""><Pencil size={14} aria-hidden="true" /></button>}
      {onRemove && <button type="button" className={cn(RECORD_ICON_BUTTON, "hover:text-danger")} aria-label={t("recordWindow.remove", { name })} title={t("recordWindow.remove", { name })} onClick={() => setAsking(true)} data-record-remove=""><Trash2 size={14} aria-hidden="true" /></button>}
    </span>
  );
}

/** The + at the right: one action, or a menu of the kinds it adds. */
export function RecordAddButton<T extends string>({ label, onAdd, choices }: {
  label: string;
  onAdd: (choice?: T) => void;
  choices?: readonly { id: T; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  usePopoverDismiss(open, root, () => setOpen(false));
  if (!choices?.length) {
    return <button type="button" className={RECORD_ICON_BUTTON} aria-label={label} title={label} onClick={() => onAdd()} data-record-add=""><Plus size={16} aria-hidden="true" /></button>;
  }
  return (
    <span ref={root} className="relative inline-flex" onKeyDown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
      <button type="button" className={RECORD_ICON_BUTTON} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} data-record-add="">
        <Plus size={16} aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="menu" aria-label={label} className={cn(MENU_SURFACE, "absolute end-0 top-full z-20 mt-1 min-w-40")}>
          {choices.map((choice) => (
            <button key={choice.id} type="button" role="menuitem" className={MENU_ROW} data-record-add-choice={choice.id} onClick={() => { setOpen(false); onAdd(choice.id); }}>{choice.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}

export type RecordFormField =
  | { key: string; label: string; kind: "text" | "textarea"; value?: string; required?: boolean; max?: number; placeholder?: string }
  | { key: string; label: string; kind: "number"; value?: string; required?: boolean; min?: number; max?: number; step?: number; placeholder?: string }
  | { key: string; label: string; kind: "datetime" | "date"; value?: string; required?: boolean }
  | { key: string; label: string; kind: "choice"; value?: string; required?: boolean; choices: readonly { value: string; label: string }[] }
  | { key: string; label: string; kind: "file"; required?: boolean };

export type RecordFormValues = Record<string, string | File | undefined>;

const INPUT = "min-w-0 rounded-lg bg-popover px-2.5 py-1.5 text-[14px] leading-5 text-popover-ink placeholder:text-popover-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** The input zone a + (or an edit) opens: its fields, then Cancel and the primary action at the right. Enter in a one-line field saves, Escape leaves. */
export function RecordEntryForm({ fields, submitLabel, onSubmit, onCancel, extra, className, ...data }: {
  fields: readonly RecordFormField[];
  submitLabel: string;
  onSubmit: (values: RecordFormValues) => Promise<void>;
  onCancel: () => void;
  /** beside the actions, at the left (a note's kind, Attach, + Time) */
  extra?: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const [values, setValues] = useState<RecordFormValues>(() => Object.fromEntries(fields.map((field) => [field.key, field.kind === "file" ? undefined : ("value" in field ? field.value ?? "" : "")])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const missing = fields.some((field) => field.required && !values[field.key]);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || missing) return;
    setBusy(true);
    setError("");
    onSubmit(values).catch((failure: unknown) => setError(actionFailure(failure))).finally(() => setBusy(false));
  };
  const set = (key: string, value: string | File | undefined) => setValues((now) => ({ ...now, [key]: value }));
  return (
    <form className={cn("flex min-w-0 flex-col gap-3 rounded-xl bg-popover-field p-3", className)} onSubmit={submit} data-record-form="" {...data}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
      <div className="grid min-w-0 grid-cols-1 gap-2.5 @min-[36rem]:grid-cols-2">
        {fields.map((field, index) => {
          const fieldId = `${id}-${field.key}`;
          const wide = field.kind === "textarea" || field.kind === "file";
          const value = values[field.key];
          const control = (() => {
            switch (field.kind) {
              case "textarea":
                return <textarea id={fieldId} autoFocus={index === 0} rows={3} maxLength={field.max} required={field.required} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} dir="auto"
                  className={cn(INPUT, "resize-y [field-sizing:content] min-h-16")} onChange={(event) => set(field.key, event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }} />;
              case "choice":
                return <select id={fieldId} autoFocus={index === 0} required={field.required} value={typeof value === "string" ? value : ""} className={INPUT} onChange={(event) => set(field.key, event.target.value)}>
                  {!field.required && <option value="">{t("recordCard.edit.notSet")}</option>}
                  {field.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>;
              case "file":
                return <input id={fieldId} type="file" required={field.required} className={cn(INPUT, "file:me-2 file:rounded-md file:border-0 file:bg-popover-hover file:px-2 file:py-1 file:text-popover-ink")}
                  onChange={(event) => set(field.key, event.target.files?.[0])} />;
              case "number":
                return <input id={fieldId} autoFocus={index === 0} type="number" inputMode="decimal" min={field.min} max={field.max} step={field.step ?? "any"} required={field.required} placeholder={field.placeholder}
                  value={typeof value === "string" ? value : ""} className={INPUT} onChange={(event) => set(field.key, event.target.value)} />;
              case "datetime":
              case "date":
                return <input id={fieldId} autoFocus={index === 0} type={field.kind === "date" ? "date" : "datetime-local"} required={field.required} value={typeof value === "string" ? value : ""} className={INPUT} onChange={(event) => set(field.key, event.target.value)} />;
              default:
                return <input id={fieldId} autoFocus={index === 0} type="text" maxLength={field.max} required={field.required} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} dir="auto" className={INPUT} onChange={(event) => set(field.key, event.target.value)} />;
            }
          })();
          return (
            <label key={field.key} htmlFor={fieldId} className={cn("flex min-w-0 flex-col gap-1", wide && "@min-[36rem]:col-span-2")}>
              <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{field.label}</span>
              {control}
            </label>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {extra}
        <span className="ms-auto flex items-center gap-2">
          {error && <span role="alert" className="text-[13px] leading-[18px] text-danger">{error}</span>}
          <button type="button" className={RECORD_ACTION} onClick={onCancel} disabled={busy}>{t("recordWindow.cancel")}</button>
          <button type="submit" className={RECORD_PRIMARY} disabled={busy || missing} data-record-form-submit="">{submitLabel}</button>
        </span>
      </div>
    </form>
  );
}

/** A person's or a company's initials in a round tile (no picture: the console sends none). */
export function RecordAvatar({ name, size = "sm", square = false }: { name: string; size?: "sm" | "lg"; square?: boolean }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? `${Array.from(words[0]!)[0]}${Array.from(words.at(-1)!)[0]}` : Array.from(words[0] ?? "?").slice(0, 2).join("")).toLocaleUpperCase();
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center bg-popover-hover font-medium leading-none text-popover-ink", size === "lg" ? "size-10 text-[14px]" : "size-7 text-[11px]", square ? "rounded-lg" : "rounded-full")} data-record-avatar="">
      {initials || "?"}
    </span>
  );
}
