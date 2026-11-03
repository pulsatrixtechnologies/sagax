import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeVaultDomain, vaultDomainMatches, vaultHandle, VAULT_ONCE_GRANT_MS } from "../../shared/credential-vault.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import type { VaultKeySource } from "../mcp/mcp-oauth.ts";

// Every value below is fake test data.
const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };
const OTHER_KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 9) };
const FAKE_PASSWORD = "fake-Pa55word-for-tests";
const FAKE_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-vault-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function vault(dir = tempDir(), key: VaultKeySource = KEY, now = () => 1_000_000) {
  return { dir, vault: new CredentialVault(dir, () => key, now) };
}

const login = { kind: "login", name: "Example portal", username: "ada@example.test", password: FAKE_PASSWORD, totpSeed: FAKE_SEED, domains: ["example.test"] };

describe("credential vault encryption", () => {
  it("round-trips through the encrypted file and never writes a value in clear", () => {
    const { dir, vault: first } = vault();
    const created = first.create(LOCAL_VAULT_PRINCIPAL, login);
    expect(created).toMatchObject({ name: "Example portal", hasPassword: true, hasTotp: true, domains: ["example.test"] });
    expect(JSON.stringify(created)).not.toContain(FAKE_PASSWORD);
    expect(JSON.stringify(created)).not.toContain(FAKE_SEED);
    const raw = readFileSync(join(dir, "credential-vault.enc"), "utf8");
    expect(raw).not.toContain(FAKE_PASSWORD);
    expect(raw).not.toContain("Example portal");
    // A fresh instance (a new launch) reads it back with the same key.
    const { vault: second } = vault(dir);
    expect(second.list(LOCAL_VAULT_PRINCIPAL).map((item) => item.id)).toEqual([created.id]);
  });

  it("refuses to open with another key and never overwrites the file", () => {
    const { dir, vault: first } = vault();
    first.create(LOCAL_VAULT_PRINCIPAL, login);
    const before = readFileSync(join(dir, "credential-vault.enc"), "utf8");
    const { vault: wrong } = vault(dir, OTHER_KEY);
    expect(() => wrong.list(LOCAL_VAULT_PRINCIPAL)).toThrow(/could not be decrypted/);
    expect(() => wrong.create(LOCAL_VAULT_PRINCIPAL, login)).toThrow(/could not be decrypted/);
    expect(readFileSync(join(dir, "credential-vault.enc"), "utf8")).toBe(before);
    const { vault: none } = vault(dir, { kind: "unavailable", reason: "The encrypted credential store could not be read on this launch." });
    expect(none.unavailableReason(LOCAL_VAULT_PRINCIPAL)).toMatch(/could not be read/);
  });

  it("binds each file to its person: a copy in another person's folder does not open", () => {
    const { dir, vault: store } = vault();
    store.create("pr_alice", login);
    mkdirSync(join(dir, "principals", "pr_bob"), { recursive: true });
    copyFileSync(join(dir, "principals", "pr_alice", "credential-vault.enc"), join(dir, "principals", "pr_bob", "credential-vault.enc"));
    const { vault: fresh } = vault(dir);
    expect(fresh.list("pr_alice")).toHaveLength(1);
    expect(() => fresh.list("pr_bob")).toThrow(/could not be decrypted/);
  });

  it("validates input: a login needs a site, a seed must be a real seed", () => {
    const { vault: store } = vault();
    expect(() => store.create(LOCAL_VAULT_PRINCIPAL, { ...login, domains: [] })).toThrow(/at least one site/);
    expect(() => store.create(LOCAL_VAULT_PRINCIPAL, { ...login, totpSeed: "not a seed!" })).toThrow(/seed/);
    expect(() => store.create(LOCAL_VAULT_PRINCIPAL, { ...login, domains: ["10.0.0.1"] })).toThrow(/site/);
    const note = store.create(LOCAL_VAULT_PRINCIPAL, { kind: "note", name: "Door code", notes: "fake note" });
    expect(note).toMatchObject({ kind: "note", hasNotes: true });
    expect(store.revealNotes(LOCAL_VAULT_PRINCIPAL, note.id)).toBe("fake note");
    // A secret field left out keeps its value; an empty string clears it.
    const item = store.create(LOCAL_VAULT_PRINCIPAL, login);
    expect(store.update(LOCAL_VAULT_PRINCIPAL, item.id, { name: "Renamed" })).toMatchObject({ name: "Renamed", hasPassword: true });
    expect(store.update(LOCAL_VAULT_PRINCIPAL, item.id, { totpSeed: "" })).toMatchObject({ hasTotp: false });
    expect(store.remove(LOCAL_VAULT_PRINCIPAL, item.id)).toBe(true);
    expect(store.item(LOCAL_VAULT_PRINCIPAL, item.id)).toBeNull();
  });
});

