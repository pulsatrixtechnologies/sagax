// "Connect Microsoft Teams" from the chat (2026-10-22, after Sagax 0.7.2:
// "peux tu le connecter" took 13 tool calls and ended in "I can't"). The
// bot calls open_connector_setup once; Sagax posts a card whose one button
// opens the page where the person signs in, in their own browser:
//
// - the reference design on the person's own xAI account: grok.com/connectors (xAI
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
import { decodeGrokGatewayName, GROK_CLOUD_CONNECTORS, GROK_CONNECTORS_URL, grokConnectorIdForName, grokGatewayToolConnector } from "./grok-cloud-connectors.ts";
import { containsUuid, isOpaqueId } from "./human-id.ts";

/** Where a person adds, signs in to and removes their claude.ai connectors. */
export const CLAUDE_AI_CONNECTORS_URL = "https://claude.ai/customize/connectors";

/** The only hosts a setup card may open. */
const SETUP_HOSTS = new Set(["grok.com", "claude.ai"]);

/** #2690: "mac" is a permission of this Mac (Messages reads need Full Disk
 * Access): the card opens that System Settings pane instead of a web page. */
export type ConnectorSetupProvider = "grok" | "claude" | "mac";

/** The System Settings pane where Sagax gets Full Disk Access back (Messages). */
export const MAC_FULL_DISK_ACCESS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

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
  /** 2026-10-30: a Grok card names the account the connector goes on, the
   * person's Grok sign-in here: their personal or their team account. */
  account?: "personal" | "team";
}

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
  const id = grokConnectorIdForName(key);
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

/** Where the person signs in: their own Grok or Claude account, never one
 * that belongs to someone else (2026-10-21). 2026-10-28: the card no longer
 * dead-ends when the bot's engine brings no connector of the person's own
 * (a key, someone else's sign-in, another engine): it opens the person's own
 * Grok or Claude account when they have one here, which the bot then
 * reaches with run_with_engine. `prefer` (the bot's `via`) wins when that
 * account is the person's own. A refusal means there is no account of
 * theirs at all, and the bot is told not to offer the card again. */
export function chooseConnectorSetupRoute(input: {
  target: ConnectorSetupTarget;
  /** the engine the bot runs on */
  engine: "grok" | "claude" | "other";
  /** server/harness-connectors.ts accountConnectorsForTurn */
  account: "own" | "foreign" | "none";
  /** the person's own sign-in on another engine of that family this bot may run */
  ownAccounts?: { grok?: boolean; claude?: boolean };
  prefer?: ConnectorSetupProvider;
}): ConnectorSetupRoute {
  const { target } = input;
  const own = {
    grok: Boolean(target.grok) && ((input.engine === "grok" && input.account === "own") || input.ownAccounts?.grok === true),
    claude: (input.engine === "claude" && input.account === "own") || input.ownAccounts?.claude === true,
  };
  const route = (provider: ConnectorSetupProvider): ConnectorSetupRoute =>
    ({ route: provider, url: provider === "grok" ? GROK_CONNECTORS_URL : CLAUDE_AI_CONNECTORS_URL });
  if (input.prefer && own[input.prefer]) return route(input.prefer);
  // the bot's own engine first, when it runs on the person's own account
  if (input.account === "own" && (input.engine === "grok" || input.engine === "claude") && own[input.engine]) return route(input.engine);
  if (own.grok) return route("grok");
  if (own.claude) return route("claude");
  if (input.account === "foreign" && input.engine !== "other") return { refusal: "foreign" };
  if (input.account === "own" && input.engine === "grok") return { refusal: "not_on_engine" };
  return { refusal: "no_route" };
}

/** https on grok.com or claude.ai, no credentials in the URL; or the one
 * System Settings pane a Messages card opens. */
