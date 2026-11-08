import type { AccessVia } from "./engines/engine-credentials.ts";
// Connectors the engines already bring with the person's own account, so
// Sagax builds no GitHub, Outlook or Calendar integration of its own.
//
// Claude Code signed in with a claude.ai subscription mounts that account's
// claude.ai connectors (Microsoft 365 with Outlook mail and calendar, GitHub,
// Gmail, Google Calendar and so on) as MCP servers named "claude.ai <Service>",
// tools prefixed mcp__claude_ai_. Authentication stays with claude.ai.
// https://code.claude.com/docs/en/mcp ("Use MCP servers from Claude.ai")
//
//   - They load only on a claude.ai subscription login: never on an API key,
//     an auth token, apiKeyHelper, Bedrock/Vertex/Foundry or a
//     `claude setup-token` token.
//   - --strict-mcp-config drops them (measured on CLI 2.1.287, although the
//     docs say otherwise), so the Claude driver omits that flag for a turn
//     that keeps them and sets ENABLE_CLAUDEAI_MCP_SERVERS=false for every
//     other isolated turn. --setting-sources project stays either way.
//
// Speaker pays, speaker connects: a turn keeps the connectors only when it
// runs on the speaker's own subscription. On an organization server that is
// the `subscription` access (the owner speaking, from their own login
// directory); a member on someone else's bot runs on a key and has none. On
// a solo server the machine's Claude login is the operator's, so only the
// operator (and the operator's routines) get them.
//
// Codex: the ChatGPT apps (connectors) of `codex login` need Codex backend
// auth ("ChatGPT connectors require Codex backend auth" in codex-cli
// 0.153.0). Sagax's ChatGPT plan mode passes a token to a custom provider
// with an ephemeral credential store, and an API key has none, so Codex
// turns get no ChatGPT connectors; nothing here mounts them.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_CONNECTORS_URL } from "../shared/connector-setup.ts";
import { GROK_CLOUD_CONNECTORS, GROK_CONNECTORS_URL } from "../shared/grok-cloud-connectors.ts";
import type { TurnSpeaker } from "./engines/engine-access.ts";
import { resolveCli } from "./procs.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

/** How Claude Code names a claude.ai connector's server. */
export const CLAUDE_AI_SERVER_PREFIX = "claude.ai ";
/** Where a person adds, signs in to and removes their connectors. */
export { CLAUDE_AI_CONNECTORS_URL };

export const HARNESS_CONNECTORS_PATH = "/api/me/harness-connectors";
export const HARNESS_CONNECTORS_SETTINGS_PATH = "/api/harness-connectors/settings";

// ── whose connectors a turn uses ─────────────────────────────────────────

export interface ConnectorPrincipalInput {
  identity: "solo" | "perspicax";
  speaker: TurnSpeaker;
  /** The bot's owner (a routine uses the owner's connections). */
  ownerPrincipalId: string;
  /** The operator at this computer. */
  localPrincipalId: string;
}

/** The person whose connections a turn uses, "" for nobody: a conversation
 * uses its speaker's, a routine its bot owner's, an unknown person nobody's
 * (on a solo server an unnamed person is the operator). */
export function connectorPrincipalFor(input: ConnectorPrincipalInput): string {
  const solo = input.identity === "solo";
  const fallback = solo ? input.localPrincipalId : "";
  const normalize = (value: string | undefined) => value?.trim().toLowerCase() ?? "";
  switch (input.speaker.origin) {
    case "operator": return normalize(input.localPrincipalId);
    case "owner-routine": return normalize(input.ownerPrincipalId);
    case "person":
    case "peer": return normalize(input.speaker.principalId) || normalize(fallback);
  }
}

