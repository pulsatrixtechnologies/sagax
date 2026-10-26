// A person's own GitHub account on an organization server ("Connecter
// GitHub"). Two ways in, both per person:
//
//   - the device flow of the organization's GitHub OAuth App
//     (SAGAX_GITHUB_CLIENT_ID, or Settings > Organization): Sagax asks
//     github.com for a code, the person types it at github.com/login/device,
//     Sagax polls until GitHub hands the token over;
//   - a token they paste (a fine-grained or classic personal access token).
//
// The token lands in the person's encrypted connections file
// (server/person-connections.ts), never in config.json, never in another
// person's turn. It is used, for that person only, by: their server
// environment (gh and git read it from /workspace, see githubSandboxArgv),
// their personal GitHub MCP server (Authorization: Bearer), and the fetches
// Sagax itself makes for them (private skills, plugin marketplaces).
import type { GithubConnection } from "./person-connections.ts";

export const GITHUB_SCOPES = "repo read:org gist workflow";
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const USER_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export class GithubConnectError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** github.com and its API, or loopback stand-ins a test names. */
export function githubOrigins(env: NodeJS.ProcessEnv = process.env): { web: string; api: string } {
  const pick = (value: string | undefined, fallback: string) => {
    if (!value) return fallback;
    try {
      const url = new URL(value);
      if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return url.origin;
    } catch {
      // ignored: only a loopback stand-in may replace github.com
    }
    return fallback;
  };
  return { web: pick(env.SAGAX_GITHUB_WEB_ORIGIN, "https://github.com"), api: pick(env.SAGAX_GITHUB_API_ORIGIN, "https://api.github.com") };
}

