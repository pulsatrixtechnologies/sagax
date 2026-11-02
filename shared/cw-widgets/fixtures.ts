// Made-up ConnectWise Manage records, shaped like the REST API's answers.
// Tests and the preview page read them; nothing here is a real customer.

export const FIXTURE_API_HOST = "api-na.myconnectwise.net";

function info(path: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    lastUpdated: "2026-10-09T15:42:10Z",
    updatedBy: "jtremblay",
    dateEntered: "2026-10-06T13:05:00Z",
    notes_href: `https://${FIXTURE_API_HOST}/v4_6_release/apis/3.0/${path}/notes`,
    ...extra,
  };
}

export const FIXTURE_TICKETS = [
  {
    id: 48213,
    summary: "Imprimante du 2e étage hors ligne",
    recordType: "ServiceTicket",
    board: { id: 1, name: "Soutien technique" },
    status: { id: 17, name: "En cours" },
    priority: { id: 8, name: "Priority 2 - High", sort: 2 },
    company: { id: 250, identifier: "ClinVet", name: "Clinique vétérinaire Beauport" },
    contact: { id: 902, name: "Marie-Ève Gagnon" },
    contactName: "Marie-Ève Gagnon",
    type: { id: 4, name: "Matériel" },
    owner: { id: 31, identifier: "jtremblay", name: "Julien Tremblay" },
    resources: "jtremblay, slavoie",
    requiredDate: "2026-10-14T21:00:00Z",
    budgetHours: 2,
    actualHours: 1.25,
    closedFlag: false,
    _info: info("service/tickets/48213"),
  },
  {
    id: 48197,
    summary: "Renouvellement du certificat SSL du portail client",
    recordType: "ServiceTicket",
    board: { id: 2, name: "Infonuagique" },
    status: { id: 3, name: "Nouveau" },
    priority: { id: 7, name: "Priority 1 - Critical", sort: 1 },
    company: { id: 118, identifier: "Bois", name: "Les Bois Laurentides inc." },
    contact: { id: 77, name: "Patrick Bouchard" },
    owner: { id: 12, identifier: "slavoie", name: "Sophie Lavoie" },
    closedFlag: false,
    _info: info("service/tickets/48197", { lastUpdated: "2026-10-11T09:10:00Z" }),
  },
  {
    id: 48150,
    summary: "Accès VPN pour la nouvelle employée",
    recordType: "ServiceTicket",
    board: { id: 1, name: "Soutien technique" },
    status: { id: 22, name: "En attente du client" },
    priority: { id: 9, name: "Priority 3 - Normal", sort: 3 },
    company: { id: 250, identifier: "ClinVet", name: "Clinique vétérinaire Beauport" },
    contact: { id: 903, name: "Luc Pelletier" },
    owner: { id: 31, identifier: "jtremblay", name: "Julien Tremblay" },
    closedFlag: false,
    _info: info("service/tickets/48150", { lastUpdated: "2026-10-08T18:30:00Z" }),
  },
  {
    id: 48021,
    summary: "Migration des boîtes courriel vers Microsoft 365",
    recordType: "ProjectTicket",
    board: { id: 5, name: "Projets" },
    status: { id: 40, name: "Fermé" },
    priority: { id: 9, name: "Priority 3 - Normal", sort: 3 },
    company: { id: 301, identifier: "Caisse", name: "Coopérative du Vieux-Port" },
    contact: { id: 410, name: "Nathalie Roy" },
    owner: { id: 12, identifier: "slavoie", name: "Sophie Lavoie" },
    closedFlag: true,
    _info: info("service/tickets/48021", { lastUpdated: "2026-10-02T14:00:00Z" }),
  },
];

export const FIXTURE_TICKET_NOTES = [
  {
    id: 99120,
    ticketId: 48213,
    text: "Redémarré le spouleur d'impression à distance. L'imprimante répond au ping, mais la file reste bloquée.",
    detailDescriptionFlag: false,
    internalAnalysisFlag: true,
    resolutionFlag: false,
    member: { id: 31, identifier: "jtremblay", name: "Julien Tremblay" },
    dateCreated: "2026-10-09T15:40:00Z",
    createdBy: "jtremblay",
  },
  {
    id: 99098,
    ticketId: 48213,
    text: "Bonjour, l'imprimante HP du 2e étage n'imprime plus depuis ce matin. Merci!",
    detailDescriptionFlag: true,
    internalAnalysisFlag: false,
    resolutionFlag: false,
    contact: { id: 902, name: "Marie-Ève Gagnon" },
    dateCreated: "2026-10-09T12:02:00Z",
    createdBy: "Marie-Ève Gagnon",
  },
];

