/** Isolated gallery for headless screenshots of record cards (#4507). Not
 * shipped in the app. An invented product ("Nimbus Desk") and invented
 * records: nothing here names a real product, company or person.
 * ?lang=fr|en &skin=<id> &scene=<name>
 *   overview   every kind, then every state (default)
 *   ticket | company | contact | department | email | project | guid | pinned   one card
 *   invoice | agreement   a kind the product declares (#4572), drawn by the same renderer
 *   invoicelong | invoicenoref | agreementnoend | agreementnodecimals   their stress variants (&pinned=1 pins)
 *   busy       a chip in a busy chat (bubbles and a table above and below): the card must sit above it
 *   chat2      live chips of an invoice and an agreement: a record named in a card opens in place, Back returns
 *   loading | noaccess | unknown | notconnected | signin | busy | down | orgrefused   one state
 *   neighbour  the link hover card (the conforming neighbour) beside a ticket card
 *   chat       live chips in a paragraph, a list and a table: click (pin), Escape; hover opens nothing (#4785)
 *   related    the same chips with the ticket's detail route answered: a rich ticket (six notes of every kind, one
 *              resource, two configurations, its editable fields) and a company with little content (#5053);
 *              a note written in the product's Markdown with inline images and a signature, three attachments,
 *              an editable title and the owners (M-20261119-084). &console=old answers as the console did
 *              before M-20261119-084: the attachments refused as a bare 404, integration accounts among the
 *              owners (one person twice), no editable title
 * The time is held still (scene `now`), so a capture is the same every run. */
