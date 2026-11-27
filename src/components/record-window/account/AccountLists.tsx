// A company's and a contact's list tabs (M-20261127-101, M-20261127-140):
// Notes, Contacts (cards with their roles, phone, email and portal),
// Activities (what comes, then what is done, with "Done" on each row),
// Configurations (by type), Attachments, Sites and a contact's History. Each
// list sits under the one filter (M-20261127-139); its + is at the right and
// opens its form only on a click (M-20261127-122, M-20261127-110); every
// entry the console lets the person change has edit and remove at its right
// (M-20261127-126).
import { useEffect, useState, type ReactNode } from "react";
import { Activity, CalendarDays, Check, Download, Laptop, Mail, MapPin, Monitor, Network, Phone, Plus, Printer, RotateCcw, Server, Shield, Smartphone, SquareCheck, Users } from "lucide-react";
import { RecordMarkdown } from "@/components/RecordMarkdown";
import { RECORD_ACTION, RecordAvatar, RecordEntryForm, RecordPod, RecordRowActions, type RecordFormField, type RecordFormValues } from "@/components/record-window/RecordBlocks";
import { RecordFilter, RecordList, filterRecordRows, type RecordColumn } from "@/components/record-window/RecordGrid";
import { RecordName } from "@/components/record-window/ticket/parts";
import { newestFirst } from "@/components/record-window/ticket/TicketNotesTab";
import { PlanForm, type PlanRow } from "@/components/record-window/ticket/TicketPlanTab";
import type { RecordDetail } from "@/components/useRecordDetail";
import type { DataFilterValue } from "@/components/data/DataFilter";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { attachmentOf, type ActivityKind, type ActivityRow, type AttachmentRow, type ConfigurationKind, type ConfigurationRow, type ContactRow, type HistoryRow, type RecordChoice, type SiteRow, type TicketNote } from "@/lib/record-detail";
import { RECORD_EMAIL_MAX, RECORD_NAME_MAX, RECORD_NOTE_MAX, RECORD_PHONE_MAX, type RecordActionName } from "../../../../shared/record-actions";
import { DateBlock, whenWords, type When } from "./AccountProfile";
import type { AccountKind } from "./account-model";

/** A tab's panel: its padding, its name for the captures and the tests. */
export function Panel({ name, children }: { name: string; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-3 p-5" data-record-tab-panel={name}>{children}</div>;
}

/** A section not read yet, or not read: one quiet line. */
export function SectionStatus({ state }: { state: { error: string } }) {
  return <p role="status" className="py-2 text-popover-ink-secondary">{state.error || t("recordCard.loading")}</p>;
}

/** A labelled + at the right ("+ New contact"). */
export function AddAction({ label, onAdd, name }: { label: string; onAdd: () => void; name: string }) {
  return <button type="button" className={RECORD_ACTION} onClick={onAdd} data-record-add-entry={name}><Plus size={14} aria-hidden="true" />{label}</button>;
}

/** A small fact with its icon (a phone, an address, a count). */
export function Mini({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return <span className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]" title={title}><span aria-hidden="true" className="shrink-0 text-popover-ink-secondary">{icon}</span><span dir="auto" className="min-w-0 truncate">{children}</span></span>;
}

/** The values a form changed, so an edit sends only what the person changed. */
function changed(values: RecordFormValues, before: Record<string, string>): Record<string, string> {
  const set: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) if (typeof value === "string" && value.trim() !== (before[key] ?? "")) set[key] = value.trim();
  return set;
}

// ── Notes ──

