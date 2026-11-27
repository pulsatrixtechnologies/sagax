// An invented company and an invented contact of the invented product
// ("Nimbus Desk", record-card-fixtures.ts) for the company's and the
// contact's window (M-20261127-101): their cards and a stand-in console that
// answers the detail route's sections for them and takes every write in
// memory, as a real console would change its data. Used by the gallery
// (src/gallery/record-window.tsx) and the tests. Nothing here names a real
// product, company or person.
import { NIMBUS_PRODUCT, type Lang } from "./record-card-fixtures";
import { RECORD_ACTIONS } from "../../shared/record-actions";

export const ACME_ID = "7310";
export const ADA_ID = "2204";
const ref = (kind: string, id: string) => ({ product: NIMBUS_PRODUCT, kind, id });
const product = { id: NIMBUS_PRODUCT, name: "Nimbus Desk" };

/** The console's data for one language and one held clock, changed by the writes it takes. */
export function accountConsole(lang: Lang, now: number) {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  // a local time of the record's zone (Toronto, -05:00 in winter) as an instant
  const at = (local: string) => new Date(`${local}-05:00`).toISOString();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  let nextId = 7000;
  const NOOR = "Noor Haddad", BRUNO = "Bruno Tremblay", IRIS = "Iris Chen";
  const members: Record<string, ReturnType<typeof ref>> = { [NOOR]: ref("member", "13"), [BRUNO]: ref("member", "12"), [IRIS]: ref("member", "14") };

  const contacts = [
    { id: ADA_ID, name: "Ada Lindqvist", ref: ref("contact", ADA_ID), title: L("Directrice des opérations", "Operations director"), roles: [L("Principale", "Main"), L("Facturation", "Billing")], phone: "418 555-0142", email: "ada@acme.example", portal: L("Actif", "Active") },
    { id: "2205", name: "Lina Moreau", ref: ref("contact", "2205"), title: L("Contrôleuse", "Controller"), roles: [L("Approbatrice", "Approver")], phone: "418 555-0144", email: "lina@acme.example", portal: L("Actif", "Active") },
    { id: "2206", name: "Omar Belkacem", ref: ref("contact", "2206"), title: L("Contremaître", "Foreman"), roles: [L("Technique", "Technical")], phone: "418 555-0143", email: "omar@acme.example", portal: L("Inactif", "Inactive") },
    { id: "2207", name: "Sofia Ricci", ref: ref("contact", "2207"), title: L("Adjointe administrative", "Office assistant"), roles: [L("Utilisatrice", "User")], phone: "418 555-0146", email: "sofia@acme.example", portal: L("Actif", "Active") },
    { id: "2208", name: "Jonas Weber", ref: ref("contact", "2208"), title: L("Estimateur", "Estimator"), roles: [L("Utilisateur", "User")], phone: "418 555-0145", email: "jonas@acme.example", portal: L("Aucun", "None") },
  ];
  const notes = [
    { id: "81", author: NOOR, author_ref: members[NOOR], timestamp: ago(29 * MIN), text: L("Intéressée par un bloc d'heures 2027. Relancer après la rencontre du 14 décembre.", "Interested in a 2027 block of hours. Follow up after the December 14 meeting."), on: "#300124", on_ref: ref("ticket", "300124"), contact: ADA_ID },
    { id: "80", author: IRIS, author_ref: members[IRIS], timestamp: at("2026-11-03T09:02"), text: L("Le chantier a besoin d'un VPN permanent.", "The site office needs a permanent VPN."), on: "#299412", on_ref: ref("ticket", "299412") },
    { id: "79", author: BRUNO, author_ref: members[BRUNO], timestamp: at("2026-10-12T15:40"), text: L("Facturer le déplacement au taux régional.", "Bill the trip at the regional rate.") },
    { id: "78", author: NOOR, author_ref: members[NOOR], timestamp: at("2026-09-02T10:15"), text: L("Début de la migration vers la nouvelle messagerie.", "Start of the move to the new mail service.") },
  ];
  const tickets = [
    { id: "300187", number: "#300187", summary: L("Imprimante du 2e étage hors ligne", "Second floor printer offline"), ref: ref("ticket", "300187"), status: L("Nouveau", "New"), tone: "open", priority: L("1 : Urgente", "1: Urgent"), level: "urgent", type: L("Matériel", "Hardware"), next: { start: at("2026-11-27T15:00"), date: "", who: [IRIS] }, owner: IRIS, owner_ref: members[IRIS], updated: ago(2 * HOUR), contact: "2206" },
    { id: "300124", number: "#300124", summary: L("Partenariat Acme Fabrication", "Acme Fabrication partnership"), ref: ref("ticket", "300124"), status: L("En attente", "Waiting"), tone: "waiting", priority: L("3 : Moyenne", "3: Medium"), level: "normal", type: L("Administratif", "Administration"), next: { start: at("2026-12-14T14:30"), date: "", who: [NOOR, BRUNO] }, owner: NOOR, owner_ref: members[NOOR], updated: ago(29 * MIN), contact: ADA_ID },
    { id: "299950", number: "#299950", summary: L("Renouvellement des licences de bureautique", "Office licence renewal"), ref: ref("ticket", "299950"), status: L("En cours", "In progress"), tone: "open", priority: L("3 : Moyenne", "3: Medium"), level: "normal", type: L("Licences", "Licences"), next: { start: at("2026-11-30T10:00"), date: "", who: [NOOR] }, owner: NOOR, owner_ref: members[NOOR], updated: ago(DAY), contact: ADA_ID },
    { id: "299412", number: "#299412", summary: L("Accès VPN du chantier", "Site office VPN access"), ref: ref("ticket", "299412"), status: L("Fermé", "Closed"), tone: "done", priority: L("2 : Haute", "2: High"), level: "high", type: L("Accès", "Access"), closed: true, owner: IRIS, owner_ref: members[IRIS], updated: at("2026-11-03T16:20") },
    { id: "298870", number: "#298870", summary: L("Poste de Jonas lent", "Jonas's computer slow"), ref: ref("ticket", "298870"), status: L("Fermé", "Closed"), tone: "done", priority: L("4 : Basse", "4: Low"), level: "low", type: L("Poste", "Workstation"), closed: true, owner: BRUNO, owner_ref: members[BRUNO], updated: at("2026-10-21T11:05") },
  ];
  const activities = [
    { id: "601", subject: L("Rappeler Ada pour la signature", "Call Ada back for the signature"), type: L("Tâche", "Task"), type_kind: "task", dateStart: at("2026-12-02T09:00"), date: L("2 déc. 2026", "Dec 2, 2026"), assigned: NOOR, assigned_ref: members[NOOR], contact: "Ada Lindqvist", contact_ref: ref("contact", ADA_ID), done: false },
    { id: "602", subject: L("Envoyer la grille tarifaire révisée", "Send the revised price grid"), type: L("Courriel", "Email"), type_kind: "email", dateStart: at("2026-12-05T09:00"), date: L("5 déc. 2026", "Dec 5, 2026"), assigned: BRUNO, assigned_ref: members[BRUNO], contact: "Lina Moreau", contact_ref: ref("contact", "2205"), done: false },
    { id: "603", subject: L("Rencontre de partenariat", "Partnership meeting"), type: L("Rendez-vous", "Appointment"), type_kind: "meeting", dateStart: at("2026-12-14T14:30"), date: L("14 déc. 2026", "Dec 14, 2026"), assigned: NOOR, assigned_ref: members[NOOR], contact: "Ada Lindqvist", contact_ref: ref("contact", ADA_ID), done: false },
    { id: "604", subject: L("Préparer le contrat d'adhésion", "Prepare the membership contract"), type: L("Tâche", "Task"), type_kind: "task", dateStart: at("2026-10-30T09:00"), date: L("30 oct. 2026", "Oct 30, 2026"), assigned: BRUNO, assigned_ref: members[BRUNO], done: true },
  ];
  const configurations = [
    { id: "41", name: "ACME-SRV01", type: L("Serveurs", "Servers"), icon: "server", status: L("Actif", "Active"), detail: L("Serveur de fichiers, 2 To", "File server, 2 TB"), site: L("Bureau", "Office"), seen: L("en ligne", "online"), online: true, ref: ref("configuration", "41") },
    { id: "42", name: "ACME-FW", type: L("Pare-feu", "Firewalls"), icon: "firewall", status: L("Actif", "Active"), detail: L("Pare-feu de périmètre", "Perimeter firewall"), site: L("Bureau", "Office"), seen: L("en ligne", "online"), online: true },
    { id: "43", name: "ACME-PC-002", type: L("Postes", "Workstations"), icon: "workstation", status: L("Actif", "Active"), detail: L("Utilisé par Ada Lindqvist", "Used by Ada Lindqvist"), site: L("Bureau", "Office"), seen: L("en ligne", "online"), online: true, contact: ADA_ID },
    { id: "44", name: "ACME-PC-014", type: L("Postes", "Workstations"), icon: "laptop", status: L("Actif", "Active"), detail: L("Utilisé par Jonas Weber", "Used by Jonas Weber"), site: L("Chantier", "Site office"), seen: L("vu il y a 3 j", "seen 3 d ago"), online: false },
    { id: "45", name: "ACME-PC-021", type: L("Postes", "Workstations"), icon: "workstation", status: L("Actif", "Active"), detail: L("Utilisé par Sofia Ricci", "Used by Sofia Ricci"), site: L("Bureau", "Office"), seen: L("en ligne", "online"), online: true },
    { id: "46", name: "ACME-PRN-2", type: L("Imprimantes", "Printers"), icon: "printer", status: L("Actif", "Active"), detail: L("Imprimante du 2e étage", "Second floor printer"), site: L("Bureau", "Office"), seen: L("hors ligne", "offline"), online: false },
  ];
  const attachments = [
    { id: "91", name: "contrat-adhesion.pdf", size: L("412 Ko", "412 KB"), date: L("27 nov. 2026", "Nov 27, 2026"), author: NOOR, contact: ADA_ID },
    { id: "92", name: "grille-tarifaire.xlsx", size: L("38 Ko", "38 KB"), date: L("26 nov. 2026", "Nov 26, 2026"), author: BRUNO },
    { id: "93", name: "soumission-pare-feu.msg", size: L("96 Ko", "96 KB"), date: L("3 nov. 2026", "Nov 3, 2026"), author: IRIS },
    { id: "94", name: "photo-imprimante.png", size: L("1,2 Mo", "1.2 MB"), date: L("27 nov. 2026", "Nov 27, 2026"), author: "Omar Belkacem" },
  ];
  const sites = [
    { id: "51", name: L("Bureau", "Office"), address: L("1200, rue des Cascades", "1200 Cascades Street"), city: "Québec, QC G1K 3G7", phone: "418 555-0100", contacts: 4, configurations: 5, main: true },
    { id: "52", name: L("Chantier", "Site office"), address: L("85, boulevard du Parc", "85 Park Boulevard"), city: "Québec, QC G1N 4X1", phone: "418 555-0190", contacts: 1, configurations: 1 },
  ];
  const history = [
    { at: at("2026-11-27T13:21"), date: "", text: L("a changé le téléphone : 418 555-0199 devient 418 555-0142", "changed the phone: 418 555-0199 becomes 418 555-0142"), who: NOOR },
    { at: at("2026-11-03T09:02"), date: "", text: L("a ajouté le rôle Facturation", "added the Billing role"), who: BRUNO },
    { at: at("2019-03-17T10:00"), date: "", text: L("a créé le contact", "created the contact"), who: NOOR },
  ];
  const projectsList = [
    { id: "77", name: L("Migration de la messagerie", "Mail service migration"), ref: ref("project", "77"), status: L("En cours", "In progress"), tone: "open", share: 72, manager: NOOR, manager_ref: members[NOOR], period: L("1 sept. au 15 déc. 2026", "Sep 1 to Dec 15, 2026"), hours: L("18 h sur 25 h", "18 h of 25 h") },
    { id: "78", name: L("Remplacement du pare-feu", "Firewall replacement"), ref: ref("project", "78"), status: L("En cours", "In progress"), tone: "open", share: 40, manager: IRIS, manager_ref: members[IRIS], period: L("3 au 30 nov. 2026", "Nov 3 to 30, 2026"), hours: L("4 h sur 10 h", "4 h of 10 h") },
    { id: "79", name: L("Inventaire des postes 2026", "2026 workstation inventory"), ref: ref("project", "79"), status: L("Fermé", "Closed"), tone: "done", share: 100, manager: BRUNO, manager_ref: members[BRUNO], period: L("10 janv. au 28 févr. 2026", "Jan 10 to Feb 28, 2026"), hours: L("12 h sur 12 h", "12 h of 12 h") },
  ];
  const opportunitiesList = [
    { id: "88", name: L("Bloc d'heures 2027", "2027 block of hours"), amount: L("12 000,00 $", "$12,000.00"), stage: L("Proposition", "Proposal"), step: 1, steps: 4, probability: 60, close: L("31 déc. 2026", "Dec 31, 2026"), owner: NOOR, owner_ref: members[NOOR], tone: "open" },
    { id: "89", name: L("Renouvellement du pare-feu", "Firewall renewal"), amount: L("3 400,00 $", "$3,400.00"), stage: L("Qualifiée", "Qualified"), step: 0, steps: 4, probability: 40, close: L("15 janv. 2027", "Jan 15, 2027"), owner: BRUNO, owner_ref: members[BRUNO], tone: "open" },
  ];
  const months = [L("juin", "Jun"), L("juil.", "Jul"), L("août", "Aug"), L("sept.", "Sep"), L("oct.", "Oct"), L("nov.", "Nov")];
  const hours = (values: number[]) => values.map((value, index) => ({ label: months[index]!, value, text: `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value)} h` }));
  const agreementsList = [
    { id: "412", name: L("Bloc d'heures 2026", "2026 block of hours"), ref: ref("agreement", "412"), status: L("Active", "Active"), tone: "done", type: L("Bloc d'heures", "Block of hours"), period: L("1er janv. au 31 déc. 2026", "Jan 1 to Dec 31, 2026"), renew: L("reconduite le 1er janv. 2027", "renews on Jan 1, 2027"), used: "31 h", of: "50 h", share: 62, left: L("19 h restantes", "19 h left"), pace: L("Au rythme actuel : épuisé vers le 20 févr. 2027", "At this pace: used up around Feb 20, 2027"), months: hours([4, 6, 2.5, 5, 7, 6.5]) },
  ];
  const invoices = [
    { id: "10482", number: "F-10482", ref: ref("invoice", "10482"), issued: L("1er nov. 2026", "Nov 1, 2026"), due: L("Échéance le 1er déc.", "Due Dec 1"), amount: L("2 650,00 $", "$2,650.00"), state: L("À échoir", "Not due") },
    { id: "10391", number: "F-10391", ref: ref("invoice", "10391"), issued: L("1er oct. 2026", "Oct 1, 2026"), due: L("Échue le 31 oct.", "Was due Oct 31"), amount: L("1 420,15 $", "$1,420.15"), state: L("En retard", "Late"), late: 27 },
    { id: "10277", number: "F-10277", ref: ref("invoice", "10277"), issued: L("1er sept. 2026", "Sep 1, 2026"), due: L("Échue le 1er oct.", "Was due Oct 1"), amount: L("750,00 $", "$750.00"), state: L("En retard", "Late"), late: 57 },
  ];

  const open = () => tickets.filter((row) => !row.closed);
  const mine = <T extends { contact?: string }>(list: T[], kind: string) => (kind === "contact" ? list.filter((row) => row.contact === ADA_ID) : list);
  const sheet = (kind: string) => kind === "company" ? {
    context: [L("Client géré", "Managed customer"), "Capitale-Nationale", L("budget de 1 500 $ par mois", "budget of $1,500 a month")],
    since: "2019-03-17",
    reach: [
      { kind: "phone", value: "418 555-0100" }, { kind: "fax", value: "418 555-0101" },
      { kind: "email", value: "ada@acme.example", detail: "Ada Lindqvist" },
      { kind: "web", value: "acme.example" }, { kind: "linkedin", value: "linkedin.example/company/acme" },
      { kind: "address", value: L("1200, rue des Cascades\nQuébec, QC G1K 3G7", "1200 Cascades Street\nQuébec, QC G1K 3G7"), detail: L("Site Bureau, 1 autre site", "Office site, 1 other site") },
      { kind: "id", value: "AcmeFab" },
    ],
    tiles: [
      { tab: "tickets", label: L("Billets ouverts", "Open tickets"), value: String(open().length), detail: L("1 urgent", "1 urgent"), tone: "alert" },
      { tab: "finance", label: L("Solde à recevoir", "Balance due"), value: L("4 820,15 $", "$4,820.15"), detail: L("2 factures en retard", "2 invoices late"), tone: "waiting" },
      { tab: "agreements", label: L("Bloc d'heures 2026", "2026 block of hours"), value: "31 / 50 h", share: 62 },
      { tab: "configurations", label: L("Parc géré", "Managed fleet"), value: String(configurations.length), detail: L("1 serveur · 1 pare-feu · 3 postes · 1 imprimante", "1 server · 1 firewall · 3 workstations · 1 printer") },
    ],
    upcoming: activities.filter((row) => !row.done).map((row) => ({ id: row.id, subject: row.subject, start: row.dateStart, date: row.date, type: row.type, assigned: row.assigned, assigned_ref: row.assigned_ref })),
    feed: [
      { kind: "note", at: notes[0]!.timestamp, who: notes[0]!.author, who_ref: notes[0]!.author_ref, text: L(`a écrit : « ${notes[0]!.text} »`, `wrote: "${notes[0]!.text}"`), ref: ref("ticket", "300124"), label: "#300124", tone: "waiting" },
      { kind: "ticket", at: ago(2 * HOUR), text: L("Billet ouvert par Omar Belkacem : Imprimante du 2e étage hors ligne", "Ticket opened by Omar Belkacem: Second floor printer offline"), ref: ref("ticket", "300187"), label: "#300187", tone: "alert" },
      { kind: "ticket", at: ago(DAY), text: L("Renouvellement des licences de bureautique est passé à En cours", "Office licence renewal moved to In progress"), ref: ref("ticket", "299950"), label: "#299950" },
      { kind: "attachment", at: ago(3 * HOUR), text: L("Pièce jointe ajoutée : contrat-adhesion.pdf", "Attachment added: contrat-adhesion.pdf") },
      { kind: "invoice", at: at("2026-11-27T08:00"), text: L("Facture en retard de 27 jours", "Invoice 27 days late"), ref: ref("invoice", "10391"), label: "F-10391", tone: "waiting" },
    ],
    people: contacts.slice(0, 3).map((row) => ({ name: row.name, ref: row.ref, role: row.roles[0], detail: `${row.title} · ${row.phone}` })),
  } : {
    title: L("Directrice des opérations", "Operations director"),
    roles: [L("Principale", "Main"), L("Facturation", "Billing"), L("Décideuse", "Decision maker")],
    reach: [
      { kind: "phone", value: "418 555-0142", detail: L("bureau", "office") }, { kind: "phone", value: "418 555-0177", detail: L("cellulaire", "mobile") },
      { kind: "email", value: "ada@acme.example", detail: "Ada Lindqvist" },
      { kind: "site", value: L("Site Bureau", "Office site"), detail: L("1200, rue des Cascades, Québec", "1200 Cascades Street, Québec") },
    ],
    tiles: [
      { tab: "tickets", label: L("Billets ouverts", "Open tickets"), value: String(mine(open(), "contact").length), detail: L("1 en attente de sa réponse", "1 waiting for her answer"), tone: "waiting" },
      { tab: "activities", label: L("À venir", "Coming up"), value: String(activities.filter((row) => !row.done && row.contact === "Ada Lindqvist").length), detail: L("Prochaine le 2 déc.", "Next on Dec 2") },
      { tab: "notes", label: L("Dernier échange", "Last exchange"), value: L("il y a 29 min", "29 min ago"), detail: L("Note sur #300124", "Note on #300124") },
      { label: L("Portail client", "Customer portal"), value: L("Actif", "Active"), detail: L("Connectée le 12 nov.", "Signed in Nov 12") },
    ],
    upcoming: activities.filter((row) => !row.done && row.contact === "Ada Lindqvist").map((row) => ({ id: row.id, subject: row.subject, start: row.dateStart, date: row.date, type: row.type, assigned: row.assigned })),
    feed: [
      { kind: "note", at: notes[0]!.timestamp, who: NOOR, who_ref: members[NOOR], text: L(`lui a écrit : « ${notes[0]!.text} »`, `wrote to her: "${notes[0]!.text}"`), ref: ref("ticket", "300124"), label: "#300124" },
      { kind: "ticket", at: ago(DAY), text: L("A répondu sur Renouvellement des licences de bureautique", "Answered on Office licence renewal"), ref: ref("ticket", "299950"), label: "#299950" },
      { kind: "invoice", at: at("2026-11-15T09:00"), text: L("A reçu le rappel de la facture", "Received the invoice reminder"), ref: ref("invoice", "10391"), label: "F-10391", tone: "waiting" },
    ],
    prefs: [{ label: L("Langue", "Language"), value: L("Français", "French") }, { label: L("Joindre par", "Reach by"), value: L("Courriel", "Email") }, { label: L("Avisée des billets", "Told of tickets"), value: L("Oui", "Yes") }, { label: L("Fuseau", "Time zone"), value: "America/Toronto" }],
  };
  const section = (kind: string, name: string): Record<string, unknown> => {
    switch (name) {
      case "sheet": return { sheet: sheet(kind) };
      case "notes": return { lines: mine(notes, kind).map((row) => ({ id: row.id, author: row.author, author_ref: row.author_ref, timestamp: row.timestamp, kind: "discussion", text: row.text, ...(row.on ? { on: row.on, on_ref: row.on_ref } : {}) })) };
      case "contacts": return { lines: contacts };
      case "tickets": return { lines: mine(tickets, kind) };
      case "activities": return { lines: kind === "contact" ? activities.filter((row) => row.contact === "Ada Lindqvist") : activities };
      case "projects": return { lines: projectsList };
      case "opportunities": return { lines: opportunitiesList };
      case "agreements": return { lines: agreementsList };
      case "configurations": return { lines: mine(configurations, kind) };
      case "attachments": return { lines: mine(attachments, kind) };
      case "sites": return { lines: sites };
      case "finance": return {
        finance: {
          tiles: [
            { label: L("Solde à recevoir", "Balance due"), value: L("4 820,15 $", "$4,820.15"), detail: L("3 factures ouvertes", "3 open invoices") },
            { label: L("En retard", "Late"), value: L("2 170,15 $", "$2,170.15"), detail: L("2 factures", "2 invoices"), tone: "alert" },
            { label: L("Délai moyen de paiement", "Average time to pay"), value: L("38 j", "38 d"), detail: L("sur 12 mois", "over 12 months") },
            { label: L("Payé en 2026", "Paid in 2026"), value: L("18 450,00 $", "$18,450.00"), detail: L("11 factures", "11 invoices") },
          ],
          aging: [
            { label: L("0 à 30 jours", "0 to 30 days"), text: L("2 650,00 $", "$2,650.00"), share: 55, tone: "done" },
            { label: L("31 à 60 jours", "31 to 60 days"), text: L("1 420,15 $", "$1,420.15"), share: 29, tone: "waiting" },
            { label: L("61 à 90 jours", "61 to 90 days"), text: L("750,00 $", "$750.00"), share: 16, tone: "alert" },
            { label: L("Plus de 90 jours", "Over 90 days"), text: L("0,00 $", "$0.00"), share: 0, tone: "open" },
          ],
        },
        lines: invoices,
      };
      case "stats": return { stats: {
        hours: hours([6, 9, 4, 11, 7, 8]),
        types: [{ label: L("Soutien", "Support"), value: 18, text: "18" }, { label: L("Projet", "Project"), value: 4, text: "4" }, { label: L("Administratif", "Administration"), value: 3, text: "3" }],
        resolution: { text: L("1,8 j", "1.8 d"), detail: L("sur les 12 derniers mois", "over the last 12 months") },
        billable: [{ billing: "B", share: 78, text: "78 %" }, { billing: "NC", share: 15, text: "15 %" }, { billing: "DNB", share: 7, text: "7 %" }],
      } };
      case "history": return { lines: history };
      default: return { lines: [] };
    }
  };
  const counts = (kind: string) => kind === "company" ? {
    counts: { notes: notes.length, contacts: contacts.length, tickets: tickets.length, activities: activities.length, projects: projectsList.length, opportunities: opportunitiesList.length, agreements: agreementsList.length, configurations: configurations.length, attachments: attachments.length, sites: sites.length },
    fields: [], actions: RECORD_ACTIONS.filter((action) => !action.startsWith("time.") && !action.startsWith("expense.") && !action.startsWith("configuration.")),
  } : {
    counts: { tickets: mine(tickets, kind).length, activities: activities.filter((row) => row.contact === "Ada Lindqvist").length, configurations: mine(configurations, kind).length, attachments: mine(attachments, kind).length, notes: mine(notes, kind).length, history: history.length },
    fields: [], actions: RECORD_ACTIONS.filter((action) => !action.startsWith("time.") && !action.startsWith("expense.") && !action.startsWith("contact.") && !action.startsWith("site.")),
  };
  /** A write: the data changes as the console's would. */
  const take = (kind: string, body: { action?: string; id?: string; set?: Record<string, unknown> }) => {
    const set = body.set ?? {};
    const id = String(nextId++);
    const remove = <T extends { id?: string }>(list: T[]) => { const index = list.findIndex((row) => row.id === body.id); if (index >= 0) list.splice(index, 1); };
    switch (body.action) {
      case "note.add": notes.unshift({ id, author: NOOR, author_ref: members[NOOR], timestamp: new Date(now).toISOString(), text: String(set.text), ...(kind === "contact" ? { contact: ADA_ID } : {}) } as (typeof notes)[number]); break;
      case "note.update": { const row = notes.find((one) => one.id === body.id); if (row && set.text) row.text = String(set.text); break; }
      case "note.remove": remove(notes); break;
      case "contact.add": contacts.push({ id, name: [set.first_name, set.last_name].filter(Boolean).join(" "), ref: ref("contact", id), title: String(set.title ?? ""), roles: [], phone: String(set.phone ?? ""), email: String(set.email ?? ""), portal: L("Aucun", "None") }); break;
      case "contact.update": { const row = contacts.find((one) => one.id === body.id); if (row) Object.assign(row, set.title !== undefined ? { title: set.title } : {}, set.phone !== undefined ? { phone: set.phone } : {}, set.email !== undefined ? { email: set.email } : {}); break; }
      case "contact.remove": remove(contacts); break;
      case "schedule.done": { const row = activities.find((one) => one.id === body.id); if (row) row.done = set.done === true; break; }
      case "schedule.add": activities.push({ id, subject: String(set.subject ?? ""), type: L("Tâche", "Task"), type_kind: "task", dateStart: set.start ? new Date(`${String(set.start)}:00-05:00`).toISOString() : new Date(now + DAY).toISOString(), date: "", assigned: NOOR, assigned_ref: members[NOOR], contact: kind === "contact" ? "Ada Lindqvist" : "", contact_ref: ref("contact", ADA_ID), done: false }); break;
      case "schedule.update": { const row = activities.find((one) => one.id === body.id); if (row && set.subject) row.subject = String(set.subject); break; }
      case "schedule.remove": remove(activities); break;
      case "attachment.add": attachments.unshift({ id, name: String(set.name), size: "1 Ko", date: L("27 nov. 2026", "Nov 27, 2026"), author: NOOR, ...(kind === "contact" ? { contact: ADA_ID } : {}) } as (typeof attachments)[number]); break;
      case "attachment.remove": remove(attachments); break;
      case "site.add": sites.push({ id, name: String(set.name), address: String(set.address ?? ""), city: String(set.city ?? ""), phone: String(set.phone ?? ""), contacts: 0, configurations: 0 }); break;
      case "site.update": { const row = sites.find((one) => one.id === body.id); if (row) Object.assign(row, set); break; }
      case "site.remove": remove(sites); break;
      case "configuration.remove": { const row = configurations.find((one) => one.id === body.id); if (row) delete row.contact; break; }
      case "configuration.add": { const row = configurations.find((one) => one.id === set.configuration); if (row) row.contact = ADA_ID; break; }
    }
  };
  const choices: Record<string, Array<{ value: string; label: string }>> = {
    member: [{ value: "12", label: BRUNO }, { value: "13", label: NOOR }, { value: "14", label: IRIS }],
    configuration: configurations.map((row) => ({ value: row.id, label: row.name })),
  };
  return { counts, section, take, choices };
}

