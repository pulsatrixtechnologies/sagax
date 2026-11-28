/** A board and an invoice as a console sends them (M-20261127-101,
 * M-20261127-140): their cards and their detail sections, the payments
 * taken in memory, for the record window's gallery
 * (src/gallery/record-window.html) and its tests. Invented product,
 * companies and people; nothing leaves the page.
 * Gallery scenes: board and invoice (a chat naming both), invoice-card (a
 * console that serves no detail for invoices: the card's facts only). */
import { NIMBUS_PRODUCT } from "./record-card-fixtures";

type Lang = "fr" | "en";
type Json = Record<string, unknown>;

export const BOARD_ID = "41";
export const INVOICE_ID = "10391";

export function boardInvoiceConsole(lang: Lang, now: number, scene: string) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const ref = (kind: string, id: string) => ({ product: NIMBUS_PRODUCT, kind, id });
  // a local time in Toronto (daylight time until 2026-11-01)
  const at = (iso: string) => new Date(`${iso}${iso < "2026-11-01T02" ? "-04:00" : "-05:00"}`).toISOString();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const H = 3_600_000, D = 86_400_000;
  const NOOR = "Noor Haddad", BRUNO = "Bruno Tremblay", MAYA = "Maya Chen";
  const member = (name: string) => ref("member", { [NOOR]: "13", [BRUNO]: "12", [MAYA]: "14" }[name] ?? "0");
  const ACME = { name: "Acme Fabrication", ref: ref("company", "7310") };
  const CLINIC = { name: L("Clinique Nimbus", "Nimbus Clinic"), ref: ref("company", "7311") };
  const BAKERY = { name: L("Boulangerie Nimbus", "Nimbus Bakery"), ref: ref("company", "7312") };
  const status = { new: { status: L("Nouveau", "New"), status_tone: "open" }, doing: { status: L("En cours", "In progress"), status_tone: "open" }, waiting: { status: L("En attente", "Waiting"), status_tone: "waiting" } };
  const priority = {
    urgent: { priority: L("1 : Urgente", "1: Urgent"), priority_level: "urgent" },
    high: { priority: L("2 : Élevée", "2: High"), priority_level: "high" },
    normal: { priority: L("3 : Moyenne", "3: Medium"), priority_level: "normal" },
    low: { priority: L("4 : Basse", "4: Low"), priority_level: "low" },
  };
  const planned = (start: string, end: string, people: Array<[string, boolean]>) => ({ state: "planned", start: at(start), end: at(end), people: people.map(([name, seen]) => ({ name, ref: member(name), start: at(start), end: at(end), seen })) });
  const ticket = (id: string, summary: string, company: { name: string; ref: unknown }, state: Json, level: Json, type: string, owner: string, opened: string, next: Json) => ({
    id, ref: ref("ticket", id), number: `#${id}`, summary, company: company.name, company_ref: company.ref, ...state, ...level, type,
    owner, ...(owner ? { owner_ref: member(owner) } : {}), mine: owner === NOOR, opened, next,
  });
  const tickets = [
    ticket("300187", L("Imprimante du 2e étage hors ligne", "Second floor printer offline"), ACME, status.new, priority.urgent, L("Matériel", "Hardware"), BRUNO, ago(2 * H), planned("2026-11-27T15:00", "2026-11-27T16:00", [[BRUNO, true]])),
    ticket("299871", L("Sauvegarde en échec", "Backup failing"), CLINIC, status.new, priority.urgent, L("Sauvegarde", "Backup"), NOOR, ago(5 * H), { state: "none" }),
    ticket("299840", L("Courriels qui n'arrivent plus", "Emails no longer arrive"), BAKERY, status.new, priority.urgent, L("Courriel", "Email"), "", ago(1 * H), { state: "none" }),
    ticket("300110", L("Accès VPN pour un nouvel employé", "VPN access for a new employee"), BAKERY, status.doing, priority.high, L("Accès", "Access"), BRUNO, ago(1 * D), { state: "ongoing", start: at("2026-11-27T13:00"), end: at("2026-11-27T14:30"), people: [{ name: BRUNO, ref: member(BRUNO), start: at("2026-11-27T13:00"), end: at("2026-11-27T14:30"), seen: true }] }),
    ticket("299655", L("Mise à jour du pare-feu", "Firewall update"), ACME, status.doing, priority.high, L("Réseau", "Network"), NOOR, ago(2 * D), { state: "ongoing", people: [{ name: NOOR, ref: member(NOOR), seen: true }] }),
    ticket("299950", L("Renouvellement des licences", "License renewal"), ACME, status.doing, priority.normal, L("Licences", "Licenses"), MAYA, ago(3 * D), planned("2026-11-30T09:00", "2026-11-30T10:00", [[MAYA, true]])),
    ticket("300124", L("Partenariat Acme Fabrication", "Acme Fabrication partnership"), ACME, status.waiting, priority.normal, L("Administratif", "Administration"), NOOR, ago(35 * D), planned("2026-12-14T14:30", "2026-12-14T15:30", [[NOOR, true], [BRUNO, false]])),
    ticket("299702", L("Nouveau poste pour la réception", "New reception workstation"), CLINIC, status.waiting, priority.low, L("Poste", "Workstation"), BRUNO, ago(6 * D), planned("2026-12-01T10:00", "2026-12-01T11:00", [[BRUNO, false]])),
  ];
  const weeks = [["2026-10-19", 14, 12], ["2026-10-26", 11, 13], ["2026-11-02", 16, 14], ["2026-11-09", 12, 11], ["2026-11-16", 15, 16], ["2026-11-23", 12, 12]].map(([week, opened, closed]) => ({ week, opened, closed }));

  const money = (value: number) => new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol" }).format(value);
  const TOTAL = 1421.67;
  const payments: Array<{ id: string; date: string; type: string; amount: number; reference?: string; by: string }> = [];
  const paid = () => payments.reduce((sum, row) => sum + row.amount, 0);
  const board = {
    product: { id: NIMBUS_PRODUCT, name: "Nimbus Desk" }, kind: { id: "board", name: "Board" }, id: BOARD_ID, number: L("Soutien", "Support"),
    title: L("Soutien (Transformation numérique)", "Support (Digital transformation)"),
    chips: [{ label: L(`${tickets.length} billets actifs`, `${tickets.length} active tickets`), tone: "open" }],
    notes: { state: "none", items: [] }, open_url: `https://desk.example/records/boards/${BOARD_ID}`, tz: "America/Toronto", as_of: new Date(now - 2 * 60_000).toISOString(), cached: false,
  };
  const invoice = () => ({
    product: { id: NIMBUS_PRODUCT, name: "Nimbus Desk" }, kind: { id: "invoice", name: L("Facture", "Invoice") }, id: INVOICE_ID, number: `F-${INVOICE_ID}`,
    title: "Acme Fabrication inc.",
    state: { label: L("Envoyée", "Sent"), tone: "open" },
    chips: [{ label: L("Standard", "Standard"), tone: "open" }],
    dates: { due: "2026-10-31" },
    fields: [
      { label: L("Facturée à", "Billed to"), type: "ref", value: "Acme Fabrication inc.", ref: ACME.ref },
      { label: "Total", type: "money", amount: String(TOTAL), currency: "CAD", value: money(TOTAL) },
      { label: L("Solde", "Balance"), type: "money", amount: String(TOTAL - paid()), currency: "CAD", value: money(TOTAL - paid()) },
      { label: "Date", type: "date", at: "2026-10-01", day: true, value: "2026-10-01" },
      { label: L("Taxes", "Tax"), type: "money", amount: "185.17", currency: "CAD", value: money(185.17) },
      { label: L("Modalités", "Terms"), value: "Net 30" },
      { label: L("Entente", "Agreement"), type: "ref", value: L("Bloc d'heures 2026", "2026 block of hours"), ref: ref("agreement", "412") },
      { label: L("Billet", "Ticket"), type: "ref", value: "#300124", ref: ref("ticket", "300124") },
    ],
    lines: { state: "ok", title: L("Lignes", "Lines"), total: 3, more: false, items: [
      { label: L("Soutien technique, octobre 2026", "Technical support, October 2026"), detail: "6.5", value: money(877.5) },
      { label: L("Licences de suite bureautique", "Office suite licenses"), detail: "12", value: money(264) },
      { label: L("Déplacement", "Travel"), detail: "1", value: money(95) },
    ] },
    notes: { state: "none", items: [] }, open_url: `https://desk.example/records/invoices/${INVOICE_ID}`, tz: "America/Toronto", as_of: new Date(now - 2 * 60_000).toISOString(), cached: false,
  });
  const document = () => ({
    document: {
      issued: "2026-10-01", due: "2026-10-31", terms: "Net 30",
      billed_to: { name: "Acme Fabrication inc.", ref: ACME.ref, attention: "Ada Lindqvist", address: [L("1200, rue des Cascades", "1200 Cascades Street"), L("Ville Nimbus (Québec)  G1A 0A1", "Nimbus City, QC  G1A 0A1")] },
      links: [{ label: "#299950", ref: ref("ticket", "299950") }, { label: "#300124", ref: ref("ticket", "300124") }, { label: L("Entente Bloc d'heures 2026", "2026 block of hours agreement"), ref: ref("agreement", "412") }],
      subtotal: money(1236.5), taxes: [{ label: L("TPS 5 %", "GST 5%"), amount: money(61.83) }, { label: L("TVQ 9,975 %", "QST 9.975%"), amount: money(123.34) }],
      total: money(TOTAL), paid: money(paid()), balance: money(TOTAL - paid()), owed: TOTAL - paid() > 0, pdf: true,
      steps: [
        { step: "issued", at: "2026-10-01", done: true }, { step: "sent", at: "2026-10-01", who: "Ada Lindqvist", done: true },
        { step: "due", at: "2026-10-31" }, { step: "reminder", at: "2026-11-15", done: true }, { step: "next_reminder", at: "2026-12-01", done: false },
      ],
      client: { balance: money(4820.15), late: money(2170.15), pays_in: L("38 jours en moyenne", "38 days on average") },
    },
    lines: [
      { label: L("Soutien technique, octobre 2026", "Technical support, October 2026"), detail: L("6,50 h à 135,00 $ · billets #299950 et #300124", "6.50 h at $135.00 · tickets #299950 and #300124"), amount: money(877.5) },
      { label: L("Licences de suite bureautique", "Office suite licenses"), detail: L("12 licences à 22,00 $", "12 licenses at $22.00"), amount: money(264) },
      { label: L("Déplacement", "Travel"), detail: L("Ville Nimbus, 1 visite", "Nimbus City, 1 visit"), amount: money(95) },
    ],
  });
  const history = [
    { id: "3", at: at("2026-11-15T08:00"), text: L("Rappel envoyé automatiquement à ada@acme.example", "Reminder sent automatically to ada@acme.example"), tone: "done" },
    { id: "2", at: at("2026-10-01T16:12"), text: L("Facture envoyée par Bruno Tremblay", "Invoice sent by Bruno Tremblay"), tone: "done" },
    { id: "1", at: at("2026-10-01T16:05"), text: L("Facture créée à partir de 2 billets et 1 entente", "Invoice created from 2 tickets and 1 agreement"), tone: "done" },
  ];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  return {
    chat: lang === "fr"
      ? `Voici le board [Soutien (Transformation numérique)](sagax://record/${NIMBUS_PRODUCT}/board/${BOARD_ID}) : trois billets urgents attendent. La facture [F-${INVOICE_ID}](sagax://record/${NIMBUS_PRODUCT}/invoice/${INVOICE_ID}) d'Acme Fabrication est en retard.`
      : `Here is the board [Support (Digital transformation)](sagax://record/${NIMBUS_PRODUCT}/board/${BOARD_ID}): three urgent tickets wait. Acme Fabrication's invoice [F-${INVOICE_ID}](sagax://record/${NIMBUS_PRODUCT}/invoice/${INVOICE_ID}) is late.`,
    /** the card of the board or the invoice, else null */
    card(kind: string, id: string): Json | null {
      if (kind === "board" && id === BOARD_ID) return board;
      if (kind === "invoice" && id === INVOICE_ID) return invoice();
      return null;
    },
    /** the detail route of the board or the invoice, else null */
    detail(url: string, init?: RequestInit): Response | null {
      const isBoard = url.includes(`/board/${BOARD_ID}/detail`), isInvoice = url.includes(`/invoice/${INVOICE_ID}/detail`);
      if (!isBoard && !isInvoice) return null;
      // a console older than the board and invoice sections: it serves no detail for these kinds
      if (isInvoice && scene === "invoice-card") return json({ state: "unavailable", code: "kind_unknown" }, 404);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action?: string; set?: Record<string, unknown> };
        if (body.action !== "payment.add") return json({ state: "unavailable", code: "action_unknown" }, 400);
        payments.unshift({ id: String(900 + payments.length), date: String(body.set?.date), type: L("Virement", "Transfer"), amount: Number(body.set?.amount), ...(body.set?.reference ? { reference: String(body.set.reference) } : {}), by: NOOR });
        history.unshift({ id: String(10 + payments.length), at: new Date(now).toISOString(), text: L(`Paiement de ${money(Number(body.set?.amount))} enregistré par ${NOOR}`, `Payment of ${money(Number(body.set?.amount))} recorded by ${NOOR}`), tone: "done" });
        return json({ updated: true });
      }
      const section = new URL(url, "http://gallery").searchParams.get("section");
      if (isBoard) {
        if (section === "counts") return json({ counts: { tickets: tickets.length }, fields: [], actions: [] });
        if (section === "tickets") return json({ lines: tickets, next: null });
        if (section === "stats") return json({ lines: weeks, closed_this_week: 12, first_response: { text: "38 min", detail: L("Objectif : moins de 1 h · atteint 92 % du temps", "Target: under 1 h · met 92% of the time") }, next: null });
        return json({ lines: [], next: null });
      }
      if (section === "counts") return json({ counts: { payments: payments.length, history: history.length }, fields: [], actions: ["payment.add"] });
      if (section === "document") return json({ ...document(), next: null });
      if (section === "payments") return json({ lines: payments.map((row) => ({ id: row.id, date: row.date, type: row.type, amount: money(row.amount), ...(row.reference ? { reference: row.reference } : {}), by: row.by })), next: null });
      if (section === "history") return json({ lines: history, next: null });
      if (section === "download") return json({ name: `F-${INVOICE_ID}.pdf`, contentType: "application/pdf", base64: btoa("PDF") });
      return json({ lines: [], next: null });
    },
  };
}
