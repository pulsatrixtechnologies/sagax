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
// with an ephemeral credential store, and an API key has none, so those
// bring no ChatGPT apps; nothing here mounts them. #3353 (L10): the person's
// own Codex sign-in on ChatGPT brings them through the connector registry
// (server/connectors/providers/chatgpt-apps.ts), listed and called by the
// Codex host with no model, so `codex` answers them from the registry below.
import { execChild } from "./process/spawn-helper.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_CONNECTORS_URL } from "../shared/connector-setup.ts";
import type { TurnSpeaker } from "./engines/engine-access.ts";
import { resolveCli } from "./procs.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { ConnectorRegistry } from "./connectors/registry.ts";
import type { ConnectorAccount, ConnectorState } from "./connectors/types.ts";

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

// Which of these a turn loads (claude.ai on Claude, the Grok gateway on the
// Grok CLI) is read once per turn by server/connectors/turn-plan.ts, the only file that names those
// rules (server/connectors/one-source.guard.test.ts).

// What a turn is told about the person's connectors is the one list of
// server/connectors/list-prompt.ts (#3351), the same text on every engine.

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
  execChild(resolved.command, resolved.args, { env, cwd, timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true }, (error, stdout) => {
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
   * or stale one is read again in the background when `input` is given,
   * for a reader that never waits on the CLI. */
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
  /** #3344: the person's connector registry (server/connectors/registry.ts).
   * When given, the answer is read from it (the read lands there, so every
   * other reader and the next start know it too). */
  registry?: Pick<ConnectorRegistry, "refresh" | "account" | "accountsOf">;
  /** #1533: the person's own Claude sign-in exists, but Claude says it is
   * signed out (its refresh was refused): their engine card says Reconnect. */
  /** #2384: `instanceId` is the account the inventory was read on. */
  onSignedOut?(principalId: string, instanceId?: string): void;
}

const REGISTRY_STATUS: Readonly<Record<ConnectorState, ClaudeAiConnectorStatus>> = {
  connected: "connected",
  "needs-sign-in": "needs_auth",
  failed: "failed",
  unknown: "unknown",
};

/** The person's Claude sign-in as the registry knows it once read again
 * (#3344), in the shape this route has always answered. */
async function registryInventory(registry: Pick<ConnectorRegistry, "refresh" | "account">, principalId: string, instanceId: string, force: boolean): Promise<ClaudeAiInventory> {
  const ref = { provider: "claude-ai" as const, instanceId, slot: "primary" as const };
  await registry.refresh(principalId, ref, force);
  const known = registry.account(principalId, ref);
  if (!known || known.at === 0) return { auth: "unknown", connectors: [], at: 0 };
  return { auth: known.auth, connectors: known.connectors.map((entry) => ({ name: entry.name, status: REGISTRY_STATUS[entry.state] })), at: known.at };
}

/** #3358: one of the person's Grok sign-ins on the connector pages, as the
 * registry knows it. Never its instance id, address or email: its label,
 * its slot and what it is. */
export interface HarnessGrokAccount {
  label: string;
  slot: "primary" | "second";
  kind?: "personal" | "team";
  auth: "subscription" | "key" | "none" | "unknown";
  connectors: Array<{ id?: string; name: string; status: ClaudeAiConnectorStatus }>;
  at: number;
}

/** #3358: what the pages read from the registry beside Claude: the
 * person's Grok sign-ins (an organization server, where each person has
 * their own) and the ChatGPT apps of their Codex sign-in. */
async function registryAccounts(registry: HarnessConnectorRouteDeps["registry"], principalId: string, organization: boolean, refresh: boolean): Promise<{ grok?: { accounts: HarnessGrokAccount[] }; codex: { available: boolean; reason?: "not_supported"; connectors?: ClaudeAiConnector[] } }> {
  const notSupported = { available: false, reason: "not_supported" as const };
  if (!registry) return { codex: notSupported };
  if (refresh) {
    await Promise.all([
      organization ? registry.refresh(principalId, { provider: "grok-com" }, true) : Promise.resolve(),
      registry.refresh(principalId, { provider: "chatgpt-apps" }, true),
    ]);
  }
  const entries = (connectors: ConnectorAccount["connectors"]) => connectors.map((entry) => ({ ...(entry.id ? { id: entry.id } : {}), name: entry.name, status: REGISTRY_STATUS[entry.state] }));
  const grok = organization
    ? {
      accounts: registry.accountsOf(principalId, "grok-com").map((account): HarnessGrokAccount => ({
        label: account.label,
        slot: account.slot,
        ...(account.kind ? { kind: account.kind } : {}),
        auth: account.auth,
        connectors: account.auth === "subscription" ? entries(account.connectors) : [],
        at: account.at,
      })),
    }
    : undefined;
  const chatgpt = registry.accountsOf(principalId, "chatgpt-apps").filter((account) => account.auth === "subscription");
  const codex = chatgpt.length
    ? { available: true, connectors: chatgpt.flatMap((account) => entries(account.connectors).map(({ name, status }) => ({ name, status }))) }
    : notSupported;
  return { ...(grok ? { grok } : {}), codex };
}

function isAdminScope(auth: RequestAuth): boolean {
  if (auth.kind === "loopback" && auth.trust === "service") return false;
  return auth.scopes.includes("admin");
}

/** GET  /api/me/harness-connectors        the caller's own claude.ai connectors,
 *                                         Grok sign-ins and ChatGPT apps (#3358)
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
    const refresh = url.searchParams.get("refresh") === "1";
    // #3358: the other providers' sign-ins, read beside Claude's
    const others = registryAccounts(deps.registry, principalId, deps.organization, refresh)
      .catch(() => ({ codex: { available: false, reason: "not_supported" } }));
    const answer = async (claude: { available: boolean; reason?: ClaudeAiUnavailable; connectors: ClaudeAiConnector[] }) =>
      json(res, 200, { ...base, claude, ...(await others) });
    if (deps.restrictedByPolicy()) return answer({ available: false, reason: "managed_policy", connectors: [] });
    if (!deps.organization && principalId !== deps.localPrincipalId().trim().toLowerCase()) {
      return answer({ available: false, reason: "not_operator", connectors: [] });
    }
    const account = deps.claudeAccountFor(principalId);
    if ("unavailable" in account) return answer({ available: false, reason: account.unavailable, connectors: [] });
    const inventory = deps.registry && account.instanceId
      ? await registryInventory(deps.registry, principalId, account.instanceId, refresh)
      : await deps.inventory.read(account.key, { cli: account.cli, env: account.env }, refresh);
    if (inventory.auth === "none") {
      if (deps.organization) deps.onSignedOut?.(principalId, account.instanceId);
      return answer({ available: false, reason: "not_signed_in", connectors: [] });
    }
    if (inventory.auth === "key") return answer({ available: false, reason: "key", connectors: [] });
    if (inventory.auth === "unknown") return answer({ available: false, reason: "unknown", connectors: [] });
    return answer({ available: true, connectors: inventory.connectors });
  };
}
