import { activeLocale, t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { resultBudgetDraft, type McpMessage, type McpResultBudgetDraft, type McpResultBudgetListing } from "./McpResultBudgetField";

/** A server this computer starts (a command) or one reached at a URL -
 * the two shapes the server stores. Secrets arrive as names only. */
interface StdioMcpListing extends McpResultBudgetListing {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  enabled: boolean;
}
export interface RemoteMcpListing extends McpResultBudgetListing {
  name: string;
  type: "http" | "sse";
  url: string;
  headerKeys: string[];
  enabled: boolean;
  /** OAuth sign-in state; absent when the server has not been asked yet. */
  auth?: McpAuthState;
  authError?: string;
  /** "needed": the server offers no dynamic registration, so a client ID
   * registered with the provider must be entered before signing in. */
  authClient?: "dynamic" | "manual" | "needed";
  authIssuer?: string;
  authPending?: boolean;
  /** every saved sign-in, the default account first */
  accounts?: McpAccountListing[];
}
export interface McpAccountListing {
  /** "default", or the server's id for an account added after it */
  id: string;
  label?: string;
  auth: McpAuthState;
  authError?: string;
  authPending?: boolean;
}
export type McpAuthState = "none" | "required" | "connected" | "expired" | "error";
/** managedBy: the enrolled organisation has not approved this server, so it
 * stays configured but never reaches bots. */
export type McpServerListing = (StdioMcpListing | RemoteMcpListing) & {
  managedBy?: string;
  /** tools no bot sees (Plugins > the server > Tools) */
  disabledTools?: string[];
  /** where the server came from: absent when added by hand */
  source?: string;
  /** reads the person's GitHub account (the GitHub plugin's token
   * placeholder, server/github/github-mcp-token.ts): whether it is connected */
  github?: "connected" | "missing";
  /** Lot B: installation = shared config; person = only-me (never send header values into shared). */
  scope?: "installation" | "person";
};

/** A saved server whose name Sagax now reserves (`mcp`, `__`, `sagax-`...):
 * never mounted until it is renamed or removed (server/mcp/mcp-registry.ts
 * reservedMcpServers). */
export interface ReservedMcpListing {
  name: string;
  suggestedName?: string;
}

export function isRemoteMcpListing(server: McpServerListing): server is RemoteMcpListing {
  return "url" in server;
}

export type McpTransport = "stdio" | "remote";

export interface McpDraft extends McpResultBudgetDraft {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  type: "http" | "sse";
  url: string;
  headers: string;
}

export interface ProbeResult {
  ok: boolean;
  tools?: Array<{ name: string; description?: string }>;
  /** how many tools the server advertised, when `tools` shows only the first */
  total?: number;
  /** tools Grok registers under another name or cannot register (server/mcp/mcp-probe.ts) */
  engineNames?: { grok: { renamed: Array<{ upstream: string; registered: string; reason: string }>; unregistrable: Array<{ upstream: string; reason: string }> } };
  error?: string;
  /** `keys`: the server refused the headers it was sent (server/mcp/mcp-probe.ts);
   * `unreachable` and `timeout` may pass on a second try. */
  reason?: "keys" | "unreachable" | "timeout";
  /** the HTTP status of a refused key */
  status?: number;
}

/** Whether a failed test refused the keys of a URL server, so Fix the keys
 * can ask for just their values. */
export function refusedKeys(server: McpServerListing, result: ProbeResult | undefined): server is RemoteMcpListing {
  return Boolean(result && !result.ok && result.reason === "keys" && isRemoteMcpListing(server));
}

/** What a failed test says. A refused key names the headers to check, never
 * their values. */
export function probeFailureLabel(server: McpServerListing, result: ProbeResult): string {
  if (!refusedKeys(server, result)) return result.error ?? "";
  const reason = result.status ? `HTTP ${result.status}` : "unauthorized";
  if (!server.headerKeys.length) return t("mcp.check.keysNeeded", { reason });
  return t("mcp.check.keysRefused", { reason, names: new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(server.headerKeys) });
}

/** The header lines Fix the keys saves: each named header with the value
 * typed again, or a blank one that keeps the saved value. */
export function fixedKeysHeaders(names: readonly string[], values: Readonly<Record<string, string>>): string {
  return names.map((name) => `${name}: ${(values[name] ?? "").trim()}`).join("\n");
}

/** After a sign-in, list the server's tools once. A failure is one plain
 * line that keeps the test's own reason (a timeout, an HTTP status), which is
 * already safe to show; the card's Connect button is the retry. */
export async function signedInToolsCheck(
  name: string,
  request: (path: string, init?: RequestInit) => Promise<ProbeResult>,
  signal: AbortSignal,
): Promise<ProbeResult> {
  let tested: ProbeResult;
  try {
    tested = await request(`/api/mcp/servers/${name}/test`, { method: "POST", signal });
  } catch (cause) {
    if (signal.aborted) throw cause;
    tested = { ok: false, error: readableError(cause) };
  }
  if (tested.ok) return tested;
  // A proxy's "504 Gateway Timeout" or a browser's "Failed to fetch" has no
  // closing period; add one so the reason does not run into the next sentence.
  const reason = (tested.error ?? "").trim();
  return { ...tested, error: t("whop.testFailed", { reason: reason && !/[.!?]$/.test(reason) ? `${reason}.` : reason }) };
}

/** How long the panel waits for the browser to come back from a sign-in:
 * the server forgets the pending flow after ten minutes too. */
export const SIGN_IN_WAIT_MS = 10 * 60_000;
export const SIGN_IN_POLL_MS = 2_000;

/** The system browser in the desktop app; a new tab on the web. The tab is
 * opened blank first so the provider never gets a handle on this window. */
export async function openSignInPage(url: string): Promise<boolean> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return true;
  }
  const opened = window.open("", "_blank");
  if (!opened) return false;
  opened.opener = null;
  opened.location.replace(url);
  return true;
}