function AccountNote({ note, detail, when }: { note: TicketNote; detail: RecordDetail; when: When }) {
  const [editing, setEditing] = useState(false);
  const name = note.author || t("recordCard.related.unknownAuthor");
  const id = note.id;
  if (editing && id) {
    return (
      <RecordEntryForm data-record-note-edit="" submitLabel={t("recordWindow.save")} onCancel={() => setEditing(false)}
        fields={[{ key: "text", label: t("recordWindow.notes.text"), kind: "textarea", value: note.body, required: true, max: RECORD_NOTE_MAX }]}
        onSubmit={async (values) => { await detail.write({ action: "note.update", id, set: { text: String(values.text ?? "") } }); setEditing(false); }} />
    );
  }
  return (
    <>
      <div className="flex min-w-0 items-start gap-3">
        <RecordAvatar name={name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium"><RecordName name={name} recordRef={note.authorRef} /></span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-popover-ink-secondary">
            <span>{whenWords(note.timestamp && Number.isFinite(Date.parse(note.timestamp)) ? note.timestamp : undefined, note.date, when)}</span>
            {note.on && <>· {t("recordWindow.account.noteOn")} <RecordName name={note.on} recordRef={note.onRef} /></>}
          </span>
        </span>
        <RecordRowActions name={t("recordWindow.notes.noteOf", { name })}
          onEdit={id && detail.can("note.update") ? () => setEditing(true) : undefined}
          onRemove={id && detail.can("note.remove") ? () => detail.write({ action: "note.remove", id }) : undefined} />
      </div>
      <RecordMarkdown text={note.body} readImage={detail.readImage} />
    </>
  );
}

export function AccountNotesTab({ detail, when }: { detail: RecordDetail; when: When }) {
  const state = detail.section("notes");
  const [adding, setAdding] = useState(false);
  const columns: RecordColumn<TicketNote>[] = [
    { id: "author", label: t("recordWindow.account.author"), text: (row) => row.author },
    { id: "text", label: t("recordWindow.notes.text"), text: (row) => row.body },
    { id: "on", label: t("recordWindow.account.tabs.tickets"), text: (row) => row.on ?? "" },
  ];
  const canAdd = detail.can("note.add");
  return (
    <Panel name="notes">
      {adding && (
        <RecordEntryForm data-record-note-form="" submitLabel={t("recordWindow.account.addNote")} onCancel={() => setAdding(false)}
          fields={[{ key: "text", label: t("recordWindow.notes.text"), kind: "textarea", required: true, max: RECORD_NOTE_MAX }]}
          onSubmit={async (values) => { await detail.write({ action: "note.add", set: { text: String(values.text ?? "") } }); setAdding(false); }} />
      )}
      {!state.page ? <SectionStatus state={state} /> : (
        <RecordList layout="stack" label={t("recordWindow.tabs.notes")} columns={columns} rows={newestFirst(state.page.lines)} rowKey={(row) => row.id ?? `${row.timestamp}-${row.author}`}
          toolbar={canAdd && !adding ? <AddAction name="note" label={t("recordWindow.notes.new")} onAdd={() => setAdding(true)} /> : undefined}
          empty={t("recordWindow.notes.none")}
          row={(note) => <AccountNote note={note} detail={detail} when={when} />} />
      )}
    </Panel>
  );
}

// ── Contacts ──

const CONTACT_FORM = (row?: ContactRow): RecordFormField[] => [
  { key: "first_name", label: t("recordWindow.account.contact.firstName"), kind: "text", required: !row, max: RECORD_NAME_MAX, ...(row ? { placeholder: row.name } : {}) },
  { key: "last_name", label: t("recordWindow.account.contact.lastName"), kind: "text", max: RECORD_NAME_MAX },
  { key: "title", label: t("recordWindow.account.contact.title"), kind: "text", max: RECORD_NAME_MAX, value: row?.title ?? "" },
  { key: "phone", label: t("recordWindow.account.contact.phone"), kind: "text", max: RECORD_PHONE_MAX, value: row?.phone ?? "" },
  { key: "email", label: t("recordWindow.account.contact.email"), kind: "text", max: RECORD_EMAIL_MAX, value: row?.email ?? "" },
];

function ContactCard({ row, detail, onEdit }: { row: ContactRow; detail: RecordDetail; onEdit?: () => void }) {
  return (
    <>
      <div className="flex min-w-0 items-start gap-3">
        <span className="[&>[data-record-avatar]]:size-11"><RecordAvatar name={row.name} size="lg" /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 font-medium"><RecordName name={row.name} recordRef={row.ref} /></span>
          {row.title && <span dir="auto" className="break-words text-[13px] leading-[18px] text-popover-ink-secondary">{row.title}</span>}
        </span>
        <RecordRowActions name={row.name} onEdit={row.id && detail.can("contact.update") ? onEdit : undefined}
          onRemove={row.id && detail.can("contact.remove") ? () => detail.write({ action: "contact.remove", id: row.id! }) : undefined} />
      </div>
      {row.roles.length > 0 && <span className="flex flex-wrap gap-1.5">{row.roles.map((role) => <span key={role} className="inline-flex h-6 items-center rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]">{role}</span>)}</span>}
      {(row.phone || row.email) && (
        <span className="flex min-w-0 flex-wrap gap-1.5">
          {row.phone && <Mini icon={<Phone size={13} />}>{row.phone}</Mini>}
          {row.email && <Mini icon={<Mail size={13} />} title={row.email}>{row.email}</Mini>}
        </span>
      )}
      {(row.portal || row.inactive) && <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.portal && t("recordWindow.account.portal", { state: row.portal }), row.inactive && t("recordWindow.account.inactive")].filter(Boolean).join(" · ")}</span>}
    </>
  );
}