export function isConnectorSetupUrl(raw: string): boolean {
  if (raw === MAC_FULL_DISK_ACCESS_URL) return true;
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
  const raw = provenToolName(proof)?.replace(/^mcp__/, "");
  if (!raw) return false;
  // grok's managed gateway (shared/grok-cloud-connectors.ts): the connector
  // is in the tool name, `cursor__user-Teams-list_5fchats___10`
  const gateway = grokGatewayToolConnector(raw);
  if (gateway) {
    // the tool itself, after `<server>__user-<Connector>-`: a sign-in step proves nothing
    const tool = decodeGrokGatewayName(raw.slice(raw.indexOf("__") + 2)).replace(/^[a-z]+-[^-]+-?/i, "");
    return gateway.id === target.grok && !AUTH_TOOL.test(tool);
  }
  const name = raw.toLowerCase();
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

const HOST_LABEL: Record<ConnectorSetupProvider, string> = { grok: "grok.com", claude: "claude.ai", mac: "System Settings" };

/** The row's text: what clients without the card draw (phones, exports). */
export function connectorSetupText(view: Pick<ConnectorSetupView, "label" | "provider" | "url" | "account">, language: "fr" | "en"): string {
  if (view.provider === "mac") return connectorReauthText(view, language);
  const link = `[${HOST_LABEL[view.provider]}](${view.url})`;
  const account = view.provider === "grok" && view.account ? ACCOUNT_LABEL[language][view.account] : "";
  return language === "fr"
    ? `Connectez ${view.label} sur ${link}${account ? `, avec ${account}` : ""}.`
    : `Connect ${view.label} on ${link}${account ? `, with ${account}` : ""}.`;
}

const ACCOUNT_LABEL = {
  fr: { personal: "votre compte Grok personnel", team: "votre compte Grok d'équipe" },
  en: { personal: "your personal Grok account", team: "your team Grok account" },
} as const;

/** #2749: a connector call refused because the connector's sign-in expired
 * ("Managed MCP gateway tool call failed: Cursor connector needs
 * re-authentication in Cursor: ...", seen on an X routine 2026-11-07). The
 * person must hear it plainly, with the sign-in link, not as a buried
 * "failed 2 times". */
const REAUTH_FAILURE = /\b(?:needs?|requires?|required)\s+(?:a\s+)?re-?authenticat(?:e|ion)\b|\bre-?authenticat(?:e|ion)\s+(?:is\s+)?required\b|\breauth(?:entication)?_required\b|\bneeds?\s+(?:a\s+)?new\s+sign-?in\b/i;
/** #2690 (proactive report #2645, 2026-11-07): X answers an expired or
 * revoked connection with "client-not-enrolled", GitHub with a bare HTTP 400. */
const X_NOT_ENROLLED = /\bclient[-_]not[-_]enrolled\b/i;
const HTTP_400 = /\bHTTP\s*(?:status\s*)?400\b|\b400\s+Bad\s+Request\b|\bstatus(?:\s+code)?[:\s]+400\b/i;
/** The Messages tools (shared/imessage.ts MESSAGES_MCP_SERVER) and what they say without this Mac's permission. */
const MESSAGES_TOOL = /(?:^|__|\b)(?:messages|imessage)__|^(?:mcp__)?(?:messages|imessage)\b/i;
const MESSAGES_ACCESS_FAILURE = /\bneeds\s+Full\s+Disk\s+Access\b|\bFull\s+Disk\s+Access\b.*\b(?:denied|missing|required|needed)\b|\bnot\s+(?:authori[sz]ed|allowed)\s+to\s+send\s+Apple\s+events\b|\berror\s+-1743\b/i;
/** A grok.com connector call goes through Grok's managed gateway. */
const GATEWAY_FAILURE = /\bmanaged\s+mcp\s+gateway\b|\bmanaged_gateway:/i;

export interface ConnectorReauthFailure {
  /** the connector as the person knows it ("X", "Outlook") */
  label: string;
  /** the setup target id (resolveConnectorSetupTarget), else the cleaned label */
  connector: string;
  provider: ConnectorSetupProvider;
  url: string;
}

/** The connector whose sign-in a failed call says must be renewed, or null
 * for any other failure. `tool` is the call's name or title: a gateway id
 * (`cursor__user-X-search_5fposts_5fall`), or a display title ending with
 * the connector ("Search posts all · X"). */
export function connectorReauthFailure(tool: string | undefined, output: string | undefined): ConnectorReauthFailure | null {
  const said = String(output ?? "");
  const name = String(tool ?? "").trim();
  // #2690: Messages lost this Mac's Full Disk Access (or Automation): the
  // same one card, opening the System Settings pane
  if (MESSAGES_TOOL.test(name) && MESSAGES_ACCESS_FAILURE.test(said)) {
    return { label: "Messages", connector: "messages", provider: "mac", url: MAC_FULL_DISK_ACCESS_URL };
  }
  if (!REAUTH_FAILURE.test(said) && !X_NOT_ENROLLED.test(said) && !HTTP_400.test(said)) return null;
  const gateway = name ? grokGatewayToolConnector(name) : null;
  const titled = !gateway && name.includes(" · ") ? name.slice(name.lastIndexOf(" · ") + 3).trim() : "";
  const claude = /^mcp__claude_ai_/i.test(name) || /\bclaude\.ai\b/i.test(said);
  const provider: ConnectorSetupProvider | null = gateway || GATEWAY_FAILURE.test(said) ? "grok" : claude ? "claude" : null;
  if (!provider) return null;
  const raw = gateway?.name ?? (titled || (claude ? decodeGrokGatewayName(name.replace(/^mcp__claude_ai_/i, "").split("__")[0] ?? "").replace(/_/g, " ") : ""));
  const target = raw ? resolveConnectorSetupTarget(raw) : null;
  const label = target?.label ?? cleanName(raw);
  // #2690: X's "client-not-enrolled" and GitHub's bare HTTP 400 are what an
  // expired sign-in of those two looks like; for any other connector a 400
  // stays an ordinary failure
  if (!REAUTH_FAILURE.test(said)) {
    const which = (target?.id ?? label).toLowerCase();
    const isX = which === "x" || which === "twitter" || /^x\b/i.test(label);
    const isGithub = which.includes("github");
    if (!(X_NOT_ENROLLED.test(said) && isX) && !(HTTP_400.test(said) && isGithub)) return null;
  }
  return {
    label: label || (provider === "grok" ? "A grok.com connector" : "A claude.ai connector"),
    connector: target?.id ?? (label.toLowerCase() || "connector"),
    provider,
    url: provider === "grok" ? GROK_CONNECTORS_URL : CLAUDE_AI_CONNECTORS_URL,
  };
}

/** The routine problem line for an expired connector sign-in. */
export function connectorReauthProblem(failure: ConnectorReauthFailure): string {
  if (failure.provider === "mac") return `${failure.label} lost this Mac's Full Disk Access: give it back to Sagax in System Settings, Privacy & Security, then run the routine again. Its calls failed until then.`;
  return `${failure.label} needs a new sign-in: reconnect it on ${HOST_LABEL[failure.provider]} (${failure.url}), then run the routine again. Its calls failed until then.`;
}

/** The chat line beside the card for an expired sign-in. */
export function connectorReauthText(failure: Pick<ConnectorReauthFailure, "label" | "provider" | "url">, language: "fr" | "en"): string {
  if (failure.provider === "mac") {
    return language === "fr"
      ? `${failure.label} n'a plus accès à ce Mac : redonnez l'accès complet au disque à Sagax dans Réglages Système, Confidentialité et sécurité. Ses appels échouent d'ici là.`
      : `${failure.label} lost access to this Mac: give Sagax Full Disk Access again in System Settings, Privacy & Security. Its calls fail until then.`;
  }
  const link = `[${HOST_LABEL[failure.provider]}](${failure.url})`;
  return language === "fr"
    ? `${failure.label} demande une nouvelle connexion : reconnectez-le sur ${link}. Ses appels échouent d'ici là.`
    : `${failure.label} needs a new sign-in: reconnect it on ${link}. Its calls fail until then.`;
}
