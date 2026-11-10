import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "../config.ts";
import { ContentKeyUnavailable } from "../encryption/content-keys.ts";
import { closeMessageDb, closeMessageSearch, configureContentEncryption, insertMessage, readThread } from "../messages/message-db.ts";
import type { Message } from "../store.ts";
import { McpOAuthVault, resolveVaultKey, type VaultKeySource } from "../mcp/mcp-oauth.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import { VAULT_KEY_RESET_MARKER } from "./vault-key-reset.ts";

// Every value below is fake test data.
const OLD_KEY = "07".repeat(32);
const NEW_KEY = "09".repeat(32);
const STAMP = "1800000000000";
const record = { serverUrl: "https://mcp.example.com/mcp", resource: "https://mcp.example.com/mcp", issuer: "https://auth.example.com", authorizationEndpoint: "https://auth.example.com/authorize", tokenEndpoint: "https://auth.example.com/token", tokens: { access: "fake-access" } };
const login = { kind: "login", name: "Example portal", username: "ada@example.test", password: "fake-Pa55word-for-tests", domains: ["example.test"] };

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-key-reset-"));
  dirs.push(dir);
  return dir;
}

/** The server's key source on a desktop launch: the key from the parent, the reset stamp when one happened. */
function launch(dir: string, key: string, reset?: string): () => VaultKeySource {
  const env: NodeJS.ProcessEnv = { SAGAX_DESKTOP_PARENT: "1", SAGAX_DATA_DIR: dir, SAGAX_MCP_OAUTH_KEY: key, ...(reset ? { SAGAX_VAULT_KEY_RESET: reset } : {}) };
  return () => resolveVaultKey(dir, env);
}

/** Stores sealed with the old key, at the root and for a team bot. */
function sealWithOldKey(dir: string): void {
  const keys = launch(dir, OLD_KEY);
  new McpOAuthVault(dir, keys).set("notes", record);
  const vault = new CredentialVault(dir, keys);
  vault.create(LOCAL_VAULT_PRINCIPAL, login);
  vault.createForTeamBot("bot-a1", login);
  mkdirSync(join(dir, "workspaces", "bot-a1"), { recursive: true });
  writeFileSync(join(dir, "workspaces", "bot-a1", "memes.enc"), "a person's own file");
}

