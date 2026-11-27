// Small pieces of the ticket window's tabs: a person's name that opens their
// record in the window (M-20261127-101), a note's kind tag, the B, NC or DNB
// tag changed in place (M-20261127-138), and the day an entry is listed under.
import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { RecordRefChip, useOpenRef } from "@/components/RecordCard";
import { MENU_ROW, MENU_ROW_ACTIVE, MENU_SURFACE } from "@/components/menu-look";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { actionFailure } from "@/lib/record-detail";
import type { RecordRef } from "../../../../shared/record-cards";
import { RECORD_BILLING, type RecordBilling } from "../../../../shared/record-actions";

/** A person (or any record named in a row): a chip that opens it in the window when the person may, else words. */
export function RecordName({ name, recordRef, className }: { name: string; recordRef?: RecordRef; className?: string }) {
  const open = useOpenRef(recordRef);
  if (!name) return null;
  return recordRef && open ? <RecordRefChip name={name} refTo={recordRef} onOpen={open} /> : <span dir="auto" className={cn("break-words", className)}>{name}</span>;
}

/** A note's kind: discussion, internal or resolution, in the tone's tint under the popover ink. */
export function NoteKindTag({ kind }: { kind: "discussion" | "internal" | "resolution" }) {
  const tint = kind === "internal" ? "bg-warning/15" : kind === "resolution" ? "bg-success/15" : "bg-popover-hover";
  return <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[12px] leading-4 text-popover-ink", tint)} data-note-kind={kind}>{t(`recordWindow.notes.${kind}` as "recordWindow.notes.internal")}</span>;
}

const BILLING_TINT: Record<RecordBilling, string> = { B: "bg-success/15", NC: "bg-warning/15", DNB: "bg-popover-hover" };
export const BILLING_FILL: Record<RecordBilling, string> = { B: "bg-success", NC: "bg-warning", DNB: "bg-popover-ink-secondary" };

export function billingLabel(billing: RecordBilling): string {
  return t(billing === "B" ? "recordWindow.billing.billable" : billing === "NC" ? "recordWindow.billing.noCharge" : "recordWindow.billing.doNotBill");
}

/** The entry's B, NC or DNB: a tag, changed in place when the console takes it. */
export function BillingTag({ billing, onChange }: { billing?: RecordBilling; onChange?: (next: RecordBilling) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  usePopoverDismiss(open, root, () => setOpen(false));
  if (!billing && !onChange) return null;
  const tag = cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-[12px] font-medium leading-4 text-popover-ink", billing ? BILLING_TINT[billing] : "bg-popover-hover");
  if (!onChange) return <span className={tag} title={billing && billingLabel(billing)} data-billing={billing}>{billing}</span>;
  return (
    <span ref={root} className="relative inline-flex flex-col items-end" onKeyDown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
      <button type="button" disabled={busy} className={cn(tag, "hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50")} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={t("recordWindow.billing.change", { billing: billing ? billingLabel(billing) : t("recordCard.edit.notSet") })} title={billing && billingLabel(billing)} onClick={() => setOpen(!open)} data-billing={billing ?? ""}>
        {billing ?? t("recordCard.edit.notSet")}<ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="menu" className={cn(MENU_SURFACE, "absolute end-0 top-full z-20 mt-1 min-w-48")}>
          {RECORD_BILLING.map((choice) => (
            <button key={choice} type="button" role="menuitemradio" aria-checked={choice === billing} className={choice === billing ? MENU_ROW_ACTIVE : MENU_ROW} data-billing-choice={choice}
              onClick={() => {
                setOpen(false);
                if (choice === billing) return;
                setBusy(true);
                setError("");
                onChange(choice).catch((failure: unknown) => setError(actionFailure(failure))).finally(() => setBusy(false));
              }}>
              <span className={cn("inline-flex h-5 min-w-9 items-center justify-center rounded px-1 text-[12px] font-medium text-popover-ink", BILLING_TINT[choice])}>{choice}</span>
              <span>{billingLabel(choice)}</span>
            </button>
          ))}
        </span>
      )}
      {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
    </span>
  );
}

/** The day an entry is listed under, in the record's zone: its key and its words (26 nov., jeu.). */
export function dayOf(at: string | undefined, fallback: string, tz?: string): { key: string; day: string; weekday: string } {
  const date = at ? new Date(at) : null;
  if (!date || !Number.isFinite(date.getTime())) return { key: `text:${fallback}`, day: fallback, weekday: "" };
  const lang = activeLocale();
  const zone = tz ? { timeZone: tz } : {};
  const key = new Intl.DateTimeFormat("en-CA", { ...zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return {
    key,
    day: new Intl.DateTimeFormat(lang, { ...zone, day: "numeric", month: "short" }).format(date),
    weekday: new Intl.DateTimeFormat(lang, { ...zone, weekday: "short" }).format(date),
  };
}

/** A clock time of an instant, in the record's zone (16 h 10). */
export function clockOf(at: string | undefined, tz?: string): string {
  const date = at ? new Date(at) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(activeLocale(), { ...(tz ? { timeZone: tz } : {}), hour: "numeric", minute: "2-digit" }).format(date);
}

/** A number of hours or an amount, two decimals, in the person's language. */
export function decimal(value: number): string {
  return new Intl.NumberFormat(activeLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** An instant as a local date-time field's value ("2026-12-14T14:30"). */
export function localInput(at: string | undefined): string {
  const date = at ? new Date(at) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}