import { StrictMode, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { LinkPreviewCard } from "../components/LinkHoverCard";
import { DETAIL_SECTIONS, type DetailSection } from "../lib/record-detail";
import { RECORD_EDIT_FIELDS } from "../lib/record-detail";
import { RecordCard } from "../components/RecordCard";
import { loadLocale } from "../lib/i18n";
import { NIMBUS_MARK, NIMBUS_PRODUCT, agreementCard, companyCard, contactCard, departmentCard, emailCard, guidCard, invoiceCard, nimbusProduct, nimbusProductRaw, projectCard, ticketCard, answer, AGREEMENT_REF, COMPANY_REF, CONTACT_REF, DEPARTMENT_REF, EMAIL_REF, GUID_REF, INVOICE_REF, PROJECT_REF, TICKET_REF, type Lang } from "../lib/record-card-fixtures";
import { seedPersonProducts } from "../lib/person-products";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { parseRecordCardAnswer, type RecordCardAnswer, type RecordCardMiss, type RecordRef } from "../../shared/record-cards";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang: Lang = params.get("lang") === "en" ? "en" : "fr";
await loadLocale(lang);
const scene = params.get("scene") ?? "overview";
const oldConsole = params.get("console") === "old";
// 2026-11-17 14:34 in Toronto
const NOW = Date.parse("2026-11-17T14:34:00-05:00");

const product = { name: "Nimbus Desk", iconUrl: NIMBUS_MARK };
const kindNames: Record<string, string> = lang === "fr"
  ? { ticket: "Billet", company: "Entreprise", project: "Projet", invoice: "Facture", agreement: "Entente", contact: "Contact", department: "Département", email: "Courriel" }
  : { ticket: "Ticket", company: "Company", project: "Project", invoice: "Invoice", agreement: "Agreement", contact: "Contact", department: "Department", email: "Email" };
const noop = () => {};

function read(raw: RecordCardAnswer | RecordCardMiss) {
  const parsed = "card" in raw || "state" in raw ? raw : { state: "unavailable" as const };
  return {
    card: "card" in parsed ? parsed.card : null,
    miss: "card" in parsed ? null : parsed,
    loading: false, at: NOW - 120_000, refresh: noop,
  };
}

// a rich ticket (M-20261119-055): several notes of every kind, one resource, two configurations
const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
// a note as the product stores it (M-20261119-084): an inline image, bold, a phone link, escaped brackets and
// parentheses, and a signature of small linked icons; every address is invented
const INLINE = "https://desk.example.test/v4_6_release/api/inlineimages/acme";
const SHOT_GUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ICON_GUIDS = ["1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f"];
const MARKDOWN_NOTE = [
  L("Bonjour,", "Hello,"),
  "",
  L("J'ai reçu ce courriel ce matin, est-ce qu'il est légitime\\? Capture ci-dessous \\(le lien pointe ailleurs\\).", "I got this email this morning, is it legitimate\\? Screenshot below \\(the link points elsewhere\\)."),
  "",
  `![\\[image\\]](${INLINE}/${SHOT_GUID})`,
  "",
  L("**Merci de me répondre avant midi.**", "**Please answer before noon.**"),
  "",
  "Ada Lindqvist | Acme Fabrication | [418 555-0142](tel:4185550142)",
  ICON_GUIDS.map((guid, index) => `[![\\[image\\]](${INLINE}/${guid})](https://social.example.test/acme/${index + 1})`).join(" "),
].join("\n");
const relatedPages = {
  schedule: { lines: [
    { member: "Noor Haddad", date: "2026-11-18 09:00", end: "2026-11-18 10:30", where: L("À distance", "Remote"), doneFlag: false },
  ] },
  notes: { lines: [
    { author: "Ada Lindqvist", date: "2026-11-18 09:30", kind: "discussion", text: MARKDOWN_NOTE },
    { author: "Ada Lindqvist", date: "2026-11-18 08:45", kind: "discussion", text: L("L'imprimante s'arrête après la première page. Le bac de remplacement est prêt à l'accueil.\nNous imprimons à l'étage en attendant, mais la file du comptoir reste bloquée pour les étiquettes d'expédition.", "The printer stops after the first page. The replacement tray is ready at reception.\nWe print upstairs meanwhile, but the counter queue stays blocked for the shipping labels.") },
    { author: "Noor Haddad", date: "2026-11-18 08:10", kind: "internal", text: L("Apporter le rouleau d'entraînement de rechange. Le pilote a été réinstallé hier sans effet durable : vérifier le port réseau et le câble avant de remplacer la pièce.", "Bring the spare feed roller. The driver was reinstalled yesterday with no lasting effect: check the network port and the cable before replacing the part.") },
    { author: "Noor Haddad", date: "2026-11-17 16:20", kind: "discussion", text: L("Bonjour Ada, nous regardons le pilote et le port réseau de l'imprimante. Un technicien passe demain matin à 9 h.", "Hello Ada, we are looking at the printer's driver and network port. A technician comes by tomorrow morning at 9.") },
    { author: "Dispatch", date: "2026-11-17 14:30", kind: "internal", text: L("Billet assigné à Noor. Fenêtre d'intervention confirmée avec le client.", "Ticket assigned to Noor. Visit window confirmed with the customer.") },
    { author: "Ada Lindqvist", date: "2026-11-17 09:05", kind: "description", text: L("L'imprimante du comptoir ne répond plus au ping depuis lundi matin. Redémarrée deux fois, même résultat.", "The counter printer has not answered a ping since Monday morning. Restarted twice, same result.") },
    { author: "Noor Haddad", date: "2026-11-18 11:15", kind: "resolution", text: L("Rouleau d'entraînement remplacé, port réseau changé. Vingt pages imprimées sans arrêt.", "Feed roller replaced, network port changed. Twenty pages printed without a stop.") },
  ] },
  time: { tab: "time", totalHours: "3.5 h", lines: [
    { date: L("18 nov.", "Nov 18"), member: "Noor Haddad", hours: "1.5 h", note: L("Pilote réinstallé et file vérifiée sur les deux postes.", "Reinstalled the printer driver and verified the queue on both workstations.") },
    { date: L("17 nov.", "Nov 17"), member: "Noor Haddad", hours: "2 h", note: L("Connexion tracée et réglages réseau vérifiés.", "Traced the connection and checked the network settings.") },
  ] },
  configurations: { tab: "configurations", lines: [
    { name: L("Imprimante de l'accueil", "Reception printer"), type: L("Imprimante", "Printer"), status: L("Actif", "Active") },
    { name: L("Poste du comptoir", "Counter workstation"), type: L("Poste de travail", "Workstation"), status: L("Actif", "Active") },
  ] },
  expenses: { tab: "expenses", lines: [{ date: L("17 nov.", "Nov 17"), member: "Noor Haddad", type: L("Déplacement", "Travel"), amount: "12,50 $" }] },
  activities: { tab: "activities", lines: [{ subject: L("Confirmer la qualité d'impression", "Confirm print quality"), type: L("Suivi", "Follow-up"), date: L("19 nov.", "Nov 19"), assigned: "Noor Haddad" }] },
  attachments: { tab: "attachments", lines: [
    { name: "print-test.txt", size: "10 B", date: L("18 nov.", "Nov 18"), id: "42" },
    { name: L("Capture d'écran 2026-11-18.png", "Screenshot 2026-11-18.png"), size: "34.9 KB", date: L("18 nov.", "Nov 18"), id: "43" },
    { name: L("Courriel suspect.eml", "Suspicious email.eml"), size: "499.9 KB", date: L("18 nov.", "Nov 18"), id: "44" },
  ] },
};
const relatedCounts = Object.fromEntries(DETAIL_SECTIONS.filter((key) => key !== "schedule" && key !== "notes").map((key) => [key, relatedPages[key].lines.length]));

const statuses = [{ value: "1", label: lang === "fr" ? "En cours" : "In progress" }, { value: "2", label: lang === "fr" ? "En attente" : "Waiting" }];
let status = statuses[0]!;
// the owners as the console answers them: the organization's people; before M-20261119-084 the integration
// accounts too, one of them carrying a person's own name (the same person listed twice)
const PEOPLE = [{ value: "11", label: "Ada Lindqvist" }, { value: "12", label: "Bruno Tremblay" }, { value: "13", label: "Noor Haddad" }, { value: "14", label: "Sacha Morin" }];
const OWNERS = oldConsole
  ? [{ value: "90", label: "Phone System Integration" }, { value: "11", label: "Ada Lindqvist" }, { value: "91", label: "Ada Lindqvist" }, { value: "92", label: "Backup Monitor API" }, { value: "93", label: "Calendar Bridge" }, ...PEOPLE.slice(1)]
  : PEOPLE;
let title: string | undefined;

/** A png of the note's images, drawn here (no file, no network): a screenshot, or a small round icon. */
async function notePng(guid: string): Promise<string> {
  const icon = ICON_GUIDS.indexOf(guid);
  const canvas = document.createElement("canvas");
  canvas.width = icon >= 0 ? 32 : 640;
  canvas.height = icon >= 0 ? 32 : 300;
  const ctx = canvas.getContext("2d")!;
  if (icon >= 0) {
    ctx.fillStyle = icon === 0 ? "#2563eb" : "#4b5563";
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#f3f4f6"; ctx.fillRect(0, 0, 640, 300);
    ctx.fillStyle = "#1f2937"; ctx.fillRect(0, 0, 640, 40);
    ctx.fillStyle = "#ffffff"; ctx.font = "16px sans-serif"; ctx.fillText(L("Votre boîte est pleine", "Your mailbox is full"), 20, 26);
    ctx.fillStyle = "#9ca3af";
    for (const [y, w] of [[80, 520], [110, 460], [140, 500], [170, 300]] as const) ctx.fillRect(20, y, w, 12);
    ctx.fillStyle = "#2563eb"; ctx.fillRect(20, 220, 180, 40);
    ctx.fillStyle = "#ffffff"; ctx.fillText(L("Valider le compte", "Verify the account"), 36, 246);
  }
  const blob = await new Promise<Blob>((done) => canvas.toBlob((made) => done(made!), "image/png"));
  let binary = "";
  for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function Card({ record, label, answerOf, pinned, miss, loading }: { record: RecordRef; label: string; answerOf?: Record<string, unknown>; pinned?: boolean; miss?: RecordCardMiss; loading?: boolean }) {
  const value = miss ?? (answerOf ? parseRecordCardAnswer(answer(answerOf)) : null);
  const base = value ? read(value) : { card: null, miss: null, loading: true, at: 0, refresh: noop };
  return (
    <div data-gallery-card={record.kind} className="w-fit">
      <RecordCard
        record={record} label={label} kindName={kindNames[record.kind]} product={product}
        read={loading ? { ...base, loading: true, card: null, miss: null } : base}
        pinned={pinned} onClose={noop} onAsk={noop} onConnect={noop} onSignIn={noop} onOpenRecord={noop} canOpenRecord={(ref) => ref.product === NIMBUS_PRODUCT} now={NOW}
      />
    </div>
  );
}

const ticket = <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={ticketCard(NOW, lang)} />;
const company = <Card record={COMPANY_REF} label="Acme Fabrication" answerOf={companyCard(NOW, lang)} />;
const contact = <Card record={CONTACT_REF} label="Ada Lindqvist" answerOf={contactCard(NOW, lang)} />;
const department = <Card record={DEPARTMENT_REF} label={lang === "fr" ? "Soutien technique" : "Technical support"} answerOf={departmentCard(NOW, lang)} />;
const email = <Card record={EMAIL_REF} label={lang === "fr" ? "Courriel du 17 nov." : "Email of Nov 17"} answerOf={emailCard(NOW, lang)} />;
const project = <Card record={PROJECT_REF} label={lang === "fr" ? "Migration du serveur" : "Server migration"} answerOf={projectCard(NOW, lang)} />;
const guid = <Card record={GUID_REF} label={GUID_REF.id} answerOf={guidCard(NOW, lang)} />;
const asPinned = params.get("pinned") === "1";
const invoice = <Card record={INVOICE_REF} label="INV-1042" answerOf={invoiceCard(NOW, lang)} pinned={asPinned} />;
const agreement = <Card record={AGREEMENT_REF} label="Managed services" answerOf={agreementCard(NOW, lang)} pinned={asPinned} />;
const pinned = <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={ticketCard(NOW, lang)} pinned />;
// the stress variants of the UX gate: a two-line title, many fields, no notes, long names
const variant = (change: (card: Record<string, unknown>) => void) => { const card = ticketCard(NOW, lang); change(card); return card; };
const longTitle = variant((card) => { card.title = lang === "fr" ? "Imprimante de l'accueil hors ligne depuis lundi matin, redémarrée deux fois sans succès, pilote à réinstaller sur tous les postes" : "Front desk printer offline since Monday morning, restarted twice without success, driver to reinstall on every workstation"; });
const manyFields = variant((card) => { card.fields = Array.from({ length: 12 }, (_, index) => ({ label: `${lang === "fr" ? "Champ" : "Field"} ${index + 1}`, value: `${lang === "fr" ? "Valeur" : "Value"} ${index + 1}` })); });
const noNotes = variant((card) => { card.notes = { state: "none", items: [] }; });
const longNames = variant((card) => {
  card.company = { name: "Acme Fabrication et Distribution Internationale de Pièces Usinées de Précision", ref: { product: "nimbus_desk", kind: "company", id: "7310" } };
  card.people = [{ role: "contact", label: "Contact", name: "Ada Lindqvist-Haddad de la Fontaine-Beaumont", detail: "418 555-0142 poste 1234" }, { role: "owner", label: lang === "fr" ? "Responsable" : "Owner", name: "Noor Haddad-Lindqvist de Saint-Exupéry" }];
  card.priority = { label: lang === "fr" ? "Priorité 1 - Critique, intervention immédiate" : "Priority 1 - Critical, immediate response", level: "urgent" };
  card.state = { label: lang === "fr" ? "En attente de la pièce du fournisseur" : "Waiting for the supplier's part", tone: "waiting" };
});
// the same stress variants for the kinds a product declares: 14 fields and a long comment, no end date,
// a money value with no decimals, a reference the person cannot open
const invoiceWith = (change: (card: Record<string, unknown>) => void) => { const card = invoiceCard(NOW, lang); change(card); return card; };
const agreementWith = (change: (card: Record<string, unknown>) => void) => { const card = agreementCard(NOW, lang); change(card); return card; };
const invoiceLong = invoiceWith((card) => {
  const fields = card.fields as Array<Record<string, unknown>>;
  for (let index = 0; index < 5; index += 1) fields.push({ label: `${lang === "fr" ? "Champ" : "Field"} ${index + 1}`, value: `${lang === "fr" ? "Valeur" : "Value"} ${index + 1}` });
  card.description = { text: lang === "fr"
    ? "Merci de votre confiance. Cette facture couvre les services gérés de septembre et d'octobre, le remplacement de deux postes de travail et la migration du courriel. Le paiement est attendu dans les trente jours suivant la date de facturation. Les écarts doivent nous être signalés avant l'échéance afin d'éviter des frais de retard. Pour toute question sur une ligne, écrivez-nous en indiquant le numéro de facture."
    : "Thank you for your business. This invoice covers the managed services of September and October, the replacement of two workstations and the mail migration. Payment is expected within thirty days of the invoice date. Any discrepancy must be reported before the due date to avoid late fees. For any question on a line, write to us quoting the invoice number.", more: false };
});
const invoiceNoRef = invoiceWith((card) => {
  const fields = card.fields as Array<{ ref?: { product: string; kind: string; id: string }; type: string }>;
  for (const field of fields) if (field.type === "ref" && field.ref?.kind === "agreement") field.ref = { product: "ledger_other", kind: "agreement", id: "412" };
});
const agreementNoEnd = agreementWith((card) => {
  const fields = (card.fields as Array<{ label: string }>).filter((field) => field.label !== (lang === "fr" ? "Fin" : "End"));
  fields.splice(1, 0, { label: lang === "fr" ? "Sans date de fin" : "No end date", value: lang === "fr" ? "Oui" : "Yes" } as never);
  card.fields = fields;
});
const agreementNoDecimals = agreementWith((card) => {
  for (const field of card.fields as Array<{ type?: string; value: string }>) if (field.type === "money") field.value = lang === "fr" ? "1 050 $" : "$1,050";
});
const variants: Record<string, ReactElement> = {
  invoicelong: <Card record={INVOICE_REF} label="INV-1042" answerOf={invoiceLong} pinned={asPinned} />,
  invoicenoref: <Card record={INVOICE_REF} label="INV-1042" answerOf={invoiceNoRef} pinned={asPinned} />,
  agreementnoend: <Card record={AGREEMENT_REF} label="Managed services" answerOf={agreementNoEnd} pinned={asPinned} />,
  agreementnodecimals: <Card record={AGREEMENT_REF} label="Managed services" answerOf={agreementNoDecimals} pinned={asPinned} />,
  longtitle: <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={longTitle} pinned={asPinned} />,
  fields12: <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={manyFields} pinned={asPinned} />,
  nonotes: <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={noNotes} pinned={asPinned} />,
  longnames: <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={longNames} pinned={asPinned} />,
};
const miss = (state: RecordCardMiss["state"], extra: Partial<RecordCardMiss> = {}) => (
  <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} miss={{ state, ...extra }} />
);
const states: Record<string, ReactElement> = {
  loading: <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} loading />,
  noaccess: miss("no_access"),
  unknown: miss("unknown"),
  notconnected: miss("not_connected", { productState: "key_missing" }),
  signin: miss("sign_in"),
  busy: miss("busy", { retryAfter: 10 }),
  down: miss("down"),
  orgrefused: miss("org_refused", { rule: { id: "rule-2", text: "Reading tickets is refused" } }),
};

