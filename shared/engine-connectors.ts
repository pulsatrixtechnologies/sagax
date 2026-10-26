// Mail, calendar, Teams and SharePoint through the connectors the engines
// already bring (parité R9 + R11, JC 2026-10-21): the claude.ai connectors
// of the speaker's own Claude account (server/harness-connectors.ts) and
// the cloud connectors of the xAI account a Grok bot runs on
// (shared/grok-cloud-connectors.ts). Sagax registers no Microsoft 365 or
// Entra app of its own for any of this.
//
// Two pure readings:
//   - what each engine's connectors reach (Connect apps, the engine cards,
//     the turn's prompt), never whether a person signed in to them: that
//     stays on claude.ai and grok.com;
//   - which connector calls act outside the app (a mail sent, a Teams post,
//     an invitation, a SharePoint write), so the outbound guard
//     (shared/outbound.ts) keeps their approval card at every level but Full.
import { GROK_CLOUD_CONNECTORS } from "./grok-cloud-connectors.ts";

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
  return name
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
 * (isEngineConnectorServer) that names no known action and is no read or
 * draft: it keeps its card (fail closed). */
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

const NEEDS: Array<{ capability: ConnectorCapability; pattern: RegExp; hints?: Array<[RegExp, string]> }> = [
  { capability: "sharepoint", pattern: /\b(sharepoint|onedrive)\b/i, hints: [[/sharepoint/i, "SharePoint"], [/onedrive/i, "OneDrive"]] },
  { capability: "teams", pattern: /\bteams\b/i, hints: [[/teams/i, "Teams"]] },
  { capability: "calendar", pattern: /\b(calendrier|calendar|agenda|r[ée]union|meeting|rendez-vous|invitation|invite[rz]?)\b/i, hints: [[/google calendar/i, "Google Calendar"]] },
  { capability: "mail", pattern: /\b(courriels?|e-?mails?|mails?|gmail|outlook|bo[iî]te de r[ée]ception|inbox)\b/i, hints: [[/gmail/i, "Gmail"], [/outlook/i, "Outlook"]] },
];

/** The connector a person's request needs (mail, calendar, Teams,
 * SharePoint), and the service it names when it names one. Words only:
 * the switch it drives (server/connector-switch.ts) never runs a tool. */
export function connectorNeed(text: string): { capability: ConnectorCapability; hint?: string } | null {
  const plain = text.slice(0, 4_000);
  for (const need of NEEDS) {
    if (!need.pattern.test(plain)) continue;
    const hint = need.hints?.find(([pattern]) => pattern.test(plain))?.[1];
    return { capability: need.capability, ...(hint ? { hint } : {}) };
  }
  return null;
}