export function AccountContactsTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("contacts");
  const [form, setForm] = useState<{ row?: ContactRow } | null>(null);
  const columns: RecordColumn<ContactRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "title", label: t("recordWindow.account.contact.title"), text: (row) => row.title },
    { id: "roles", label: t("recordWindow.account.roles"), text: (row) => row.roles.join(" ") },
    { id: "phone", label: t("recordWindow.account.contact.phone"), text: (row) => row.phone },
    { id: "email", label: t("recordWindow.account.contact.email"), text: (row) => row.email },
  ];
  const editing = form?.row;
  return (
    <Panel name="contacts">
      {form && (
        <RecordEntryForm key={editing?.id ?? "new"} data-record-contact-form="" fields={CONTACT_FORM(editing)} onCancel={() => setForm(null)}
          submitLabel={editing ? t("recordWindow.save") : t("recordWindow.account.addContact")}
          onSubmit={async (values) => {
            if (editing?.id) {
              const set = changed(values, { title: editing.title, phone: editing.phone, email: editing.email });
              if (Object.keys(set).length) await detail.write({ action: "contact.update", id: editing.id, set });
            } else {
              await detail.write({ action: "contact.add", set: changed(values, {}) });
            }
            setForm(null);
          }} />
      )}
      {!state.page ? <SectionStatus state={state} /> : (
        <RecordList layout="cards" label={t("recordWindow.account.tabs.contacts")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id ?? row.name}
          toolbar={detail.can("contact.add") && !form ? <AddAction name="contact" label={t("recordWindow.account.newContact")} onAdd={() => setForm({})} /> : undefined}
          row={(row) => <ContactCard row={row} detail={detail} onEdit={() => setForm({ row })} />} />
      )}
    </Panel>
  );
}

// ── Activities ──

const ACTIVITY_ICON: Record<ActivityKind, typeof Activity> = { task: SquareCheck, email: Mail, call: Phone, meeting: CalendarDays, other: Activity };