export interface DeviceFlowStart {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

export type GithubStatus =
  | { state: "none"; deviceFlow: boolean }
  | { state: "pending"; deviceFlow: true; userCode: string; verificationUri: string; expiresAt: number }
  | { state: "connected"; deviceFlow: boolean; login: string; name?: string; scopes?: string[]; via: "device" | "token"; connectedAt: number; fineGrained?: boolean; orgAccessUrl?: string }
  | { state: "error"; deviceFlow: boolean; error: string };

interface PendingDevice {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  timer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

export interface GithubConnectOptions {
  clientId: () => string | undefined;
  /** Save (or, with undefined, forget) a person's connection. */
  save: (principalId: string, connection: GithubConnection | undefined) => void;
  /** After a connection is saved: put it where the person's tools run. */
  onConnected?: (principalId: string, connection: GithubConnection) => void;
  fetch?: typeof fetch;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** Poll interval floor in ms (tests use a small one). */
  minIntervalMs?: number;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    if (text.length > 65_536) return null;
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export class GithubConnect {
  private readonly options: GithubConnectOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingDevice>();
  private readonly errors = new Map<string, string>();

  constructor(options: GithubConnectOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private origins() {
    return githubOrigins(this.options.env ?? process.env);
  }

  deviceFlowAvailable(): boolean {
    return Boolean(this.options.clientId()?.trim());
  }

  status(principalId: string, connection: GithubConnection | undefined): GithubStatus {
    const deviceFlow = this.deviceFlowAvailable();
    const flow = this.pending.get(principalId);
    if (flow && !flow.cancelled && flow.expiresAt > this.now()) {
      return { state: "pending", deviceFlow: true, userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt };
    }
    if (connection) {
      return {
        state: "connected", deviceFlow, login: connection.login, via: connection.via, connectedAt: connection.connectedAt,
        ...(connection.name ? { name: connection.name } : {}), ...(connection.scopes ? { scopes: connection.scopes } : {}),
        // One owner only: the person's organizations stay out of reach (never the token itself).
        ...(githubTokenKind(connection.token) === "fine_grained" ? { fineGrained: true } : {}),
        // Signed in through the OAuth App: GitHub's page where the person
        // grants (or requests) its access to each of their organizations.
        ...(connection.via === "device" && this.options.clientId()?.trim()
          ? { orgAccessUrl: `${this.origins().web}/settings/connections/applications/${encodeURIComponent(this.options.clientId()!.trim())}` } : {}),
      };
    }
    const error = this.errors.get(principalId);
    return error ? { state: "error", deviceFlow, error } : { state: "none", deviceFlow };
  }

  /** Who a token belongs to (and its scopes), or a refusal. */
  async identify(token: string): Promise<{ login: string; name?: string; scopes?: string[] }> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.origins().api}/user`, {
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "Sagax", "x-github-api-version": "2022-11-28" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GithubConnectError("GitHub could not be reached from the server.", "github_unreachable", 502);
    }
    if (response.status === 401) throw new GithubConnectError("GitHub refused this token.", "token_refused", 400);
    if (!response.ok) throw new GithubConnectError(`GitHub answered ${response.status}.`, "github_error", 502);
    const body = await readJson(response);
    const login = typeof body?.login === "string" && LOGIN.test(body.login) ? body.login : null;
    if (!login) throw new GithubConnectError("GitHub did not say whose token this is.", "github_error", 502);
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : undefined;
    const scopeHeader = response.headers.get("x-oauth-scopes");
    const scopes = scopeHeader ? scopeHeader.split(",").map((scope) => scope.trim()).filter(Boolean).slice(0, 50) : undefined;
    return { login, ...(name ? { name } : {}), ...(scopes ? { scopes } : {}) };
  }

  /** Connect with a token the person pasted. */
  async connectWithToken(principalId: string, token: string): Promise<GithubConnection> {
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > 4_096 || /\s/.test(trimmed)) throw new GithubConnectError("Paste a GitHub token on one line.", "invalid_token");
    const who = await this.identify(trimmed);
    this.cancel(principalId);
    const connection: GithubConnection = { token: trimmed, ...who, via: "token", connectedAt: this.now() };
    this.options.save(principalId, connection);
    this.errors.delete(principalId);
    this.options.onConnected?.(principalId, connection);
    return connection;
  }

  /** Start the device flow: the code the person types at GitHub. */
  async startDeviceFlow(principalId: string): Promise<DeviceFlowStart> {
    const clientId = this.options.clientId()?.trim();
    if (!clientId) {
      throw new GithubConnectError("Your administrator has not set up a GitHub OAuth App for this server. Paste a GitHub token instead.", "device_flow_unavailable", 409);
    }
    this.cancel(principalId);
    this.errors.delete(principalId);
    let response: Response;
    try {
      response = await this.fetcher(`${this.origins().web}/login/device/code`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "Sagax" },
        body: new URLSearchParams({ client_id: clientId, scope: GITHUB_SCOPES }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GithubConnectError("GitHub could not be reached from the server.", "github_unreachable", 502);
    }
    const body = await readJson(response);
    const deviceCode = typeof body?.device_code === "string" ? body.device_code : "";
    const userCode = typeof body?.user_code === "string" ? body.user_code : "";
    const verificationUri = typeof body?.verification_uri === "string" ? body.verification_uri : "";
    if (!response.ok || !deviceCode || !USER_CODE.test(userCode) || !verificationUri.startsWith(`${this.origins().web}/`)) {
      const reason = typeof body?.error === "string" ? body.error : `status ${response.status}`;
      throw new GithubConnectError(reason === "device_flow_disabled"
        ? "Device flow is turned off for this server's GitHub OAuth App (GitHub > Developer settings > the app > Enable Device Flow)."
        : `GitHub refused to start the sign-in (${reason}).`, "device_flow_refused", 502);
    }
    const expiresIn = Math.min(Math.max(Number(body?.expires_in) || 900, 60), 900);
    const interval = Math.max(Number(body?.interval) || 5, 1);
    const flow: PendingDevice = { deviceCode, userCode, verificationUri, expiresAt: this.now() + expiresIn * 1000, interval, timer: null, cancelled: false };
    this.pending.set(principalId, flow);
    this.schedule(principalId, flow, clientId);
    return { userCode, verificationUri, expiresAt: flow.expiresAt, interval };
  }

  private schedule(principalId: string, flow: PendingDevice, clientId: string): void {
    const delay = Math.max(flow.interval * 1000, this.options.minIntervalMs ?? 1000);
    flow.timer = setTimeout(() => { void this.poll(principalId, flow, clientId); }, delay);
    flow.timer.unref?.();
  }

  private async poll(principalId: string, flow: PendingDevice, clientId: string): Promise<void> {
    if (flow.cancelled || this.pending.get(principalId) !== flow) return;
    if (this.now() > flow.expiresAt) {
      this.finish(principalId, flow, "The code expired. Start again.");
      return;
    }
    let body: Record<string, unknown> | null = null;
    try {
      const response = await this.fetcher(`${this.origins().web}/login/oauth/access_token`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "Sagax" },
        body: new URLSearchParams({ client_id: clientId, device_code: flow.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      body = await readJson(response);
    } catch {
      // a network blip: try again at the next interval
    }
    if (flow.cancelled || this.pending.get(principalId) !== flow) return;
    const error = typeof body?.error === "string" ? body.error : null;
    const token = typeof body?.access_token === "string" ? body.access_token : null;
    if (token) {
      try {
        const who = await this.identify(token);
        const scopes = typeof body?.scope === "string" ? body.scope.split(/[ ,]+/).filter(Boolean) : who.scopes;
        const connection: GithubConnection = { token, login: who.login, ...(who.name ? { name: who.name } : {}), ...(scopes?.length ? { scopes } : {}), via: "device", connectedAt: this.now() };
        this.options.save(principalId, connection);
        this.finish(principalId, flow, null);
        this.options.onConnected?.(principalId, connection);
      } catch (cause) {
        this.finish(principalId, flow, cause instanceof Error ? cause.message : "GitHub sign-in failed.");
      }
      return;
    }
    if (error === "access_denied") return this.finish(principalId, flow, "The sign-in was cancelled on GitHub.");
    if (error === "expired_token") return this.finish(principalId, flow, "The code expired. Start again.");
    if (error === "slow_down") flow.interval += 5;
    else if (error && error !== "authorization_pending") return this.finish(principalId, flow, `GitHub refused the sign-in (${error.slice(0, 60)}).`);
    this.schedule(principalId, flow, clientId);
  }

  private finish(principalId: string, flow: PendingDevice, error: string | null): void {
    flow.cancelled = true;
    if (flow.timer) clearTimeout(flow.timer);
    if (this.pending.get(principalId) === flow) this.pending.delete(principalId);
    if (error) this.errors.set(principalId, error);
    else this.errors.delete(principalId);
  }

  cancel(principalId: string): void {
    const flow = this.pending.get(principalId);
    if (flow) this.finish(principalId, flow, null);
  }

  disconnect(principalId: string): void {
    this.cancel(principalId);
    this.errors.delete(principalId);
    this.options.save(principalId, undefined);
  }
}

// ── where the token is used ──────────────────────────────────────────────

const GITHUB_HOSTS = new Set(["github.com", "api.github.com", "raw.githubusercontent.com", "codeload.github.com", "objects.githubusercontent.com"]);

/** A fetch that adds the person's token for GitHub's own hosts only (a
 * skill import from a private repository). Everything else goes as is. */
export function githubAuthorizedFetch(token: string | undefined, fetcher: typeof fetch = fetch): typeof fetch {
  if (!token) return fetcher;
  return (input, init) => {
    let host = "";
    try { host = new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname; } catch { /* not a URL */ }
    if (!GITHUB_HOSTS.has(host)) return fetcher(input, init);
    const headers = new Headers(init?.headers);
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return fetcher(input, { ...init, headers });
  };
}

/** Environment for a `git` Sagax runs itself (a plugin marketplace clone):
 * the token rides an extra header for github.com only, never the argv or
 * the URL, and git never prompts. */
export function githubGitEnvironment(token: string | undefined): Record<string, string> {
  const base: Record<string, string> = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", GCM_INTERACTIVE: "never" };
  if (!token) return base;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return { ...base, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
}

/** The kind of a GitHub token, from its documented prefix. A fine-grained
 * personal access token (github_pat_) reaches one resource owner only: the
 * person's own account, or one organization, never both. */
export type GithubTokenKind = "fine_grained" | "classic" | "oauth" | "app_user" | "unknown";
export function githubTokenKind(token: string | undefined): GithubTokenKind {
  if (!token) return "unknown";
  if (token.startsWith("github_pat_")) return "fine_grained";
  if (token.startsWith("ghp_")) return "classic";
  if (token.startsWith("gho_")) return "oauth";
  if (token.startsWith("ghu_")) return "app_user";
  return "unknown";
}

/** The fixed command that puts the connection where gh and git read it in
 * the person's server environment (/workspace persists): gh's hosts.yml and
 * git's credential store, both 0600. The token rides the environment
 * (SAGAX_GH_TOKEN), never the argv.
 *
 * Sagax never overwrites a sign-in the person made there themselves (gh auth
 * login, gh auth logout, an edited hosts.yml). It decides by the token, not
 * the file's bytes (gh 2.40+ rewrites a hosts.yml into its multi-account
 * layout on its first run): hosts.yml is Sagax's when it is absent or empty,
 * or when gh's github.com token in it is the token Sagax put there (this
 * connection's, the one it replaces, or the one whose SHA-256 Sagax noted in
 * .config/gh/.sagax-managed). Otherwise the person's file stays as it is,
 * only Sagax's own lines leave git's credential store (so git uses the
 * person's sign-in), and the command prints sagax-github-kept-person-login.
 * The person's own lines in git's credential store are always kept.
 *
 * `connection` null takes Sagax's connection out (`previous` is the one being
 * taken out); with a connection, `previous` is the one it replaces. */
export function githubSandboxArgv(
  connection: Pick<GithubConnection, "token" | "login"> | null,
  previous?: Pick<GithubConnection, "token" | "login"> | null,
): { argv: string[]; env: Record<string, string> } {
  const subject = connection ?? previous ?? null;
  if (subject && !LOGIN.test(subject.login)) throw new GithubConnectError("invalid GitHub login", "invalid_login");
  const env: Record<string, string> = { SAGAX_GH_MODE: connection ? "set" : "remove" };
  if (subject) Object.assign(env, { SAGAX_GH_TOKEN: subject.token, SAGAX_GH_LOGIN: subject.login });
  if (connection && previous?.token && previous.token !== connection.token) env.SAGAX_GH_PREV_TOKEN = previous.token;
  // Tokens only ever pass through variables, shell builtins (test, printf)
  // and stdin: never an argv.
  return {
    argv: ["sh", "-c", [
      "set -eu",
      "umask 077",
      "dir=\"$HOME/.config/gh\"; hosts=\"$dir/hosts.yml\"; mark=\"$dir/.sagax-managed\"; creds=\"$HOME/.git-credentials\"",
      "tok=\"${SAGAX_GH_TOKEN:-}\"; prev=\"${SAGAX_GH_PREV_TOKEN:-}\"",
      "digest() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -c1-64; }",
      "known=\"\"; if [ -f \"$mark\" ]; then known=\"$(cat \"$mark\")\"; fi",
      "sagax_token() { [ -n \"$1\" ] || return 1; [ \"$1\" = \"$tok\" ] && return 0; [ -n \"$prev\" ] && [ \"$1\" = \"$prev\" ] && return 0; [ -n \"$known\" ] && [ \"$(printf %s \"$1\" | digest)\" = \"$known\" ]; }",
      // gh's github.com token, in the legacy and the multi-account layouts.
      "file_token() { awk '/^github\\.com:/ { h = 1; next } /^[^ ]/ { h = 0 } h && /^    oauth_token:/ { sub(/^    oauth_token:[ ]*/, \"\"); print; exit }' \"$hosts\"; }",
      "filter_creds() {",
      "  [ -f \"$creds\" ] || return 0",
      "  : > \"$creds.tmp\"",
      "  while IFS= read -r line || [ -n \"$line\" ]; do",
      "    case \"$line\" in https://*:*@github.com) t=\"${line#https://*:}\"; t=\"${t%@github.com}\"; if sagax_token \"$t\"; then continue; fi ;; esac",
      "    printf '%s\\n' \"$line\" >> \"$creds.tmp\"",
      "  done < \"$creds\"",
      "  mv \"$creds.tmp\" \"$creds\"",
      "}",
      "owned=no",
      "if [ ! -e \"$hosts\" ] || ! grep -q '[^[:space:]]' \"$hosts\"; then owned=yes",
      "elif sagax_token \"$(file_token)\"; then owned=yes",
      "fi",
      "if [ \"$owned\" = no ]; then filter_creds; rm -f \"$mark\"; echo sagax-github-kept-person-login; exit 0; fi",
      "if [ \"$SAGAX_GH_MODE\" = remove ]; then rm -f \"$hosts\"; filter_creds; rm -f \"$mark\"; echo sagax-github-removed; exit 0; fi",
      "mkdir -p \"$dir\"",
      "printf 'github.com:\\n    oauth_token: %s\\n    user: %s\\n    git_protocol: https\\n' \"$tok\" \"$SAGAX_GH_LOGIN\" > \"$hosts.tmp\"",
      "mv \"$hosts.tmp\" \"$hosts\"",
      "filter_creds",
      "printf '%s' \"$tok\" | digest > \"$mark\"",
      "printf 'https://%s:%s@github.com\\n' \"$SAGAX_GH_LOGIN\" \"$tok\" >> \"$creds\"",
      "git config --global credential.https://github.com.helper store",
      "echo sagax-github-ready",
    ].join("\n")],
    env,
  };
}
