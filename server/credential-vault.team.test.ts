import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { botVaultPrincipal, vaultHandle } from "../shared/credential-vault.ts";
import { CredentialVault, fillResolverFor, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";

const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };
const OTHER: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 9) };
const FAKE_PASSWORD = "fake-TeamVault-Pa55-for-tests";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function vault(dir = mkdtempSync(join(tmpdir(), "sagax-team-vault-")), key: VaultKeySource = KEY) {
  dirs.push(dir);
  return { dir, store: new CredentialVault(dir, () => key, () => 2_000_000) };
}

describe("team bot vault", () => {
  it("seals shared logins under bots/<id>/ and never writes a value in clear", () => {
    const { dir, store } = vault();
    const item = store.createForTeamBot("payroll", {
      kind: "login",
      name: "Payroll portal",
      username: "bot@example.test",
      password: FAKE_PASSWORD,
      domains: ["payroll.example.test"],
    });
    expect(item.grants ?? []).toEqual([]);
    const raw = readFileSync(join(dir, "bots", "payroll", "credential-vault.enc"), "utf8");
    expect(raw).not.toContain(FAKE_PASSWORD);
    expect(raw).not.toContain("Payroll portal");
    expect(JSON.stringify(item)).not.toContain(FAKE_PASSWORD);
  });

  it("isolates one team bot vault from another and from a person vault", async () => {
    const { dir, store } = vault();
    const shared = store.createForTeamBot("payroll", {
      kind: "login", name: "Shared", username: "shared@example.test", password: FAKE_PASSWORD, domains: ["payroll.example.test"],
    });
    store.create(LOCAL_VAULT_PRINCIPAL, {
      kind: "login", name: "Personal", username: "me@example.test", password: "fake-Personal-Pa55", domains: ["mail.example.test"],
    });
    expect(store.list(botVaultPrincipal("payroll")).map((row) => row.id)).toEqual([shared.id]);
    expect(store.list(botVaultPrincipal("hr"))).toHaveLength(0);
    expect(store.list(LOCAL_VAULT_PRINCIPAL)).toHaveLength(1);

    mkdirSync(join(dir, "bots", "hr"), { recursive: true });
    copyFileSync(join(dir, "bots", "payroll", "credential-vault.enc"), join(dir, "bots", "hr", "credential-vault.enc"));
    const { store: fresh } = vault(dir);
    expect(fresh.list(botVaultPrincipal("payroll"))).toHaveLength(1);
    expect(() => fresh.list(botVaultPrincipal("hr"))).toThrow(/could not be decrypted/);
  });

  it("lets the team bot fill by handle; another bot is refused", async () => {
    const { store } = vault();
    const item = store.createForTeamBot("payroll", {
      kind: "login", name: "Shared", username: "shared@example.test", password: FAKE_PASSWORD, domains: ["payroll.example.test"],
    });
    const page = "https://payroll.example.test/login";
    const fill = (botId: string) =>
      store.resolveForFill(botVaultPrincipal("payroll"), {
        handle: vaultHandle(item.id), field: "password", botId, threadId: "t1", pageUrl: page,
      });
    // no card answered yet: a team login is never filled on creation alone
    await expect(fill("payroll")).resolves.toMatchObject({ ok: false, code: "not_granted" });
    store.grant(botVaultPrincipal("payroll"), item.id, { botId: "payroll", mode: "once", threadId: "t1" });
    await expect(fill("payroll")).resolves.toMatchObject({ ok: true, value: FAKE_PASSWORD });
    await expect(fill("stranger")).resolves.toMatchObject({ ok: false, code: "not_granted" });
  });

  it("fillResolverFor prefers the team vault then the person vault", async () => {
    const { store } = vault();
    const team = store.createForTeamBot("payroll", {
      kind: "login", name: "Team SSO", username: "team@example.test", password: FAKE_PASSWORD, domains: ["sso.example.test"],
    });
    const person = store.create(LOCAL_VAULT_PRINCIPAL, {
      kind: "login", name: "My SSO", username: "me@example.test", password: "fake-Person-Pa55", domains: ["sso.example.test"],
    });
    store.grant(LOCAL_VAULT_PRINCIPAL, person.id, { botId: "payroll", mode: "always" });
    const resolver = fillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "payroll", threadId: "t1" });
    await expect(resolver.resolve({ handle: vaultHandle(team.id), field: "password", pageUrl: "https://sso.example.test/" })).resolves.toMatchObject({ ok: false, code: "not_granted" });
    store.grant(botVaultPrincipal("payroll"), team.id, { botId: "payroll", mode: "always" });
    const teamFill = await resolver.resolve({ handle: vaultHandle(team.id), field: "password", pageUrl: "https://sso.example.test/" });
    expect(teamFill).toMatchObject({ ok: true, label: "Team SSO" });
    if (teamFill.ok) expect(teamFill.value).toBe(FAKE_PASSWORD);
    const personFill = await resolver.resolve({ handle: vaultHandle(person.id), field: "password", pageUrl: "https://sso.example.test/" });
    expect(personFill).toMatchObject({ ok: true, label: "My SSO" });
  });

  it("refuses to open a team vault with another key", () => {
    const { dir, store } = vault();
    store.createForTeamBot("payroll", {
      kind: "login", name: "Shared", username: "x@example.test", password: FAKE_PASSWORD, domains: ["example.test"],
    });
    const { store: wrong } = vault(dir, OTHER);
    expect(() => wrong.list(botVaultPrincipal("payroll"))).toThrow(/could not be decrypted/);
  });
});
