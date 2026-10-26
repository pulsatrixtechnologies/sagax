// Personal runs' subscription tokens (Perspicax #384): reading the person's
// own sign-in (access token only), and the depositor's rules: only live
// personal runs of that person, renewal before expiry, a clear status when
// they have no sign-in, never a refresh token.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PerspicaxRun } from "../../shared/cloud-agents.ts";
import { claudeAccessFrom, codexAccessFrom, jwtExpiry, readSubscriptionAccess, type SubscriptionAccess } from "./subscription-access.ts";
import { MAX_DECLARED_MS, SubscriptionDepositor, type DepositorDeps } from "./subscription-depositor.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const jwt = (exp: number) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.c2ln${"x".repeat(20)}`;

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

describe("reading a person's subscription access", () => {
  it("takes Claude's access token and expiry, never the refresh token", () => {
    const access = claudeAccessFrom(JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-${"a".repeat(30)}`, refreshToken: `sk-ant-ort01-${"r".repeat(30)}`, expiresAt: NOW + 3_600_000 } }));
    expect(access).toEqual({ provider: "anthropic", accessToken: `sk-ant-oat01-${"a".repeat(30)}`, expiresAt: NOW + 3_600_000 });
    expect(JSON.stringify(access)).not.toContain("ort01");
    expect(claudeAccessFrom("{}")).toBeNull();
    expect(claudeAccessFrom("not json")).toBeNull();
  });

  it("takes Codex's ChatGPT access token, its JWT expiry and account, and ignores an API key", () => {
    const token = jwt(Math.floor((NOW + 7_200_000) / 1000));
    const access = codexAccessFrom(JSON.stringify({ OPENAI_API_KEY: null, tokens: { access_token: token, refresh_token: "rt_secret_value_123456", account_id: "acct_1" } }));
    expect(access).toEqual({ provider: "openai", accessToken: token, expiresAt: NOW + 7_200_000, accountId: "acct_1" });
    expect(JSON.stringify(access)).not.toContain("rt_secret");
    expect(codexAccessFrom(JSON.stringify({ OPENAI_API_KEY: "sk-proj-abcdefghijklmnopqrstuvwxyz" }))).toBeNull();
    expect(jwtExpiry("a.b")).toBeNull();
  });

  it("reads the person's own login directory, and on macOS Claude's keychain item for it", async () => {
    dir = mkdtempSync(join(tmpdir(), "sagax-subaccess-"));
    mkdirSync(join(dir, "claude"));
    writeFileSync(join(dir, "claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-${"b".repeat(30)}`, expiresAt: NOW } }));
    expect((await readSubscriptionAccess("claude-code", join(dir, "claude"), null))?.accessToken).toBe(`sk-ant-oat01-${"b".repeat(30)}`);
    expect(await readSubscriptionAccess("codex", join(dir, "codex"), null)).toBeNull();
    const services: string[] = [];
    const keychain = async (service: string) => { services.push(service); return JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-${"k".repeat(30)}`, expiresAt: NOW } }); };
    expect((await readSubscriptionAccess("claude-code", join(dir, "elsewhere"), keychain))?.accessToken).toBe(`sk-ant-oat01-${"k".repeat(30)}`);
    expect(services[0]).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/);
  });
});

const run = (over: Partial<PerspicaxRun>): PerspicaxRun => ({
  id: "run_1", env_id: "env_1", repo: "demo/web-app", base_branch: "main", branch: "px/x", title: "x", prompt: "x",
  engine: "claude-code", model: "", token_source: "personnel", origin: "sagax", requested_by: "user_alice", runs_as: "user_alice",
  state: "running", pr: {}, stats: {}, error: "", unread: false, created_at: "", updated_at: "", ...over,
});

function depositor(runs: PerspicaxRun[], options: { signedIn?: boolean; vaultKey?: boolean; access?: SubscriptionAccess | null; renewed?: SubscriptionAccess | null } = {}) {
  let now = NOW;
  let access = options.access === undefined ? { provider: "anthropic" as const, accessToken: `sk-ant-oat01-${"a".repeat(30)}`, expiresAt: NOW + 8 * 3_600_000 } : options.access;
  const deposit = vi.fn<DepositorDeps["deposit"]>(async () => ({ ok: true }));
  const renew = vi.fn(async () => { if (options.renewed !== undefined) access = options.renewed; });
  const d = new SubscriptionDepositor({
    people: () => ["pr_alice"],
    subjectOf: () => "user_alice",
    subjectToken: async () => "sign-in-token",
    runs: async () => runs,
    signedIn: () => options.signedIn !== false,
    read: async () => access,
    vaultKey: () => options.vaultKey === true,
    renew,
    deposit,
    now: () => now,
  });
  return { d, deposit, renew, advance: (ms: number) => { now += ms; }, setAccess: (next: SubscriptionAccess) => { access = next; } };
}

describe("SubscriptionDepositor", () => {
  it("hands over the token of a live personal run once, with a declared expiry", async () => {
    const { d, deposit } = depositor([run({})]);
    await d.sweep();
    await d.sweep();
    expect(deposit).toHaveBeenCalledTimes(1);
    const [signIn, runId, body] = deposit.mock.calls[0]!;
    expect(signIn).toBe("sign-in-token");
    expect(runId).toBe("run_1");
    expect(body).toEqual({ provider: "anthropic", access_token: `sk-ant-oat01-${"a".repeat(30)}`, expires_at: new Date(NOW + 8 * 3_600_000).toISOString() });
    expect(d.status("run_1")).toMatchObject({ state: "ok", engine: "claude-code" });
  });

  it("leaves queued, ended, organization-key and other people's runs alone", async () => {
    const { d, deposit } = depositor([
      run({ id: "run_q", state: "queued" }),
      run({ id: "run_f", state: "finished" }),
      run({ id: "run_o", token_source: "org" }),
      run({ id: "run_b", requested_by: "user_bob", runs_as: "user_bob" }),
    ]);
    await d.sweep();
    expect(deposit).not.toHaveBeenCalled();
  });

  it("says why when the person has no sign-in for the run's engine", async () => {
    const { d, deposit } = depositor([run({ engine: "codex" })], { signedIn: false });
    await d.sweep();
    expect(deposit).not.toHaveBeenCalled();
    expect(d.status("run_1")).toMatchObject({ state: "missing", engine: "codex" });
    expect(d.ready("pr_alice", "codex")).toMatchObject({ ok: false, message: expect.stringContaining("ChatGPT") });
  });

  it("lets a run go on a key the person keeps in Perspicax, without a sign-in here", async () => {
    const { d, deposit } = depositor([run({})], { signedIn: false, vaultKey: true });
    expect(d.ready("pr_alice", "claude-code")).toEqual({ ok: true });
    await d.sweep();
    expect(deposit).not.toHaveBeenCalled();
    expect(d.status("run_1")).toBeUndefined();
  });

  it("shows a run's status to the person it belongs to only", async () => {
    const { d } = depositor([run({})]);
    await d.sweep();
    expect(d.status("run_1", "pr_alice")).toMatchObject({ state: "ok" });
    expect(d.status("run_1", "pr_bob")).toBeUndefined();
  });

  it("handles one person at a time, and waits before running the CLI again after a renewal that gave nothing", async () => {
    const stale = { provider: "anthropic" as const, accessToken: `sk-ant-oat01-${"s".repeat(30)}`, expiresAt: NOW + 5 * 60_000 };
    const { d, renew, advance } = depositor([run({ id: "run_1" }), run({ id: "run_2" })], { access: stale, renewed: stale });
    await Promise.all([d.person("pr_alice"), d.person("pr_alice"), d.sweep()]);
    expect(renew).toHaveBeenCalledTimes(1);
    advance(60_000);
    await d.sweep();
    expect(renew).toHaveBeenCalledTimes(1);
    advance(5 * 60_000);
    await d.sweep();
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("renews through the CLI before expiry and hands over the new token", async () => {
    const fresh = { provider: "anthropic" as const, accessToken: `sk-ant-oat01-${"n".repeat(30)}`, expiresAt: NOW + 9 * 3_600_000 };
    const { d, deposit, renew } = depositor([run({})], { access: { provider: "anthropic", accessToken: `sk-ant-oat01-${"o".repeat(30)}`, expiresAt: NOW + 5 * 60_000 }, renewed: fresh });
    await d.sweep();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(deposit.mock.calls[0]![2].access_token).toBe(fresh.accessToken);
  });

  it("hands over again when the token changed or nears its declared end", async () => {
    const { d, deposit, advance, setAccess } = depositor([run({})]);
    await d.sweep();
    setAccess({ provider: "anthropic", accessToken: `sk-ant-oat01-${"c".repeat(30)}`, expiresAt: NOW + 10 * 3_600_000 });
    await d.sweep();
    expect(deposit).toHaveBeenCalledTimes(2);
    advance(9 * 3_600_000 + 50 * 60_000);
    await d.sweep();
    expect(deposit.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("never declares more than 23 h, and a short life when the file gives none", async () => {
    const { d, deposit } = depositor([run({})], { access: { provider: "openai", accessToken: jwt(0).replace(/\.c2ln.*/, ".c2ln" + "y".repeat(20)), expiresAt: NOW + 72 * 3_600_000, accountId: "acct_1" } });
    await d.sweep();
    const body = deposit.mock.calls[0]![2];
    expect(Date.parse(body.expires_at) - NOW).toBe(MAX_DECLARED_MS);
    expect(body.account_id).toBe("acct_1");
  });

  it("marks an expired sign-in that the CLI could not renew", async () => {
    const { d, deposit } = depositor([run({})], { access: { provider: "anthropic", accessToken: `sk-ant-oat01-${"e".repeat(30)}`, expiresAt: NOW - 1 }, renewed: null });
    await d.sweep();
    expect(deposit).not.toHaveBeenCalled();
    expect(d.status("run_1")).toMatchObject({ state: "expired" });
  });

  it("shows Perspicax's refusal", async () => {
    const { d, deposit } = depositor([run({})]);
    deposit.mockResolvedValueOnce({ ok: false, error: "forbidden", status: 403, message: "personal credentials are turned off" });
    await d.sweep();
    expect(d.status("run_1")).toEqual({ state: "refused", engine: "claude-code" });
  });
});

describe("renewing through the engine CLI", () => {
  it("asks Codex's app-server for an account read with a refresh, in the person's CODEX_HOME", async () => {
    const { chmodSync, readFileSync } = await import("node:fs");
    const { renewWithCli } = await import("./subscription-access.ts");
    dir = mkdtempSync(join(tmpdir(), "sagax-renew-"));
    const cli = join(dir, "fake-codex");
    writeFileSync(cli, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs'); const path = require('node:path');",
      "let buf = '';",
      "process.stdin.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1);",
      "  const m = JSON.parse(line);",
      "  if (m.id === 1) process.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\\n');",
      "  if (m.id === 2) { fs.writeFileSync(path.join(process.env.CODEX_HOME, 'seen.json'), JSON.stringify(m.params)); process.stdout.write(JSON.stringify({ id: 2, result: { account: null } }) + '\\n'); }",
      "} });",
    ].join("\n"));
    chmodSync(cli, 0o755);
    const home = join(dir, "codex");
    mkdirSync(home);
    await renewWithCli({ engine: "codex", cli, loginDir: home, environment: {}, timeoutMs: 10_000 });
    expect(JSON.parse(readFileSync(join(home, "seen.json"), "utf8"))).toEqual({ refreshToken: true });
  });
});
