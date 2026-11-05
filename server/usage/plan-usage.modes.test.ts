// Plan usage per mode (server/usage/plan-usage.ts): whose login each row reads,
// one row per provider, and the state of every row. Fake credentials in a
// temporary data dir and a fake fetch: no network, no real login.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGIN_MARKER, PrincipalEngineLogins } from "../engines/principal-engine-logins.ts";
import {
  API_KEY_NO_WINDOWS,
  NOT_SIGNED_IN,
  clearPlanUsageCache,
  fetchPlanUsage,
  fileCredentialReader,
  loadPlanUsage,
  orgPlanAccounts,
  planAccountsFromInstances,
  planErrorMessage,
  type PlanAccount,
  type PlanFetch,
  type PlanResponse,
} from "./plan-usage.ts";
import type { InstanceConfigMap } from "../contracts.ts";

/** The host a faked request goes to, compared whole (never a substring of the URL). */
const hostOf = (url: string) => new URL(url).hostname;

const NOW = 1_800_000_000_000;
const ALICE = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const SERVER_TOKEN = "server-own-login-token";

// The default fleet's plan engines, as config.ts instanceConfigs lists them.
const FLEET: InstanceConfigMap = {
  grok: { driver: "grokAgent" },
  claude: { driver: "claudeAgent" },
  codex: { driver: "codex" },
  chatgpt: { driver: "codex", displayName: "ChatGPT plan", config: { authMode: "chatgpt-plan" } },
  claudeApi: { driver: "claudeAgent", displayName: "Claude (API key)", access: "api", config: { requireApiKey: true } },
  cursor: { driver: "cursorAgent" },
};

let root = "";
let serverHome = "";

function json(body: unknown, status = 200): PlanResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
}

const CLAUDE_BODY = { five_hour: { utilization: 20, resets_at: "2027-01-15T12:00:00.000Z" }, seven_day: { utilization: 50, resets_at: "2027-01-20T00:00:00.000Z" }, subscription_type: "max" };
const CODEX_BODY = {
  plan_type: "pro",
  rate_limit: {
    primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: 1_800_000_000 },
    secondary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 1_800_000_000 },
  },
};
const GROK_CREDITS = { config: { creditUsagePercent: 40, currentPeriod: { type: "WEEK", end: "2027-01-20T00:00:00.000Z" } } };

/** A fake provider: every URL answers with its own body, or `answer`. */
function fakeFetch(answer?: (url: string) => PlanResponse | Promise<PlanResponse>) {
  return vi.fn<PlanFetch>(async (url) => {
    if (answer) return answer(url);
    if (hostOf(url) === "api.anthropic.com") return json(CLAUDE_BODY);
    if (hostOf(url) === "chatgpt.com") return json(CODEX_BODY);
    if (url.includes("billing?format=credits")) return json(GROK_CREDITS);
    return json({}, 404);
  });
}

function readText(path: string): string | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

/** The server's own CLI logins, in its HOME: never read on an organization server. */
function writeServerLogins(): void {
  mkdirSync(join(serverHome, ".claude"), { recursive: true });
  writeFileSync(join(serverHome, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: SERVER_TOKEN, expiresAt: NOW + 3_600_000 } }));
  mkdirSync(join(serverHome, ".codex"), { recursive: true });
  writeFileSync(join(serverHome, ".codex", "auth.json"), JSON.stringify({ tokens: { access_token: SERVER_TOKEN, account_id: "server-acct" } }));
  mkdirSync(join(serverHome, ".grok"), { recursive: true });
  writeFileSync(join(serverHome, ".grok", "auth.json"), JSON.stringify({ access_token: SERVER_TOKEN }));
}

function logins(): PrincipalEngineLogins {
  return new PrincipalEngineLogins({ dataDir: root, instance: () => null, now: () => NOW });
}