/** What comes first (the nearest first), then what is done (the last first). */
export function activityGroups(rows: readonly ActivityRow[]): { open: ActivityRow[]; done: ActivityRow[] } {
  const time = (row: ActivityRow) => (row.at ? Date.parse(row.at) : NaN);
  const by = (sign: 1 | -1) => (a: ActivityRow, b: ActivityRow) => {
    const left = time(a), right = time(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return sign * (left - right);
    return Number.isFinite(left) === Number.isFinite(right) ? 0 : Number.isFinite(left) ? -1 : 1;
  };
  return { open: rows.filter((row) => !row.done).sort(by(1)), done: rows.filter((row) => row.done).sort(by(-1)) };
}

const planRowOf = (row: ActivityRow): PlanRow => ({ key: row.id ?? row.subject, ...(row.id ? { id: row.id } : {}), kind: "activity", title: row.subject, when: row.date, where: "", ...(row.at ? { at: row.at } : {}), done: row.done === true });

function ActivityLine({ row, detail, tz, onEdit }: { row: ActivityRow; detail: RecordDetail; tz?: string; onEdit: () => void }) {
  const Icon = ACTIVITY_ICON[row.typeKind ?? "other"];
  const done = row.done === true;
  return (
    <>
      <DateBlock at={row.at} tz={tz} />
      <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary" title={row.type}><Icon size={15} /></span>
      <span className={cn("flex min-w-0 flex-1 flex-col", done && "text-popover-ink-secondary")}>
        <span dir="auto" className="break-words font-medium">{row.subject}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] leading-[18px] text-popover-ink-secondary">
          {[!row.at && row.date, row.type].filter(Boolean).join(" · ")}
          {row.contact && <>{row.type ? ` ${t("recordWindow.account.with")}` : ""} <RecordName name={row.contact} recordRef={row.contactRef} /></>}
        </span>
      </span>
      {row.assigned && <span title={row.assigned} className="shrink-0"><RecordAvatar name={row.assigned} /><span className="sr-only">{t("recordWindow.schedule.assigned")}: {row.assigned}</span></span>}
      {row.id && detail.can("schedule.done") ? (
        <button type="button" className={cn(RECORD_ACTION, done && "bg-transparent text-popover-ink-secondary hover:bg-popover-hover")} data-record-mark-done={done ? "reopen" : "done"}
          onClick={() => { void detail.write({ action: "schedule.done", id: row.id!, set: { kind: "activity", done: !done } }); }}>
          {done ? <RotateCcw size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{t(done ? "recordWindow.schedule.reopen" : "recordWindow.account.done")}
        </button>
      ) : done ? <span className="shrink-0 text-[13px] text-popover-ink-secondary">{t("recordWindow.account.isDone")}</span> : null}
      <RecordRowActions name={row.subject} onEdit={row.id && detail.can("schedule.update") ? onEdit : undefined}
        onRemove={row.id && detail.can("schedule.remove") ? () => detail.write({ action: "schedule.remove", id: row.id!, set: { kind: "activity" } }) : undefined} />
    </>
  );
}

export function AccountActivitiesTab({ detail, when }: { detail: RecordDetail; when: When }) {
  const state = detail.section("activities");
  const [value, setValue] = useState<DataFilterValue>({ text: "" });
  const [form, setForm] = useState<{ row?: PlanRow } | null>(null);
  const rows = state.page?.lines ?? [];
  const columns: RecordColumn<ActivityRow>[] = [
    { id: "subject", label: t("recordWindow.schedule.subject"), text: (row) => row.subject },
    { id: "type", label: t("recordCard.related.type"), text: (row) => row.type },
    { id: "contact", label: t("recordWindow.account.contactColumn"), text: (row) => row.contact ?? "" },
    { id: "assigned", label: t("recordWindow.schedule.assigned"), text: (row) => row.assigned },
    { id: "date", label: t("recordCard.related.date"), kind: "date", text: (row) => row.date },
  ];
  const { open, done } = activityGroups(filterRecordRows(rows, columns, value));
  const group = (title: string, list: ActivityRow[], name: string) => list.length > 0 && (
    <RecordPod title={title} count={list.length} data-record-activities={name}>
      <ul className="flex min-w-0 flex-col divide-y divide-popover-hairline">
        {list.map((row, index) => (
          <li key={row.id ?? `${row.subject}-${index}`} className="flex min-w-0 items-center gap-3 py-2.5" data-record-activity={row.done ? "done" : "open"}>
            <ActivityLine row={row} detail={detail} tz={when.tz} onEdit={() => setForm({ row: planRowOf(row) })} />
          </li>
        ))}
      </ul>
    </RecordPod>
  );
  return (
    <Panel name="activities">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {rows.length > 0 && <RecordFilter columns={columns} value={value} onChange={setValue} shown={open.length + done.length} total={rows.length} />}
        {detail.can("schedule.add") && !form && <span className="ms-auto"><AddAction name="activity" label={t("recordWindow.account.newActivity")} onAdd={() => setForm({})} /></span>}
      </div>
      {form && <PlanForm key={form.row?.key ?? "new"} kind="activity" row={form.row} detail={detail} onDone={() => setForm(null)} />}
      {!state.page ? <SectionStatus state={state} />
        : !rows.length ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordWindow.account.noActivity")}</p>
        : !open.length && !done.length ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordWindow.noMatch")}</p>
        : <>{group(t("recordWindow.account.upcoming"), open, "open")}{group(t("recordWindow.account.doneGroup"), done, "done")}</>}
    </Panel>
  );
}

// ── Configurations ──

const CONFIGURATION_ICON: Record<ConfigurationKind, typeof Server> = { server: Server, firewall: Shield, network: Network, workstation: Monitor, laptop: Laptop, printer: Printer, phone: Smartphone, other: Monitor };

export function AccountConfigurationsTab({ kind, detail }: { kind: AccountKind; detail: RecordDetail }) {
  const state = detail.section("configurations");
  const [value, setValue] = useState<DataFilterValue>({ text: "" });
  const [adding, setAdding] = useState(false);
  const [choices, setChoices] = useState<RecordChoice[] | undefined>();
  const { choices: read } = detail;
  useEffect(() => {
    if (!adding) return;
    let current = true;
    read("configuration").then((list) => { if (current) setChoices(list); }, () => { if (current) setChoices([]); });
    return () => { current = false; };
  }, [adding, read]);
  const rows = state.page?.lines ?? [];
  const columns: RecordColumn<ConfigurationRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "type", label: t("recordCard.related.type"), text: (row) => row.type },
    { id: "detail", label: t("recordWindow.account.configurationDetail"), text: (row) => row.detail ?? "" },
    { id: "site", label: t("recordWindow.account.tabs.sites"), text: (row) => row.site ?? "" },
    { id: "status", label: t("recordCard.related.status"), text: (row) => row.status },
  ];
  const kept = filterRecordRows(rows, columns, value);
  const groups = new Map<string, ConfigurationRow[]>();
  for (const row of kept) groups.set(row.type || t("recordWindow.account.otherType"), [...(groups.get(row.type || t("recordWindow.account.otherType")) ?? []), row]);
  // a contact links an existing configuration to itself; its removal is that link's
  const canLink = kind === "contact" && detail.can("configuration.add");
  return (
    <Panel name="configurations">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {rows.length > 0 && <RecordFilter columns={columns} value={value} onChange={setValue} shown={kept.length} total={rows.length} />}
        {canLink && !adding && <span className="ms-auto"><AddAction name="configuration" label={t("recordWindow.account.linkConfiguration")} onAdd={() => setAdding(true)} /></span>}
      </div>
      {adding && (
        <RecordEntryForm data-record-configuration-form="" submitLabel={t("recordWindow.account.linkConfiguration")} onCancel={() => setAdding(false)}
          fields={[{ key: "configuration", label: t("recordWindow.configurations.pick"), kind: "choice", required: true, choices: choices ?? [] }]}
          onSubmit={async (values) => { await detail.write({ action: "configuration.add", set: { configuration: String(values.configuration ?? "") } }); setAdding(false); }} />
      )}
      {!state.page ? <SectionStatus state={state} />
        : !rows.length ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.related.empty")}</p>
        : !kept.length ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordWindow.noMatch")}</p>
        : [...groups].map(([type, list]) => {
          const Icon = CONFIGURATION_ICON[list[0]?.icon ?? "other"];
          return (
            <RecordPod key={type} title={<span className="inline-flex items-center gap-2"><Icon size={15} aria-hidden="true" className="text-popover-ink-secondary" />{type}</span>} count={list.length} data-record-configuration-group={type}>
              <ul className="flex min-w-0 flex-col divide-y divide-popover-hairline">
                {list.map((row, index) => {
                  const RowIcon = CONFIGURATION_ICON[row.icon ?? "other"];
                  return (
                    <li key={row.id ?? `${row.name}-${index}`} className="flex min-w-0 flex-wrap items-center gap-3 py-2.5" data-record-configuration="">
                      <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary"><RowIcon size={15} /></span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="min-w-0 font-medium"><RecordName name={row.name} recordRef={row.ref} /></span>
                        {(row.detail || row.status) && <span dir="auto" className="break-words text-[13px] leading-[18px] text-popover-ink-secondary">{[row.detail, row.status].filter(Boolean).join(" · ")}</span>}
                      </span>
                      {row.site && <Mini icon={<MapPin size={13} />}>{row.site}</Mini>}
                      {row.seen && (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] leading-[18px] text-popover-ink-secondary" data-record-seen={row.online ? "online" : ""}>
                          <span aria-hidden="true" className={cn("size-2 rounded-full", row.online ? "bg-success" : "bg-popover-ink-secondary/50")} />{row.seen}
                        </span>
                      )}
                      <RecordRowActions name={row.name} onRemove={kind === "contact" && row.id && detail.can("configuration.remove") ? () => detail.write({ action: "configuration.remove", id: row.id! }) : undefined} />
                    </li>
                  );
                })}
              </ul>
            </RecordPod>
          );
        })}
    </Panel>
  );
}

