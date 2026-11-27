// The model of a company's and a contact's window (M-20261127-101,
// M-20261127-140): their tabs with their counts, and what the Profile tab
// shows, the console's sheet first and, for what it does not send (or before
// it serves a company's sections at all), the card's own facts. Nothing here
// invents a value: a part with no data is left out (M-20261127-143).
import { t } from "@/lib/i18n";
import type { RecordDetail } from "@/components/useRecordDetail";
import type { RecordTab } from "@/components/record-window/RecordBlocks";
import type { DetailSection, RecordSheet, SheetFeed, SheetPerson, SheetReach, SheetTile, SheetUpcoming, TicketRow } from "@/lib/record-detail";
import type { RecordActionName } from "../../../../shared/record-actions";
import type { RecordCard, RecordField, RecordRef } from "../../../../shared/record-cards";

export type AccountKind = "company" | "contact";

/** A company's tabs, in the mockup's order (M-20261127-117, D-20261127-010). */
export const COMPANY_TABS = ["sheet", "notes", "contacts", "tickets", "activities", "projects", "opportunities", "agreements", "configurations", "attachments", "sites", "finance", "data"] as const;
/** A contact's (M-20261127-140). */
export const CONTACT_TABS = ["sheet", "tickets", "activities", "configurations", "attachments", "notes", "history"] as const;
export type AccountTab = (typeof COMPANY_TABS)[number] | (typeof CONTACT_TABS)[number];

/** The console section each tab reads. */
export const TAB_SECTION: Record<AccountTab, DetailSection> = {
  sheet: "sheet", notes: "notes", contacts: "contacts", tickets: "tickets", activities: "activities", projects: "projects",
  opportunities: "opportunities", agreements: "agreements", configurations: "configurations", attachments: "attachments",
  sites: "sites", finance: "finance", data: "stats", history: "history",
};

/** What a tab's + adds, when the console takes it (a contact links a configuration; a company's fleet is the product's). */
function addOf(kind: AccountKind, tab: AccountTab): RecordActionName | undefined {
  switch (tab) {
    case "notes": return "note.add";
    case "contacts": return "contact.add";
    case "activities": return "schedule.add";
    case "attachments": return "attachment.add";
    case "sites": return "site.add";
    case "configurations": return kind === "contact" ? "configuration.add" : undefined;
    default: return undefined;
  }
}

const TAB_LABEL: Record<AccountTab, string> = {
  sheet: "recordWindow.account.tabs.sheet", notes: "recordWindow.tabs.notes", contacts: "recordWindow.account.tabs.contacts",
  tickets: "recordWindow.account.tabs.tickets", activities: "recordWindow.account.tabs.activities", projects: "recordWindow.account.tabs.projects",
  opportunities: "recordWindow.account.tabs.opportunities", agreements: "recordWindow.account.tabs.agreements",
  configurations: "recordWindow.tabs.configurations", attachments: "recordWindow.tabs.attachments", sites: "recordWindow.account.tabs.sites",
  finance: "recordWindow.account.tabs.finance", data: "recordWindow.account.tabs.data", history: "recordWindow.account.tabs.history",
};

export function tabLabel(kind: AccountKind, tab: AccountTab): string {
  if (tab === "sheet" && kind === "contact") return t("recordWindow.account.tabs.contact");
  return t(TAB_LABEL[tab] as "recordWindow.tabs.notes");
}

/** The card's list is its open tickets (a company's and a contact's card list them): their rows, for a console that sends no section. */
export function cardTicketRows(card: RecordCard): { rows: TicketRow[]; total: number } | undefined {
  const lines = card.lines;
  if (!lines || lines.state !== "ok" || !lines.items.some((line) => line.ref?.kind === "ticket")) return undefined;
  const rows = lines.items.map((line): TicketRow => ({
    // the number is the ticket's id when it is one people read (never a GUID on screen)
    ...(line.ref ? { ref: line.ref, number: /^\d{1,12}$/.test(line.ref.id) ? `#${line.ref.id}` : "" } : { number: "" }),
    summary: line.label, status: line.detail ?? "", priority: "", type: "", owner: "", updatedText: line.value ?? "",
  }));
  return { rows, total: lines.total ?? rows.length };
}

/**
 * The tabs shown: the Profile always; every other one once the console's
 * counts came, with its count, hidden when it holds nothing and nothing can
 * be added (M-20261127-143). A console with no sections for this kind (or
 * none yet) leaves the Profile and the card's open tickets.
 */
export function accountTabs(kind: AccountKind, card: RecordCard, detail: RecordDetail | undefined): RecordTab<AccountTab>[] {
  const list = kind === "company" ? COMPANY_TABS : CONTACT_TABS;
  const fromCard = cardTicketRows(card);
  if (!detail?.known) {
    return [
      { id: "sheet", label: tabLabel(kind, "sheet") },
      ...(fromCard?.total ? [{ id: "tickets" as const, label: tabLabel(kind, "tickets"), count: fromCard.total }] : []),
    ];
  }
  return list.map((tab) => {
    const add = addOf(kind, tab);
    const count = detail.counts[TAB_SECTION[tab]];
    // Finance and Data hold figures, not entries: no number beside them, hidden only when the console says there is nothing
    const shown = tab === "finance" || tab === "data" ? (count === 0 ? 0 : undefined) : tab === "sheet" ? undefined : count ?? (tab === "tickets" ? fromCard?.total : undefined);
    return { id: tab, label: tabLabel(kind, tab), ...(shown !== undefined ? { count: shown } : {}), ...(add && detail.can(add) ? { canAdd: true } : {}) };
  });
}

