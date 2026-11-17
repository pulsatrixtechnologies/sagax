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
      { role: "contact", label: "Contact", name: "Ada Lindqvist", detail: "418 555-0142" },
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
        { author: "Ada Lindqvist", at: ago(now, 4 * HOUR), internal: false, text: T(lang, "Toujours rien ce matin, on imprime à l'étage en attendant.", "Still nothing this morning, we print upstairs meanwhile."), more: false },
      ],
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
    people: [{ role: "owner", label: T(lang, "Responsable", "Owner"), name: "Noor Haddad" }],
    dates: { opened: ago(now, 4 * 365 * DAY), updated: ago(now, 2 * DAY) },
    fields: [
      { label: T(lang, "Identifiant", "Identifier"), value: "ACMEFAB" },
      { label: "Type", value: T(lang, "Client", "Customer") },
      { label: T(lang, "Téléphone", "Phone"), value: "418 555-0100" },
      { label: T(lang, "Ville", "City"), value: T(lang, "Québec", "Quebec City") },
    ],
    notes: { state: "none", items: [] },
    open_url: "https://desk.example/records/companies/7310", tz: "America/Toronto", as_of: new Date(now - 2 * MIN).toISOString(), cached: false,
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

/** A record whose id is a GUID: its number is a human label, never the id. */
export function guidCard(now: number, lang: Lang): Record<string, unknown> {
  const base = ticketCard(now, lang);
  return { ...base, id: GUID_REF.id, number: GUID_REF.id, notes: { state: "none", items: [] }, description: undefined };
}

/** What the route answers for a card. */
export const answer = (card: Record<string, unknown>) => ({ card });