// ── Attachments ──

/** A file's kind in two to four letters, from its name (PDF, XLSX). */
export function fileKind(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.slice(0, 4).toUpperCase() : "";
}

export function AccountAttachmentsTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("attachments");
  const [adding, setAdding] = useState(false);
  const columns: RecordColumn<AttachmentRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "date", label: t("recordCard.related.date"), kind: "date", text: (row) => row.date },
    { id: "author", label: t("recordWindow.account.author"), text: (row) => row.author ?? "" },
  ];
  return (
    <Panel name="attachments">
      {detail.notice && <p role="status" className="text-[13px] leading-[18px] text-danger">{detail.notice}</p>}
      {adding && (
        <RecordEntryForm data-record-attachment-form="" submitLabel={t("recordWindow.account.attach")} onCancel={() => setAdding(false)}
          fields={[{ key: "file", label: t("recordWindow.attachments.file"), kind: "file", required: true }]}
          onSubmit={async (values) => {
            const file = values.file;
            if (!(file instanceof File)) return;
            await detail.write({ action: "attachment.add", set: await attachmentOf(file) });
            setAdding(false);
          }} />
      )}
      {!state.page ? <SectionStatus state={state} /> : (
        <RecordList layout="cards" label={t("recordWindow.tabs.attachments")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id || row.name}
          toolbar={detail.can("attachment.add") && !adding ? <AddAction name="attachment" label={t("recordWindow.account.attach")} onAdd={() => setAdding(true)} /> : undefined}
          row={(row) => (
            <div className="flex min-w-0 items-start gap-3" data-record-attachment-card="">
              <span aria-hidden="true" className="inline-flex h-10 w-11 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-[11px] font-semibold tracking-wide">{fileKind(row.name) || <Download size={15} />}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <button type="button" className="min-w-0 break-all text-start font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={row.download} data-record-attachment="">{row.name}</button>
                <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.size, row.date].filter(Boolean).join(" · ")}</span>
                {row.author && <span dir="auto" className="text-[13px] leading-[18px] text-popover-ink-secondary">{t("recordWindow.account.addedBy", { name: row.author })}</span>}
              </span>
              <RecordRowActions name={row.name} onRemove={row.id && detail.can("attachment.remove") ? () => detail.write({ action: "attachment.remove", id: row.id }) : undefined} />
            </div>
          )} />
      )}
    </Panel>
  );
}