/** A company's card as the console sends it: its facts, its account manager and main contact, its open tickets. */
export function accountCompanyCard(now: number, lang: Lang): Record<string, unknown> {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  return {
    product, kind: { id: "company", name: L("Entreprise", "Company") }, id: ACME_ID, number: "Acme Fabrication", title: "Acme Fabrication",
    state: { label: L("Actif", "Active"), tone: "done" },
    people: [
      { role: "owner", label: L("Gestionnaire de compte", "Account manager"), name: "Noor Haddad" },
      { role: "contact", label: L("Contact principal", "Main contact"), name: "Ada Lindqvist", ref: ref("contact", ADA_ID) },
    ],
    dates: { opened: "2019-03-17T14:00:00Z", updated: new Date(now - 2 * 86_400_000).toISOString() },
    fields: [
      { label: L("Identifiant", "Identifier"), value: "AcmeFab" },
      { label: "Type", value: L("Client géré", "Managed customer") },
      { label: L("Téléphone", "Phone"), value: "418 555-0100", type: "phone" },
      { label: L("Ville", "City"), value: "Québec" },
      { label: L("Site web", "Website"), value: "acme.example" },
      { label: L("Billets ouverts", "Open tickets"), value: "3" },
      { label: L("Ententes actives", "Active agreements"), value: "1" },
      { label: "Contacts", value: "5" },
    ],
    lines: {
      state: "ok", title: L("Billets ouverts", "Open tickets"), total: 3,
      items: [
        { label: L("Imprimante du 2e étage hors ligne", "Second floor printer offline"), detail: L("Nouveau", "New"), ref: ref("ticket", "300187") },
        { label: L("Partenariat Acme Fabrication", "Acme Fabrication partnership"), detail: L("En attente", "Waiting"), ref: ref("ticket", "300124") },
        { label: L("Renouvellement des licences de bureautique", "Office licence renewal"), detail: L("En cours", "In progress"), ref: ref("ticket", "299950") },
      ],
      more: false,
    },
    notes: { state: "none", items: [] },
    open_url: `https://desk.example/records/companies/${ACME_ID}`, tz: "America/Toronto", as_of: new Date(now - 2 * 60_000).toISOString(), cached: false,
  };
}

