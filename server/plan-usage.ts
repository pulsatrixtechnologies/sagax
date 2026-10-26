// Subscription allowance for the engines Sagax already signs in
// (Claude, Codex, Grok). Parsers are pure. The fetcher takes fetch and a
// credential reader so tests never touch the network or a real login file.
// Access tokens stay in the request header only, never in the JSON result.
//
// Whose sign-in is read:
//   - solo: this computer's own CLI logins (the server's HOME, an instance's
//     CLAUDE_CONFIG_DIR / CODEX_HOME / GROK_HOME), as the turns use them;
//   - organization server (Perspicax identity): the person asking, and only
//     their own subscription login in ${DATA_DIR}/principals/<id>/<engine>
//     (principal-engine-logins.ts). Never the server's own login, never the
//     organization's key, never another person's directory.
// One row per credential source: the ChatGPT plan instance reads the same
// Codex login as Codex, so it folds into the Codex row. An API key has no
// plan windows: it gets its own row only when a key is configured.
//
// Each row is in one state: windows, no-windows (API key, or a plan that
// reports none), signed-out (no login: the card offers Connect) or error
// ("Could not reach <product>: <reason>", the card offers refresh). Only a
// missing login or a refused sign-in (401) is signed-out; a network failure,
// a timeout, a 429, a 5xx or an access token waiting for its refresh is an
// error with its reason.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { InstanceConfigMap } from "./contracts.ts";
import { resolveClaudeConfigDir } from "./drivers/claude.ts";
import { codexHome } from "./drivers/codex-identity.ts";
import { harnessHome } from "./env-path.ts";

export type PlanDriver = "claude" | "codex" | "grok";

export interface PlanWindow {
  available: boolean;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: string | null;
}

export interface PlanExtra {
  label: string;
  remainingPercent: number;
  usedPercent: number;
  resetsAt: string | null;
}

/** A model- or product-scoped slice of the plan. `windows` are that slice's
 * own 5-hour, weekly, or other allowance — not a share of the account total. */
export interface PlanModelUsage {
  name: string;
  windows: PlanExtra[];
}

export interface PlanWindows {
  plan: string | null;
  fiveHour: PlanWindow;
  weekly: PlanWindow;
  extra: PlanExtra[];
  models: PlanModelUsage[];
}

/** windows: the plan answered. no-windows: an API key, or a plan that
 * reports none. signed-out: no login to read (Connect). error: the reason
 * the windows could not be read (refresh). */
export type PlanRowState = "windows" | "no-windows" | "signed-out" | "error";

export interface PlanProviderRow {
  id: string;
  name: string;
  driver: string;
  plan: string | null;
  /** `ok` and `error` stay for the phone apps, which read only them. */
  ok: boolean;
  error: string | null;
  state: PlanRowState;
  /** subscription: a plan login. api-key: a configured key (no windows). */
  access: "subscription" | "api-key";
  /** The engine instance whose Connect signs this provider in. */
  instanceId: string | null;
  /** state error: why, for the renderer's own words. */
  failure: PlanFailure | null;
  fiveHour: PlanWindow;
  weekly: PlanWindow;
  extra: PlanExtra[];
  models: PlanModelUsage[];
}

export interface PlanUsageReport {
  fetchedAt: string;
  providers: PlanProviderRow[];
}

export interface PlanAccount {
  id: string;
  name: string;
  driver: PlanDriver;
  environment: Record<string, string | undefined>;
  configDir?: string;
  /** The engine instance this row signs in through (Connect). */
  instanceId?: string;
  /** api-key: a key row, nothing is read or fetched. Default subscription. */
  access?: "subscription" | "api-key";
  /** Organization server: the person has no sign-in marker for this
   * engine, so nothing is read and the row is signed-out. */
  signedOut?: boolean;
  /** Organization server: read only this account's environment, never the
   * server's own HOME or its default keychain entry. */
  isolated?: boolean;
}

export interface PlanCredential {
  token: string | null;
  accountId: string | null;
  expired: boolean;
  /** An expired access token next to a refresh token: the CLI renews it on
   * its next turn, so the person is still signed in. */
  refreshable?: boolean;
}

export interface CredentialReader {
  read(account: PlanAccount): PlanCredential | Promise<PlanCredential>;
}

export interface PlanResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type PlanFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<PlanResponse>;

export interface PlanUsageDeps {
  fetch: PlanFetch;
  credentials: CredentialReader;
  now?: () => number;
  timeoutMs?: number;
}

export interface CredentialSource {
  readText: (path: string) => string | null;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** macOS login keychain, read-only. Tests inject this so `security` is never spawned. */
  readClaudeKeychain?: (service: string) => string | null | Promise<string | null>;
}

const PROVIDER_TIMEOUT_MS = 8_000;
const PLAN_USAGE_CACHE_MS = 45_000;
const CREDENTIAL_READ_MAX_BYTES = 1_000_000;
const KEYCHAIN_TIMEOUT_MS = 5_000;
const KEYCHAIN_MAX_BUFFER = 1_000_000;
export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_MODEL_FAMILIES = ["opus", "sonnet", "haiku"];

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const GROK_CREDITS_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const GROK_SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings";

const FIVE_HOUR_MIN_SECONDS = 3 * 3600;
const FIVE_HOUR_MAX_SECONDS = 8 * 3600;
const WEEK_MIN_SECONDS = 5 * 86400;
const WEEK_MAX_SECONDS = 9 * 86400;
const MONTH_MIN_SECONDS = 27 * 86400;
const MONTH_MAX_SECONDS = 32 * 86400;

const DRIVER_OF: Record<string, PlanDriver> = {
  claudeAgent: "claude",
  codex: "codex",
  grokAgent: "grok",
};

