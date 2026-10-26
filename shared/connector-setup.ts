// "Connect Microsoft Teams" from the chat (JC 2026-10-22, after Sagax 0.7.2:
// "peux tu le connecter" took 13 tool calls and ended in "I can't"). The
// bot calls open_connector_setup once; Sagax posts a card whose one button
// opens the page where the person signs in, in their own browser:
//
//   - a Grok bot on the person's own xAI account: grok.com/connectors (xAI
//     documents no per-connector deep link: "New Connector", then the app);
//   - a Claude bot on the person's own subscription: claude.ai Customize >
//     Connectors.
//
// Sagax never holds a token for these and never signs anyone in. An engine
// account that belongs to someone else (the payer is not the speaker,
// review of #943) is refused: the person would connect an account the turn
// is not theirs to use. The card says "Connecté" only on evidence: for
// Claude, the card's person's own claude.ai inventory read again; for Grok
// (no API says which connectors an account connected), a successful call to
// that connector after the card, in a turn of the card's person on the
// card's bot, never a sign-in tool. Until then a Grok card stays "pending".
import { claudeAiConnectorCapabilities, grokConnectorCapabilities, type ConnectorCapability } from "./engine-connectors.ts";
import { GROK_CLOUD_CONNECTORS, GROK_CONNECTORS_URL } from "./grok-cloud-connectors.ts";
import { containsUuid, isOpaqueId } from "./human-id.ts";

/** Where a person adds, signs in to and removes their claude.ai connectors. */
export const CLAUDE_AI_CONNECTORS_URL = "https://claude.ai/customize/connectors";

/** The only hosts a setup card may open. */
const SETUP_HOSTS = new Set(["grok.com", "claude.ai"]);

export type ConnectorSetupProvider = "grok" | "claude";

export interface ConnectorSetupTarget {
  /** a stable id: the Grok catalog id when there is one, else the cleaned name */
  id: string;
  label: string;
  /** the xAI cloud connector id (shared/grok-cloud-connectors.ts) */
  grok?: string;
  /** what it reaches, to read the claude.ai inventory by service */
  capabilities: ConnectorCapability[];
}

export interface ConnectorSetupView {
  /** cs_ + 18 hex */
  id: string;
  connector: string;
  label: string;
  provider: ConnectorSetupProvider;
  /** grok.com or claude.ai only (isConnectorSetupUrl) */
  url: string;
  /** waiting: not checked yet; pending: checked, no evidence yet; connected: evidence */
  status: "waiting" | "pending" | "connected";
  /** A digest of the person the card is for (server/routes/connector-setup.ts), never their id. */
  owner: string;
  createdAt: number;
  checkedAt?: number;
}

const ALIASES: Array<[RegExp, string]> = [
  [/^(?:microsoft[\s_-]*teams|ms[\s_-]*teams|teams)$/, "microsoft-teams"],
  [/^(?:outlook|microsoft outlook|outlook \(exchange\)|exchange|outlook mail|hotmail)$/, "outlook"],
  [/^(?:gmail|google mail)$/, "gmail"],
  [/^(?:google[\s_-]*drive|gdrive|drive)$/, "google-drive"],
  [/^(?:one[\s_-]*drive)$/, "onedrive"],
  [/^(?:share[\s_-]*point)$/, "sharepoint"],
  [/^salesforce$/, "salesforce"],
  [/^(?:x|twitter|x \(twitter\))$/, "x"],
];

function cleanName(raw: string): string {
  // oxlint-disable-next-line no-control-regex -- control characters never belong in a name on screen
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

/** The connector a person named ("Teams", "Microsoft Teams", "gmail"), or null. */
export function resolveConnectorSetupTarget(raw: string): ConnectorSetupTarget | null {
  const label = cleanName(raw);
  // a name on screen, never an id (AGENTS.md "Never a UUID/GUID on screen")
  if (!label || containsUuid(label) || isOpaqueId(label)) return null;
  const key = label.toLowerCase();
  const id = ALIASES.find(([pattern]) => pattern.test(key))?.[1];
  const grok = id ? GROK_CLOUD_CONNECTORS.find((connector) => connector.id === id) : undefined;
  if (grok) {
    return {
      id: grok.id,
      label: grok.id === "outlook" ? "Outlook" : grok.name,
      grok: grok.id,
      capabilities: grokConnectorCapabilities(grok.id),
    };
  }
  return {
    id: key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app",
    label,
    capabilities: claudeAiConnectorCapabilities(label),
  };
}

export type ConnectorSetupRoute =
  | { route: ConnectorSetupProvider; url: string }
  | { refusal: "foreign" | "not_on_engine" | "no_route" };

/** Where the person signs in: the engine's own connectors, on the person's
 * own engine account only (JC 2026-10-21). */
export function chooseConnectorSetupRoute(input: {
  target: ConnectorSetupTarget;
  /** the engine the bot runs on */
  engine: "grok" | "claude" | "other";
  /** server/harness-connectors.ts accountConnectorsForTurn */
  account: "own" | "foreign" | "none";
  prefer?: ConnectorSetupProvider;
}): ConnectorSetupRoute {
  const { target } = input;
  if (input.account === "foreign" && input.engine !== "other") return { refusal: "foreign" };
  const engineRoute: ConnectorSetupRoute | null = input.account !== "own" ? null
    : input.engine === "grok" ? (target.grok ? { route: "grok", url: GROK_CONNECTORS_URL } : null)
      : input.engine === "claude" ? { route: "claude", url: CLAUDE_AI_CONNECTORS_URL }
        : null;
  if (engineRoute) return engineRoute;
  if (input.account === "own" && input.engine === "grok") return { refusal: "not_on_engine" };
  return { refusal: "no_route" };
}

/** https on grok.com or claude.ai, no credentials in the URL. */
export function isConnectorSetupUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && SETUP_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
}