describe("domain binding", () => {
  it("normalizes bound sites: exact host, explicit wildcard, explicit port, localhost http only", () => {
    expect(normalizeVaultDomain("https://Login.Example.test/path?q=1")).toBe("login.example.test");
    expect(normalizeVaultDomain("example.test.")).toBe("example.test");
    expect(normalizeVaultDomain("example.test:8443")).toBe("example.test:8443");
    expect(normalizeVaultDomain("*.example.test")).toBe("*.example.test");
    expect(normalizeVaultDomain("localhost")).toBe("localhost");
    expect(normalizeVaultDomain("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeVaultDomain("http://example.test")).toBeNull();
    expect(normalizeVaultDomain("http://localhost")).toBeNull();
    expect(normalizeVaultDomain("*.co.uk")).toBeNull();
    expect(normalizeVaultDomain("*.example.test:8443")).toBeNull();
    expect(normalizeVaultDomain("192.168.1.1")).toBeNull();
    expect(normalizeVaultDomain("[::1]")).toBeNull();
    expect(normalizeVaultDomain("nodot")).toBeNull();
  });

  it("matches the exact site by default, subdomains only by a wildcard, https only, never a look-alike", () => {
    const domains = ["example.test"];
    expect(vaultDomainMatches(domains, "https://example.test/login")).toBe(true);
    expect(vaultDomainMatches(domains, "https://sso.example.test/")).toBe(false);
    expect(vaultDomainMatches(domains, "https://example.test:8443/")).toBe(false);
    expect(vaultDomainMatches(domains, "http://example.test/")).toBe(false);
    expect(vaultDomainMatches(domains, "https://example.test.evil.test/")).toBe(false);
    expect(vaultDomainMatches(domains, "https://badexample.test/")).toBe(false);
    expect(vaultDomainMatches(domains, "https://user:pass@example.test/")).toBe(false);
    expect(vaultDomainMatches(domains, "javascript:alert(1)")).toBe(false);
    expect(vaultDomainMatches(["*.example.test"], "https://sso.example.test/")).toBe(true);
    expect(vaultDomainMatches(["*.example.test"], "https://example.test/")).toBe(false);
    expect(vaultDomainMatches(["example.test:8443"], "https://example.test:8443/")).toBe(true);
    expect(vaultDomainMatches(["http://localhost:3000"], "http://localhost:3000/")).toBe(true);
    expect(vaultDomainMatches(["http://localhost:3000"], "http://localhost:4000/")).toBe(false);
    expect(vaultDomainMatches(["localhost"], "http://localhost/")).toBe(false);
  });
});

describe("grants", () => {
  const fill = (store: CredentialVault, id: string, botId: string, threadId: string, pageUrl = "https://example.test/login", field: "password" | "totp" | "username" = "password") =>
    store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: vaultHandle(id), field, botId, threadId, pageUrl });

  it("refuses an ungranted bot, then honours always for that bot in any conversation", async () => {
    const { vault: store } = vault();
    const item = store.create(LOCAL_VAULT_PRINCIPAL, login);
    await expect(fill(store, item.id, "bot-a", "t1")).resolves.toMatchObject({ ok: false, code: "not_granted" });
    store.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    await expect(fill(store, item.id, "bot-a", "t2")).resolves.toMatchObject({ ok: true, value: FAKE_PASSWORD });
    // Another bot is not covered by bot-a's grant.
    await expect(fill(store, item.id, "bot-b", "t2")).resolves.toMatchObject({ ok: false, code: "not_granted" });
    expect(store.item(LOCAL_VAULT_PRINCIPAL, item.id)).toMatchObject({ lastUsedBy: "bot-a", lastUsedAt: 1_000_000 });
    store.revoke(LOCAL_VAULT_PRINCIPAL, item.id, "bot-a");
    await expect(fill(store, item.id, "bot-a", "t2")).resolves.toMatchObject({ ok: false, code: "not_granted" });
  });

  it("holds a once grant to its conversation and its time window", async () => {
    let now = 1_000_000;
    const { vault: store } = vault(undefined, KEY, () => now);
    const item = store.create(LOCAL_VAULT_PRINCIPAL, login);
    expect(() => store.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once" })).toThrow(/conversation/);
    store.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "once", threadId: "t1" });
    await expect(fill(store, item.id, "bot-a", "t1")).resolves.toMatchObject({ ok: true });
    await expect(fill(store, item.id, "bot-a", "t1", undefined, "username")).resolves.toMatchObject({ ok: true, value: "ada@example.test" });
    await expect(fill(store, item.id, "bot-a", "t9")).resolves.toMatchObject({ ok: false, code: "not_granted" });
    now += VAULT_ONCE_GRANT_MS + 1;
    await expect(fill(store, item.id, "bot-a", "t1")).resolves.toMatchObject({ ok: false, code: "not_granted" });
    expect(store.item(LOCAL_VAULT_PRINCIPAL, item.id)?.grants).toEqual([]);
  });

  it("never resolves a value for a page off the item's sites", async () => {
    const { vault: store } = vault();
    const item = store.create(LOCAL_VAULT_PRINCIPAL, login);
    store.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    for (const pageUrl of ["https://evil.test/", "http://example.test/", "https://example.test.evil.test/", "about:blank"]) {
      const result = await fill(store, item.id, "bot-a", "t1", pageUrl);
      expect(result).toMatchObject({ ok: false, code: "wrong_origin" });
      expect(JSON.stringify(result)).not.toContain(FAKE_PASSWORD);
    }
    expect(store.item(LOCAL_VAULT_PRINCIPAL, item.id)?.lastUsedAt).toBeUndefined();
  });

  it("computes the one-time code at fill time from the seed", async () => {
    const { vault: store } = vault(undefined, KEY, () => 59_000);
    const item = store.create(LOCAL_VAULT_PRINCIPAL, login);
    store.grant(LOCAL_VAULT_PRINCIPAL, item.id, { botId: "bot-a", mode: "always" });
    // RFC 6238 SHA1 vector at T=59 s, six digits: 287082.
    await expect(fill(store, item.id, "bot-a", "t1", undefined, "totp")).resolves.toMatchObject({ ok: true, value: "287082" });
  });

  it("finds items by site or by name for a request", () => {
    const { vault: store } = vault();
    store.create(LOCAL_VAULT_PRINCIPAL, login);
    store.create(LOCAL_VAULT_PRINCIPAL, { kind: "apiKey", name: "Billing API", apiKey: "fake-api-key-value" });
    expect(store.find(LOCAL_VAULT_PRINCIPAL, { domain: "example.test" }).map((item) => item.name)).toEqual(["Example portal"]);
    expect(store.find(LOCAL_VAULT_PRINCIPAL, { domain: "sso.example.test" })).toEqual([]);
    expect(store.find(LOCAL_VAULT_PRINCIPAL, { name: "billing" }).map((item) => item.name)).toEqual(["Billing API"]);
    expect(store.find(LOCAL_VAULT_PRINCIPAL, { domain: "other.test" })).toEqual([]);
  });
});

