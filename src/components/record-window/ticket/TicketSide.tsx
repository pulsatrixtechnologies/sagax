// A ticket's fields column, version A (D-20261127-008, M-20261127-119): the
// company card on top (the company, the contact and their phone, the site),
// then the named fields (Owner, Team, Location, Board, Type > Subtype > Item
// on one line, Time with its billable share, Agreement), the dates small at
// the foot. Every value with a picker changes in place (the card's field
// pickers, RecordFieldSelect); a person or a company opens its record in the
// window. It stays beside every tab (M-20261127-105).
//
// The fields are the console's: a field takes its slot by its `editKey` (or
// its `role`), never by its words; a field of no slot keeps its own label
// under the named ones, and an editable field the card holds no value for is
// still a choice to make. Nothing of the card is left out.
import type { ReactNode } from "react";
import { Building2, ChevronRight } from "lucide-react";
import { FieldValue, PersonLine, RecordRefChip, ROOMY_FIELD_SELECT, ROOMY_FIELD_UNSET, useOpenRef, useRecordEdits } from "@/components/RecordCard";
import { RecordFieldSelect } from "@/components/RecordFieldSelect";
import { RecordAvatar } from "@/components/record-window/RecordBlocks";
import { RecordName } from "./parts";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatFull, formatLateness, formatRelative } from "@/lib/record-card-format";
import type { RecordCard as Card, RecordField, RecordRef } from "../../../../shared/record-cards";

/** The named slots, in their order (Type, Subtype and Item share one line). */
const SLOTS = ["owner", "team", "location", "board", "type", "time", "agreement"] as const;
type Slot = (typeof SLOTS)[number];
const TYPE_PARTS = ["type", "subtype", "item"] as const;

const LABEL: Record<Slot, string> = {
  owner: "recordWindow.side.owner",
  team: "recordWindow.side.team",
  location: "recordWindow.side.location",
  board: "recordWindow.side.board",
  type: "recordWindow.side.type",
  time: "recordWindow.side.time",
  agreement: "recordWindow.side.agreement",
};

const keyOf = (field: RecordField) => field.editKey ?? field.role;

/** The ticket's hours, from the time tab's totals when they are read, else the card's own field. */
export interface TicketHours {
  hours?: string;
  billable?: string;
  /** the billable share, 0 to 100 */
  share?: number;
}

function Value({ field, slot, label, now, tz }: { field?: RecordField; slot: string; label: string; now: number; tz?: string }) {
  const edits = useRecordEdits();
  if (field) return <FieldValue field={field} label={label} now={now} lang={activeLocale()} tz={tz} />;
  const edit = edits?.[slot];
  if (edit) return <RecordFieldSelect edit={edit} current={t("recordCard.edit.notSet")} label={label} triggerClass={ROOMY_FIELD_UNSET} />;
  return null;
}

function Person({ name, personRef, detail }: { name: string; personRef?: RecordRef; detail?: string }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-popover-ink-secondary">
      <RecordName name={name} recordRef={personRef} />
      {detail && <span dir="ltr" className="whitespace-nowrap [unicode-bidi:isolate]">· {detail}</span>}
    </span>
  );
}

