/** Isolated gallery of the record window (M-20261127-101): the real chip, the
 * real HoverCard and the real window, its frame and its ticket body, over a
 * stand-in console that answers like the detail route and takes every write
 * in memory (nothing leaves the page). An invented product ("Nimbus Desk")
 * and invented records: nothing here names a real product, company or person.
 * ?lang=fr|en &skin=<id> &scene=<name>
 *   ticket    a chat with the ticket's chip: a click opens the ticket window (default)
 *   company   the same chat: its company's chip opens the company's window, its contact's chip the contact's
 *             (src/lib/record-account-fixtures.ts; a contact named in the company opens in the same window)
 *   frame     the shared pieces of the frame on their own (pods, the filtered grid, the list,
 *             the schedule cells, the add menu, a form), for the lots that build other kinds
 *   board, invoice, invoice-card   a chat naming a board and an invoice (src/lib/record-board-invoice-fixtures.ts)
 *   &console=old  the console answers as before the window: no entry ids, no billing, no actions list,
 *             and no section for a company or a contact (their window is drawn from the card)
 * The time is held still. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { RECORD_ACTION, RecordAddButton, RecordAvatar, RecordEntryForm, RecordPod, RecordRowActions, RecordWindowTabs } from "../components/record-window/RecordBlocks";
import { RecordGrid, RecordList, type RecordColumn } from "../components/record-window/RecordGrid";
import { RecordSplit } from "../components/record-window/RecordSplit";
import { RecordWindow } from "../components/record-window/RecordWindow";
import { ScheduleCell, ScheduleTypeChip, type ScheduleKind } from "../components/record-window/ScheduleCell";
import { loadLocale, t } from "../lib/i18n";
import { NIMBUS_PRODUCT, nimbusProduct, nimbusProductRaw, answer, type Lang } from "../lib/record-card-fixtures";
import { accountCompanyCard, accountConsole, accountContactCard } from "../lib/record-account-fixtures";
import { seedPersonProducts } from "../lib/person-products";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import { boardInvoiceConsole } from "../lib/record-board-invoice-fixtures";
import { RECORD_ACTIONS } from "../../shared/record-actions";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang: Lang = params.get("lang") === "en" ? "en" : "fr";
await loadLocale(lang);
const scene = params.get("scene") ?? "ticket";
const oldConsole = params.get("console") === "old";
const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
const TZ = "America/Toronto";
// 2026-11-27 13:50 in Toronto
const NOW = Date.parse("2026-11-27T13:50:00-05:00");
const at = (iso: string) => new Date(`${iso}-05:00`).toISOString();
const fmt = (iso: string) => new Intl.DateTimeFormat(lang, { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(at(iso)));
const ref = (kind: string, id: string) => ({ product: NIMBUS_PRODUCT, kind, id });
const TICKET_ID = "300124";
const ADA = "Ada Lindqvist", NOOR = "Noor Haddad", BRUNO = "Bruno Tremblay";
const member = (name: string) => ({ [ADA]: ref("contact", "2204"), [NOOR]: ref("member", "13"), [BRUNO]: ref("member", "12") } as Record<string, ReturnType<typeof ref>>)[name];

// the console's data, changed by the writes the page takes
let title = L("Partenariat Acme Fabrication", "Acme Fabrication partnership");
let nextId = 900;
const notes = [
  { id: "71", author: NOOR, timestamp: at("2026-11-27T13:21"), kind: "discussion", text: L("Invitation envoyée pour la rencontre du 14 décembre.", "Invitation sent for the December 14 meeting.") },
  { id: "70", author: BRUNO, timestamp: at("2026-11-26T16:05"), kind: "internal", text: L("Valider la grille tarifaire avant la rencontre.\n\nÀ faire de mon côté :\n1. Comparer avec l'entente 2025.\n2. Confirmer le taux du bloc d'heures.\n3. Envoyer la version finale à Ada.", "Check the price grid before the meeting.\n\nOn my side:\n1. Compare with the 2025 agreement.\n2. Confirm the block of hours rate.\n3. Send the final version to Ada.") },
  { id: "69", author: NOOR, timestamp: at("2026-11-23T15:05"), kind: "discussion", text: L("Merci, on se reparle après la revue du contrat.", "Thanks, we talk again after the contract review.") },
];
const schedule = [
  { id: "501", kind: "meeting", member: NOOR, start: "2026-12-14T14:30", end: "2026-12-14T15:30", where: L("À distance", "Remote"), done: false },
  { id: "502", kind: "meeting", member: BRUNO, start: "2026-12-14T14:30", end: "2026-12-14T15:30", where: L("À distance", "Remote"), done: false },
  { id: "503", kind: "resource", member: NOOR, start: "2026-11-26T16:30", end: "2026-11-26T17:00", where: L("À distance", "Remote"), done: false },
  { id: "504", kind: "resource", member: NOOR, start: "", end: "", where: L("À distance", "Remote"), done: false },
  { id: "505", kind: "meeting", member: NOOR, start: "2026-10-29T15:00", end: "2026-10-29T15:30", where: L("Au bureau", "At the office"), done: true },
  { id: "506", kind: "meeting", member: BRUNO, start: "2026-10-29T15:00", end: "2026-10-29T15:30", where: L("Au bureau", "At the office"), done: true },
  { id: "507", kind: "resource", member: NOOR, start: "2026-10-22T09:00", end: "2026-10-22T09:20", where: L("À distance", "Remote"), done: true },
];
const activities = [
  { id: "601", subject: L("Rappeler Ada pour la signature", "Call Ada back for the signature"), type: L("Tâche", "Task"), date: L("2 déc. 2026", "Dec 2, 2026"), dateStart: at("2026-12-02T09:00"), assigned: NOOR, done: false },
  { id: "602", subject: L("Envoyer la grille tarifaire", "Send the price grid"), type: L("Courriel", "Email"), date: L("30 oct. 2026", "Oct 30, 2026"), dateStart: at("2026-10-30T09:00"), assigned: BRUNO, done: true },
];
const time = [
  { id: "81", start: at("2026-11-26T16:10"), member: NOOR, hours: 0.17, work_type: L("Gestion", "Management"), billing: "B", note: L("Suivi et envoi de l'invitation.", "Follow-up and invitation sent.") },
  { id: "82", start: at("2026-11-23T15:05"), member: NOOR, hours: 0.33, work_type: L("Rencontre", "Meeting"), billing: "B", note: L("Suivi du partenariat.", "Partnership follow-up.") },
  { id: "83", start: at("2026-10-29T15:00"), member: BRUNO, hours: 0.5, work_type: L("Rencontre", "Meeting"), billing: "NC", note: L("Suivi des informations requises.", "Follow-up of the information needed.") },
  { id: "84", start: at("2026-10-29T15:00"), member: NOOR, hours: 0.5, work_type: L("Rencontre", "Meeting"), billing: "B", note: L("Informations requises pour le contrat.", "Information needed for the contract.") },
  { id: "85", start: at("2026-10-22T09:00"), member: NOOR, hours: 0.33, work_type: L("Analyse", "Analysis"), billing: "DNB", note: L("Revue du contrat avant la rencontre.", "Contract review before the meeting.") },
];
const expenses = [
  { id: "91", start: at("2026-11-26T12:00"), member: NOOR, type: L("Kilométrage", "Mileage"), amount: 86.4, billing: "B", note: L("Aller-retour au client, 120 km", "Round trip to the customer, 120 km") },
  { id: "92", start: at("2026-10-29T12:00"), member: BRUNO, type: L("Repas", "Meal"), amount: 62.2, billing: "NC", note: L("Dîner de la rencontre.", "Meeting lunch.") },
];
const configurations: Array<{ id: string; name: string; type: string; status: string }> = [];
const attachments = [
  { id: "42", name: "contrat-adhesion.pdf", size: "412 Ko", date: L("27 nov.", "Nov 27") },
  { id: "43", name: "grille-tarifaire.xlsx", size: "38 Ko", date: L("26 nov.", "Nov 26") },
  { id: "44", name: "invitation.ics", size: "2 Ko", date: L("26 nov.", "Nov 26") },
];
const fieldsState = { status: { label: L("En attente", "Waiting"), tone: "waiting" as const }, priority: { label: L("3 : Moyenne", "3: Medium"), level: "normal" as const } };

const money = (value: number) => new Intl.NumberFormat(lang, { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol" }).format(value);
const hoursText = (value: number) => `${new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} h`;
const dayText = (iso: string) => new Intl.DateTimeFormat(lang, { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));

function ticketCard(): Record<string, unknown> {
  const total = time.reduce((sum, row) => sum + row.hours, 0);
  return {
    product: { id: NIMBUS_PRODUCT, name: "Nimbus Desk" }, kind: { id: "ticket", name: L("Billet", "Ticket") }, id: TICKET_ID, number: `#${TICKET_ID}`, title,
    state: fieldsState.status, priority: fieldsState.priority,
    company: { name: "Acme Fabrication", ref: ref("company", "7310") },
    people: [
      { role: "contact", label: "Contact", name: ADA, detail: "418 555-0142", ref: ref("contact", "2204") },
      { role: "owner", label: L("Responsable", "Owner"), name: NOOR },
    ],
    dates: { opened: new Date(NOW - 35 * 86_400_000).toISOString(), updated: new Date(NOW - 29 * 60_000).toISOString() },
    fields: [
      { label: "Site", value: L("Bureau principal", "Main office"), edit_key: "site" },
      { label: L("Équipe", "Team"), value: L("Transformation numérique", "Digital transformation"), edit_key: "team" },
      { label: L("Lieu", "Location"), value: L("À distance", "Remote"), edit_key: "location" },
      { label: "Board", value: L("Soutien (Transformation)", "Support (Transformation)"), edit_key: "board" },
      { label: "Type", value: L("Gestion administrative", "Administration"), edit_key: "type" },
      { label: L("Sous-type", "Subtype"), value: "Client", edit_key: "subtype" },
      { label: "Item", value: L("Rencontre", "Meeting"), edit_key: "item" },
      { label: L("Heures", "Hours"), value: hoursText(total), type: "duration" },
      { label: L("Entente", "Agreement"), value: L("Aucune", "None"), edit_key: "agreement" },
    ],
    notes: { state: "none", items: [] },
    open_url: `https://desk.example/records/tickets/${TICKET_ID}`, tz: TZ, as_of: new Date(NOW - 2 * 60_000).toISOString(), cached: false,
  };
}

function section(name: string): Record<string, unknown> {
  switch (name) {
    case "notes": return { lines: notes.map((row) => ({ ...(oldConsole ? {} : { id: row.id, ...(member(row.author) ? { author_ref: member(row.author) } : {}) }), author: row.author, timestamp: row.timestamp, kind: row.kind, text: row.text })) };
    case "schedule": return { lines: schedule.map((row) => ({ ...(oldConsole ? {} : { id: row.id, kind: row.kind, member_ref: member(row.member) }), member: row.member, ...(row.start ? { startTimestamp: at(row.start), endTimestamp: at(row.end) } : {}), where: row.where, doneFlag: row.done })) };
    case "activities": return { lines: activities.map((row) => ({ ...(oldConsole ? {} : { id: row.id, dateStart: row.dateStart, done: row.done, assigned_ref: member(row.assigned) }), subject: row.subject, type: row.type, date: row.date, assigned: row.assigned })) };
    case "time": {
      const total = time.reduce((sum, row) => sum + row.hours, 0);
      const by = (billing: string) => time.filter((row) => row.billing === billing).reduce((sum, row) => sum + row.hours, 0);
      return {
        totalHours: hoursText(total),
        ...(oldConsole ? {} : { totals: { hours: hoursText(total), billable: hoursText(by("B")), expenses: money(expenses.reduce((sum, row) => sum + row.amount, 0)), parts: Object.fromEntries(["B", "NC", "DNB"].map((billing) => [billing, { text: hoursText(by(billing)), share: total ? (by(billing) / total) * 100 : 0 }])) } }),
        lines: time.map((row) => ({ ...(oldConsole ? {} : { id: row.id, start: row.start, member_ref: member(row.member), hours_value: row.hours, work_type: row.work_type, billing: row.billing }), date: dayText(row.start), member: row.member, hours: hoursText(row.hours), note: row.note })),
      };
    }
    case "expenses": return { lines: expenses.map((row) => ({ ...(oldConsole ? {} : { id: row.id, start: row.start, member_ref: member(row.member), amount_value: row.amount, billing: row.billing, note: row.note }), date: dayText(row.start), member: row.member, type: row.type, amount: money(row.amount) })) };
    case "configurations": return { lines: configurations };
    case "attachments": return { lines: attachments };
    default: return { lines: [] };
  }
}

const CHOICES: Record<string, Array<{ value: string; label: string }>> = {
  status: [{ value: "1", label: L("En cours", "In progress") }, { value: "2", label: L("En attente", "Waiting") }],
  priority: [{ value: "1", label: L("1 : Urgente", "1: Urgent") }, { value: "3", label: L("3 : Moyenne", "3: Medium") }],
  owner: [{ value: "11", label: ADA }, { value: "12", label: BRUNO }, { value: "13", label: NOOR }],
  member: [{ value: "12", label: BRUNO }, { value: "13", label: NOOR }],
  where: [{ value: "1", label: L("À distance", "Remote") }, { value: "2", label: L("Au bureau", "At the office") }],
  work_type: [{ value: "1", label: L("Gestion", "Management") }, { value: "2", label: L("Rencontre", "Meeting") }, { value: "3", label: L("Analyse", "Analysis") }],
  expense_type: [{ value: "1", label: L("Kilométrage", "Mileage") }, { value: "2", label: L("Repas", "Meal") }],
  configuration: [{ value: "31", label: L("Poste du comptoir", "Counter workstation") }, { value: "32", label: L("Imprimante de l'accueil", "Reception printer") }],
};

/** A write the page takes: the console's data changes, as a real write would. */
function take(body: { field?: string; value?: string; action?: string; id?: string; set?: Record<string, unknown> }) {
  if (body.field === "summary") { title = String(body.value); return; }
  if (body.field === "status") { fieldsState.status = { label: CHOICES.status!.find((one) => one.value === body.value)?.label ?? fieldsState.status.label, tone: "waiting" }; return; }
  const set = body.set ?? {};
  const id = String(nextId++);
  const now = new Date(NOW).toISOString();
  switch (body.action) {
    case "note.add": notes.unshift({ id, author: NOOR, timestamp: now, kind: String(set.kind), text: String(set.text) }); break;
    case "note.update": { const row = notes.find((one) => one.id === body.id); if (row) { row.text = String(set.text ?? row.text); row.kind = String(set.kind ?? row.kind); } break; }
    case "note.remove": notes.splice(notes.findIndex((one) => one.id === body.id), 1); break;
    case "time.add": time.unshift({ id, start: now, member: NOOR, hours: Number(set.hours), work_type: CHOICES.work_type!.find((one) => one.value === set.work_type)?.label ?? "", billing: String(set.billing ?? "B"), note: String(set.note ?? "") }); break;
    case "time.update": { const row = time.find((one) => one.id === body.id); if (row) Object.assign(row, set.billing ? { billing: set.billing } : {}, set.hours ? { hours: Number(set.hours) } : {}, set.note !== undefined ? { note: set.note } : {}); break; }
    case "time.remove": time.splice(time.findIndex((one) => one.id === body.id), 1); break;
    case "expense.add": expenses.unshift({ id, start: now, member: NOOR, type: CHOICES.expense_type!.find((one) => one.value === set.type)?.label ?? "", amount: Number(set.amount), billing: String(set.billing ?? "B"), note: String(set.note ?? "") }); break;
    case "expense.update": { const row = expenses.find((one) => one.id === body.id); if (row && set.billing) row.billing = String(set.billing); break; }
    case "expense.remove": expenses.splice(expenses.findIndex((one) => one.id === body.id), 1); break;
    case "schedule.done": {
      const row = set.kind === "activity" ? activities.find((one) => one.id === body.id) : schedule.find((one) => one.id === body.id);
      if (row) row.done = set.done === true;
      break;
    }
    case "schedule.add":
      if (set.kind === "activity") activities.unshift({ id, subject: String(set.subject), type: L("Tâche", "Task"), date: "", dateStart: now, assigned: CHOICES.member!.find((one) => one.value === set.member)?.label ?? NOOR, done: false });
      else schedule.unshift({ id, kind: String(set.kind), member: CHOICES.member!.find((one) => one.value === set.member)?.label ?? NOOR, start: String(set.start ?? ""), end: String(set.end ?? set.start ?? ""), where: CHOICES.where!.find((one) => one.value === set.where)?.label ?? "", done: false });
      break;
    case "schedule.remove": {
      const list = set.kind === "activity" ? activities : schedule;
      list.splice(list.findIndex((one) => one.id === body.id), 1);
      break;
    }
    case "configuration.add": { const choice = CHOICES.configuration!.find((one) => one.value === set.configuration); if (choice) configurations.push({ id, name: choice.label, type: L("Poste de travail", "Workstation"), status: L("Actif", "Active") }); break; }
    case "configuration.remove": configurations.splice(configurations.findIndex((one) => one.id === body.id), 1); break;
    case "attachment.add": attachments.unshift({ id, name: String(set.name), size: "1 Ko", date: dayText(now) }); break;
    case "attachment.remove": attachments.splice(attachments.findIndex((one) => one.id === body.id), 1); break;
  }
}