/** The ways to reach the record a field of the card names (a `phone` or an `email` field), for a console that sends no sheet. */
function reachOfCard(card: RecordCard): SheetReach[] {
  return (card.fields ?? []).flatMap((field): SheetReach[] => {
    if (field.type !== "phone" && field.type !== "email") return [];
    // a field may list two values ("418 555-0142, 418 555-0177"): each its own row
    return field.value.split(/\s*[,;]\s*/).filter(Boolean).map((value) => ({ kind: field.type as "phone" | "email", value }));
  });
}

export interface ProfileView {
  name: string;
  /** a company's type, territory, since when and budget; a contact's title */
  context: string[];
  title?: string;
  company?: { name: string; ref?: RecordRef };
  roles: string[];
  reach: SheetReach[];
  tiles: SheetTile[];
  upcoming: SheetUpcoming[];
  feed: SheetFeed[];
  people: SheetPerson[];
  prefs: Array<{ label: string; value: string }>;
  /** the card's facts no other part shows (a console that sends no sheet) */
  facts: RecordField[];
}

/** "client since March 2019" from a calendar day, in the person's language. */
export function sinceWords(day: string, lang: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return t("recordWindow.account.since", { date: new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(date) });
}

/** The Profile: the sheet's parts, each one the card's when the sheet has none. */
export function profileView(kind: AccountKind, card: RecordCard, sheet: RecordSheet | undefined, lang: string): ProfileView {
  const fromCard = cardTicketRows(card);
  const cardReach = reachOfCard(card);
  const reach = sheet?.reach.length ? sheet.reach : cardReach;
  // the card's people: its contacts are the key contacts; the people of the organization (its account manager) are facts
  const cardPeople = card.people ?? [];
  const people: SheetPerson[] = sheet?.people.length ? sheet.people
    : cardPeople.filter((person) => person.role === "contact").map((person) => ({ name: person.name, ...(person.ref ? { ref: person.ref } : {}), ...(person.label ? { role: person.label } : {}), ...(person.detail ? { detail: person.detail } : {}) }));
  const staff: RecordField[] = sheet ? [] : cardPeople.filter((person) => person.role !== "contact")
    .map((person) => ({ label: person.label || t("recordCard.edit.owner"), value: person.name, type: "person", role: person.role, ...(person.detail ? { detail: person.detail } : {}), ...(person.ref ? { ref: person.ref } : {}) }));
  const feed: SheetFeed[] = sheet?.feed.length ? sheet.feed
    : card.notes.items.map((note) => ({ kind: "note" as const, date: "", text: note.text, ...(note.at ? { at: note.at } : {}), ...(note.author ? { who: note.author } : {}) }));
  // the card's open tickets make the first tile when the console sends none
  const tiles: SheetTile[] = sheet?.tiles.length ? sheet.tiles
    : fromCard ? [{ tab: "tickets", label: card.lines?.title ?? t("recordWindow.account.openTickets"), value: String(fromCard.total) }] : [];
  // without a sheet, every field the reach rows do not already say stays a fact
  const facts = sheet ? [] : [...staff, ...(card.fields ?? []).filter((field) => field.type !== "phone" && field.type !== "email")];
  return {
    name: card.title,
    context: [...(sheet?.context ?? []), ...(sheet?.since ? [sinceWords(sheet.since, lang)] : [])],
    ...(sheet?.title ? { title: sheet.title } : {}),
    ...(kind === "contact" && card.company ? { company: card.company } : {}),
    roles: sheet?.roles ?? [],
    reach, tiles, upcoming: sheet?.upcoming ?? [], feed, people: kind === "company" ? people : [], prefs: sheet?.prefs ?? [], facts: kind === "company" ? facts : facts.filter((field) => field.type !== "person" || field.role !== "contact"),
  };
}

/** A web address a reach row names, as a link (a bare domain is https); anything else is no link. */
export function webAddress(value: string): string | undefined {
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** A phone number as a tel: link (its digits, a leading +), or none when it holds too few. */
export function phoneAddress(value: string): string | undefined {
  const [number, extension] = value.split(/\s*(?:x|ext\.?|poste)\s*/i);
  const digits = (number ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (digits.replace("+", "").length < 3 || digits.length > 20) return undefined;
  const ext = extension?.replace(/\D/g, "");
  return `tel:${digits}${ext ? `;ext=${ext.slice(0, 10)}` : ""}`;
}

/** A mail address as a mailto: link to write to, nothing else. */
export function mailAddress(value: string): string | undefined {
  const address = value.trim();
  return /^[^\s@,;:<>()[\]"]+@[^\s@,;:<>()[\]"]+\.[^\s@,;:<>()[\]"]+$/.test(address) && address.length <= 250 ? `mailto:${address}` : undefined;
}