describe("stores sealed with the key a reset dropped", () => {
  it("stay refused under the new key without the reset (the defect)", () => {
    const dir = dataDir();
    sealWithOldKey(dir);
    const keys = launch(dir, NEW_KEY);
    expect(() => new McpOAuthVault(dir, keys).set("notes", record)).toThrow(/could not be decrypted/);
    expect(() => new CredentialVault(dir, keys).create(LOCAL_VAULT_PRINCIPAL, login)).toThrow(/could not be decrypted/);
  });

  it("are moved aside, kept, and the stores accept writes under the new key", () => {
    const dir = dataDir();
    sealWithOldKey(dir);
    const keys = launch(dir, NEW_KEY, STAMP);

    const oauth = new McpOAuthVault(dir, keys);
    expect(oauth.get("notes")).toBeUndefined();
    oauth.set("notes", record);
    expect(new McpOAuthVault(dir, keys).get("notes")).toEqual(record);

    const vault = new CredentialVault(dir, keys);
    expect(vault.list(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
    expect(vault.create(LOCAL_VAULT_PRINCIPAL, login)).toMatchObject({ name: "Example portal" });

    // Kept beside the store with the same suffix as credentials.bin, never deleted.
    expect(readdirSync(dir)).toEqual(expect.arrayContaining([`mcp-oauth.enc.unreadable-${STAMP}`, `credential-vault.enc.unreadable-${STAMP}`, VAULT_KEY_RESET_MARKER]));
    expect(readdirSync(join(dir, "bots", "bot-a1"))).toContain(`credential-vault.enc.unreadable-${STAMP}`);
    // A person's own workspace files are not stores.
    expect(existsSync(join(dir, "workspaces", "bot-a1", "memes.enc"))).toBe(true);
  });

  it("are moved once per reset: what the new key sealed stays on the next launch", () => {
    const dir = dataDir();
    sealWithOldKey(dir);
    new McpOAuthVault(dir, launch(dir, NEW_KEY, STAMP)).set("notes", record);
    expect(new McpOAuthVault(dir, launch(dir, NEW_KEY, STAMP)).get("notes")).toEqual(record);
    expect(existsSync(join(dir, "mcp-oauth.enc"))).toBe(true);
  });

  it("are left alone outside a desktop child or without a reset", () => {
    const dir = dataDir();
    sealWithOldKey(dir);
    resolveVaultKey(dir, { SAGAX_DATA_DIR: dir, SAGAX_MCP_OAUTH_KEY: NEW_KEY, SAGAX_VAULT_KEY_RESET: STAMP });
    resolveVaultKey(dir, { SAGAX_DESKTOP_PARENT: "1", SAGAX_DATA_DIR: dir, SAGAX_MCP_OAUTH_KEY: NEW_KEY, SAGAX_VAULT_KEY_RESET: "soon" });
    expect(readdirSync(dir).filter((name) => name.includes(".unreadable-"))).toEqual([]);
  });
});

describe("conversations sealed at rest with the key a reset dropped", () => {
  const msg = (id: string, text: string): Message => ({ id, role: "user", kind: "text", text, at: 1_000 });
  const legacy = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);
  /** A desktop launch of the server: a fresh keyring under the key the parent hands over. */
  async function launchServer(key: string, reset?: string): Promise<void> {
    await closeMessageSearch();
    closeMessageDb();
    vi.stubEnv("SAGAX_DESKTOP_PARENT", "1");
    vi.stubEnv("SAGAX_MCP_OAUTH_KEY", key);
    vi.stubEnv("SAGAX_VAULT_KEY_RESET", reset ?? "");
    configureContentEncryption({ mode: "on", autoMigrate: false });
  }
  function rows(): Array<{ thread_id: string; id: string; json: string; sealed: Uint8Array | null; key_id: string | null }> {
    closeMessageDb();
    const db = new DatabaseSync(join(DATA_DIR, "messages.db"), { readOnly: true });
    try { return db.prepare("SELECT thread_id, id, json, sealed, key_id FROM messages ORDER BY rowid").all() as never; } finally { db.close(); }
  }

  afterEach(async () => {
    await closeMessageSearch();
    closeMessageDb();
    vi.unstubAllEnvs();
    configureContentEncryption({ mode: "off", autoMigrate: false });
  });

  it("seal new messages again under fresh keys, and the old rows stay sealed and report unreadable", async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    await launchServer(OLD_KEY);
    insertMessage("t-old", msg("m-old", "the orchid word from before"));
    const [before] = rows();
    expect(before!.sealed).not.toBeNull();

    await launchServer(NEW_KEY, STAMP);
    insertMessage("t-new", msg("m-new", "a lilac word after the reset"));
    insertMessage("t-old", msg("m-later", "a tulip word in the old conversation"));

    const after = rows();
    // Nothing is written plain: every row is sealed, the new ones under a key the new vault key wrapped.
    for (const row of after) {
      expect(row.sealed).not.toBeNull();
      expect(row.json).not.toMatch(/orchid|lilac|tulip/);
    }
    expect(after.find((row) => row.id === "m-new")!.key_id).not.toBe(before!.key_id);
    expect(after.find((row) => row.id === "m-later")!.key_id).not.toBe(before!.key_id);
    expect(after.find((row) => row.id === "m-old")!.key_id).toBe(before!.key_id);

    expect(readThread("t-new", legacy("t-new")).messages.map((message) => message.text)).toEqual(["a lilac word after the reset"]);
    // The conversation sealed before the reset is locked, not erased and not opened plain.
    expect(() => readThread("t-old", legacy("t-old"))).toThrow(ContentKeyUnavailable);
    closeMessageDb();
    const db = new DatabaseSync(join(DATA_DIR, "messages.db"), { readOnly: true });
    try {
      expect(db.prepare("SELECT key_id FROM content_keys_retired").all()).toEqual([{ key_id: before!.key_id }]);
    } finally { db.close(); }
  });
});