describe("credential vault import and export", () => {
  it("imports in one write, merges into a match, and exports back the values", () => {
    const { dir, vault: store } = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, login);
    const outcome = store.importItems(LOCAL_VAULT_PRINCIPAL, [
      { kind: "login", name: "Same login", username: "ADA@example.test", password: "fake-merged-pass", domains: ["example.test", "www.example.test"] },
      { kind: "login", name: "New", username: "kim", password: "fake-new", domains: ["new.example.test"] },
      { kind: "apiKey", name: "Key", apiKey: "fake-key-value", domains: ["api.example.test"] },
      { kind: "login", name: "Bad", username: "x", totpSeed: "!!", domains: ["bad.example.test"] },
    ], "merge");
    expect(outcome).toEqual({ created: 2, merged: 1, duplicates: 0, inFile: 0, overLimit: 0, refused: 1 });
    const raw = readFileSync(join(dir, "credential-vault.enc"), "utf8");
    for (const value of ["fake-merged-pass", "fake-new", "fake-key-value"]) expect(raw).not.toContain(value);
    const listed = store.list(LOCAL_VAULT_PRINCIPAL);
    expect(listed.find((item) => item.id === saved.id)).toMatchObject({ name: "Example portal", domains: ["example.test", "www.example.test"], hasTotp: true });
    expect(JSON.stringify(listed)).not.toContain("fake-merged-pass");
    const exported = store.exportItems(LOCAL_VAULT_PRINCIPAL, "bitwarden-json");
    expect(exported.onePassword).toBe(0);
    expect(exported.items.find((item) => item.name === "Example portal")).toMatchObject({ password: "fake-merged-pass", totpSeed: FAKE_SEED });
    expect(exported.items.find((item) => item.name === "Key")).toMatchObject({ kind: "apiKey", apiKey: "fake-key-value" });
    // Chrome CSV: only logins leave the vault, without their seed
    const chrome = store.exportItems(LOCAL_VAULT_PRINCIPAL, "chrome-csv");
    expect(chrome.items.map((item) => item.kind)).toEqual(["login", "login"]);
    expect(chrome.items.some((item) => item.totpSeed)).toBe(false);
    expect(chrome).toMatchObject({ notInFormat: 1, totpNotInFormat: 1 });
  });

  it("never adds a file's sites to an item a bot is allowed to use", () => {
    const { vault: store } = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, login);
    store.grant(LOCAL_VAULT_PRINCIPAL, saved.id, { botId: "bot-a", mode: "always" });
    const outcome = store.importItems(LOCAL_VAULT_PRINCIPAL, [{ kind: "login", name: "x", username: "ada@example.test", password: "fake-widen", domains: ["example.test", "other.example.test"] }], "merge");
    expect(outcome).toMatchObject({ merged: 1 });
    expect(store.item(LOCAL_VAULT_PRINCIPAL, saved.id)!.domains).toEqual(["example.test"]);
  });

  it("leaves duplicates as they are in skip mode and stops at the item limit", () => {
    const { vault: store } = vault();
    store.create(LOCAL_VAULT_PRINCIPAL, login);
    const again = store.importItems(LOCAL_VAULT_PRINCIPAL, [{ kind: "login", name: "x", username: "ada@example.test", password: "fake-other", domains: ["example.test"] }], "skip");
    expect(again).toMatchObject({ created: 0, merged: 0, duplicates: 1 });
    const many = Array.from({ length: 501 }, (_, index) => ({ kind: "note" as const, name: `Note ${index}`, notes: "fake", domains: [] }));
    expect(store.importItems(LOCAL_VAULT_PRINCIPAL, many, "skip")).toMatchObject({ created: 499, overLimit: 2 });
  });
});