export interface ClaudeAiTurnInput extends ConnectorPrincipalInput {
  /** An enrolled desktop whose organization restricts MCP servers. */
  restrictedByPolicy: boolean;
  driver: string;
  /** Organization server: how this turn's credentials were chosen. */
  via?: AccessVia;
  /** Organization server: whose credentials they are (the plan's payer). */
  payerPrincipalId?: string;
  /** #2384: the account (provider instance) the turn runs on; an added
   * account (`<prefix>-<uuid>`) has its own sign-in and connectors. */
  instanceId?: string;
  /** #2747: the bot opted in to its Grok account's grok.com connectors
   * (bot setting grokAccountConnectors, off by default). */
  grokAccountConnectors?: boolean;
}

const ACCOUNT_CONNECTOR_DRIVERS = new Set(["claudeAgent", "grokAgent", "grok"]);

/** Whose account connectors a turn would reach (review of #943, point 5):
 * "own" when the account the turn runs on is the person the turn is for
 * (connectorPrincipalFor: the speaker, a routine's owner), "foreign" when
 * it is someone else's sign-in (another person's subscription, the
 * machine's login in solo for anyone but the operator): those connectors
 * are never offered, the turn says they belong to someone else. "none":
 * an engine or an access (a key) that brings none. On a solo server the
 * machine's own sign-in is the operator's: Claude's claude.ai connectors and,
 * since 2026-10-30, Grok's grok.com connectors (each write through them still
 * waits for its card, grok.ts grokCloudConnectorEnv). */
export function accountConnectorsForTurn(input: ClaudeAiTurnInput): "own" | "foreign" | "none" {
  if (input.restrictedByPolicy || !ACCOUNT_CONNECTOR_DRIVERS.has(input.driver)) return "none";
  const principal = connectorPrincipalFor(input);
  if (input.identity === "perspicax") {
    if (input.via !== "subscription") return "none";
    if (input.payerPrincipalId !== undefined && input.payerPrincipalId.trim().toLowerCase() !== principal) return "foreign";
    return principal ? "own" : "foreign";
  }
  return principal && principal === input.localPrincipalId.trim().toLowerCase() ? "own" : "foreign";
}

/** Whether a Claude turn keeps the claude.ai connectors of the account it
 * runs on: only when that account is the speaker's own. */
export function claudeAiConnectorsForTurn(input: ClaudeAiTurnInput): boolean {
  return input.driver === "claudeAgent" && accountConnectorsForTurn(input) === "own";
}

/** Whether a Grok turn may load the cloud connectors of the xAI account it
 * runs on: the person's own grok.com sign-in only, on an organization turn
 * and, since 2026-10-30, on a solo server (the operator's own sign-in). The
 * driver adds no tool selection (grokCloudConnectorEnv) and keeps a card on
 * every write (grok.ts spawnArgs: never Grok's own auto or bypass mode). */
export function grokCloudConnectorsForTurn(input: ClaudeAiTurnInput): boolean {
  // #2747 (QA of #2816): xAI's managed gateway serves every connector of the
  // grok.com account, the account's own third-party MCP connectors included
  // (`managed_gateway:cursor` carried the operator's "Pulsatrix Sagax"
  // connector, remote_support_host_code and the rest, into a bot's turn). A
  // bot sees only the tools Sagax mounts for it, so no bot turn loads the
  // account's managed MCP unless the bot opted in (grokAccountConnectors,
  // a bot setting off by default), and then only on the person's own sign-in.
  return input.grokAccountConnectors === true && GROK_DRIVERS.has(input.driver) && accountConnectorsForTurn(input) === "own";
}

/** The system note for a turn that keeps them: what they are and whose. */
export function claudeAiConnectorsPrompt(enabled: boolean): string {
  if (!enabled) return "";
  return "\nThis turn runs on the speaker's own Claude account, so its claude.ai connectors (for example Microsoft 365 for Outlook mail and calendar, or GitHub) may be mounted as MCP servers named \"claude.ai <Service>\", with tools prefixed mcp__claude_ai_. They act as that person, with that person's access: use them for that person's own mail, calendar, repositories and files when asked, never for anyone else. For that person's own mail and calendar, omit userId and user_id (or pass \"me\") so the call stays on /me with their credentials; never target another UPN or a bot inbound address. If one is missing or answers that it needs authentication, or the person asks to connect one, call open_connector_setup once (it posts the sign-in card) and answer in one short sentence.";
}