export const FIXTURE_TIME = [
  {
    id: 88021,
    chargeToId: 48213,
    chargeToType: "ServiceTicket",
    company: { id: 250, identifier: "ClinVet", name: "Clinique vétérinaire Beauport" },
    member: { id: 31, identifier: "jtremblay", name: "Julien Tremblay" },
    workType: { id: 2, name: "À distance" },
    workRole: { id: 4, name: "Technicien" },
    billableOption: "Billable",
    actualHours: 1.25,
    notes: "Redémarré le spouleur d'impression. La file répond, une page de test est sortie.",
    timeStart: "2026-10-09T14:10:00Z",
    timeEnd: "2026-10-09T15:25:00Z",
    status: { id: 1, name: "Ouverte" },
    agreement: { id: 704, name: "Soutien illimité" },
  },
  {
    id: 88040,
    chargeToId: 48197,
    chargeToType: "ServiceTicket",
    company: { id: 118, name: "Les Bois Laurentides inc." },
    member: { id: 12, name: "Sophie Lavoie" },
    workType: { name: "Sur place" },
    workRole: { name: "Ingénieure" },
    billableOption: "DoNotBill",
    actualHours: 0.5,
    notes: "Vérifié la date d'expiration du certificat. Renouvellement déjà commandé.",
    timeStart: "2026-10-11T13:00:00Z",
    timeEnd: "2026-10-11T13:30:00Z",
    status: { name: "Ouverte" },
  },
];

export const FIXTURE_SCHEDULE = [
  {
    id: 33011,
    name: "Sur place, imprimante 2e étage",
    objectId: 48213,
    type: { id: 1, name: "Service" },
    member: { id: 31, name: "Julien Tremblay" },
    company: { id: 250, name: "Clinique vétérinaire Beauport" },
    dateStart: "2026-10-13T13:00:00Z",
    dateEnd: "2026-10-13T15:00:00Z",
    hours: 2,
    where: { id: 9, name: "Clinique Beauport" },
    status: { id: 2, name: "Confirmé" },
    doneFlag: false,
  },
  {
    id: 33028,
    name: "Coup d'œil au portail client",
    objectId: 48197,
    type: { name: "Service" },
    member: { name: "Sophie Lavoie" },
    company: { name: "Les Bois Laurentides inc." },
    dateStart: "2026-10-14T15:30:00Z",
    dateEnd: "2026-10-14T16:00:00Z",
    hours: 0.5,
    where: { name: "À distance" },
    status: { name: "Fait" },
    doneFlag: true,
  },
];

export const FIXTURE_AGREEMENTS = [
  {
    id: 704,
    name: "Soutien illimité",
    type: { id: 3, name: "Mensuel" },
    company: { id: 250, name: "Clinique vétérinaire Beauport" },
    agreementStatus: "Active",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-12-31T00:00:00Z",
    billAmount: 890,
    billingCycle: { id: 2, name: "Monthly" },
    cancelledFlag: false,
  },
  {
    id: 711,
    name: "Surveillance du courriel",
    type: { name: "Annuel" },
    company: { name: "Les Bois Laurentides inc." },
    agreementStatus: "Expired",
    startDate: "2025-04-01T00:00:00Z",
    endDate: "2026-03-31T00:00:00Z",
    billAmount: 2400,
    billingCycle: { name: "Yearly" },
    cancelledFlag: true,
  },
];

export const FIXTURE_COMPANIES = [
  {
    id: 250,
    identifier: "ClinVet",
    name: "Clinique vétérinaire Beauport",
    status: { id: 1, name: "Active" },
    type: { id: 2, name: "Client" },
    phoneNumber: "418-555-0142",
    website: "https://clinique.example",
    city: "Québec",
    territory: { id: 4, name: "Capitale-Nationale" },
  },
  {
    id: 118,
    identifier: "Bois",
    name: "Les Bois Laurentides inc.",
    status: { name: "Active" },
    type: { name: "Client" },
    phoneNumber: "450-555-0198",
    website: "http://bois.example",
    city: "Saint-Jérôme",
    territory: { name: "Laurentides" },
  },
];

/** A query result as the Perspicax `cw_psa_query` tool returns it. */
export function fixtureQueryResult(records: unknown[], total = records.length): string {
  return JSON.stringify({ result: records, count: records.length, total });
}

/** The same, wrapped in MCP text content blocks (what Claude Code hands back). */
export function fixtureMcpContent(payload: unknown): string {
  return JSON.stringify([{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }]);
}
