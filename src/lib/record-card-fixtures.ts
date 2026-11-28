// An invented product and invented records for the record card's tests and
// its gallery (src/gallery/record-card.tsx). The public repository names no
// real product, company, client or person: "Nimbus Desk" is made up, its host
// is `desk.example`. Every word of a card is the console's data, so these are
// what a console would send, in the language asked for.
import { parsePersonProduct } from "../../shared/person-products";
import type { PersonProduct } from "../../shared/person-products";
import type { RecordRef } from "../../shared/record-cards";

export const NIMBUS_PRODUCT = "nimbus_desk";
/** The invented product's mark (the console serves an https address; the gallery's capture script answers it with an invented SVG). */
export const NIMBUS_MARK = "https://desk.example/mark.svg";
export const TICKET_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "ticket", id: "481516" };
export const COMPANY_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "company", id: "7310" };
export const PROJECT_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "project", id: "7788" };
export const INVOICE_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "invoice", id: "5150" };
export const AGREEMENT_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "agreement", id: "412" };
export const CONTACT_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "contact", id: "2204" };
export const DEPARTMENT_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "department", id: "31" };
export const EMAIL_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "email", id: "90210" };
export const GUID_REF: RecordRef = { product: NIMBUS_PRODUCT, kind: "ticket", id: "6f1c2a52-3b7e-4f0a-9d51-0c7a8e1b2d34" };

/** The person's product list entry as the console sends it (the kinds it describes). */
export function nimbusProductRaw(): Record<string, unknown> {
  return {
    id: NIMBUS_PRODUCT,
    name: "Nimbus Desk",
    state: "connected",
    icon: { url: NIMBUS_MARK },
    records: [
      { kind: "ticket", name: { en: "Ticket", fr: "Billet" }, plural: { en: "Tickets", fr: "Billets" } },
      { kind: "company", name: { en: "Company", fr: "Entreprise" }, plural: { en: "Companies", fr: "Entreprises" } },
      { kind: "project", name: { en: "Project", fr: "Projet" }, plural: { en: "Projects", fr: "Projets" } },
      { kind: "invoice", name: { en: "Invoice", fr: "Facture" }, plural: { en: "Invoices", fr: "Factures" } },
      { kind: "agreement", name: { en: "Agreement", fr: "Entente" }, plural: { en: "Agreements", fr: "Ententes" } },
      { kind: "contact", name: { en: "Contact", fr: "Contact" }, plural: { en: "Contacts", fr: "Contacts" } },
      { kind: "department", name: { en: "Department", fr: "Département" }, plural: { en: "Departments", fr: "Départements" } },
      { kind: "email", name: { en: "Email", fr: "Courriel" }, plural: { en: "Emails", fr: "Courriels" } },
      { kind: "board", name: { en: "Board", fr: "Board" }, plural: { en: "Boards", fr: "Boards" } },
    ],
  };
}

export function nimbusProduct(): PersonProduct {
  return parsePersonProduct(nimbusProductRaw())!;
}