const OUTWARD_ACTS = "Sending, forwarding or replying to mail, an automatic reply, posting or replying in Teams, starting a Teams chat, creating, changing or cancelling a calendar event (it mails the attendees), answering an invitation, and any SharePoint or OneDrive write";
/** What an outward act through a connector does at this turn's level
 * (2026-10-28: a Full access turn was never told it was one). */
function outwardRule(full: boolean): string {
  return full
    ? ` This turn runs in Full access: ${OUTWARD_ACTS.charAt(0).toLowerCase()}${OUTWARD_ACTS.slice(1)} go out when the person asked for them, with no confirmation and no typed GO; only a Refuse or Ask first rule, or a recipient outside the bot's allowed recipients, stops one, and Sagax shows that itself. Make the call with the exact recipients, subject, time and attendees, and say it is done only once the call succeeded. Reads, drafts and reply drafts do not ask.`
    : ` ${OUTWARD_ACTS} wait for the person's approval card: make the call with the exact recipients, subject, time and attendees (Sagax shows the card; never ask for a typed GO), and say it is done only once the call succeeded. Reads, drafts and reply drafts do not ask.`;
}
/** run_with_engine (server/run-with-engine.ts): the way to another engine of
 * this person's that has the connector. */
const RELAY_HINT = " When the connector needed is on another engine of this person's (their own Grok account's Outlook, Microsoft Teams or SharePoint, or their claude.ai connectors), call run_with_engine with that engine: it runs that part on their own sign-in there and gives you the result. Never answer that you cannot switch engines.";

/** Another engine or sign-in of this person's that a turn may hand a part
 * to (run_with_engine), with the connectors known to be there: what the
 * cached claude.ai inventory lists as connected, what a Grok sign-in's own
 * catalog carried (grok-tool-catalog.ts GrokAccountReach). */
export interface ConnectorElsewhere {
  /** the name run_with_engine takes ("Claude", "Grok (personal account)") */
  engine: string;
  connectors: readonly string[];
  /** a second Grok sign-in: what it is */
  accountKind?: "personal" | "team";
}

/** The relay hint with the person's other engines named, so the bot calls
 * run_with_engine with the right one instead of guessing (2026-10-29).
 * Nothing known elsewhere: the generic hint. */
export function relayHint(elsewhere: readonly ConnectorElsewhere[] | undefined): string {
  const known = (elsewhere ?? []).filter((entry) => entry.connectors.length);
  if (!known.length) return RELAY_HINT;
  const lines = known.map((entry) => `${entry.engine}: ${[...entry.connectors].join(", ")}`).join("; ");
  const personal = known.some((entry) => entry.accountKind === "personal");
  return ` This person's other engines and sign-ins, with the connectors they bring (run_with_engine takes the engine's name exactly as written here): ${lines}. For one of those, call run_with_engine with that engine and the complete request: it runs that part on their own sign-in there and gives you the result, in this same turn.${personal ? " For Outlook, Microsoft Teams and Gmail, prefer the personal account when more than one account has them." : ""} Never answer that you cannot switch engines or accounts.`;
}

const GROK_DRIVERS = new Set(["grokAgent", "grok"]);

/** What a turn is told about mail, calendar, Teams and SharePoint (parité
 * R9 + R11, shared/engine-connectors.ts): Claude's own claude.ai
 * connectors, the xAI account's cloud connectors on a Grok organization
 * turn (grokCloudConnectorEnv let them load), a turn on someone else's
 * account (nothing offered), or, for an engine that brings none, which
 * engine does. A person's request that needs one is already moved, for that
 * request, to another engine of theirs whose connector is known to be
 * there (server/connector-switch.ts); a turn told it has none is one where
 * no such engine was found, so the bot says so and may offer a teammate
 * (coordinate_bots in a person's chat, ask_bot in a routine). */
