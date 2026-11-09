// Mail, calendar, Teams and SharePoint through the connectors the engines
// already bring (parité R9 + R11 2026-10-21): the claude.ai connectors
// of the speaker's own Claude account (server/harness-connectors.ts) and
// the cloud connectors of the xAI account the reference design runs on
// (shared/grok-cloud-connectors.ts). Sagax registers no Microsoft 365 or
// Entra app of its own for any of this.
//
// Two pure readings:
//   - what each engine's connectors reach (Capabilities, the engine cards,
//     the turn's prompt), never whether a person signed in to them: that
//     stays on claude.ai and grok.com;
//   - which connector calls act outside the app (a mail sent, a Teams post,
//     an invitation, a SharePoint write), so the outbound guard
//     (shared/outbound.ts) keeps their approval card at every level but Full.
import { decodeGrokGatewayName, GROK_CLOUD_CONNECTORS, grokGatewayToolConnector } from "./grok-cloud-connectors.ts";

export type ConnectorCapability = "mail" | "calendar" | "teams" | "sharepoint" | "files";
export const CONNECTOR_CAPABILITIES: readonly ConnectorCapability[] = ["mail", "calendar", "teams", "sharepoint", "files"];

export type ConnectorEngine = "claude" | "grok";

/** claude.ai connector names (as `claude mcp list` prints them, after
 * "claude.ai "), matched loosely: the service, not the exact spelling. */
const CLAUDE_AI: Array<[RegExp, ConnectorCapability[]]> = [
  [/microsoft\s*365|office\s*365|\bm365\b/i, ["mail", "calendar", "teams", "sharepoint", "files"]],
  [/outlook|exchange/i, ["mail", "calendar"]],
  [/\bteams\b/i, ["teams"]],
  [/sharepoint/i, ["sharepoint", "files"]],
  [/onedrive/i, ["files"]],
  [/gmail/i, ["mail"]],
  [/google\s*calendar|gcal/i, ["calendar"]],
  [/google\s*drive/i, ["files"]],
];

const GROK: Record<string, ConnectorCapability[]> = {
  outlook: ["mail", "calendar"],
  "microsoft-teams": ["teams"],
  gmail: ["mail"],
  "google-drive": ["files"],
  onedrive: ["files"],
  sharepoint: ["sharepoint", "files"],
  salesforce: [],
  x: [],
};

export function claudeAiConnectorCapabilities(name: string): ConnectorCapability[] {
  return CLAUDE_AI.find(([pattern]) => pattern.test(name))?.[1].slice() ?? [];
}

export function grokConnectorCapabilities(id: string): ConnectorCapability[] {
  return GROK[id]?.slice() ?? [];
}

/** The Grok catalog by display name ("Outlook (Exchange)"). */
export const GROK_CONNECTOR_CAPABILITY_BY_NAME: ReadonlyMap<string, ConnectorCapability[]> = new Map(
  GROK_CLOUD_CONNECTORS.map((connector) => [connector.name, grokConnectorCapabilities(connector.id)]),
);

export interface EngineConnectorOffer {
  engine: ConnectorEngine;
  /** The connector's own name, as its engine shows it. */
  connector: string;
  capabilities: ConnectorCapability[];
}

/** The connectors that reach mail, calendar, Teams, SharePoint or files:
 * Claude's from the person's account (`GET /api/me/harness-connectors`,
 * a connector that needs sign-in still counts: the card says where to sign
 * in), Grok's from the xAI catalog once a Grok engine is set up. */
export function engineConnectorOffers(input: {
  claude?: readonly { name: string; status?: string }[] | null;
  grok?: boolean;
}): EngineConnectorOffer[] {
  const offers: EngineConnectorOffer[] = [];
  for (const connector of input.claude ?? []) {
    const capabilities = claudeAiConnectorCapabilities(connector.name);
    if (capabilities.length) offers.push({ engine: "claude", connector: connector.name, capabilities });
  }
  if (input.grok) {
    for (const connector of GROK_CLOUD_CONNECTORS) {
      const capabilities = grokConnectorCapabilities(connector.id);
      if (capabilities.length) offers.push({ engine: "grok", connector: connector.name, capabilities });
    }
  }
  return offers;
}