export interface ClientDraft {
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

export const EMPTY_DRAFT: McpDraft = { name: "", transport: "stdio", command: "", args: "", env: "", type: "http", url: "", headers: "", resultBudget: "" };
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export function parseMcpArguments(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseMcpEnvironment(
  value: string,
  savedKeys: readonly string[] = [],
): { ok: true; env: Record<string, string | true> } | { ok: false; error: McpMessage } {
  const saved = new Set(savedKeys);
  const env: Record<string, string | true> = {};
  for (const original of value.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) return { ok: false, error: { key: "mcp.env.useKeyValue", params: { line } } };
    const key = line.slice(0, equals).trim();
    const secret = line.slice(equals + 1);
    if (!ENV_NAME.test(key)) return { ok: false, error: { key: "mcp.env.invalidName", params: { key } } };
    if (Object.hasOwn(env, key)) return { ok: false, error: { key: "mcp.env.duplicate", params: { key } } };
    env[key] = secret === "" && saved.has(key) ? true : secret;
  }
  return { ok: true, env };
}

/** `Name: value` per line, the way headers are written everywhere. A blank
 * value beside a saved header keeps the saved value, as with env above. */
export function parseMcpHeaders(
  value: string,
  savedKeys: readonly string[] = [],
): { ok: true; headers: Record<string, string | true> } | { ok: false; error: McpMessage } {
  const saved = new Set(savedKeys);
  const headers: Record<string, string | true> = {};
  for (const original of value.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return { ok: false, error: { key: "mcp.headers.useColon", params: { line } } };
    const key = line.slice(0, colon).trim();
    const secret = line.slice(colon + 1).trim();
    if (!HEADER_NAME.test(key)) return { ok: false, error: { key: "mcp.headers.invalidName", params: { key } } };
    if (Object.hasOwn(headers, key)) return { ok: false, error: { key: "mcp.headers.duplicate", params: { key } } };
    headers[key] = secret === "" && saved.has(key) ? true : secret;
  }
  return { ok: true, headers };
}

export function probeToolsLabel(tools: ProbeResult["tools"], total?: number): string {
  if (!tools?.length) return t("mcp.probe.noTools");
  // A big server (Whop lists 425) sends its first hundred names only.
  const count = Math.max(total ?? 0, tools.length);
  const names = tools.map((tool) => tool.name).join(", ") + (count > tools.length ? ", …" : "");
  return count === 1
    ? t("mcp.probe.toolsOne", { names })
    : t("mcp.probe.toolsMany", { count, names });
}

export function draftFor(server: McpServerListing): McpDraft {
  // Values are intentionally never returned by the server. A blank value
  // beside an existing key is a write-only “keep saved value” placeholder.
  if (isRemoteMcpListing(server)) {
    return {
      ...EMPTY_DRAFT,
      name: server.name,
      transport: "remote",
      type: server.type,
      url: server.url,
      headers: server.headerKeys.map((key) => `${key}: `).join("\n"),
      resultBudget: resultBudgetDraft(server),
    };
  }
  return {
    ...EMPTY_DRAFT,
    name: server.name,
    command: server.command,
    args: server.args.join("\n"),
    env: server.envKeys.map((key) => `${key}=`).join("\n"),
    resultBudget: resultBudgetDraft(server),
  };
}