const CHAT = lang === "fr"
  ? `J'ai regardé [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}) : l'imprimante est revenue après la réinstallation du pilote. Les autres fiches liées :

- [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}), le client
- [Migration du serveur](sagax://record/nimbus_desk/project/${PROJECT_REF.id}), le projet en cours

| Fiche | Lien |
| --- | --- |
| Billet | [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}) |
| Entreprise | [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}) |`
  : `I looked at [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}): the printer came back after the driver was reinstalled. The other linked records:

- [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}), the customer
- [Server migration](sagax://record/nimbus_desk/project/${PROJECT_REF.id}), the current project

| Record | Link |
| --- | --- |
| Ticket | [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}) |
| Company | [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}) |`;

const CHAT2 = lang === "fr"
  ? `Il reste une facture impayée : [INV-1042](sagax://record/nimbus_desk/invoice/${INVOICE_REF.id}), échue le 5 novembre. Elle est liée à l'entente [Managed services](sagax://record/nimbus_desk/agreement/${AGREEMENT_REF.id}).`
  : `One invoice is still unpaid: [INV-1042](sagax://record/nimbus_desk/invoice/${INVOICE_REF.id}), due on November 5. It belongs to the agreement [Managed services](sagax://record/nimbus_desk/agreement/${AGREEMENT_REF.id}).`;