/** Per capability, which engine and connector reach it, in offer order. */
export function capabilityRoutes(offers: readonly EngineConnectorOffer[]): Record<ConnectorCapability, Array<{ engine: ConnectorEngine; connector: string }>> {
  const routes = Object.fromEntries(CONNECTOR_CAPABILITIES.map((capability) => [capability, [] as Array<{ engine: ConnectorEngine; connector: string }>])) as Record<ConnectorCapability, Array<{ engine: ConnectorEngine; connector: string }>>;
  for (const offer of offers) {
    for (const capability of offer.capabilities) routes[capability].push({ engine: offer.engine, connector: offer.connector });
  }
  return routes;
}

// ── connector calls that act outside the app ────────────────────────────

export type ConnectorWriteKind =
  | "mail-send"
  | "mail-auto-reply"
  | "teams-post"
  | "teams-chat"
  | "calendar-invite"
  | "calendar-cancel"
  | "calendar-respond"
  | "files-write"
  | "other-write";

/** Every word of a tool name, server included, upper case:
 * mcp__claude_ai_Microsoft_365__outlook_send_mail is CLAUDE AI MICROSOFT
 * 365 OUTLOOK SEND MAIL; Grok's own outlook__send_email works the same. */
function words(name: string): string[] {
  // grok's gateway escapes, in its names only: send_5fchat_5fmessage is
  // SEND CHAT MESSAGE (an ordinary outlook_delete_event keeps its "_de")
  return (/(?:^|__)(?:user|team|org|workspace)-[^-_]/.test(name) ? decodeGrokGatewayName(name) : name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** `mcp__<server>__<tool>` or the engine's own `<server>__<tool>`. */
function serverOf(name: string): { server: string; tool: string } | null {
  const match = /^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_.-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(name);
  return match ? { server: match[1]!, tool: match[2]! } : null;
}

const GROK_SERVER_IDS = new Set(GROK_CLOUD_CONNECTORS.map((connector) => connector.id.replace(/-/g, "_")));

/** A mail, calendar, Teams or file connector an engine brings: a claude.ai
 * connector of that kind (`claude_ai_Microsoft_365`, `claude_ai_Gmail`) or
 * one of the xAI account's cloud connectors (`outlook`, `microsoft_teams`).
 * Every call to one that is not a read or a draft keeps its card. */
export function isEngineConnectorServer(server: string): boolean {
  const claude = /^claude_ai_(.+)$/i.exec(server);
  if (claude) return claudeAiConnectorCapabilities(claude[1]!.replace(/_/g, " ")).length > 0;
  return GROK_SERVER_IDS.has(server.toLowerCase().replace(/-/g, "_"));
}

const MAIL = new Set(["OUTLOOK", "GMAIL", "MAIL", "EMAIL", "EXCHANGE", "MAILBOX"]);
const TEAMS = new Set(["TEAMS"]);
const CALENDAR = new Set(["CALENDAR", "GOOGLECALENDAR", "GCAL", "EVENT", "EVENTS", "MEETING", "MEETINGS"]);
/** A calendar word alone (EVENT) is anyone's: an analytics server's
 * create_event is no invitation. It needs a mail, calendar or Teams service. */
const CALENDAR_SERVICE = new Set(["OUTLOOK", "EXCHANGE", "MICROSOFT", "365", "GOOGLE", "GOOGLECALENDAR", "GCAL", "CALENDAR", "GMAIL", "TEAMS"]);
const FILE_STORES = new Set(["SHAREPOINT", "ONEDRIVE", "GOOGLEDRIVE", "GDRIVE"]);

const SEND = new Set(["SEND", "SENDS", "FORWARD", "REPLY"]);
const POST = new Set(["SEND", "POST", "REPLY", "SHARE"]);
const AUTO_REPLY = new Set(["VACATION", "AUTOREPLY", "OOF"]);
const CREATE = new Set(["CREATE", "ADD", "NEW"]);
const CHAT = new Set(["CHAT", "CHATS"]);
const INVITE = new Set(["CREATE", "ADD", "NEW", "INSERT", "UPDATE", "PATCH", "EDIT", "MODIFY", "SCHEDULE", "BOOK", "INVITE", "RESCHEDULE", "MOVE", "SET"]);
const CANCEL = new Set(["DELETE", "CANCEL", "REMOVE"]);
const RESPOND = new Set(["RESPOND", "ACCEPT", "DECLINE", "TENTATIVE", "TENTATIVELY", "RSVP"]);
const FILE_WRITE = new Set(["UPLOAD", "UPDATE", "CREATE", "WRITE", "MOVE", "RENAME", "COPY", "DELETE", "REMOVE", "PUT", "PATCH", "EDIT", "REPLACE", "SHARE", "ADD", "NEW", "SAVE", "SET", "GRANT", "INVITE", "PERMISSION", "PERMISSIONS"]);
/** Words of a call that only reads. A call with any of them and none of
 * the acting words above (READS_UNLESS) reads. */
const READS = new Set(["GET", "LIST", "SEARCH", "READ", "FIND", "FETCH", "VIEW", "LOOKUP", "QUERY", "DOWNLOAD", "CHECK", "COUNT", "DESCRIBE", "SHOW", "BROWSE", "PREVIEW", "AVAILABILITY", "AVAILABLE", "GRANTED", "SCOPES"]);
const ACTS = new Set([...SEND, ...POST, ...CREATE, ...INVITE, ...CANCEL, ...RESPOND, ...FILE_WRITE, "TRASH", "UNTRASH", "ARCHIVE", "MARK", "FLAG", "MODIFY", "BATCH", "FILTER", "LABEL", "RUN", "EXECUTE", "TRIGGER"]);

const any = (tokens: readonly string[], set: ReadonlySet<string>) => tokens.some((token) => set.has(token));

/** What a mail, Teams, calendar or file connector call does outside the
 * app, or null for a read, a draft, or a tool of another kind.
 * `other-write`: a call of an engine's connector server
 * (isEngineConnectorServer) that names no known outward action and is no
 * read or draft. It is a write, not proof of a send; the bot's approval
 * level and explicit rules decide it. */
export function connectorWriteKind(name: string): ConnectorWriteKind | null {
  const tokens = words(name);
  if (!tokens.length) return null;
  const parsed = serverOf(name);
  const action = parsed ? words(parsed.tool) : tokens;
  const acts = any(action, ACTS);
  // a draft is no send, a reply draft included; a read acts on nothing
  if (action.includes("DRAFT") && !action.includes("SEND")) return null;
  if (!acts && any(action, READS)) return null;
  const fileStore = any(tokens, FILE_STORES) || (tokens.includes("GOOGLE") && tokens.includes("DRIVE"));
  if (fileStore && any(action, FILE_WRITE)) return "files-write";
  if (any(tokens, CALENDAR) && any(tokens, CALENDAR_SERVICE)) {
    if (any(action, RESPOND)) return "calendar-respond";
    if (any(action, CANCEL)) return "calendar-cancel";
    if (any(action, INVITE)) return "calendar-invite";
  }
  if (any(tokens, TEAMS)) {
    if (any(action, POST)) return "teams-post";
    if (any(action, CREATE) && any(action, CHAT)) return "teams-chat";
  }
  if (any(tokens, MAIL) || (parsed && isEngineConnectorServer(parsed.server) && !fileStore)) {
    if (any(action, AUTO_REPLY) || (action.includes("OUT") && action.includes("OFFICE")) || (action.includes("AUTOMATIC") && action.includes("REPLIES"))
      || (action.includes("MAILBOX") && action.includes("SETTINGS"))) return "mail-auto-reply";
    if (any(action, SEND)) return "mail-send";
  }
  if (parsed && isEngineConnectorServer(parsed.server)) return "other-write";
  // a grok.com connector reached through grok's managed gateway
  // (`cursor__user-Outlook-delete_5fmail_5fmessage___12`): fail closed too
  if (grokGatewayToolConnector(name)?.id) return "other-write";
  return null;
}

/** A call whose name plainly only reads or drafts (search, list, get, a
 * draft): what an unknown engine connector may do without a card's
 * outward-facing rules. Anything else, an empty name included, does not. */
export function connectorCallReads(name: string): boolean {
  const parsed = serverOf(name);
  const action = words(parsed ? parsed.tool : name);
  if (!action.length) return false;
  if (action.includes("DRAFT") && !action.includes("SEND")) return true;
  return !any(action, ACTS) && any(action, READS);
}

// ── what a request needs ───────────────────────────────────────────────

// #3149: a word alone is not a need. "aucun courriel", "no email", or an
// agenda mentioned in passing moved bots to another engine. A mail or calendar
// word counts only when it is not negated just before it and an action or a
// possessive ("envoie", "check", "mes", "my") stands just before it in the
// same clause; Teams and SharePoint only need not to be negated.
type NeedRule = { capability: ConnectorCapability; nouns: ReadonlySet<string>; selfCued?: ReadonlySet<string>; cues?: ReadonlySet<string>; hints?: Array<[RegExp, string]> };

const wordSet = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

const OWN = "my our mes mon ma nos notre";
const NEEDS: NeedRule[] = [
  { capability: "sharepoint", nouns: wordSet("sharepoint onedrive"), hints: [[/sharepoint/i, "SharePoint"], [/onedrive/i, "OneDrive"]] },
  { capability: "teams", nouns: wordSet("teams"), hints: [[/teams/i, "Teams"]] },
  {
    capability: "calendar",
    nouns: wordSet("calendrier calendriers calendar calendars agenda réunion réunions reunion reunions meeting meetings rendezvous invitation invitations"),
    selfCued: wordSet("invite inviter invitez"),
    cues: wordSet(`${OWN} book schedule reschedule cancel move add create set accept decline invite plan check show list open free available next upcoming
      réserve réserver reserve planifie planifier cédule céduler cedule ceduler annule annuler déplace déplacer deplace ajoute ajouter crée créer cree creer
      accepte accepter refuse refuser décline décliner decline invite inviter vérifie vérifier verifie consulte consulter montre liste ouvre libre disponible
      disponibilités prochaine prochain prochaines prochains`),
    hints: [[/google calendar/i, "Google Calendar"]],
  },
  {
    capability: "mail",
    nouns: wordSet("courriel courriels email emails mail mails gmail outlook inbox"),
    cues: wordSet(`${OWN} send reply respond answer forward read check search find look summarize summarise archive delete draft write compose open triage sort clean list show new unread latest last
      envoie envoies envoyer envoyez écris écrire écrivez ecris ecrire rédige rédiger redige réponds répondre répondez reponds repondre transfère transférer transfere
      lis lire lisez vérifie vérifier verifie consulte consulter cherche chercher trouve trouver résume résumer resume archive archiver supprime supprimer
      trie trier classe ouvre montre liste nouveaux nouveau nouvelles derniers dernier`),
    hints: [[/gmail/i, "Gmail"], [/outlook/i, "Outlook"]],
  },
];

const NEGATIONS = wordSet("aucun aucune aucuns aucunes pas sans ni jamais non ne n no not without never nor none zero");
const CLAUSE_BREAKS = wordSet("and et or ou then puis if si but mais");
const NEGATION_REACH = 3;
const CUE_REACH = 5;

/** A text's clauses as lowercase words: sentence marks and commas split
 * clauses, an elision or a hyphen splits its word ("l'agenda", "résume-les"),
 * "don't" reads "do not". */
function clauses(text: string): string[][] {
  const plain = text.slice(0, 4_000).toLowerCase()
    .replace(/n['\u2019]t\b/g, " not")
    .replace(/bo[iî]tes? de r[ée]ception/g, "inbox")
    .replace(/rendez-vous/g, "rendezvous")
    .replace(/\be-mail/g, "email");
  return plain.split(/[.!?;:,\n()[\]"\u00ab\u00bb\u201c\u201d]+/).map((clause) => clause.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function clauseNeeds(words: string[], rule: NeedRule): boolean {
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    const self = rule.selfCued?.has(word) ?? false;
    if (!self && !rule.nouns.has(word)) continue;
    let start = index;
    while (start > 0 && !CLAUSE_BREAKS.has(words[start - 1]!)) start--;
    const before = words.slice(start, index);
    if (before.slice(-NEGATION_REACH).some((entry) => NEGATIONS.has(entry))) continue;
    if (self || !rule.cues) return true;
    // "Email Ana the notes": the word itself opens the clause, as a verb
    if (index === start && rule.capability === "mail" && words.length > index + 1 && word !== "gmail" && word !== "outlook" && word !== "inbox") return true;
    if (before.slice(-CUE_REACH).some((entry) => rule.cues!.has(entry))) return true;
  }
  return false;
}

/** The connector a person's request needs (mail, calendar, Teams,
 * SharePoint), and the service it names when it names one. Words only:
 * the switch it drives (server/connector-switch.ts) never runs a tool. */
export function connectorNeed(text: string): { capability: ConnectorCapability; hint?: string } | null {
  const parts = clauses(text);
  for (const need of NEEDS) {
    if (!parts.some((words) => clauseNeeds(words, need))) continue;
    const plain = text.slice(0, 4_000);
    const hint = need.hints?.find(([pattern]) => pattern.test(plain))?.[1];
    return { capability: need.capability, ...(hint ? { hint } : {}) };
  }
  return null;
}