/** A contact's card: its title, company, emails, phones and open tickets. */
export function accountContactCard(now: number, lang: Lang): Record<string, unknown> {
  const L = (fr: string, en: string) => (lang === "fr" ? fr : en);
  return {
    product, kind: { id: "contact", name: "Contact" }, id: ADA_ID, number: "Ada Lindqvist", title: "Ada Lindqvist",
    company: { name: "Acme Fabrication", ref: ref("company", ACME_ID) },
    dates: { opened: "2019-03-17T14:00:00Z", updated: new Date(now - 29 * 60_000).toISOString() },
    fields: [
      { label: L("Titre", "Title"), value: L("Directrice des opérations", "Operations director") },
      { label: L("Courriel", "Email"), value: "ada@acme.example", type: "email" },
      { label: L("Téléphone", "Phone"), value: "418 555-0142, 418 555-0177", type: "phone" },
      { label: "Site", value: L("Bureau", "Office") },
      { label: L("Billets ouverts", "Open tickets"), value: "2" },
    ],
    lines: {
      state: "ok", title: L("Billets ouverts", "Open tickets"), total: 2,
      items: [
        { label: L("Partenariat Acme Fabrication", "Acme Fabrication partnership"), detail: L("En attente", "Waiting"), ref: ref("ticket", "300124") },
        { label: L("Renouvellement des licences de bureautique", "Office licence renewal"), detail: L("En cours", "In progress"), ref: ref("ticket", "299950") },
      ],
      more: false,
    },
    notes: { state: "none", items: [] },
    open_url: `https://desk.example/records/contacts/${ADA_ID}`, tz: "America/Toronto", as_of: new Date(now - 2 * 60_000).toISOString(), cached: false,
  };
}