/** A person's own subscription sign-in, where the login flow leaves it. */
function signIn(person: string, driver: "claudeAgent" | "codex" | "grokAgent", credential: Record<string, unknown> | null, marker = true): void {
  const dir = logins().loginDir(person, driver);
  mkdirSync(dir, { recursive: true });
  if (marker) writeFileSync(join(dir, LOGIN_MARKER), JSON.stringify({ at: NOW }));
  if (!credential) return;
  if (driver === "claudeAgent") writeFileSync(join(dir, ".credentials.json"), JSON.stringify(credential));
  else if (driver === "codex") writeFileSync(join(dir, "auth.json"), JSON.stringify(credential));
  else {
    mkdirSync(join(dir, ".grok"), { recursive: true });
    writeFileSync(join(dir, ".grok", "auth.json"), JSON.stringify(credential));
  }
}

function orgAccounts(person: string, keys: Partial<Record<string, boolean>> = {}): PlanAccount[] {
  const store = logins();
  return orgPlanAccounts(FLEET, {
    loginDir: (driver) => store.loginDir(person, driver),
    signedIn: (driver) => store.signedIn(person, driver),
    apiKeyConfigured: (_driver, instanceId) => keys[instanceId] === true,
  });
}

function reader() {
  // The server process's own environment: its HOME holds the server's logins.
  return fileCredentialReader({ now: () => NOW, env: { HOME: serverHome, USERPROFILE: serverHome, CODEX_HOME: join(serverHome, ".codex") }, readText });
}