// ── Sites ──

const SITE_FORM = (row?: SiteRow): RecordFormField[] => [
  { key: "name", label: t("recordCard.related.name"), kind: "text", required: true, max: RECORD_NAME_MAX, value: row?.name ?? "" },
  { key: "address", label: t("recordWindow.account.site.address"), kind: "text", max: RECORD_NAME_MAX, value: row?.address ?? "" },
  { key: "city", label: t("recordWindow.account.site.city"), kind: "text", max: RECORD_NAME_MAX, value: row?.city ?? "" },
  { key: "phone", label: t("recordWindow.account.contact.phone"), kind: "text", max: RECORD_PHONE_MAX, value: row?.phone ?? "" },
];

export function AccountSitesTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("sites");
  const [form, setForm] = useState<{ row?: SiteRow } | null>(null);
  const columns: RecordColumn<SiteRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "address", label: t("recordWindow.account.site.address"), text: (row) => `${row.address} ${row.city}` },
    { id: "phone", label: t("recordWindow.account.contact.phone"), text: (row) => row.phone },
  ];
  const editing = form?.row;
  const write = async (values: RecordFormValues) => {
    const action: RecordActionName = editing?.id ? "site.update" : "site.add";
    const set = changed(values, editing ? { name: editing.name, address: editing.address, city: editing.city, phone: editing.phone } : {});
    if (editing?.id ? Object.keys(set).length : true) await detail.write(editing?.id ? { action, id: editing.id, set } : { action, set });
    setForm(null);
  };
  return (
    <Panel name="sites">
      {form && <RecordEntryForm key={editing?.id ?? "new"} data-record-site-form="" fields={SITE_FORM(editing)} onCancel={() => setForm(null)} submitLabel={editing ? t("recordWindow.save") : t("recordWindow.account.addSite")} onSubmit={write} />}
      {!state.page ? <SectionStatus state={state} /> : (
        <RecordList layout="cards" label={t("recordWindow.account.tabs.sites")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id ?? row.name}
          toolbar={detail.can("site.add") && !form ? <AddAction name="site" label={t("recordWindow.account.newSite")} onAdd={() => setForm({})} /> : undefined}
          row={(row) => (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover text-popover-ink-secondary"><MapPin size={15} /></span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span dir="auto" className="font-medium">{row.name}</span>
                  {row.main && <span className="inline-flex h-6 items-center rounded-full bg-popover-hover px-2.5 text-[13px] leading-[18px]">{t("recordWindow.account.mainSite")}</span>}
                </span>
                <RecordRowActions name={row.name} onEdit={row.id && detail.can("site.update") ? () => setForm({ row }) : undefined}
                  onRemove={row.id && detail.can("site.remove") ? () => detail.write({ action: "site.remove", id: row.id! }) : undefined} />
              </div>
              {(row.address || row.city) && <span dir="auto" className="flex flex-col"><span>{row.address}</span><span className="text-[13px] leading-[18px] text-popover-ink-secondary">{row.city}</span></span>}
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {row.phone && <Mini icon={<Phone size={13} />}>{row.phone}</Mini>}
                {row.contacts !== undefined && <Mini icon={<Users size={13} />}>{t("recordWindow.account.contactsCount", { count: row.contacts })}</Mini>}
                {row.configurations !== undefined && <Mini icon={<Monitor size={13} />}>{t("recordWindow.account.configurationsCount", { count: row.configurations })}</Mini>}
              </span>
            </>
          )} />
      )}
    </Panel>
  );
}

// ── History ──

export function ContactHistoryTab({ detail, when }: { detail: RecordDetail; when: When }) {
  const state = detail.section("history");
  const columns: RecordColumn<HistoryRow>[] = [
    { id: "text", label: t("recordWindow.account.change"), text: (row) => row.text },
    { id: "who", label: t("recordWindow.account.author"), text: (row) => row.who ?? "" },
    { id: "date", label: t("recordCard.related.date"), kind: "date", text: (row) => row.date },
  ];
  return (
    <Panel name="history">
      {!state.page ? <SectionStatus state={state} /> : (
        <RecordPod data-record-history="">
          <RecordList label={t("recordWindow.account.tabs.history")} columns={columns} rows={state.page.lines} rowKey={(row) => `${row.at ?? row.date}-${row.text}`}
            row={(row) => (
              <>
                <span aria-hidden="true" className="size-2.5 shrink-0 self-start rounded-full bg-popover-accent mt-2" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span dir="auto" className="break-words">{row.who ? <><span className="font-medium">{row.who}</span> {row.text}</> : row.text}</span>
                  <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{whenWords(row.at, row.date, when)}</span>
                </span>
              </>
            )} />
        </RecordPod>
      )}
    </Panel>
  );
}
