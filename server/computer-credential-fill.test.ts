import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { botVaultPrincipal, vaultHandle } from "../shared/credential-vault.ts";
import { REDACTED_CREDENTIAL } from "./credential-fill.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import {
  computerFillResolverFor,
  fillComputerField,
  parseComputerFillArguments,
} from "./computer-credential-fill.ts";
import { noteFilledSecret, redactFilledSecrets, resetFilledSecrets } from "./filled-secret-guard.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";

const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };
const FAKE_PASSWORD = "fake-Computer-Pa55-for-tests";
const dirs: string[] = [];
afterEach(() => {
  resetFilledSecrets();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function vault() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-computer-fill-"));
  dirs.push(dir);
  return { dir, store: new CredentialVault(dir, () => KEY, () => 1_000_000) };
}

describe("computer fill_credential", () => {
  it("parses one field and refuses login mode", () => {
    expect(parseComputerFillArguments({ arguments: { credential: "cred_abc", field: "password" } })).toEqual({
      credential: "cred_abc",
      field: "password",
    });
    expect(parseComputerFillArguments({ arguments: { credential: "cred_abc", field: "login" } })).toMatch(/one field/);
  });

  it("types the value into the computer and never returns it to the model", async () => {
    const { store } = vault();
    const item = store.create(LOCAL_VAULT_PRINCIPAL, {
      kind: "login",
      name: "Portal",
      username: "ada@example.test",
      password: FAKE_PASSWORD,
      domains: ["example.test"],
    });
    store.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    const typed: string[] = [];
    const access = computerFillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-a", threadId: "t1" });
    const result = await fillComputerField(
      access,
      { credential: vaultHandle(item.id), field: "password" },
      (value) => { typed.push(value); },
    );
    expect(result.ok).toBe(true);
    expect(typed).toEqual([FAKE_PASSWORD]);
    expect(result.text).toContain(REDACTED_CREDENTIAL);
    expect(result.text).not.toContain(FAKE_PASSWORD);
    expect(JSON.stringify(result)).not.toContain(FAKE_PASSWORD);
    expect(redactFilledSecrets(`later saw ${FAKE_PASSWORD}`)).toBe(`later saw ${REDACTED_CREDENTIAL}`);
  });

  it("fills a team bot vault login for that bot only", async () => {
    const { dir, store } = vault();
    const item = store.createForTeamBot("team-bot", {
      kind: "login",
      name: "Shared SSO",
      username: "team@example.test",
      password: FAKE_PASSWORD,
      domains: ["sso.example.test"],
    });
    const raw = readFileSync(join(dir, "bots", "team-bot", "credential-vault.enc"), "utf8");
    expect(raw).not.toContain(FAKE_PASSWORD);
    expect(raw).not.toContain("Shared SSO");

    store.grant(`bot:team-bot`, item.id, { botId: "team-bot", mode: "always" });
    const typed: string[] = [];
    const teamAccess = computerFillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "team-bot", threadId: "t1" });
    const ok = await fillComputerField(teamAccess, { credential: vaultHandle(item.id), field: "password" }, (value) => { typed.push(value); });
    expect(ok.ok).toBe(true);
    expect(typed).toEqual([FAKE_PASSWORD]);

    const other = computerFillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "other-bot", threadId: "t1" });
    const refused = await fillComputerField(other, { credential: vaultHandle(item.id), field: "password" }, () => { throw new Error("must not type"); });
    expect(refused.ok).toBe(false);
    expect(refused.text).not.toContain(FAKE_PASSWORD);
  });

  it("keeps person vaults isolated across principals", async () => {
    const { store } = vault();
    store.create("pr_alice", {
      kind: "login", name: "Alice mail", username: "alice@example.test", password: FAKE_PASSWORD, domains: ["mail.example.test"],
    });
    expect(store.list("pr_alice")).toHaveLength(1);
    expect(() => store.list("pr_bob")).not.toThrow();
    expect(store.list("pr_bob")).toHaveLength(0);
    // AAD binds the file: a copy under another person does not open (covered
    // in credential-vault.test.ts). Team and person principals stay apart.
    expect(botVaultPrincipal("team-bot")).toBe("bot:team-bot");
    expect(store.list(botVaultPrincipal("team-bot"))).toHaveLength(0);
  });

  it("notes a filled secret for transcript redaction", () => {
    noteFilledSecret(FAKE_PASSWORD);
    expect(redactFilledSecrets(`password=${FAKE_PASSWORD}`)).toBe(`password=${REDACTED_CREDENTIAL}`);
  });
});