export type Lang = "fr" | "en";
const T = (lang: Lang, fr: string, en: string) => (lang === "fr" ? fr : en);
const ago = (now: number, ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
/** The gallery's held time (2026-11-17 14:34 in Toronto), for the cards that carry no relative date. */
const NOW_FIXTURE = Date.parse("2026-11-17T14:34:00-05:00");
const product = { id: NIMBUS_PRODUCT, name: "Nimbus Desk" };

/** A ticket: description, two notes of seven, a due date, key fields. */
export function ticketCard(now: number, lang: Lang): Record<string, unknown> {
  return {
    product, kind: { id: "ticket", name: T(lang, "Billet", "Ticket") }, id: TICKET_REF.id, number: `#${TICKET_REF.id}`,
    title: T(lang, "Imprimante de l'accueil hors ligne depuis lundi", "Front desk printer offline since Monday"),
    state: { label: T(lang, "En cours", "In progress"), tone: "open" },
    priority: { label: T(lang, "Priorité 2 - Élevée", "Priority 2 - High"), level: "high" },
    company: { name: "Acme Fabrication", ref: { product: NIMBUS_PRODUCT, kind: "company", id: "7310" } },
    people: [
      { role: "contact", label: "Contact", name: "Ada Lindqvist", detail: "418 555-0142", ref: { product: NIMBUS_PRODUCT, kind: "contact", id: "2204" } },
      { role: "owner", label: T(lang, "Responsable", "Owner"), name: "Noor Haddad" },
    ],
    dates: { opened: ago(now, 3 * DAY), updated: ago(now, 29 * MIN), due: new Date(now + 2 * DAY).toISOString() },
    fields: [
      { label: T(lang, "Tableau", "Board"), value: T(lang, "Soutien", "Support") },
      { label: "Type", value: T(lang, "Incident", "Incident") },
      { label: T(lang, "Heures", "Hours"), value: T(lang, "3,5 / 8", "3.5 / 8") },
    ],
    description: { text: T(lang, "L'imprimante du comptoir ne répond plus au ping depuis lundi matin. Redémarrée deux fois, même résultat.", "The counter printer has not answered a ping since Monday morning. Restarted twice, same result."), more: false },
    notes: {
      state: "ok", total: 7,
      items: [
        { author: "Noor Haddad", at: ago(now, 29 * MIN), internal: true, text: T(lang, "Pilote réinstallé, la file se vide. À surveiller demain.", "Driver reinstalled, the queue is draining. To watch tomorrow."), more: false },
        { author: "Ada Lindqvist", at: ago(now, 4 * HOUR), internal: false, tag: "Email", text: T(lang, "Toujours rien ce matin, on imprime à l'étage en attendant.", "Still nothing this morning, we print upstairs meanwhile."), more: false },
        { author: "Noor Haddad", at: ago(now, DAY + 3 * HOUR), internal: false, text: T(lang, "Bonjour Ada, nous regardons le pilote et le port réseau de l'imprimante.", "Hello Ada, we are looking at the printer's driver and network port."), more: false },
      ],
    },
    lines: {
      state: "ok", title: T(lang, "Dernière entrée de temps", "Last time entry"), total: 4,
      items: [{ label: T(lang, "Diagnostic du port réseau", "Network port diagnosis"), detail: "Noor Haddad", value: "1,5 h" }],
    },
    open_url: "https://desk.example/records/tickets/481516", tz: "America/Toronto", as_of: new Date(now - 2 * MIN).toISOString(), cached: false,
  };
}

/** A company: the left pane only (no description, no notes). */
export function companyCard(now: number, lang: Lang): Record<string, unknown> {
  return {
    product, kind: { id: "company", name: T(lang, "Entreprise", "Company") }, id: COMPANY_REF.id, number: "Acme Fabrication",
    title: "Acme Fabrication",
    state: { label: T(lang, "Actif", "Active"), tone: "done" },
    people: [
      { role: "contact", label: T(lang, "Contact principal", "Main contact"), name: "Ada Lindqvist", detail: "418 555-0142", ref: { product: NIMBUS_PRODUCT, kind: "contact", id: "2204" } },
      { role: "owner", label: T(lang, "Responsable", "Owner"), name: "Noor Haddad" },
    ],
    dates: { opened: ago(now, 4 * 365 * DAY), updated: ago(now, 2 * DAY) },
    fields: [
      { label: "Type", value: T(lang, "Client", "Customer") },
      { label: T(lang, "Téléphone", "Phone"), value: "418 555-0100" },
      { label: T(lang, "Ville", "City"), value: T(lang, "Québec", "Quebec City") },
      { label: T(lang, "Billets ouverts", "Open tickets"), value: "7" },
      { label: T(lang, "Ententes actives", "Active agreements"), value: "2" },
      { label: T(lang, "Dernière activité", "Last activity"), type: "ago", at: ago(now, 29 * MIN), value: T(lang, "il y a 29 min", "29 min ago") },
    ],
    notes: { state: "none", items: [] },
    open_url: "https://desk.example/records/companies/7310", tz: "America/Toronto", as_of: new Date(now - 2 * MIN).toISOString(), cached: false,
  };
}

const COMPANY_ELSE = { product: NIMBUS_PRODUCT, kind: "company", id: "7310" };

/** A contact: title, company, emails, phones and the last ticket, on the left pane only. */
export function contactCard(now: number, lang: Lang): Record<string, unknown> {
  return {
    product, kind: { id: "contact", name: "Contact" }, id: CONTACT_REF.id, number: "Ada Lindqvist",
    title: "Ada Lindqvist",
    state: { label: T(lang, "Actif", "Active"), tone: "done" },
    company: { name: "Acme Fabrication", ref: { ...COMPANY_ELSE } },
    fields: [
      { label: T(lang, "Titre", "Title"), value: T(lang, "Directrice des opérations", "Operations director") },
      { label: T(lang, "Courriel", "Email"), value: "ada@acme.example" },
      { label: T(lang, "Courriel 2", "Email 2"), value: "ada.lindqvist@acme.example" },
      { label: T(lang, "Téléphone", "Phone"), value: "418 555-0142" },
      { label: T(lang, "Cellulaire", "Mobile"), value: "418 555-0177" },
      { label: T(lang, "Dernier billet", "Last ticket"), type: "ref", value: "#481516", detail: T(lang, "il y a 29 min", "29 min ago"), ref: { ...TICKET_REF } },
      { label: T(lang, "Dernière activité", "Last activity"), type: "ago", at: ago(now, 29 * MIN), value: T(lang, "il y a 29 min", "29 min ago") },
    ],
    open_url: "https://desk.example/records/contacts/2204", tz: "America/Toronto", as_of: new Date(now - 2 * MIN).toISOString(), cached: false,
  };
}

/** A department (a team): its manager, members and open work. */
export function departmentCard(now: number, lang: Lang): Record<string, unknown> {
  return {
    product, kind: { id: "department", name: T(lang, "Département", "Department") }, id: DEPARTMENT_REF.id, number: T(lang, "Soutien technique", "Technical support"),
    title: T(lang, "Soutien technique", "Technical support"),
    state: { label: T(lang, "Actif", "Active"), tone: "done" },
    people: [{ role: "manager", label: T(lang, "Gestionnaire", "Manager"), name: "Noor Haddad" }],
    fields: [
      { label: T(lang, "Membres", "Members"), value: "6" },
      { label: T(lang, "Billets ouverts", "Open tickets"), value: "23" },
      { label: T(lang, "Projets ouverts", "Open projects"), value: "4" },
      { label: T(lang, "Horaire", "Schedule"), value: T(lang, "Lun-ven 8 h à 17 h", "Mon-Fri 8 am to 5 pm") },
    ],
    lines: {
      state: "ok", title: T(lang, "Membres", "Members"), total: 6,
      items: [
        { label: "Noor Haddad", detail: T(lang, "Gestionnaire", "Manager") },
        { label: "Sam Example", detail: T(lang, "Technicien", "Technician") },
        { label: "Kai Moreau", detail: T(lang, "Technicien", "Technician") },
      ],
    },
    open_url: "https://desk.example/records/departments/31", tz: "America/Toronto", as_of: new Date(now - 2 * MIN).toISOString(), cached: false,
  };
}

/** An email: from, to, subject, date, the first lines, attachments and thread counts. */
export function emailCard(now: number, lang: Lang): Record<string, unknown> {
  return {
    product, kind: { id: "email", name: T(lang, "Courriel", "Email") }, id: EMAIL_REF.id, number: T(lang, "Courriel du 17 nov.", "Email of Nov 17"),
    title: T(lang, "Re : Imprimante de l'accueil hors ligne", "Re: Front desk printer offline"),
    chips: [{ label: T(lang, "2 pièces jointes", "2 attachments"), tone: "open" }],
    people: [
      { role: "from", label: T(lang, "De", "From"), name: "Ada Lindqvist", detail: "ada@acme.example", ref: { ...CONTACT_REF } },
      { role: "to", label: T(lang, "À", "To"), name: T(lang, "Soutien technique", "Technical support"), detail: "support@desk.example" },
    ],
    fields: [
      { label: "Date", type: "ago", at: ago(now, 40 * MIN), value: T(lang, "il y a 40 min", "40 min ago") },
      { label: T(lang, "Pièces jointes", "Attachments"), value: "2" },
      { label: T(lang, "Fil", "Thread"), value: T(lang, "5 messages", "5 messages") },
    ],
    description: { text: T(lang, "Bonjour, l'imprimante affiche toujours une erreur de port ce matin. Pouvez-vous passer avant midi ? Merci d'avance.", "Hello, the printer still shows a port error this morning. Could someone stop by before noon? Thanks in advance."), more: true },
    open_url: "https://desk.example/records/emails/90210", tz: "America/Toronto", as_of: new Date(now - 2 * MIN).toISOString(), cached: false,
  };
}

/** A project: a percent field (the progress bar), one note, a description. */
export function projectCard(now: number, lang: Lang): Record<string, unknown> {
  return {
    product, kind: { id: "project", name: T(lang, "Projet", "Project") }, id: PROJECT_REF.id, number: T(lang, "Migration du serveur", "Server migration"),
    title: T(lang, "Migration du serveur de fichiers", "File server migration"),
    state: { label: T(lang, "En cours", "In progress"), tone: "open" },
    company: { name: "Acme Fabrication", ref: { product: NIMBUS_PRODUCT, kind: "company", id: "7310" } },
    people: [
      { role: "contact", label: "Contact", name: "Ada Lindqvist" },
      { role: "owner", label: T(lang, "Responsable", "Owner"), name: "Noor Haddad" },
    ],
    dates: { opened: ago(now, 21 * DAY), updated: ago(now, DAY), due: new Date(now + 17 * DAY).toISOString() },
    fields: [
      { label: T(lang, "Tableau", "Board"), value: T(lang, "Projets", "Projects") },
      { label: T(lang, "Heures", "Hours"), value: "31 / 60" },
      { label: T(lang, "Avancement", "Progress"), value: "52 %" },
    ],
    description: { text: T(lang, "Remplacement du serveur de fichiers par un stockage partagé, en trois phases.", "Replacing the file server with shared storage, in three phases."), more: false },
    notes: { state: "ok", total: 1, items: [{ author: "Noor Haddad", at: ago(now, DAY + 2 * HOUR), text: T(lang, "Phase 1 terminée, copie validée avec Ada.", "Phase 1 done, copy checked with Ada."), more: false }] },
    open_url: "https://desk.example/records/projects/7788", tz: "America/Toronto", as_of: new Date(now - 2 * MIN).toISOString(), cached: false,
  };
}

const NIMBUS_COMPANY = { product: NIMBUS_PRODUCT, kind: "company", id: "7310" };

/** An invoice as a console sends a kind it declares (#4572): typed fields (money
 * with its currency, calendar days, references to records), a state, one chip,
 * a due DAY, a comment on the right. Invented values, an invented product. */
export function invoiceCard(_now: number, lang: Lang): Record<string, unknown> {
  const money = (amount: string, fr: string, en: string) => ({ type: "money", amount, currency: "CAD", value: T(lang, fr, en) });
  return {
    product, kind: { id: "invoice", name: T(lang, "Facture", "Invoice") }, id: INVOICE_REF.id, number: "INV-1042",
    title: "Example Org",
    state: { label: T(lang, "Envoyée", "Sent"), tone: "open" },
    chips: [{ label: T(lang, "Entente", "Agreement"), tone: "open" }],
    dates: { due: "2026-11-05" },
    fields: [
      { label: T(lang, "Facturé à", "Billed to"), type: "ref", value: "Example Org", ref: { ...NIMBUS_COMPANY } },
      { label: "Total", ...money("1234.5", "1 234,50 $", "$1,234.50") },
      { label: T(lang, "Solde", "Balance"), ...money("1234.5", "1 234,50 $", "$1,234.50") },
      { label: "Date", type: "date", at: "2026-10-06", day: true, value: "2026-10-06" },
      { label: T(lang, "Taxes", "Tax"), ...money("160.49", "160,49 $", "$160.49") },
      { label: T(lang, "Modalités", "Terms"), value: "Net 30" },
      { label: T(lang, "Bon de commande du client", "Customer PO"), value: "PO-7781" },
      { label: T(lang, "Entente", "Agreement"), type: "ref", value: "Managed services", ref: { ...AGREEMENT_REF } },
      { label: T(lang, "Billet", "Ticket"), type: "ref", value: T(lang, "Imprimante de l'accueil hors ligne", "Printer offline at the front desk"), ref: { ...TICKET_REF } },
    ],
    description: { text: T(lang, "Merci de votre confiance.", "Thank you for your business."), more: false },
    notes: { state: "none", items: [], more: false },
    open_url: "https://desk.example/records/invoices/5150", tz: "America/Toronto", as_of: new Date(NOW_FIXTURE - 2 * MIN).toISOString(), cached: false,
  };
}

/** An agreement: calendar days, an amount, a contact, a parent agreement. */
export function agreementCard(_now: number, lang: Lang): Record<string, unknown> {
  return {
    product, kind: { id: "agreement", name: T(lang, "Entente", "Agreement") }, id: AGREEMENT_REF.id, number: "Managed services",
    title: "Managed services",
    state: { label: T(lang, "Active", "Active"), tone: "open" },
    chips: [{ label: "Managed IT", tone: "open" }],
    company: { name: "Example Org", ref: { ...NIMBUS_COMPANY } },
    people: [{ role: "contact", label: "Contact", name: "Sam Example" }],
    fields: [
      { label: T(lang, "Début", "Start"), type: "date", at: "2026-01-01", day: true, value: "2026-01-01" },
      { label: T(lang, "Fin", "End"), type: "date", at: "2026-12-31", day: true, value: "2026-12-31" },
      { label: T(lang, "Montant", "Amount"), type: "money", amount: "1050", currency: "CAD", value: T(lang, "1 050,00 $", "$1,050.00") },
      { label: T(lang, "Cycle de facturation", "Billing cycle"), value: T(lang, "Mensuel", "Monthly") },
      { label: T(lang, "Prochaine facture", "Next invoice"), type: "date", at: "2026-12-01", day: true, value: "2026-12-01" },
      { label: T(lang, "Couverture", "Covered"), value: T(lang, "Heures", "Hours") },
      { label: T(lang, "Limite", "Limit"), value: "40 / CalendarMonth" },
      { label: "SLA", value: "Standard" },
    ],
    description: { text: T(lang, "Couvre les postes gérés du bureau principal.", "Covers the managed workstations of the main office."), more: false },
    notes: { state: "none", items: [], more: false },
    open_url: "https://desk.example/records/agreements/412", tz: "America/Toronto", as_of: new Date(NOW_FIXTURE - 2 * MIN).toISOString(), cached: false,
  };
}

/** A record whose id is a GUID: its number is a human label, never the id. */
export function guidCard(now: number, lang: Lang): Record<string, unknown> {
  const base = ticketCard(now, lang);
  return { ...base, id: GUID_REF.id, number: GUID_REF.id, notes: { state: "none", items: [] }, description: undefined };
}

/** What the route answers for a card. */
export const answer = (card: Record<string, unknown>) => ({ card });