beforeEach(() => {
  clearPlanUsageCache();
  root = mkdtempSync(join(tmpdir(), "sagax-plan-usage-"));
  serverHome = join(root, "server-home");
  mkdirSync(serverHome, { recursive: true });
  writeServerLogins();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("one row per provider", () => {
  it("solo: Codex and the ChatGPT plan are one row, the API-key row only with a key", () => {
    const without = planAccountsFromInstances(FLEET);
    expect(without.map((row) => [row.id, row.name, row.driver, row.access ?? "subscription"])).toEqual([
      ["grok", "Grok", "grok", "subscription"],
      ["claude", "Claude", "claude", "subscription"],
      ["codex", "Codex", "codex", "subscription"],
    ]);
    const withKey = planAccountsFromInstances(FLEET, { apiKeyConfigured: (driver, id) => driver === "claude" && id === "claudeApi" });
    expect(withKey.map((row) => [row.id, row.name, row.access ?? "subscription"])).toEqual([
      ["grok", "Grok", "subscription"],
      ["claude", "Claude", "subscription"],
      ["codex", "Codex", "subscription"],
      ["claudeApi", "Claude (API key)", "api-key"],
    ]);
  });

  it("solo: two logins of one provider stay two rows; a disabled engine is not listed", () => {
    const rows = planAccountsFromInstances({
      claude: { driver: "claudeAgent" },
      work: { driver: "claudeAgent", displayName: "Work Claude", config: { configDir: "/tmp/work-claude" } },
      grok: { driver: "grokAgent", enabled: false },
    });
    expect(rows.map((row) => [row.id, row.name])).toEqual([["claude", "Claude"], ["work", "Work Claude"]]);
  });

  it("organization: one row per provider in the person's own directory, isolated from the server's HOME", () => {
    signIn(ALICE, "claudeAgent", null);
    const rows = orgAccounts(ALICE);
    expect(rows.map((row) => [row.id, row.driver, row.instanceId, Boolean(row.signedOut), row.isolated])).toEqual([
      ["grok", "grok", "grok", true, true],
      ["claude", "claude", "claude", false, true],
      ["codex", "codex", "codex", true, true],
    ]);
    const dir = logins().loginDir(ALICE, "claudeAgent");
    expect(rows[1]).toMatchObject({ configDir: dir, environment: { CLAUDE_CONFIG_DIR: dir, HOME: dir } });
    expect(rows[2]?.environment.CODEX_HOME).toBe(logins().loginDir(ALICE, "codex"));
    expect(rows[0]?.environment.GROK_HOME).toBe(join(logins().loginDir(ALICE, "grokAgent"), ".grok"));
    expect(JSON.stringify(rows)).not.toContain(serverHome);
  });
});

describe("organization server: the person's own subscription", () => {
  it("windows for each provider, read with the person's token, never the server's", async () => {
    signIn(ALICE, "claudeAgent", { claudeAiOauth: { accessToken: "alice-claude", expiresAt: NOW + 3_600_000, refreshToken: "r" } });
    signIn(ALICE, "codex", { tokens: { access_token: "alice-codex", refresh_token: "r", account_id: "alice-acct" } });
    signIn(ALICE, "grokAgent", { access_token: "alice-grok", expires_at: NOW + 3_600_000 });
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(orgAccounts(ALICE), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers.map((row) => [row.id, row.state, row.plan, row.ok])).toEqual([
      ["grok", "windows", null, true],
      ["claude", "windows", "max", true],
      ["codex", "windows", "pro", true],
    ]);
    const tokens = fetchImpl.mock.calls.map((call) => call[1].headers.Authorization);
    expect(tokens).toContain("Bearer alice-claude");
    expect(tokens).toContain("Bearer alice-codex");
    expect(tokens).toContain("Bearer alice-grok");
    expect(tokens.join(" ")).not.toContain(SERVER_TOKEN);
    expect(JSON.stringify(report)).not.toMatch(/alice-(claude|codex|grok)/);
  });

  it("not signed in: no marker, nothing read or fetched, even with the server's own logins on disk", async () => {
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(orgAccounts(ALICE), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers.map((row) => [row.id, row.state, row.error, row.instanceId])).toEqual([
      ["grok", "signed-out", NOT_SIGNED_IN, "grok"],
      ["claude", "signed-out", NOT_SIGNED_IN, "claude"],
      ["codex", "signed-out", NOT_SIGNED_IN, "codex"],
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a marker without a login file is signed out, not the server's login", async () => {
    signIn(ALICE, "claudeAgent", null);
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(orgAccounts(ALICE).filter((row) => row.driver === "claude"), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers[0]).toMatchObject({ state: "signed-out", ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never another person's login", async () => {
    signIn(BOB, "claudeAgent", { claudeAiOauth: { accessToken: "bob-claude", expiresAt: NOW + 3_600_000 } });
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(orgAccounts(ALICE), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers.every((row) => row.state === "signed-out")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    const bob = await fetchPlanUsage(orgAccounts(BOB), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(bob.providers.find((row) => row.id === "claude")?.state).toBe("windows");
    expect(fetchImpl.mock.calls[0]?.[1].headers.Authorization).toBe("Bearer bob-claude");
  });

  it("an expired access token next to a refresh token is an error that renews, not a sign-in", async () => {
    signIn(ALICE, "claudeAgent", { claudeAiOauth: { accessToken: "alice-claude", expiresAt: NOW - 60_000, refreshToken: "r" } });
    const expiredJwt = `h.${Buffer.from(JSON.stringify({ exp: NOW / 1000 - 60 })).toString("base64url")}.s`;
    signIn(ALICE, "codex", { tokens: { access_token: expiredJwt, refresh_token: "r" } });
    signIn(ALICE, "grokAgent", { access_token: "alice-grok", expires_at: NOW - 60_000 });
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(orgAccounts(ALICE), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers.map((row) => [row.id, row.state, row.failure?.kind ?? null])).toEqual([
      ["grok", "signed-out", null],
      ["claude", "error", "renewing"],
      ["codex", "error", "renewing"],
    ]);
    expect(report.providers[1]?.error).toBe("Could not reach Claude: the sign-in token expired and renews on the next turn; refresh after it");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the API-key row: only with a key, no plan windows, nothing fetched with the key", async () => {
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(orgAccounts(ALICE, { claudeApi: true }), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers.at(-1)).toMatchObject({ id: "claudeApi", name: "Claude (API key)", access: "api-key", state: "no-windows", error: API_KEY_NO_WINDOWS });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(orgAccounts(ALICE).some((row) => row.access === "api-key")).toBe(false);
  });

  it("each person has their own cached report", async () => {
    signIn(ALICE, "claudeAgent", { claudeAiOauth: { accessToken: "alice-claude", expiresAt: NOW + 3_600_000 } });
    signIn(BOB, "claudeAgent", { claudeAiOauth: { accessToken: "bob-claude", expiresAt: NOW + 3_600_000 } });
    const fetchImpl = fakeFetch();
    await loadPlanUsage({ accounts: orgAccounts(ALICE), now: NOW, fetch: fetchImpl, credentials: reader() });
    await loadPlanUsage({ accounts: orgAccounts(BOB), now: NOW + 1_000, fetch: fetchImpl, credentials: reader() });
    await loadPlanUsage({ accounts: orgAccounts(ALICE), now: NOW + 2_000, fetch: fetchImpl, credentials: reader() });
    expect(fetchImpl.mock.calls.map((call) => call[1].headers.Authorization)).toEqual(["Bearer alice-claude", "Bearer bob-claude"]);
  });
});

describe("solo: this computer's own logins", () => {
  it("reads the server's HOME as before and folds the ChatGPT plan into Codex", async () => {
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(planAccountsFromInstances(FLEET), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers.map((row) => [row.id, row.state])).toEqual([["grok", "windows"], ["claude", "windows"], ["codex", "windows"]]);
    expect(fetchImpl.mock.calls.every((call) => call[1].headers.Authorization === `Bearer ${SERVER_TOKEN}`)).toBe(true);
  });

  it("signed out when this computer has no login", async () => {
    rmSync(serverHome, { recursive: true, force: true });
    const fetchImpl = fakeFetch();
    const report = await fetchPlanUsage(planAccountsFromInstances(FLEET), { fetch: fetchImpl, credentials: reader(), now: () => NOW });
    expect(report.providers.map((row) => row.state)).toEqual(["signed-out", "signed-out", "signed-out"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("error mapping: only a missing or refused login is a sign-in", () => {
  const claudeOnly = () => planAccountsFromInstances({ claude: { driver: "claudeAgent" } });
  const run = async (answer: (url: string) => PlanResponse | Promise<PlanResponse>) => {
    clearPlanUsageCache();
    const report = await fetchPlanUsage(claudeOnly(), { fetch: fakeFetch(answer), credentials: reader(), now: () => NOW, timeoutMs: 8_000 });
    return report.providers[0]!;
  };

  it.each([
    ["a network failure", () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }, "error", "Could not reach Claude: network error (ECONNREFUSED)"],
    ["a timeout", () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }, "error", "Could not reach Claude: no answer within 8 s"],
    ["a 429", () => json({ error: "rate" }, 429), "error", "Could not reach Claude: rate limited (429), try again in a minute"],
    ["a 500", () => json("down", 503), "error", "Could not reach Claude: service error (503)"],
    ["a 403", () => json({ error: "scope" }, 403), "error", "Could not reach Claude: access refused (403)"],
    ["a 404", () => json({}, 404), "error", "Could not reach Claude: unexpected answer (404)"],
    ["a body that is not JSON", () => json("<html>", 200), "error", "Could not reach Claude: unexpected usage response"],
    ["a 401", () => json({ error: "invalid" }, 401), "signed-out", NOT_SIGNED_IN],
  ] as const)("%s", async (_name, answer, state, error) => {
    const row = await run(answer);
    expect(row).toMatchObject({ state, error, ok: false });
    expect(JSON.stringify(row)).not.toContain(SERVER_TOKEN);
  });

  it("a plan that answers without any window has no plan windows", async () => {
    const row = await run(() => json({ subscription_type: "free" }));
    expect(row).toMatchObject({ state: "no-windows", ok: true, plan: "free", error: null });
  });

  it("the reason names the system error code or the HTTP status", () => {
    expect(planErrorMessage("grok", { kind: "network", code: "ECONNRESET" })).toBe("Could not reach Grok: network error (ECONNRESET)");
    expect(planErrorMessage("codex", { kind: "http", status: 502 })).toBe("Could not reach Codex: service error (502)");
  });

  it("Grok: a 401 on credits is a sign-in, a 5xx is an error", async () => {
    const grok = planAccountsFromInstances({ grok: { driver: "grokAgent" } });
    const refused = await fetchPlanUsage(grok, { fetch: fakeFetch(() => json({}, 401)), credentials: reader(), now: () => NOW });
    expect(refused.providers[0]?.state).toBe("signed-out");
    const down = await fetchPlanUsage(grok, { fetch: fakeFetch(() => json({}, 502)), credentials: reader(), now: () => NOW });
    expect(down.providers[0]).toMatchObject({ state: "error", error: "Could not reach Grok: service error (502)" });
  });
});