// a stand-in console: the product list and the cards, as the routes answer
seedPersonProducts([nimbusProduct()]);
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/me/perspicax/products")) return json({ products: [nimbusProductRaw()] });
  if (url.includes("/detail?")) {
    if (scene !== "related") return new Response(null, { status: 404 });
    const query = new URL(url, window.location.href).searchParams;
    if (init?.method === "POST") {
      const change = JSON.parse(String(init.body));
      if (change.field === "summary") title = change.value;
      else status = statuses.find(choice => choice.value === change.value) ?? status;
      return json({ updated: true });
    }
    switch (query.get("section")) {
      case "counts": return json({ counts: oldConsole ? { ...relatedCounts, attachments: undefined } : relatedCounts, fields: oldConsole ? RECORD_EDIT_FIELDS : [...RECORD_EDIT_FIELDS, "summary"] });
      case "choices": return json({ choices: query.get("field") === "owner" ? OWNERS : statuses, next: null });
      case "download": return json({ name: "print-test.txt", contentType: "text/plain", base64: btoa("Print test") });
      case "image": {
        const guid = (query.get("field") ?? "").split("/").at(-1) ?? "";
        return [SHOT_GUID, ...ICON_GUIDS].includes(guid) ? json({ contentType: "image/png", base64: await notePng(guid) }) : new Response(JSON.stringify({ state: "unavailable", code: "detail_invalid" }), { status: 400 });
      }
      // the console before M-20261119-084: its documents read refused, answered as a bare 404
      case "attachments": if (oldConsole) return new Response(JSON.stringify({ state: "unavailable" }), { status: 404, headers: { "content-type": "application/json" } }); return json({ ...relatedPages.attachments, next: null });
      default: return json({ ...relatedPages[query.get("section") as DetailSection], next: null });
    }
  }
  const match = /\/api\/me\/records\/nimbus_desk\/(\w+)\/([^?]+)/.exec(url);
  if (match) {
    const mode = params.get("answer");
    if (mode) return json({ state: mode, ...(mode === "busy" ? { retryAfter: 10 } : {}) });
    const make = { ticket: ticketCard, company: companyCard, project: projectCard, invoice: invoiceCard, agreement: agreementCard, contact: contactCard, department: departmentCard, email: emailCard }[match[1]!];
    if (scene === "related" && match[1] === "ticket") {
      const card = ticketCard(Date.now(), lang);
      const fields = (card.fields as Array<Record<string, unknown>>).map((field, index) => ({
        ...field, edit_key: ["board", "type"][index],
      }));
      return json(answer({ ...card, fields, ...(title ? { title } : {}), state: { label: status.label, tone: "open" } }));
    }
    return json(make ? answer(make(Date.now(), lang)) : { state: "unknown" });
  }
  return realFetch(input, init);
};