export function TicketSide({ card, hours, now }: { card: Card; hours?: TicketHours; now: number }) {
  const edits = useRecordEdits();
  const lang = activeLocale();
  const tz = card.tz;
  const fields = card.fields ?? [];
  const bySlot = new Map<string, RecordField>();
  for (const field of fields) { const key = keyOf(field); if (key && !bySlot.has(key)) bySlot.set(key, field); }
  const hoursField = fields.find((field) => field.role === "hours" || field.editKey === "hours" || field.type === "duration");
  const site = bySlot.get("site");
  const people = card.people ?? [];
  const owner = people.find((person) => person.role === "owner");
  const contact = people.find((person) => person.role === "contact");
  const others = people.filter((person) => person !== owner && person !== contact);
  const companyOpen = useOpenRef(card.company?.ref);
  const used = new Set<RecordField>([...(site ? [site] : []), ...(hoursField ? [hoursField] : [])]);
  const rows: Array<{ key: string; label: string; value: ReactNode }> = [];
  for (const slot of SLOTS) {
    const label = t(LABEL[slot] as "recordWindow.side.owner");
    if (slot === "owner") {
      if (owner || edits?.owner) rows.push({ key: slot, label, value: owner ? <span className="flex min-w-0 items-start gap-2" data-record-person="owner"><PersonLine role="owner" label={label} name={owner.name} detail={owner.detail} personRef={owner.ref} labelled /></span> : <Value slot="owner" label={label} now={now} tz={tz} /> });
      continue;
    }
    if (slot === "type") {
      const parts = TYPE_PARTS.map((part) => ({ part, field: bySlot.get(part) })).filter(({ part, field }) => field || edits?.[part]);
      if (!parts.length) continue;
      parts.forEach(({ field }) => { if (field) used.add(field); });
      rows.push({
        key: slot, label, value: (
          <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5" data-record-type-line="">
            {parts.map(({ part, field }, index) => (
              <span key={part} className="inline-flex min-w-0 items-center gap-1">
                {index > 0 && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary rtl:-scale-x-100" />}
                <Value field={field} slot={part} label={t(`recordCard.edit.${part}` as "recordCard.edit.type")} now={now} tz={tz} />
              </span>
            ))}
          </span>
        ),
      });
      continue;
    }
    if (slot === "time") {
      const text = hours?.hours ?? hoursField?.value;
      if (!text) continue;
      rows.push({
        key: slot, label, value: (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1" data-record-hours="">
            <span className="tabular-nums">{text}</span>
            {hours?.share !== undefined && (
              <span role="progressbar" aria-label={t("recordWindow.side.billableShare")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hours.share)} className="h-1 w-14 overflow-hidden rounded-full bg-popover-hover">
                <span className="block h-full rounded-full bg-success" style={{ width: `${Math.max(0, Math.min(100, hours.share))}%` }} />
              </span>
            )}
            {hours?.billable && <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{t("recordWindow.side.billable", { hours: hours.billable })}</span>}
          </span>
        ),
      });
      continue;
    }
    const field = bySlot.get(slot);
    if (!field && !edits?.[slot]) continue;
    if (field) used.add(field);
    rows.push({ key: slot, label, value: <Value field={field} slot={slot} label={label} now={now} tz={tz} /> });
  }
  // a field of no slot keeps its own label; an editable one with no value is still a choice
  for (const field of fields) {
    if (used.has(field) || (keyOf(field) && (SLOTS as readonly string[]).includes(keyOf(field)!)) || (keyOf(field) && (TYPE_PARTS as readonly string[]).includes(keyOf(field)!))) continue;
    rows.push({ key: `field-${rows.length}`, label: field.label, value: <FieldValue field={field} label={field.label} now={now} lang={lang} tz={tz} /> });
  }
  for (const person of others) rows.push({ key: `person-${person.role}`, label: person.label ?? person.role, value: <span className="flex min-w-0 items-start gap-2"><PersonLine role={person.role} label={person.label} name={person.name} detail={person.detail} personRef={person.ref} labelled /></span> });
  const placed = new Set<string>(["status", "priority", "owner", "contact", "site", ...SLOTS, ...TYPE_PARTS, ...fields.map(keyOf).filter((key): key is string => Boolean(key))]);
  for (const [key, edit] of Object.entries(edits ?? {})) {
    if (placed.has(key)) continue;
    const label = t(`recordCard.edit.${key}` as "recordCard.edit.board");
    rows.push({ key: `edit-${key}`, label, value: <RecordFieldSelect edit={edit} current={t("recordCard.edit.notSet")} label={label} triggerClass={ROOMY_FIELD_UNSET} /> });
  }
  const dates = card.dates ?? {};
  const when = (iso: string, mode: "relative" | "absolute") => <time dateTime={iso} title={formatFull(iso, lang, tz)}>{mode === "relative" ? formatRelative(iso, now, lang, tz) : formatAbsolute(iso, now, lang, tz)}</time>;
  const late = dates.due && card.state?.tone !== "done" && !dates.closed ? formatLateness(dates.due, now, lang, tz) : null;
  const dateParts: ReactNode[] = [
    ...(dates.opened ? [<span key="opened">{t("recordWindow.side.opened")} {when(dates.opened, "relative")}</span>] : []),
    ...(dates.updated ? [<span key="updated">{t("recordWindow.side.updated")} {when(dates.updated, "relative")}</span>] : []),
    ...(dates.due ? [<span key="due" className={late ? "text-danger" : undefined}>{t("recordWindow.side.due")} {when(dates.due, "absolute")}{late ? ` (${t("recordCard.late", { duration: late })})` : ""}</span>] : []),
    ...(dates.closed ? [<span key="closed">{t("recordWindow.side.closed")} {when(dates.closed, "absolute")}</span>] : []),
  ];
  const showCompany = Boolean(card.company || contact || site || edits?.contact || edits?.site);
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-record-pane="left" data-record-ticket-side="">
      {showCompany && (
        <section className="flex min-w-0 items-start gap-3 rounded-xl bg-popover-field p-3" data-record-company-card="" aria-label={t("recordCard.company")}>
          {card.company ? <RecordAvatar name={card.company.name} size="lg" square /> : <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary"><Building2 size={18} /></span>}
          <div className="flex min-w-0 flex-col gap-0.5">
            {card.company && (
              <span className="min-w-0 font-medium" data-record-company="">
                {card.company.ref && companyOpen ? <RecordRefChip name={card.company.name} refTo={card.company.ref} onOpen={companyOpen} slot="company" /> : <span dir="auto" className="break-words">{card.company.name}</span>}
              </span>
            )}
            {edits?.contact
              ? <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px]" data-record-person="contact"><RecordFieldSelect edit={edits.contact} current={contact?.name ?? t("recordCard.edit.notSet")} label={t("recordCard.edit.contact")} triggerClass={ROOMY_FIELD_SELECT} />{contact?.detail && <span dir="ltr" className="whitespace-nowrap text-popover-ink-secondary">· {contact.detail}</span>}</span>
              : contact && <span data-record-person="contact"><Person name={contact.name} personRef={contact.ref} detail={contact.detail} /></span>}
            {(site || edits?.site) && <span className="min-w-0 text-[13px] leading-[18px] text-popover-ink-secondary" data-record-site="">{site ? <FieldValue field={site} label={site.label} now={now} lang={lang} tz={tz} /> : <Value slot="site" label={t("recordWindow.side.site")} now={now} tz={tz} />}</span>}
          </div>
        </section>
      )}
      {(rows.length > 0 || dateParts.length > 0) && (
        <section className="flex min-w-0 flex-col gap-3 rounded-xl bg-popover-field p-3" data-record-fields="">
          {rows.length > 0 && (
            <dl className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5 text-[14px] leading-[22px]" data-record-facts="">
              {rows.map((row) => (
                <div key={row.key} className="contents">
                  <dt className="max-w-[10rem] break-words text-[13px] text-popover-ink-secondary">{row.label}</dt>
                  <dd className="min-h-[22px] min-w-0 break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {dateParts.length > 0 && (
            <p className="flex flex-wrap gap-x-1.5 border-t border-popover-hairline pt-2.5 text-[12px] leading-4 text-popover-ink-secondary" data-record-dates="">
              {dateParts.map((part, index) => <span key={index} className="inline-flex gap-x-1.5">{index > 0 && <span aria-hidden="true">·</span>}{part}</span>)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