export function engineConnectorsPrompt(input: { driver: string; claudeAi: boolean; grokCloud: boolean; foreign?: boolean; full?: boolean; relay?: boolean; elsewhere?: readonly ConnectorElsewhere[] }): string {
  const outward = outwardRule(input.full === true);
  const relay = input.relay ? relayHint(input.elsewhere) : "";
  if (input.claudeAi && input.driver === "claudeAgent") return `${claudeAiConnectorsPrompt(true)}${relay}${outward}`;
  if (input.foreign && ACCOUNT_CONNECTOR_DRIVERS.has(input.driver)) {
    return `\nThis turn runs on an engine account that is not the speaker's own (the bot owner's or another person's sign-in), so its mail, calendar, Microsoft Teams and SharePoint connectors are not used for this person: they belong to someone else. If asked for one of those, say so plainly, do not read or send anything through them, and do not claim anything was sent. The person can connect their own account to use their own.${relay}`;
  }
  if (input.grokCloud && GROK_DRIVERS.has(input.driver)) {
    return `\nThis turn runs on the person's own xAI account of this Grok engine, so its cloud connectors (${GROK_CLOUD_CONNECTORS.map((connector) => connector.name).join(", ")}) are reachable through use_tool when the account connected them on grok.com: find one with search_tool (for example "teams" or "outlook"), then call it. They act with that account's access. For that person's own mail and calendar, omit userId and user_id (or pass "me") so the call stays on /me with their credentials; never target another UPN or a bot inbound address. If one is missing or needs sign-in, or the person asks to connect one, call use_tool with tool_name agents__open_connector_setup right away: it posts the card that opens ${GROK_CONNECTORS_URL} for them; then answer in one short sentence.${relay}${outward}`;
  }
  if (input.relay) {
    return `\nThis turn's engine brings no mail, calendar, Microsoft Teams or SharePoint connector of this person's.${relay} If no engine you may use has it, say so plainly and do not claim anything was sent. When the person asks to connect one, call open_connector_setup (agents__open_connector_setup) once: it posts the card for their own Grok or Claude account, or says why there is none.${outward}`;
  }
  return "\nThis turn's engine brings no mail, calendar, Microsoft Teams or SharePoint connector, and no other engine of this person was found with the one needed (Sagax moves such a request on its own when it finds one). If asked for one of those, say so plainly and do not claim anything was sent: the person can connect it on Claude (claude.ai connectors, such as Microsoft 365 or Gmail) or on Grok (the xAI account's cloud connectors, such as Outlook, Microsoft Teams or SharePoint), and you can offer to ask a teammate bot on that engine with your teammate tools. When the person asks to connect one, call the Sagax tool open_connector_setup (agents__open_connector_setup) once: it posts the right card, or says why there is none.";
}

// ── what the person has ──────────────────────────────────────────────────

export type ClaudeAiConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";
export interface ClaudeAiConnector {
  name: string;
  status: ClaudeAiConnectorStatus;
}

/** The claude.ai connectors in `claude mcp list` output. Other servers (a
 * user-scope server, a project's .mcp.json) are not this person's account
 * and are left out; so is the URL. */
export function parseClaudeMcpList(stdout: string): ClaudeAiConnector[] {
  const out: ClaudeAiConnector[] = [];
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(CLAUDE_AI_SERVER_PREFIX)) continue;
    // "claude.ai <Name>: <url> - <status>": a name may hold ": " itself
    // ("Keyword Tool: Free SEO Keyword Research"), the address never does,
    // so the name ends at the last ": " before the status
    const dash = line.lastIndexOf(" - ");
    const colon = (dash > 0 ? line.slice(0, dash) : line).lastIndexOf(": ");
    if (colon <= CLAUDE_AI_SERVER_PREFIX.length) continue;
    const name = line.slice(CLAUDE_AI_SERVER_PREFIX.length, colon).trim();
    if (!name || name.length > 80 || /[\p{Cc}]/u.test(name) || seen.has(name)) continue;
    seen.add(name);
    const tail = line.slice(colon).toLowerCase();
    const status: ClaudeAiConnectorStatus = /\bconnected\b/.test(tail) && !/\bnot connected\b/.test(tail) ? "connected"
      : /needs authentication|needs auth/.test(tail) ? "needs_auth"
        : /failed|error/.test(tail) ? "failed"
          : "unknown";
    out.push({ name, status });
  }
  return out;
}