function Frame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`min-h-screen bg-app p-2 text-ink ${wide ? "" : ""}`}>{children}</div>;
}

function Label({ children }: { children: string }) {
  return <p className="mb-1.5 mt-5 text-[12px] leading-4 text-ink-secondary first:mt-0">{children}</p>;
}

function Page() {
  if (scene === "chat" || scene === "related") {
    return (
      <Frame>
        <div className="max-w-[44rem] pt-[22rem] text-[15px] leading-6" data-gallery-chat>
          <ChatMarkdown text={CHAT} botId="bot-gallery" draftId="bot:bot-gallery:thread-gallery" message={{ threadId: "thread-gallery", messageId: "m-1" }} />
        </div>
      </Frame>
    );
  }
  if (scene === "busy") {
    const bubble = (text: string, mine?: boolean) => (
      <div className={`w-fit max-w-[min(42rem,78%)] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink ${mine ? "ms-auto" : ""}`}>{text}</div>
    );
    const filler = lang === "fr" ? "Voici ce que j'ai trouvé dans les billets ouverts de la semaine, classés par client." : "Here is what I found in this week's open tickets, grouped by customer.";
    return (
      <Frame>
        <div className="flex max-w-[44rem] flex-col gap-3 text-[15px] leading-6" data-gallery-chat>
          {bubble(filler, true)}{bubble(filler)}{bubble(filler, true)}{bubble(filler)}
          <div className="rounded-xl border border-hairline p-3">
            <ChatMarkdown text={CHAT} botId="bot-gallery" draftId="bot:bot-gallery:thread-gallery" message={{ threadId: "thread-gallery", messageId: "m-3" }} />
          </div>
          {bubble(filler, true)}{bubble(filler)}{bubble(filler, true)}{bubble(filler)}
        </div>
      </Frame>
    );
  }
  if (scene === "chat2") {
    return (
      <Frame>
        <div className="max-w-[44rem] pt-[22rem] text-[15px] leading-6" data-gallery-chat>
          <ChatMarkdown text={CHAT2} botId="bot-gallery" draftId="bot:bot-gallery:thread-gallery" message={{ threadId: "thread-gallery", messageId: "m-2" }} />
        </div>
      </Frame>
    );
  }
  if (scene === "neighbour") {
    return (
      <Frame>
        <div className="flex flex-wrap items-start gap-6" data-gallery-neighbour>
          <div><Label>{lang === "fr" ? "Voisine : la carte de lien" : "Neighbour: the link card"}</Label><LinkPreviewCard href="https://github.com/example/project/pull/2547" github={{ kind: "pull", owner: "example", repo: "project", number: 2547 } as never} /></div>
          <div><Label>{lang === "fr" ? "La carte de fiche" : "The record card"}</Label>{ticket}</div>
        </div>
      </Frame>
    );
  }
  const single: Record<string, ReactElement> = { ticket, company, contact, department, email, project, invoice, agreement, guid, pinned, ...variants, ...states };
  if (single[scene]) return <Frame>{single[scene]}</Frame>;
  return (
    <Frame>
      <Label>{lang === "fr" ? "Billet" : "Ticket"}</Label>{ticket}
      <Label>{lang === "fr" ? "Entreprise (volet de gauche seulement)" : "Company (left pane only)"}</Label>{company}
      <Label>{lang === "fr" ? "Projet" : "Project"}</Label>{project}
      <Label>{lang === "fr" ? "Facture (un type que le produit déclare)" : "Invoice (a kind the product declares)"}</Label>{invoice}
      <Label>{lang === "fr" ? "Entente" : "Agreement"}</Label>{agreement}
      <Label>{lang === "fr" ? "Chargement" : "Loading"}</Label>{states.loading}
      {(["noaccess", "unknown", "notconnected", "signin", "busy", "down", "orgrefused"] as const).map((name) => (
        <div key={name}><Label>{name}</Label>{states[name]}</div>
      ))}
    </Frame>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Page /></StrictMode>);