const PRODUCT_NAME: Record<PlanDriver, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
};

const LOGIN_DRIVER: Record<PlanDriver, "claudeAgent" | "codex" | "grokAgent"> = {
  claude: "claudeAgent",
  codex: "codex",
  grok: "grokAgent",
};

export interface PlanInstanceOptions {
  /** Whether a key is configured for this API-key instance. Without it,
   * no API-key row is listed. */
  apiKeyConfigured?: (driver: PlanDriver, instanceId: string) => boolean;
}

interface PlanInstance {
  id: string;
  driver: PlanDriver;
  displayName: string | null;
  environment: Record<string, string | undefined>;
  configDir?: string;
  apiKey: boolean;
  chatgptPlan: boolean;
}

function planInstances(instances: InstanceConfigMap): PlanInstance[] {
  const out: PlanInstance[] = [];
  for (const [id, entry] of Object.entries(instances)) {
    const driver = DRIVER_OF[entry.driver];
    if (!driver || entry.enabled === false) continue;
    const config = asRecord(entry.config);
    const configDir = typeof config?.configDir === "string" && config.configDir.trim() ? config.configDir : undefined;
    out.push({
      id,
      driver,
      displayName: entry.displayName?.trim() || null,
      environment: { ...entry.environment },
      ...(configDir ? { configDir } : {}),
      apiKey: entry.access === "api" || config?.requireApiKey === true,
      chatgptPlan: config?.authMode === "chatgpt-plan",
    });
  }
  // The engine named after its driver (claude, codex, grok) leads its
  // credential source, so a folded row keeps the product's own name.
  const rank = (entry: PlanInstance) => (entry.chatgptPlan ? 2 : entry.id === entry.driver ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Where a subscription row reads its login: rows with the same source
 * show the same plan, so they are one row. */
function credentialSource(entry: PlanInstance): string {
  const env = entry.environment;
  if (entry.driver === "claude") return `claude\u0000${entry.configDir ?? env.CLAUDE_CONFIG_DIR ?? ""}\u0000${env.HOME ?? ""}`;
  if (entry.driver === "codex") return `codex\u0000${env.CODEX_HOME ?? ""}\u0000${env.HOME ?? ""}`;
  return `grok\u0000${env.GROK_HOME ?? ""}\u0000${env.HOME ?? ""}`;
}

function apiKeyRow(entry: PlanInstance): PlanAccount {
  return {
    id: entry.id,
    name: `${PRODUCT_NAME[entry.driver]} (API key)`,
    driver: entry.driver,
    environment: {},
    instanceId: entry.id,
    access: "api-key",
  };
}

/** Solo: one row per login this computer's engines read (the default fleet
 * gives one Claude, one Codex, one Grok), plus an API-key row only for a
 * key that is configured. */
export function planAccountsFromInstances(instances: InstanceConfigMap, options: PlanInstanceOptions = {}): PlanAccount[] {
  const accounts: PlanAccount[] = [];
  const seen = new Set<string>();
  const keys: PlanAccount[] = [];
  for (const entry of planInstances(instances)) {
    if (entry.apiKey) {
      if (options.apiKeyConfigured?.(entry.driver, entry.id)) keys.push(apiKeyRow(entry));
      continue;
    }
    const source = credentialSource(entry);
    if (seen.has(source)) continue;
    seen.add(source);
    accounts.push({
      id: entry.id,
      name: entry.chatgptPlan || !entry.displayName ? PRODUCT_NAME[entry.driver] : entry.displayName,
      driver: entry.driver,
      environment: entry.environment,
      instanceId: entry.id,
      ...(entry.configDir ? { configDir: entry.configDir } : {}),
    });
  }
  return [...accounts, ...keys];
}

export interface OrgPlanOptions {
  /** The person's own login directory for a driver
   * (PrincipalEngineLogins.loginDir). */
  loginDir: (driver: "claudeAgent" | "codex" | "grokAgent") => string;
  /** Their sign-in marker is there (PrincipalEngineLogins.signedIn). */
  signedIn: (driver: "claudeAgent" | "codex" | "grokAgent") => boolean;
  /** The key that would serve this person's turns on the engine: their own
   * key in Perspicax, or the organization's. Shown as "no plan windows". */
  apiKeyConfigured?: (driver: PlanDriver, instanceId: string) => boolean;
}

/** Organization server: one row per provider, read from the asking
 * person's own login directory only. */
export function orgPlanAccounts(instances: InstanceConfigMap, options: OrgPlanOptions): PlanAccount[] {
  const accounts: PlanAccount[] = [];
  const keys: PlanAccount[] = [];
  const seen = new Set<PlanDriver>();
  for (const entry of planInstances(instances)) {
    if (entry.apiKey) {
      if (options.apiKeyConfigured?.(entry.driver, entry.id) && !keys.some((key) => key.driver === entry.driver)) keys.push(apiKeyRow(entry));
      continue;
    }
    if (seen.has(entry.driver)) continue;
    seen.add(entry.driver);
    const login = LOGIN_DRIVER[entry.driver];
    const dir = options.loginDir(login);
    const environment: Record<string, string | undefined> =
      entry.driver === "claude" ? { HOME: dir, CLAUDE_CONFIG_DIR: dir }
        : entry.driver === "codex" ? { HOME: dir, CODEX_HOME: dir }
          : { HOME: dir, GROK_HOME: join(dir, ".grok") };
    accounts.push({
      id: entry.driver,
      name: PRODUCT_NAME[entry.driver],
      driver: entry.driver,
      environment,
      instanceId: entry.id,
      isolated: true,
      ...(entry.driver === "claude" ? { configDir: dir } : {}),
      ...(options.signedIn(login) ? {} : { signedOut: true }),
    });
  }
  return [...accounts, ...keys];
}

export function parseClaudeUsage(body: unknown): PlanWindows {
  const root = claudeRoot(body);
  const extra: PlanExtra[] = [];
  const models: PlanModelUsage[] = [];
  if (root) {
    for (const [key, value] of Object.entries(root)) {
      if (key === "five_hour" || key === "seven_day") continue;
      if (!/^[a-z][a-z0-9_]{0,40}$/i.test(key)) continue;
      const window = readClaudeWindow(value);
      if (!window) continue;
      const model = claudeModelWindow(key);
      if (model) addModelWindow(models, model.name, extraLine(model.window, window));
      else extra.push(extraLine(claudeExtraLabel(key), window));
    }
  }
  sortModelWindows(models);
  return {
    plan: planLabel(root?.subscription_type ?? root?.plan ?? root?.plan_type),
    fiveHour: (root && readClaudeWindow(root.five_hour)) ?? closedWindow(),
    weekly: (root && readClaudeWindow(root.seven_day)) ?? closedWindow(),
    extra,
    models,
  };
}

export function parseCodexUsage(body: unknown): PlanWindows {
  const root = asRecord(body);
  const assigned = assignDurationWindows(durationWindows(root?.rate_limit));
  const models: PlanModelUsage[] = [];
  const extra = [...assigned.extra];
  if (root) collectCodexNamedLimits(root, models, extra);
  sortModelWindows(models);
  return { ...assigned, extra, models, plan: planLabel(root?.plan_type ?? root?.plan) };
}

export function parseGrokUsage(credits: unknown, billing?: unknown, settings?: unknown): PlanWindows {
  let fiveHour = closedWindow();
  let weekly = closedWindow();
  const extra: PlanExtra[] = [];
  const models: PlanModelUsage[] = [];
  let sawMonthly = false;
  const place = (sample: GrokSample | null) => {
    if (!sample) return;
    const window = openWindow(sample.used, sample.resetsAt);
    if (sample.slot === "fiveHour") {
      if (!fiveHour.available) fiveHour = window;
    } else if (sample.slot === "weekly") {
      if (!weekly.available) weekly = window;
    } else if (sample.slot === "monthly") {
      if (!sawMonthly) {
        sawMonthly = true;
        extra.push(extraLine("Monthly", window));
      }
    } else {
      extra.push(extraLine(sample.seconds == null ? "Credits" : durationLabel(sample.seconds), window));
    }
  };
  const creditSample = readGrokSample(credits);
  place(creditSample);
  const productSample = creditSample ?? { used: 0, slot: "other" as const, resetsAt: null, seconds: null };
  for (const model of readGrokProducts(credits, productSample)) addModelWindow(models, model.name, model.window);
  if (billing !== undefined) place(readGrokSample(billing));
  sortModelWindows(models);
  return { plan: grokPlan(settings), fiveHour, weekly, extra, models };
}

export function fileCredentialReader(source: CredentialSource): CredentialReader {
  const env = source.env ?? process.env;
  const now = source.now ?? Date.now;
  return {
    async read(account) {
      const merged: NodeJS.ProcessEnv = account.isolated ? { ...account.environment } : { ...env, ...account.environment };
      const at = now();
      if (account.driver === "claude") return readClaudeCredential(account, merged, source, at);
      if (account.driver === "codex") return readCodexCredential(merged, source.readText, at);
      return readGrokCredential(merged, source.readText, at);
    },
  };
}

export function defaultCredentialReader(env: NodeJS.ProcessEnv = process.env): CredentialReader {
  return fileCredentialReader({
    env,
    readText(path) {
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size > CREDENTIAL_READ_MAX_BYTES) return null;
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    ...(process.platform === "darwin" ? { readClaudeKeychain: readDarwinClaudeKeychain } : {}),
  });
}

export async function fetchPlanUsage(accounts: PlanAccount[], deps: PlanUsageDeps): Promise<PlanUsageReport> {
  const now = deps.now?.() ?? Date.now();
  const providers = await Promise.all(accounts.map((account) => fetchProvider(account, deps)));
  return { fetchedAt: new Date(now).toISOString(), providers };
}

// One report per credential set (on an organization server, per person).
const PLAN_USAGE_CACHE_ENTRIES = 64;
const cachedReports = new Map<string, { at: number; report: PlanUsageReport }>();

export function clearPlanUsageCache(): void {
  cachedReports.clear();
}

export async function loadPlanUsage(input: {
  accounts: PlanAccount[];
  refresh?: boolean;
  now?: number;
  fetch?: PlanFetch;
  credentials?: CredentialReader;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<PlanUsageReport> {
  const now = input.now ?? Date.now();
  const key = planUsageCacheKey(input.accounts);
  const cached = cachedReports.get(key);
  if (!input.refresh && cached && now - cached.at < PLAN_USAGE_CACHE_MS) return cached.report;
  const report = await fetchPlanUsage(input.accounts, {
    fetch: input.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    credentials: input.credentials ?? defaultCredentialReader(input.env),
    now: () => now,
    timeoutMs: input.timeoutMs,
  });
  cachedReports.delete(key);
  cachedReports.set(key, { at: now, report });
  while (cachedReports.size > PLAN_USAGE_CACHE_ENTRIES) {
    const oldest = cachedReports.keys().next().value;
    if (oldest === undefined) break;
    cachedReports.delete(oldest);
  }
  return report;
}

/** J4: a plan window that has crossed the warning line (default 80 %) or
 * is spent (100 %). */
export interface PlanUsageAlert {
  providerId: string;
  provider: string;
  window: "fiveHour" | "weekly";
  level: "warn" | "limit";
  usedPercent: number;
  resetsAt: string | null;
}

export const PLAN_ALERT_DEFAULT_PERCENT = 80;
/** Windows already announced, per audience: a window warns once (and once
 * more when it is spent) until its reset moves it to a new key. */
const announcedWindows = new Map<string, true>();
const ANNOUNCED_MAX = 512;

export function clearPlanUsageAlerts(): void {
  announcedWindows.clear();
}

/** The windows of `report` that newly crossed `threshold` for `scope` (a
 * person, or "server" solo). Each (window, reset, level) is returned once. */
export function newPlanUsageAlerts(report: PlanUsageReport, scope: string, threshold = PLAN_ALERT_DEFAULT_PERCENT): PlanUsageAlert[] {
  const line = Math.min(99, Math.max(1, Number.isFinite(threshold) ? Math.round(threshold) : PLAN_ALERT_DEFAULT_PERCENT));
  const out: PlanUsageAlert[] = [];
  for (const row of report.providers) {
    if (row.state !== "windows") continue;
    for (const window of ["fiveHour", "weekly"] as const) {
      const value = row[window];
      if (!value.available || value.usedPercent === null) continue;
      const level = value.usedPercent >= 100 ? "limit" : value.usedPercent >= line ? "warn" : null;
      if (!level) continue;
      const key = `${scope}\u0000${row.id}\u0000${window}\u0000${(value.resetsAt ?? "").slice(0, 16)}\u0000${level}`;
      if (announcedWindows.has(key)) continue;
      announcedWindows.set(key, true);
      if (announcedWindows.size > ANNOUNCED_MAX) announcedWindows.delete(announcedWindows.keys().next().value as string);
      out.push({ providerId: row.id, provider: row.name, window, level, usedPercent: value.usedPercent, resetsAt: value.resetsAt });
    }
  }
  return out;
}

/** The notice's words, English like the server's other notification titles. */
export function planUsageAlertText(alert: PlanUsageAlert): { title: string; body: string } {
  const span = alert.window === "weekly" ? "weekly" : "5-hour";
  return alert.level === "limit"
    ? { title: `${alert.provider}: ${span} usage limit reached`, body: `Your ${span} limit on ${alert.provider} is used up. Turns on it wait for the reset or continue on another engine.` }
    : { title: `${alert.provider}: ${Math.round(alert.usedPercent)}% of your ${span} limit used`, body: `You have used ${Math.round(alert.usedPercent)}% of your ${span} limit on ${alert.provider}.` };
}

function closedWindow(): PlanWindow {
  return { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
}

function openWindow(usedPercent: number, resetsAt: string | null): PlanWindow {
  const used = clampPercent(usedPercent);
  return {
    available: true,
    usedPercent: used,
    remainingPercent: clampPercent(100 - used),
    resetsAt,
  };
}

function extraLine(label: string, window: PlanWindow): PlanExtra {
  return {
    label,
    remainingPercent: window.remainingPercent ?? 0,
    usedPercent: window.usedPercent ?? 0,
    resetsAt: window.resetsAt,
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function timeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) >= 1e12 ? value : value * 1000;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return timeMs(Number(trimmed));
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoOrNull(value: unknown): string | null {
  const ms = timeMs(value);
  if (ms == null) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function planLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || /[\r\n]/.test(trimmed)) return null;
  if (/bearer\s|access_token|refresh_token|sk-ant-|eyJ[a-zA-Z0-9_-]{8,}/i.test(trimmed)) return null;
  return trimmed;
}

function secretString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 16_000 || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function missingCredential(): PlanCredential {
  return { token: null, accountId: null, expired: false };
}

function expiredCredential(refreshable = false): PlanCredential {
  return { token: null, accountId: null, expired: true, ...(refreshable ? { refreshable: true } : {}) };
}

/** The `exp` of a JWT access token (Codex), unverified: only to know
 * whether to ask with it. */
function jwtExpiryMs(token: string): number | null {
  const part = token.split(".")[1];
  if (!part || part.length > 8_000) return null;
  try {
    const payload = asRecord(JSON.parse(Buffer.from(part, "base64url").toString("utf8")));
    const exp = finiteNumber(payload?.exp);
    return exp == null ? null : exp * 1000;
  } catch {
    return null;
  }
}

export const NOT_SIGNED_IN = "Not signed in";
export const NO_PLAN_WINDOWS = "No plan windows for this provider";
export const API_KEY_NO_WINDOWS = "API key: no plan windows";

/** Why a provider's windows could not be read, in words a person can act on. */
export type PlanFailure =
  | { kind: "network"; code?: string }
  | { kind: "timeout"; seconds?: number }
  | { kind: "http"; status: number }
  | { kind: "unexpected" }
  | { kind: "renewing" }
  | { kind: "unreadable" };

export function planFailureReason(failure: PlanFailure, timeoutMs = PROVIDER_TIMEOUT_MS): string {
  switch (failure.kind) {
    case "network": return failure.code ? `network error (${failure.code})` : "network error";
    case "timeout": return `no answer within ${failure.seconds ?? Math.max(1, Math.round(timeoutMs / 1000))} s`;
    case "unexpected": return "unexpected usage response";
    case "renewing": return "the sign-in token expired and renews on the next turn; refresh after it";
    case "unreadable": return "the saved sign-in could not be read";
    case "http":
      if (failure.status === 429) return "rate limited (429), try again in a minute";
      if (failure.status === 403) return "access refused (403)";
      if (failure.status >= 500) return `service error (${failure.status})`;
      return `unexpected answer (${failure.status})`;
  }
}

/** "Could not reach Claude: <reason>". Never a secret: reasons are fixed
 * words, an HTTP status or a system error code. */
export function planErrorMessage(driver: PlanDriver, failure: PlanFailure, timeoutMs?: number): string {
  return `Could not reach ${PRODUCT_NAME[driver]}: ${planFailureReason(failure, timeoutMs)}`;
}

function claudeRoot(body: unknown): Record<string, unknown> | null {
  const root = asRecord(body);
  if (!root) return null;
  if ("five_hour" in root || "seven_day" in root) return root;
  const nested = asRecord(root.usage) ?? asRecord(root.windows);
  if (nested && ("five_hour" in nested || "seven_day" in nested)) return nested;
  return root;
}

function readClaudeWindow(value: unknown): PlanWindow | null {
  const record = asRecord(value);
  if (!record) return null;
  const utilization = finiteNumber(record.utilization);
  if (utilization == null) return null;
  return openWindow(utilization, isoOrNull(record.resets_at ?? record.resetsAt));
}

function claudeExtraLabel(key: string): string {
  const suffix = key.startsWith("seven_day_")
    ? key.slice("seven_day_".length)
    : key.replace(/^five_hour_/, "");
  return titleWords(suffix);
}

function titleWords(suffix: string): string {
  const words = suffix.split("_").filter((part) => part.length > 0);
  if (words.length === 0) return "Window";
  return words.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
}

/** Opus, Sonnet, and Haiku only. `seven_day_oauth_apps` and other windows stay extra lines. */
function claudeModelWindow(key: string): { name: string; window: string } | null {
  const weekly = key.startsWith("seven_day_");
  const fiveHour = key.startsWith("five_hour_");
  if (!weekly && !fiveHour) return null;
  const suffix = key.slice(weekly ? "seven_day_".length : "five_hour_".length);
  const lower = suffix.toLowerCase();
  const family = CLAUDE_MODEL_FAMILIES.find((name) => lower === name || lower.startsWith(`${name}_`));
  if (!family) return null;
  return { name: titleWords(suffix), window: weekly ? "Weekly" : "5-hour" };
}

function addModelWindow(models: PlanModelUsage[], name: string, line: PlanExtra): void {
  const found = models.find((model) => model.name.toLowerCase() === name.toLowerCase());
  if (found) found.windows.push(line);
  else models.push({ name, windows: [line] });
}

function sortModelWindows(models: PlanModelUsage[]): void {
  const rank = (label: string) => (label === "5-hour" ? 0 : label === "Weekly" ? 1 : 2);
  for (const model of models) model.windows.sort((a, b) => rank(a.label) - rank(b.label));
}

interface DurationWindow {
  used: number;
  seconds: number;
  resetsAt: string | null;
}

function readDurationWindow(value: unknown): DurationWindow | null {
  const record = asRecord(value);
  if (!record) return null;
  const used = finiteNumber(record.used_percent);
  let seconds = finiteNumber(record.limit_window_seconds);
  if (seconds == null) {
    const minutes = finiteNumber(record.window_minutes);
    if (minutes != null) seconds = minutes * 60;
  }
  if (used == null || seconds == null || seconds <= 0) return null;
  return { used, seconds, resetsAt: isoOrNull(record.reset_at ?? record.resetAt) };
}

/** Primary and secondary windows, or one flat window when those keys are absent. */
function durationWindows(node: unknown): DurationWindow[] {
  const record = asRecord(node);
  if (!record) return [];
  const source = asRecord(record.rate_limit) ?? record;
  const windows: DurationWindow[] = [];
  for (const key of ["primary_window", "secondary_window"]) {
    const window = readDurationWindow(source[key]);
    if (window) windows.push(window);
  }
  if (windows.length === 0) {
    const self = readDurationWindow(source);
    if (self) windows.push(self);
  }
  return windows;
}

function codexLimitName(record: Record<string, unknown>): string | null {
  return planLabel(record.limit_name) ?? planLabel(record.metered_feature) ?? planLabel(record.name);
}

function pushAssignedLines(assigned: PlanWindows, into: PlanExtra[]): void {
  if (assigned.fiveHour.available) into.push(extraLine("5-hour", assigned.fiveHour));
  if (assigned.weekly.available) into.push(extraLine("Weekly", assigned.weekly));
  into.push(...assigned.extra);
}

function collectCodexNamedLimits(root: Record<string, unknown>, models: PlanModelUsage[], extra: PlanExtra[]): void {
  const buckets: Array<{ name: string | null; node: unknown }> = [];
  if (root.code_review_rate_limit) buckets.push({ name: "Code review", node: root.code_review_rate_limit });
  const additional = root.additional_rate_limits;
  if (Array.isArray(additional)) {
    for (const item of additional) {
      const record = asRecord(item);
      buckets.push({ name: record ? codexLimitName(record) : null, node: item });
    }
  } else {
    const named = asRecord(additional);
    if (named) {
      for (const [key, value] of Object.entries(named)) buckets.push({ name: planLabel(key), node: value });
    }
  }
  for (const bucket of buckets) {
    const assigned = assignDurationWindows(durationWindows(bucket.node));
    if (!bucket.name) {
      pushAssignedLines(assigned, extra);
      continue;
    }
    const lines: PlanExtra[] = [];
    pushAssignedLines(assigned, lines);
    for (const line of lines) addModelWindow(models, bucket.name, line);
  }
}

function readGrokProducts(body: unknown, sample: GrokSample): Array<{ name: string; window: PlanExtra }> {
  const root = asRecord(body);
  if (!root) return [];
  const config = asRecord(root.config) ?? root;
  if (!Array.isArray(config.productUsage)) return [];
  const label = sample.slot === "fiveHour" ? "5-hour" : sample.slot === "weekly" ? "Weekly" : sample.slot === "monthly" ? "Monthly" : "Used";
  const rows: Array<{ name: string; window: PlanExtra }> = [];
  for (const item of config.productUsage) {
    const record = asRecord(item);
    if (!record) continue;
    const raw = typeof record.product === "string" ? record.product : typeof record.name === "string" ? record.name : "";
    const name = planLabel(raw.replace(/([a-z])([A-Z])/g, "$1 $2"));
    const used = finiteNumber(record.usagePercent ?? record.usedPercent ?? record.utilization);
    if (!name || used == null) continue;
    rows.push({ name, window: extraLine(label, openWindow(used, sample.resetsAt)) });
  }
  return rows;
}

function durationLabel(seconds: number): string {
  if (seconds >= 86400) return `${Math.max(1, Math.round(seconds / 86400))}-day`;
  if (seconds >= 3600) return `${Math.max(1, Math.round(seconds / 3600))}-hour`;
  return `${Math.max(1, Math.round(seconds / 60))}-minute`;
}

function assignDurationWindows(windows: DurationWindow[]): PlanWindows {
  let fiveHour = closedWindow();
  let weekly = closedWindow();
  const extra: PlanExtra[] = [];
  for (const window of windows) {
    const open = openWindow(window.used, window.resetsAt);
    const fiveHourSlot = window.seconds >= FIVE_HOUR_MIN_SECONDS && window.seconds <= FIVE_HOUR_MAX_SECONDS;
    const weeklySlot = window.seconds >= WEEK_MIN_SECONDS && window.seconds <= WEEK_MAX_SECONDS;
    if (fiveHourSlot && !fiveHour.available) fiveHour = open;
    else if (weeklySlot && !weekly.available) weekly = open;
    else extra.push(extraLine(durationLabel(window.seconds), open));
  }
  return { plan: null, fiveHour, weekly, extra, models: [] };
}

type GrokSlot = "fiveHour" | "weekly" | "monthly" | "other";

interface GrokSample {
  used: number;
  slot: GrokSlot;
  resetsAt: string | null;
  seconds: number | null;
}

function classifyGrok(typeValue: unknown, seconds: number | null): GrokSlot {
  const type = typeof typeValue === "string" ? typeValue.toUpperCase() : "";
  if (type.includes("WEEK")) return "weekly";
  if (type.includes("MONTH")) return "monthly";
  if (/(^|[^A-Z0-9])(5|FIVE)[^A-Z0-9]*HOUR/.test(type)) return "fiveHour";
  if (seconds == null) return "other";
  if (seconds >= FIVE_HOUR_MIN_SECONDS && seconds <= FIVE_HOUR_MAX_SECONDS) return "fiveHour";
  if (seconds >= WEEK_MIN_SECONDS && seconds <= WEEK_MAX_SECONDS) return "weekly";
  if (seconds >= MONTH_MIN_SECONDS && seconds <= MONTH_MAX_SECONDS) return "monthly";
  return "other";
}

function readGrokSample(body: unknown): GrokSample | null {
  const root = asRecord(body);
  if (!root) return null;
  const config = asRecord(root.config) ?? root;
  let used = finiteNumber(config.creditUsagePercent);
  if (used == null) {
    const cap = finiteNumber(asRecord(config.onDemandCap)?.val ?? config.onDemandCap);
    const spent = finiteNumber(asRecord(config.onDemandUsed)?.val ?? config.onDemandUsed);
    if (cap != null && spent != null && cap > 0) used = (spent / cap) * 100;
  }
  if (used == null) return null;
  const period = asRecord(config.currentPeriod);
  const type = period?.type ?? period?.period ?? config.period ?? config.interval;
  const start = period?.start ?? period?.periodStart;
  const end = period?.end ?? period?.periodEnd ?? config.billingPeriodEnd ?? root.billingPeriodEnd;
  const startMs = timeMs(start);
  const endMs = timeMs(end);
  const seconds = startMs != null && endMs != null && endMs > startMs ? (endMs - startMs) / 1000 : null;
  return { used, slot: classifyGrok(type, seconds), resetsAt: isoOrNull(end), seconds };
}

function grokPlan(settings: unknown): string | null {
  const root = asRecord(settings);
  if (!root) return null;
  const nested = asRecord(root.settings);
  return planLabel(nested?.subscription_tier_display ?? root.subscription_tier_display);
}

function planUsageCacheKey(accounts: PlanAccount[]): string {
  return accounts.map((account) => {
    const environment = Object.entries(account.environment)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => `${name}=${value}`)
      .join("\n");
    return [
      account.id, account.driver, account.name, account.configDir ?? "", environment,
      account.access ?? "subscription", account.instanceId ?? "", account.signedOut ? "out" : "", account.isolated ? "isolated" : "",
    ].join("\u0000");
  }).join("\n");
}

function claudeCredentialFromText(text: string | null, now: number): PlanCredential {
  const oauth = asRecord(asRecord(parseJson(text))?.claudeAiOauth);
  const token = secretString(oauth?.accessToken);
  if (!token) return missingCredential();
  const expiry = timeMs(oauth?.expiresAt);
  if (expiry != null && expiry <= now) return expiredCredential(Boolean(secretString(oauth?.refreshToken)));
  return { token, accountId: null, expired: false };
}

/** macOS 26 `security -w` may print the JSON secret as hex. */
export function decodeKeychainSecret(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && trimmed.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex").toString("utf8");
  }
  return trimmed;
}

function claudeKeychainServices(account: PlanAccount, env: NodeJS.ProcessEnv, resolvedDir: string): string[] {
  if (!account.configDir?.trim() && !env.CLAUDE_CONFIG_DIR?.trim()) return [CLAUDE_KEYCHAIN_SERVICE];
  let defaultDir: string | null = null;
  try {
    const withoutConfig = { ...env };
    delete withoutConfig.CLAUDE_CONFIG_DIR;
    defaultDir = resolveClaudeConfigDir(undefined, withoutConfig);
  } catch {
    defaultDir = null;
  }
  if (defaultDir != null && resolvedDir === defaultDir) return [CLAUDE_KEYCHAIN_SERVICE];
  const suffix = createHash("sha256").update(resolvedDir).digest("hex").slice(0, 8);
  return [`${CLAUDE_KEYCHAIN_SERVICE}-${suffix}`];
}

export function readDarwinClaudeKeychain(service: string): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFile(
        "security",
        ["find-generic-password", "-s", service, "-w"],
        {
          timeout: KEYCHAIN_TIMEOUT_MS,
          maxBuffer: KEYCHAIN_MAX_BUFFER,
          windowsHide: true,
          shell: false,
          encoding: "utf8",
        },
        (error, stdout) => {
          resolve(error || !stdout ? null : stdout);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

async function readClaudeCredential(
  account: PlanAccount,
  env: NodeJS.ProcessEnv,
  source: CredentialSource,
  now: number,
): Promise<PlanCredential> {
  let resolvedDir: string;
  try {
    resolvedDir = resolveClaudeConfigDir(account.configDir, env);
  } catch {
    return missingCredential();
  }
  const file = claudeCredentialFromText(source.readText(join(resolvedDir, ".credentials.json")), now);
  if (file.token || !source.readClaudeKeychain) return file;
  let sawExpired = file.expired;
  let refreshable = Boolean(file.refreshable);
  for (const service of claudeKeychainServices(account, env, resolvedDir)) {
    let raw: string | null = null;
    try {
      raw = (await source.readClaudeKeychain(service)) ?? null;
    } catch {
      raw = null;
    }
    const parsed = claudeCredentialFromText(decodeKeychainSecret(raw), now);
    if (parsed.token) return parsed;
    if (parsed.expired) sawExpired = true;
    if (parsed.refreshable) refreshable = true;
  }
  return sawExpired ? expiredCredential(refreshable) : missingCredential();
}

function readCodexCredential(
  env: NodeJS.ProcessEnv,
  readText: (path: string) => string | null,
  now: number,
): PlanCredential {
  const home = codexHome(env);
  if (!home) return missingCredential();
  const root = asRecord(parseJson(readText(join(home, "auth.json"))));
  if (!root) return missingCredential();
  const tokens = asRecord(root.tokens);
  const token = secretString(tokens?.access_token) ?? secretString(root.access_token);
  if (!token) return missingCredential();
  const expiry = timeMs(tokens?.expires_at ?? tokens?.expiresAt ?? root.expires_at ?? root.expiresAt) ?? jwtExpiryMs(token);
  if (expiry != null && expiry <= now) return expiredCredential(Boolean(secretString(tokens?.refresh_token) ?? secretString(root.refresh_token)));
  const accountId = secretString(tokens?.account_id) ?? secretString(root.account_id);
  return { token, accountId, expired: false };
}

interface GrokCandidate {
  token: string;
  expiresAt: number | null;
  refreshable: boolean;
}

function grokCandidate(record: Record<string, unknown>): GrokCandidate | null {
  const token = secretString(record.access_token) ?? secretString(record.key);
  if (!token) return null;
  return { token, expiresAt: timeMs(record.expires_at ?? record.expiresAt), refreshable: Boolean(secretString(record.refresh_token)) };
}

function readGrokCredential(
  env: NodeJS.ProcessEnv,
  readText: (path: string) => string | null,
  now: number,
): PlanCredential {
  const rootDir = env.GROK_HOME?.trim() || harnessHome("grok", env);
  const root = asRecord(parseJson(readText(join(rootDir, "auth.json"))));
  if (!root) return missingCredential();
  const direct = grokCandidate(root);
  if (direct) {
    if (direct.expiresAt != null && direct.expiresAt <= now) return expiredCredential(direct.refreshable);
    return { token: direct.token, accountId: null, expired: false };
  }
  let sawExpired = false;
  let refreshable = false;
  let best: GrokCandidate | null = null;
  for (const value of Object.values(root)) {
    const record = asRecord(value);
    if (!record) continue;
    const candidate = grokCandidate(record);
    if (!candidate) continue;
    if (candidate.expiresAt != null && candidate.expiresAt <= now) {
      sawExpired = true;
      if (candidate.refreshable) refreshable = true;
      continue;
    }
    const bestStamp = best?.expiresAt ?? Number.NEGATIVE_INFINITY;
    const stamp = candidate.expiresAt ?? Number.NEGATIVE_INFINITY;
    if (!best || stamp >= bestStamp) best = candidate;
  }
  if (best) return { token: best.token, accountId: null, expired: false };
  return sawExpired ? expiredCredential(refreshable) : missingCredential();
}

function baseRow(account: PlanAccount): Omit<PlanProviderRow, "ok" | "error" | "state" | "plan" | "failure"> {
  return {
    id: account.id,
    name: account.name,
    driver: account.driver,
    access: account.access ?? "subscription",
    instanceId: account.instanceId ?? null,
    fiveHour: closedWindow(),
    weekly: closedWindow(),
    extra: [],
    models: [],
  };
}

function errorRow(account: PlanAccount, failure: PlanFailure, timeoutMs = PROVIDER_TIMEOUT_MS): PlanProviderRow {
  const stored: PlanFailure = failure.kind === "timeout" ? { kind: "timeout", seconds: Math.max(1, Math.round(timeoutMs / 1000)) } : failure;
  return { ...baseRow(account), plan: null, ok: false, error: planErrorMessage(account.driver, stored, timeoutMs), state: "error", failure: stored };
}

function signedOutRow(account: PlanAccount): PlanProviderRow {
  return { ...baseRow(account), plan: null, ok: false, error: NOT_SIGNED_IN, state: "signed-out", failure: null };
}

function apiKeyResultRow(account: PlanAccount): PlanProviderRow {
  return { ...baseRow(account), plan: null, ok: false, error: API_KEY_NO_WINDOWS, state: "no-windows", failure: null };
}

function okRow(account: PlanAccount, windows: PlanWindows): PlanProviderRow {
  const any = windows.fiveHour.available || windows.weekly.available || windows.extra.length > 0 || windows.models.length > 0;
  return {
    ...baseRow(account),
    plan: windows.plan,
    ok: true,
    error: null,
    state: any ? "windows" : "no-windows",
    failure: null,
    fiveHour: windows.fiveHour,
    weekly: windows.weekly,
    extra: windows.extra,
    models: windows.models,
  };
}

async function fetchProvider(account: PlanAccount, deps: PlanUsageDeps): Promise<PlanProviderRow> {
  if (account.access === "api-key") return apiKeyResultRow(account);
  if (account.signedOut) return signedOutRow(account);
  let credential: PlanCredential;
  try {
    credential = await deps.credentials.read(account);
  } catch {
    return errorRow(account, { kind: "unreadable" });
  }
  if (credential.expired && credential.refreshable) {
    return errorRow(account, { kind: "renewing" });
  }
  if (credential.expired || !credential.token) return signedOutRow(account);
  try {
    if (account.driver === "claude") return await fetchClaude(account, credential.token, deps);
    if (account.driver === "codex") return await fetchCodex(account, credential.token, credential.accountId, deps);
    return await fetchGrok(account, credential.token, deps);
  } catch {
    return errorRow(account, { kind: "unexpected" });
  }
}

interface HttpResult {
  status: number;
  ok: boolean;
  body: unknown;
  /** Set when no HTTP answer came back (status 0). */
  failure?: PlanFailure;
}

function transportFailure(error: unknown): PlanFailure {
  const record = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; cause?: unknown } : null;
  if (record?.name === "TimeoutError" || record?.name === "AbortError") return { kind: "timeout" };
  const cause = record?.cause && typeof record.cause === "object" ? record.cause as { code?: unknown; name?: unknown } : null;
  if (cause?.name === "TimeoutError" || cause?.name === "ConnectTimeoutError") return { kind: "timeout" };
  const raw = typeof cause?.code === "string" ? cause.code : typeof record?.code === "string" ? record.code : "";
  const code = /^[A-Z][A-Z0-9_]{1,40}$/.test(raw) ? raw : undefined;
  return code ? { kind: "network", code } : { kind: "network" };
}

async function fetchJson(
  fetchImpl: PlanFetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpResult> {
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
    }
    let body: unknown = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return { status: response.status, ok: response.ok, body };
  } catch (error) {
    return { status: 0, ok: false, body: null, failure: transportFailure(error) };
  }
}

/** The failure behind a result that brought no usable body. */
function resultFailure(result: HttpResult): PlanFailure {
  if (result.failure) return result.failure;
  if (!result.ok) return { kind: "http", status: result.status };
  return { kind: "unexpected" };
}

/** A refused sign-in: the person signs in again (Connect). 403 is not one:
 * a scope or a plan refusal, reported as an error with its status. */
function signInRefused(status: number): boolean {
  return status === 401;
}

async function fetchClaude(account: PlanAccount, token: string, deps: PlanUsageDeps): Promise<PlanProviderRow> {
  const timeout = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const result = await fetchJson(deps.fetch, CLAUDE_USAGE_URL, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "anthropic-beta": "oauth-2025-04-20",
  }, timeout);
  if (signInRefused(result.status)) return signedOutRow(account);
  if (!result.ok || result.body === null || typeof result.body !== "object") {
    return errorRow(account, resultFailure(result), timeout);
  }
  return okRow(account, parseClaudeUsage(result.body));
}

async function fetchCodex(
  account: PlanAccount,
  token: string,
  accountId: string | null,
  deps: PlanUsageDeps,
): Promise<PlanProviderRow> {
  const timeout = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  const result = await fetchJson(deps.fetch, CODEX_USAGE_URL, headers, timeout);
  if (signInRefused(result.status)) return signedOutRow(account);
  if (!result.ok || result.body === null || typeof result.body !== "object") {
    return errorRow(account, resultFailure(result), timeout);
  }
  return okRow(account, parseCodexUsage(result.body));
}

async function fetchGrok(account: PlanAccount, token: string, deps: PlanUsageDeps): Promise<PlanProviderRow> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "X-XAI-Token-Auth": "xai-grok-cli",
  };
  const timeout = deps.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const [credits, billing, settings] = await Promise.all([
    fetchJson(deps.fetch, GROK_CREDITS_URL, headers, timeout),
    fetchJson(deps.fetch, GROK_BILLING_URL, headers, timeout),
    fetchJson(deps.fetch, GROK_SETTINGS_URL, headers, timeout),
  ]);
  if (signInRefused(credits.status) || (signInRefused(billing.status) && !credits.ok)) return signedOutRow(account);
  const creditsBody = credits.ok ? credits.body : null;
  const billingBody = billing.ok ? billing.body : null;
  if (creditsBody === null && billingBody === null) {
    // the credits answer names the failure; billing only when credits said nothing
    const primary = credits.ok ? billing : credits;
    return errorRow(account, resultFailure(primary), timeout);
  }
  const windows = parseGrokUsage(creditsBody, billingBody ?? undefined, settings.ok ? settings.body : undefined);
  return okRow(account, windows);
}