export type ClaudeAuthMethod = "subscription" | "key" | "none" | "unknown";

/** `claude auth status --json`: a claude.ai login is the only one that
 * brings connectors. Only the method is read; email and organization stay
 * out of everything this module returns. */
export function parseClaudeAuthStatus(stdout: string): ClaudeAuthMethod {
  try {
    const parsed = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown };
    if (parsed.loggedIn === false) return "none";
    if (parsed.authMethod === "claude.ai") return "subscription";
    if (typeof parsed.authMethod === "string" && parsed.authMethod) return "key";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export interface ClaudeAiInventory {
  auth: ClaudeAuthMethod;
  connectors: ClaudeAiConnector[];
  at: number;
}

export interface ClaudeCliRun {
  (input: { cli: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number }): Promise<string>;
}

/** Runs the Claude CLI once, bounded, and returns its stdout (never its
 * stderr, which may carry account details). */
export const runClaudeCli: ClaudeCliRun = ({ cli, args, env, cwd, timeoutMs }) => new Promise((resolve, reject) => {
  const resolved = resolveCli(cli, args, env);
  execFile(resolved.command, resolved.args, { env, cwd, timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true }, (error, stdout) => {
    if (error && !stdout) reject(new Error("claude cli failed"));
    else resolve(String(stdout));
  });
});

/** Reads one account's claude.ai connectors through its own CLI, cached a
 * few minutes per account (the health check opens every connector). Runs
 * in an empty folder so no project's .mcp.json joins the list. */
export class ClaudeAiConnectorInventory {
  private readonly cache = new Map<string, ClaudeAiInventory>();
  private readonly inflight = new Map<string, Promise<ClaudeAiInventory>>();
  private readonly run: ClaudeCliRun;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: { run: ClaudeCliRun; now?: () => number; ttlMs?: number }) {
    this.run = options.run;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
  }

  /** The cached inventory, whatever its age, without waiting; a missing
   * or stale one is read again in the background when `input` is given.
   * For a turn's connector switch (server/connector-switch.ts), which never
   * waits on the CLI. */
  peek(key: string, input?: { cli: string; env: NodeJS.ProcessEnv }): ClaudeAiInventory | undefined {
    const cached = this.cache.get(key);
    if (input && (!cached || this.now() - cached.at >= this.ttlMs)) void this.read(key, input).catch(() => {});
    return cached;
  }

  forget(key: string): void {
    this.cache.delete(key);
  }

  read(key: string, input: { cli: string; env: NodeJS.ProcessEnv }, force = false): Promise<ClaudeAiInventory> {
    const cached = this.cache.get(key);
    if (!force && cached && this.now() - cached.at < this.ttlMs) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running) return running;
    const work = (async (): Promise<ClaudeAiInventory> => {
      const cwd = mkdtempSync(join(tmpdir(), "omb-claude-connectors-"));
      try {
        const auth = parseClaudeAuthStatus(await this.run({ cli: input.cli, args: ["auth", "status", "--json"], env: input.env, cwd, timeoutMs: 15_000 }).catch(() => ""));
        const connectors = auth === "subscription"
          ? parseClaudeMcpList(await this.run({ cli: input.cli, args: ["mcp", "list"], env: input.env, cwd, timeoutMs: 45_000 }).catch(() => ""))
          : [];
        const result = { auth, connectors, at: this.now() };
        this.cache.set(key, result);
        return result;
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }
}

// ── routes ───────────────────────────────────────────────────────────────

/** Why a person's Claude connectors do not reach their turns. */
export type ClaudeAiUnavailable =
  | "managed_policy"    // the organization restricts MCP servers here
  | "no_engine"         // no Claude engine on this server
  | "not_signed_in"     // org: the person has no Claude sign-in of their own
  | "not_operator"      // solo: the machine's Claude login is the operator's
  | "key"               // the account is an API key, which has no connectors
  | "unknown";          // the CLI did not answer (missing, too old, timed out)

export interface HarnessConnectorRouteDeps {
  organization: boolean;
  restrictedByPolicy(): boolean;
  /** The caller as a principal, "" when not a known person. */
  principalFor(auth: RequestAuth): string;
  localPrincipalId(): string;
  isAdmin(auth: RequestAuth): boolean;
  /** 2026-10-19: a person an admin gave server.settings in Perspicax. */
  settingsDelegate?(auth: RequestAuth): boolean;
  /** The CLI and environment of the caller's own Claude account, or a
   * reason it has none. */
  claudeAccountFor(principalId: string): { cli: string; env: NodeJS.ProcessEnv; key: string; instanceId?: string } | { unavailable: "no_engine" | "not_signed_in" | "key" };
  inventory: Pick<ClaudeAiConnectorInventory, "read">;
  /** #1533: the person's own Claude sign-in exists, but Claude says it is
   * signed out (its refresh was refused): their engine card says Reconnect. */
  /** #2384: `instanceId` is the account the inventory was read on. */
  onSignedOut?(principalId: string, instanceId?: string): void;
}

function isAdminScope(auth: RequestAuth): boolean {
  if (auth.kind === "loopback" && auth.trust === "service") return false;
  return auth.scopes.includes("admin");
}

/** GET  /api/me/harness-connectors        the caller's own claude.ai connectors
 *  PUT  /api/harness-connectors/settings  retired no-op (always on), kept for older clients
 * Nothing returned names the account (no email, no organization, no URL). */
export function createHarnessConnectorRoutes(deps: HarnessConnectorRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== HARNESS_CONNECTORS_PATH && path !== HARNESS_CONNECTORS_SETTINGS_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const admin = deps.isAdmin(auth) && isAdminScope(auth);
    if (path === HARNESS_CONNECTORS_SETTINGS_PATH) {
      if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
      if (!admin && !deps.settingsDelegate?.(auth)) return json(res, 403, { error: "Only an administrator can change this." });
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req, 4096) as { claudeAi?: unknown } | null;
      if (!body || typeof body !== "object" || Object.keys(body).some((key) => key !== "claudeAi") || typeof body.claudeAi !== "boolean") {
        return json(res, 400, { error: "Send { \"claudeAi\": true | false }." });
      }
      // Claude connectors are always allowed on a server: nothing is stored.
      return json(res, 200, { claudeAi: true });
    }
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const principalId = deps.principalFor(auth);
    if (!principalId) return json(res, 403, { error: "sign in as a person first" });
    const base = { manageUrl: CLAUDE_AI_CONNECTORS_URL, canManage: admin, enabled: true };
    const answer = (claude: { available: boolean; reason?: ClaudeAiUnavailable; connectors: ClaudeAiConnector[] }) =>
      json(res, 200, { ...base, claude, codex: { available: false, reason: "not_supported" } });
    if (deps.restrictedByPolicy()) return answer({ available: false, reason: "managed_policy", connectors: [] });
    if (!deps.organization && principalId !== deps.localPrincipalId().trim().toLowerCase()) {
      return answer({ available: false, reason: "not_operator", connectors: [] });
    }
    const account = deps.claudeAccountFor(principalId);
    if ("unavailable" in account) return answer({ available: false, reason: account.unavailable, connectors: [] });
    const inventory = await deps.inventory.read(account.key, { cli: account.cli, env: account.env }, url.searchParams.get("refresh") === "1");
    if (inventory.auth === "none") {
      if (deps.organization) deps.onSignedOut?.(principalId, account.instanceId);
      return answer({ available: false, reason: "not_signed_in", connectors: [] });
    }
    if (inventory.auth === "key") return answer({ available: false, reason: "key", connectors: [] });
    if (inventory.auth === "unknown") return answer({ available: false, reason: "unknown", connectors: [] });
    return answer({ available: true, connectors: inventory.connectors });
  };
}