/** A tool call a turn finished, as the server recorded it when it settled
 * (server/routes/connector-setup.ts ConnectorSetupProofs): the driver's
 * normalized name, whose turn it was and on which bot. */
export interface ConnectorSetupProof {
  /** the driver's name (`mcp__microsoft_teams__list_chats`), or the meta tool `use_tool` */
  name: string;
  input?: string;
  ok: boolean;
  at: number;
  /** the owner digest of the turn's speaker, "" when no person spoke */
  owner: string;
  botId: string;
}

/** The meta tool whose input names the tool it runs. */
const META_TOOL = "use_tool";
/** A sign-in step says nothing about whether the connector works. */
const AUTH_TOOL = /auth/i;

function provenToolName(proof: Pick<ConnectorSetupProof, "name" | "input">): string | null {
  if (proof.name !== META_TOOL) return proof.name;
  try {
    const parsed = JSON.parse(proof.input ?? "") as { tool_name?: unknown };
    return typeof parsed?.tool_name === "string" ? parsed.tool_name : null;
  } catch {
    return null;
  }
}

/** Proof that a Grok card's connector works: a successful call to it after
 * the card, in a turn of the card's own person on the card's bot. A sign-in
 * tool is not proof. A Claude card takes no call as proof: only its
 * person's claude.ai inventory (claudeInventoryShowsConnected). */
export function connectorProofMatches(view: Pick<ConnectorSetupView, "provider" | "connector" | "label" | "createdAt" | "owner">, proof: ConnectorSetupProof, cardBotId: string): boolean {
  if (view.provider !== "grok") return false;
  if (!proof.ok || proof.at <= view.createdAt || !proof.owner || proof.owner !== view.owner || !cardBotId || proof.botId !== cardBotId) return false;
  const target = resolveConnectorSetupTarget(view.label) ?? resolveConnectorSetupTarget(view.connector);
  if (!target?.grok) return false;
  const name = provenToolName(proof)?.toLowerCase().replace(/^mcp__/, "");
  if (!name) return false;
  const server = `${target.grok.replace(/-/g, "_")}__`;
  if (!name.startsWith(server)) return false;
  return !AUTH_TOOL.test(name.slice(server.length));
}

function claudeServiceMatches(service: string, target: ConnectorSetupTarget): boolean {
  if (service.trim().toLowerCase() === target.label.toLowerCase()) return true;
  const reaches = claudeAiConnectorCapabilities(service);
  if (!target.capabilities.length) return false;
  // Microsoft 365 reaches Teams; Gmail does not reach Teams
  return target.capabilities.every((capability) => reaches.includes(capability));
}

/** The claude.ai inventory (GET /api/me/harness-connectors) shows this connector connected. */
export function claudeInventoryShowsConnected(connectors: readonly { name: string; status: string }[], target: ConnectorSetupTarget): boolean {
  return connectors.some((connector) => connector.status === "connected" && claudeServiceMatches(connector.name, target));
}

const HOST_LABEL: Record<ConnectorSetupProvider, string> = { grok: "grok.com", claude: "claude.ai" };

/** The row's text: what clients without the card draw (phones, exports). */
export function connectorSetupText(view: Pick<ConnectorSetupView, "label" | "provider" | "url">, language: "fr" | "en"): string {
  const link = `[${HOST_LABEL[view.provider]}](${view.url})`;
  return language === "fr" ? `Connectez ${view.label} sur ${link}.` : `Connect ${view.label} on ${link}.`;
}