const lot3 = boardInvoiceConsole(lang, NOW, scene);
seedPersonProducts([nimbusProduct()]);
const accounts = accountConsole(lang, NOW);
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.includes("/api/me/perspicax/products")) return json({ products: [nimbusProductRaw()] });
  const account = /\/api\/me\/records\/nimbus_desk\/(company|contact)\/\d+\/detail\?/.exec(url)?.[1];
  if (account) {
    // a console older than the company's sections: it has no detail for the kind
    if (oldConsole) return json({ state: "unavailable", code: "kind_unknown" }, 404);
    const query = new URL(url, window.location.href).searchParams;
    if (init?.method === "POST") { accounts.take(account, JSON.parse(String(init.body))); return json({ updated: true }); }
    const section = query.get("section") ?? "counts";
    if (section === "counts") return json(accounts.counts(account));
    if (section === "choices") return json({ choices: accounts.choices[query.get("field") ?? ""] ?? [], next: null });
    if (section === "download") return json({ name: "contrat-adhesion.pdf", contentType: "application/pdf", base64: btoa("PDF") });
    return json({ ...accounts.section(account, section), next: null });
  }
  const boardOrInvoice = lot3.detail(url, init);
  if (boardOrInvoice) return boardOrInvoice;
  if (url.includes("/detail?")) {
    const query = new URL(url, window.location.href).searchParams;
    if (!url.includes(`/ticket/${TICKET_ID}/`)) return new Response(null, { status: 404 });
    if (init?.method === "POST") { take(JSON.parse(String(init.body))); return json({ updated: true }); }
    switch (query.get("section")) {
      case "counts": return json({
        counts: { time: time.length, expenses: expenses.length, configurations: configurations.length, activities: activities.length, attachments: attachments.length },
        fields: ["status", "priority", "owner", "team", "location", "board", "type", "subtype", "item", "agreement", "contact", "site", "summary"],
        ...(oldConsole ? {} : { actions: RECORD_ACTIONS }),
      });
      case "choices": return json({ choices: CHOICES[query.get("field") ?? ""] ?? CHOICES.status, next: null });
      case "download": return json({ name: "contrat-adhesion.pdf", contentType: "application/pdf", base64: btoa("PDF") });
      default: return json({ ...section(query.get("section") ?? ""), next: null });
    }
  }
  const match = /\/api\/me\/records\/nimbus_desk\/(\w+)\/([^?]+)/.exec(url);
  if (match) {
    if (match[1] === "ticket") return json(answer(ticketCard()));
    if (match[1] === "company") return json(answer(accountCompanyCard(NOW, lang)));
    if (match[1] === "contact") return json(answer(accountContactCard(NOW, lang)));
    const other = lot3.card(match[1]!, match[2]!);
    if (other) return json(answer(other));
    return json({ state: "unknown" });
  }
  // the app's other routes are not this gallery's: answered as a server without them
  if (/\/(api|v1)\//.test(url)) return new Response(JSON.stringify({ error: "not in the gallery" }), { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const CHAT = lang === "fr"
  ? `Le billet [#${TICKET_ID}](sagax://record/nimbus_desk/ticket/${TICKET_ID}) attend la rencontre du 14 décembre avec [Acme Fabrication](sagax://record/nimbus_desk/company/7310) et [Ada Lindqvist](sagax://record/nimbus_desk/contact/2204).`
  : `Ticket [#${TICKET_ID}](sagax://record/nimbus_desk/ticket/${TICKET_ID}) waits for the December 14 meeting with [Acme Fabrication](sagax://record/nimbus_desk/company/7310) and [Ada Lindqvist](sagax://record/nimbus_desk/contact/2204).`;

type Row = { id: string; kind: ScheduleKind; who: string; when: string; where: string };
const ROWS: Row[] = [
  { id: "1", kind: "meeting", who: NOOR, when: fmt("2026-12-14T14:30"), where: L("À distance", "Remote") },
  { id: "2", kind: "activity", who: L("Rappeler Ada pour la signature", "Call Ada back for the signature"), when: L("Échéance 2 déc. 2026", "Due Dec 2, 2026"), where: "" },
  { id: "3", kind: "resource", who: BRUNO, when: fmt("2026-11-26T16:30"), where: L("Au bureau", "At the office") },
];

/** The frame's shared pieces on their own: what the lots of the other kinds build with. */
function Frame() {
  const [tab, setTab] = useState<"sheet" | "contacts" | "tickets">("sheet");
  const [adding, setAdding] = useState(false);
  const columns: RecordColumn<Row>[] = [
    { id: "type", label: "Type", width: 128, text: (row) => row.kind, cell: (row) => <ScheduleTypeChip kind={row.kind} /> },
    { id: "who", label: L("Ressource ou sujet", "Resource or subject"), width: 240, text: (row) => row.who, cell: (row) => <ScheduleCell title={row.who} /> },
    { id: "when", label: L("Date et heure", "Date and time"), width: 200, kind: "date", text: (row) => row.when },
    { id: "where", label: L("Lieu", "Location"), width: 120, text: (row) => row.where },
    { id: "actions", label: "", fixed: true, width: 80, text: () => "", cell: (row) => <RecordRowActions name={row.who} onEdit={() => {}} onRemove={async () => {}} /> },
  ];
  const type = "nimbus_desk/company";
  return (
    <div className="relative h-screen w-screen" data-gallery-frame="">
      <RecordWindow type={type}
        head={<div className="flex items-center gap-2.5 px-6 pb-4 pt-5"><span className="text-[13px] text-popover-ink-secondary">{L("Client", "Company")}</span><span className="text-[20px] font-semibold">Acme Fabrication</span></div>}
        tabs={<RecordWindowTabs tabs={[{ id: "sheet", label: L("Fiche", "Sheet") }, { id: "contacts", label: "Contacts", count: 24 }, { id: "tickets", label: L("Billets", "Tickets"), count: 0 }]} tab={tab} onTab={setTab} label={L("Onglets", "Tabs")} idPrefix="frame" />}
        foot={<div className="border-t border-popover-hairline px-4 py-2.5 text-[13px] text-popover-ink-secondary">{L("Pied de la fenêtre", "The window's foot")}</div>}
      >
        <RecordSplit type={type}
          left={<div className="flex flex-col gap-3 p-4"><RecordPod title={L("Contacts clés", "Key contacts")} count={3} collapsible actions={<RecordAddButton label={L("Ajouter un contact", "Add a contact")} onAdd={() => setAdding(true)} />}>
            <RecordList label="Contacts" columns={[{ id: "name", label: L("Nom", "Name"), text: (row: string) => row }]} rows={[ADA, BRUNO, NOOR]} rowKey={(row) => row}
              row={(row) => <><RecordAvatar name={row} /><span className="flex-1">{row}</span><RecordRowActions name={row} onEdit={() => {}} onRemove={async () => {}} /></>} />
          </RecordPod></div>}
          right={<div className="flex flex-col gap-3 p-4">
            {adding && <RecordEntryForm fields={[{ key: "name", label: L("Nom", "Name"), kind: "text", required: true }, { key: "note", label: "Note", kind: "textarea" }]} submitLabel={L("Ajouter", "Add")} onCancel={() => setAdding(false)} onSubmit={async () => setAdding(false)} />}
            <RecordPod title={L("Planification", "Schedule")} count={ROWS.length} actions={<><button type="button" className={RECORD_ACTION}>{L("Action", "Action")}</button><RecordAddButton label={L("Ajouter", "Add")} choices={[{ id: "meeting", label: t("recordWindow.schedule.meeting") }, { id: "resource", label: t("recordWindow.schedule.resource") }, { id: "activity", label: t("recordWindow.schedule.activity") }]} onAdd={() => {}} /></>}>
              <RecordGrid type={type} grid="frame" label={L("Planification", "Schedule")} columns={columns} rows={ROWS} rowKey={(row) => row.id} />
            </RecordPod>
          </div>}
        />
      </RecordWindow>
    </div>
  );
}

function Page() {
  if (scene === "frame") return <Frame />;
  return (
    <div className="min-h-screen bg-app p-6 text-ink">
      <div className="max-w-[44rem] text-[15px] leading-6" data-gallery-chat>
        <ChatMarkdown text={scene === "board" || scene.startsWith("invoice") ? lot3.chat : CHAT} botId="bot-gallery" draftId="bot:bot-gallery:thread-gallery" message={{ threadId: "thread-gallery", messageId: "m-1" }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><StoreProvider><Page /></StoreProvider></StrictMode>);
