// Content encryption at rest (docs/content-encryption.md): sealing, the
// additional data, cryptographic erasure, the reversible migration, search
// and recall over the blind index, the backup export, the Azure Key Vault
// provider (a fake client, no network) and no key material in a log line.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "./config.ts";
import { azureKeyVaultProvider, parseKeyUrl } from "./encryption/content-key-azure.ts";
import { WORKSPACE_OWNER, type KekProvider } from "./encryption/content-keys.ts";
import { contentKeysForExport, unsealDatabaseCopy } from "./content-export.ts";
import { contentEncryptionFromEnv } from "./encryption/content-encryption-env.ts";
import {
  vacuumAfterSealing,
  chatFollowups, closeMessageDb, closeMessageSearch, configureContentEncryption, contentEncryptionModeFromEnv, contentEncryptionStatus,
  contentKeyChanged, deleteThread, eraseContentOwner, flushContentIndex, insertMessage, latestSaidByBot, openApprovalCardMessages,
  readCommandReceipt, readMessageText, readThread, readThreadTail, recallMessages, recentMessages, runContentMigration, saveChatFollowup,
  searchMessages, searchMessagesAsync, setMigrationFaultForTests, threadsReferencing, unlockContentKeys, updateMessage, withCommandReceipt, type ContentOwnerResolver,
} from "./message-db.ts";
import type { Message } from "./store.ts";

const msg = (id: string, text: string, extra: Partial<Message> = {}): Message => ({ id, role: "user", kind: "text", text, at: 1_000, ...extra });
const legacy = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);
const file = () => join(DATA_DIR, "messages.db");

let owners: Record<string, { owner: string; confidential: boolean }> = {};
const resolveOwner: ContentOwnerResolver = (threadId) => owners[threadId] ?? { owner: WORKSPACE_OWNER, confidential: false };
const turn = (mode: "on" | "off", provider?: KekProvider, others?: KekProvider[]) =>
  configureContentEncryption({ mode, resolveOwner, autoMigrate: false, ...(provider ? { provider } : {}), ...(others ? { others } : {}) });
const raw = () => new DatabaseSync(file(), { readOnly: true });
const migrateAll = () => { for (let i = 0; i < 1000 && !runContentMigration(Infinity).done; i++); };

/** Every byte of the database and its log: no plaintext word may be left. */
function onDisk(): string {
  flushContentIndex();
  closeMessageDb();
  return ["", "-wal"].map((suffix) => (existsSync(file() + suffix) ? readFileSync(file() + suffix).toString("latin1") : "")).join("");
}

beforeEach(async () => {
  await closeMessageSearch();
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  owners = {};
  turn("on");
});
afterEach(async () => {
  setMigrationFaultForTests(null);
  await closeMessageSearch();
  closeMessageDb();
});

describe("sealing", () => {
  it("round-trips a message and keeps no plaintext in its row", () => {
    insertMessage("t1", msg("m1", "the zebra password is orchid", { role: "bot", from: { botId: "b1", name: "Ada", color: "#000" }, sendId: "s1" }));
    updateMessage("t1", msg("m1", "the zebra password is orchid, edited", { role: "bot", from: { botId: "b1", name: "Ada", color: "#000" }, sendId: "s1" }));
    closeMessageDb();
    expect(readThread("t1", legacy("t1")).messages).toEqual([msg("m1", "the zebra password is orchid, edited", { role: "bot", from: { botId: "b1", name: "Ada", color: "#000" }, sendId: "s1" })]);
    const db = raw();
    const row = db.prepare("SELECT text, json, sealed, key_id FROM messages").get() as { text: string | null; json: string; sealed: Uint8Array; key_id: string };
    db.close();
    expect(row.text).toBeNull();
    expect(row.json).not.toContain("orchid");
    expect(JSON.parse(row.json)).toMatchObject({ id: "m1", sealed: 1, hasText: 1, from: { name: "Ada", botId: "b1" }, sendId: "s1" });
    expect(Buffer.from(row.sealed).toString("latin1")).not.toContain("orchid");
    expect(onDisk()).not.toContain("orchid");
  });

  it("keeps every server query working on sealed rows", () => {
    const card = { title: "t", subtitle: "s", options: ["Allow"], requestType: "permission", requestId: "r" } as unknown as Message["card"];
    insertMessage("t1", msg("open", "", { role: "bot", kind: "options", card }));
    insertMessage("t1", msg("done", "", { role: "bot", kind: "options", card: { ...card!, answered: "allow" } as Message["card"] }));
    insertMessage("t1", msg("said", "I filed the quarterly report", { role: "bot", at: 2_000 }));
    insertMessage("t1", msg("pic", "see /api/attachments/0123456789abcdef0123.png", { at: 3_000 }));
    expect(openApprovalCardMessages().map((hit) => hit.message.id)).toEqual(["open"]);
    expect(readMessageText("t1", "said")?.text).toBe("I filed the quarterly report");
    expect(latestSaidByBot(["t1"], "b1", 0).map((hit) => hit.head)).toEqual(["I filed the quarterly report"]);
    expect(recentMessages(["t1"], { since: 0 }).map((hit) => hit.messageId)).toEqual(["pic", "said"]);
    expect(threadsReferencing("0123456789abcdef0123.png")).toEqual(["t1"]);
    expect(readThreadTail("t1", legacy("t1"), 2).messages.map((message) => message.id)).toEqual(["said", "pic"]);
  });

  it("refuses a sealed blob copied to another thread or person (additional data)", () => {
    owners = { a: { owner: "alice", confidential: false }, b: { owner: "alice", confidential: false } };
    insertMessage("a", msg("m1", "alpha secret"));
    insertMessage("b", msg("m1", "bravo words"));
    closeMessageDb();
    const db = new DatabaseSync(file());
    const blob = (db.prepare("SELECT sealed FROM messages WHERE thread_id = 'a'").get() as { sealed: Uint8Array }).sealed;
    db.prepare("UPDATE messages SET sealed = ? WHERE thread_id = 'b'").run(blob);
    db.close();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readThread("b", legacy("b")).messages).toEqual([]);
    expect(readThread("a", legacy("a")).messages.map((message) => message.text)).toEqual(["alpha secret"]);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/alpha|bravo/);
    warn.mockRestore();
  });

  it("seals receipts and queued follow-ups too", () => {
    withCommandReceipt("digest.append", "t1:turn1", () => JSON.stringify({ text: "receipt orchid" }), 1);
    saveChatFollowup({ id: "f1", kind: "bot", ownerId: "b1", threadId: "t1", payload: { text: "queued orchid" } });
    expect(readCommandReceipt("digest.append", "t1:turn1")?.result).toBe(JSON.stringify({ text: "receipt orchid" }));
    expect(withCommandReceipt("digest.append", "t1:turn1", () => "again", 2)).toEqual({ result: JSON.stringify({ text: "receipt orchid" }), replayed: true });
    expect(chatFollowups().map((followup) => followup.payload.text)).toEqual(["queued orchid"]);
    expect(onDisk()).not.toContain("orchid");
  });
});

describe("cryptographic erasure", () => {
  it("destroys a person's key: their rows, receipts and keys are gone for good", () => {
    owners = { a: { owner: "alice", confidential: false }, secret: { owner: "alice", confidential: true }, b: { owner: "bob", confidential: false } };
    insertMessage("a", msg("m1", "alice ordinary orchid"));
    insertMessage("secret", msg("m1", "alice confidential orchid"));
    insertMessage("b", msg("m1", "bob stays"));
    expect(eraseContentOwner("alice")).toMatchObject({ keys: 2, rows: 2 });
    expect(readThread("a", legacy("a")).messages).toEqual([]);
    expect(readThread("secret", legacy("secret")).messages).toEqual([]);
    expect(readThread("b", legacy("b")).messages.map((message) => message.text)).toEqual(["bob stays"]);
    const db = raw();
    expect(db.prepare("SELECT COUNT(*) AS n FROM content_keys WHERE owner = 'alice'").get()).toEqual({ n: 0 });
    db.close();
    expect(searchMessages("orchid")).toEqual([]);
  });

  it("re-seals a thread that is now someone else's before destroying the old owner's key", () => {
    owners = { a: { owner: "alice", confidential: false } };
    insertMessage("a", msg("m1", "moved to bob"));
    owners = { a: { owner: "bob", confidential: false } };
    eraseContentOwner("alice");
    expect(readThread("a", legacy("a")).messages.map((message) => message.text)).toEqual(["moved to bob"]);
  });

  it("gives a confidential thread its own key, destroyed with the thread", () => {
    owners = { c: { owner: "alice", confidential: false } };
    insertMessage("c", msg("m1", "before it turned confidential"));
    owners = { c: { owner: "alice", confidential: true } };
    contentKeyChanged("c");
    insertMessage("c", msg("m2", "after"));
    migrateAll();
    let db = raw();
    const keys = db.prepare("SELECT DISTINCT m.key_id, k.thread_id FROM messages m JOIN content_keys k USING (key_id) WHERE m.thread_id = 'c'").all();
    db.close();
    expect(keys).toEqual([expect.objectContaining({ thread_id: "c" })]);
    expect(readThread("c", legacy("c")).messages.map((message) => message.text)).toEqual(["before it turned confidential", "after"]);
    deleteThread("c");
    db = raw();
    expect(db.prepare("SELECT COUNT(*) AS n FROM content_keys WHERE thread_id = 'c'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM thread_keys").get()).toEqual({ n: 0 });
    db.close();
  });

  it("leaves a row whose key is gone unreadable, never wrong", () => {
    insertMessage("t1", msg("m1", "will be erased"));
    closeMessageDb();
    const db = new DatabaseSync(file());
    db.exec("DELETE FROM content_keys");
    db.close();
    expect(readThread("t1", legacy("t1")).messages).toEqual([]);
  });
});

describe("migration", () => {
  it("seals plain rows in small batches, reads mixed rows meanwhile, and opens them back with off", () => {
    turn("off");
    for (let i = 0; i < 300; i++) insertMessage(`t${i % 3}`, msg(`m${i}`, `plain orchid number ${i}`, { at: i }));
    turn("on");
    expect(runContentMigration(0).done).toBe(false); // one batch at most
    const mixed = raw();
    const counts = mixed.prepare("SELECT SUM(sealed IS NOT NULL) AS sealed, SUM(sealed IS NULL) AS plain FROM messages").get() as { sealed: number; plain: number };
    mixed.close();
    expect(counts.sealed).toBeGreaterThan(0);
    expect(counts.plain).toBeGreaterThan(0);
    expect(readThread("t0", legacy("t0")).messages).toHaveLength(100);
    expect(searchMessages("orchid number 7", 40).map((hit) => hit.messageId).sort()).toEqual(["m7", "m70", "m71", "m72", "m73", "m74", "m75", "m76", "m77", "m78", "m79"].sort());
    migrateAll();
    expect(contentEncryptionStatus()).toMatchObject({ mode: "on", done: true, plainRows: 0, sealedRows: 300 });
    // the next start's VACUUM leaves no page of the plain era
    expect(vacuumAfterSealing()).toBeGreaterThanOrEqual(0);
    expect(vacuumAfterSealing()).toBeNull();
    expect(onDisk()).not.toContain("orchid");
    expect(searchMessages("number 299").map((hit) => hit.messageId)).toEqual(["m299"]);
    expect(recallMessages("orchid", ["t0"], 3).length).toBe(3);
    // reversible: off opens every row back to plain
    turn("off");
    migrateAll();
    expect(contentEncryptionStatus()).toMatchObject({ mode: "off", sealedRows: 0, plainRows: 300 });
    const db = raw();
    expect(db.prepare("SELECT text FROM messages WHERE id = 'm5'").get()).toEqual({ text: "plain orchid number 5" });
    db.close();
    expect(readThread("t2", legacy("t2")).messages).toHaveLength(100);
    expect(recallMessages("orchid", ["t0"], 3).length).toBe(3);
    expect(searchMessages("number 299").map((hit) => hit.messageId)).toEqual(["m299"]);
  });

  it("writes plain when no key is available, and seals once it is", () => {
    const broken: KekProvider = {
      id: "local",
      wrapSync: () => { throw new Error("locked"); },
      unwrapSync: () => { throw new Error("locked"); },
      wrap: async () => { throw new Error("locked"); },
      unwrap: async () => { throw new Error("locked"); },
    };
    turn("on", broken);
    insertMessage("t1", msg("m1", "written while locked"));
    let db = raw();
    expect(db.prepare("SELECT sealed IS NULL AS plain FROM messages").get()).toEqual({ plain: 1 });
    db.close();
    turn("on");
    migrateAll();
    db = raw();
    expect(db.prepare("SELECT sealed IS NULL AS plain FROM messages").get()).toEqual({ plain: 0 });
    db.close();
    expect(readThread("t1", legacy("t1")).messages[0]?.text).toBe("written while locked");
  });

  it("keeps the cursor when a slice throws so cleartext rows are not skipped", () => {
    turn("off");
    for (let i = 0; i < 40; i++) insertMessage("t1", msg(`m${i}`, `plain orchid ${i}`, { at: i }));
    turn("on");
    expect(runContentMigration(0).done).toBe(false);
    const afterFirst = raw();
    const sealedFirst = (afterFirst.prepare("SELECT SUM(sealed IS NOT NULL) AS n FROM messages").get() as { n: number }).n;
    afterFirst.close();
    expect(sealedFirst).toBeGreaterThan(0);

    setMigrationFaultForTests(() => { throw new Error("SQLITE_BUSY"); });
    expect(() => runContentMigration(0)).toThrow(/SQLITE_BUSY/);
    setMigrationFaultForTests(null);

    const mid = raw();
    const plainLeft = (mid.prepare("SELECT SUM(sealed IS NULL) AS n FROM messages").get() as { n: number }).n;
    mid.close();
    expect(plainLeft).toBeGreaterThan(0);

    migrateAll();
    expect(contentEncryptionStatus()).toMatchObject({ done: true, plainRows: 0, sealedRows: 40 });
    expect(readThread("t1", legacy("t1")).messages).toHaveLength(40);
  });

  it("logs a failed auto-migrate slice and reschedules instead of giving up", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      turn("off");
      for (let i = 0; i < 20; i++) insertMessage("t1", msg(`m${i}`, `word ${i}`, { at: i }));
      setMigrationFaultForTests(() => { throw new Error("disk full"); });
      configureContentEncryption({ mode: "on", resolveOwner, autoMigrate: true });
      await vi.advanceTimersByTimeAsync(50);
      expect(error.mock.calls.map((call) => String(call[0])).join("\n")).toMatch(/content migration slice failed/);
      setMigrationFaultForTests(null);
      for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(MIGRATION_BACKOFF_STEP);
      expect(contentEncryptionStatus()).toMatchObject({ done: true, plainRows: 0, sealedRows: 20 });
    } finally {
      setMigrationFaultForTests(null);
      error.mockRestore();
      vi.useRealTimers();
      turn("on");
    }
  });
});

/** Upper bound used while draining the auto-migrate backoff in the test above. */
const MIGRATION_BACKOFF_STEP = 60_000;

describe("search and recall over sealed rows", () => {
  beforeEach(() => {
    insertMessage("a", msg("m1", "Literal 10%_\\ path. Hello 世界. " + "long ".repeat(100) + "needle", { at: 1 }));
    insertMessage("b", { id: "m2", at: 2, role: "bot", kind: "activity", tool: { name: "Run HELLO migration", ok: true } } as Message);
    insertMessage("a", msg("m3", "Les restaurants de Montréal sont ouverts", { at: 3 }));
    insertMessage("a", msg("m4", "café crème", { at: 4, role: "bot", kind: "digest" }));
  });

  it("finds substrings (text, tool names, short needles) the same way, in the worker too", async () => {
    expect(searchMessages("hello").map((hit) => hit.messageId)).toEqual(["m2", "m1"]);
    expect(searchMessages("10%_\\").map((hit) => hit.messageId)).toEqual(["m1"]);
    expect(searchMessages("世界").map((hit) => hit.messageId)).toEqual(["m1"]);
    expect(searchMessages("ab").map((hit) => hit.messageId)).toEqual([]);
    expect(searchMessages("ne").map((hit) => hit.messageId)).toEqual(["m1"]);
    expect(searchMessages("needle", 40, "b")).toEqual([]);
    const [hit] = searchMessages("needle");
    expect(hit?.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe("needle");
    for (const query of ["hello", "needle", "MONTRÉAL", "absent"]) {
      expect(await searchMessagesAsync(query, 5)).toEqual(searchMessages(query, 5));
    }
  });

  it("ranks recall with words, prefixes and folded accents, with a bracketed snippet", () => {
    expect(recallMessages("restaurant", ["a"], 5, undefined, "any").map((hit) => hit.messageId)).toEqual(["m3"]);
    expect(recallMessages("montreal", ["a"]).map((hit) => hit.messageId)).toEqual(["m3"]);
    expect(recallMessages("cafe", ["a"]).map((hit) => ({ id: hit.messageId, kind: hit.kind }))).toEqual([{ id: "m4", kind: "digest" }]);
    expect(recallMessages("restaurants ouverts", ["a"])[0]?.snippet).toBe("Les [restaurants] de Montréal sont [ouverts]");
    expect(recallMessages("restaurants fermés", ["a"])).toEqual([]);
    expect(recallMessages("needle", ["b"])).toEqual([]);
  });
});

describe("backup export", () => {
  it("copies the database in the clear with the live keys, and refuses without them", () => {
    insertMessage("t1", msg("m1", "backup orchid"));
    withCommandReceipt("digest.append", "t1:x", () => "receipt orchid", 1);
    flushContentIndex();
    const keys = contentKeysForExport();
    expect(keys.length).toBe(1);
    closeMessageDb();
    const copy = join(DATA_DIR, "copy.db");
    copyFileSync(file(), copy);
    const refused = join(DATA_DIR, "refused.db");
    copyFileSync(file(), refused);
    expect(() => unsealDatabaseCopy(refused, [])).toThrow(/cannot open/);
    expect(unsealDatabaseCopy(copy, keys)).toEqual({ opened: 1, erased: 0 });
    const db = new DatabaseSync(copy, { readOnly: true });
    expect(db.prepare("SELECT text, sealed FROM messages").get()).toEqual({ text: "backup orchid", sealed: null });
    expect(db.prepare("SELECT result FROM command_receipts").get()).toEqual({ result: "receipt orchid" });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('content_keys', 'thread_keys', 'messages_sealed_fts', 'message_index')").all()).toEqual([]);
    db.close();
  });
});

describe("Azure Key Vault provider (fake client)", () => {
  const secret = "client-secret-value";
  const fakeVault = () => {
    const calls: Array<{ url: string; body: string; auth: string }> = [];
    let tokens = 0;
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : "";
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      calls.push({ url, body, auth });
      if (url.includes("/oauth2/v2.0/token")) {
        tokens++;
        return Response.json({ access_token: `token-${tokens}`, expires_in: 3600 });
      }
      const value = (JSON.parse(body) as { value: string }).value;
      // the fake "wraps" by reversing the bytes: enough to prove the round trip
      const flipped = Buffer.from(value, "base64url").reverse().toString("base64url");
      if (url.includes("/wrapkey")) return Response.json({ kid: "https://unit.vault.azure.net/keys/content/v2", value: flipped });
      if (url.includes("/unwrapkey")) return Response.json({ value: flipped });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const provider = azureKeyVaultProvider({
      keyUrl: "https://unit.vault.azure.net/keys/content",
      env: { AZURE_TENANT_ID: "tenant", AZURE_CLIENT_ID: "client", SAGAX_CONTENT_KEY_AZURE_CLIENT_SECRET: secret },
      fetch: fetcher,
    });
    return { calls, provider, tokens: () => tokens };
  };

  it("wraps on first use, unwraps at unlock, caches the token, re-wraps local keys", async () => {
    insertMessage("t1", msg("m1", "sealed under a local key"));
    const vault = fakeVault();
    turn("on", vault.provider);
    closeMessageDb();
    const unlocked = await unlockContentKeys();
    expect(unlocked).toEqual({ unlocked: 1, failed: 0, rewrapped: 1 });
    insertMessage("t2", msg("m1", "new owner key, asynchronous"));
    await vi.waitFor(() => expect(vault.calls.some((call) => call.url.endsWith("/wrapkey?api-version=7.4"))).toBe(true));
    closeMessageDb();
    // a fresh process: only Key Vault can open the keys now
    const reopened = fakeVault();
    turn("on", reopened.provider);
    expect(await unlockContentKeys()).toMatchObject({ unlocked: 1, failed: 0 });
    expect(readThread("t1", legacy("t1")).messages[0]?.text).toBe("sealed under a local key");
    expect(reopened.calls.find((call) => call.url.includes("/unwrapkey"))?.url).toBe("https://unit.vault.azure.net/keys/content/v2/unwrapkey?api-version=7.4");
    expect(reopened.tokens()).toBe(1);
    const db = raw();
    expect(db.prepare("SELECT provider, ref FROM content_keys").all()).toEqual([{ provider: "azure-keyvault", ref: "RSA-OAEP-256 https://unit.vault.azure.net/keys/content/v2" }]);
    db.close();
  });

  it("checks its settings and never puts a secret in an error", async () => {
    expect(() => parseKeyUrl("http://unit.vault.azure.net/keys/content")).toThrow(/https/);
    expect(() => parseKeyUrl("https://unit.vault.azure.net/secrets/content")).toThrow(/name a key/);
    expect(parseKeyUrl("https://unit.vault.azure.net/keys/content/").scope).toBe("https://vault.azure.net");
    expect(() => contentEncryptionFromEnv({ SAGAX_CONTENT_KEY_PROVIDER: "azure-keyvault" })).toThrow(/KEY_URL/);
    expect(() => contentEncryptionFromEnv({ SAGAX_CONTENT_KEY_PROVIDER: "kms" })).toThrow(/local or azure-keyvault/);
    expect(contentEncryptionModeFromEnv({})).toBe("on");
    expect(contentEncryptionModeFromEnv({ SAGAX_CONTENT_ENCRYPTION: "off" })).toBe("off");
    const failing = azureKeyVaultProvider({
      keyUrl: "https://unit.vault.azure.net/keys/content",
      env: { AZURE_TENANT_ID: "tenant", AZURE_CLIENT_ID: "client", AZURE_CLIENT_SECRET: secret },
      fetch: (async () => Response.json({ error: secret }, { status: 401 })) as typeof fetch,
    });
    const error = await failing.wrap(Buffer.alloc(32), Buffer.alloc(0)).catch((caught: Error) => caught);
    expect(String(error)).toMatch(/answered 401/);
    expect(String(error)).not.toContain(secret);
    const other = fakeVault();
    await expect(other.provider.unwrap({ provider: "azure-keyvault", ref: "RSA-OAEP-256 https://elsewhere.vault.azure.net/keys/x/1", wrapped: Buffer.alloc(32) }, Buffer.alloc(0))).rejects.toThrow(/another Key Vault/);
  });

  it("uses a managed identity when no client credential is set", async () => {
    const seen: string[] = [];
    const provider = azureKeyVaultProvider({
      keyUrl: "https://unit.vault.azure.net/keys/content",
      env: {},
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        seen.push(`${String(input)} ${new Headers(init?.headers).get("metadata") ?? ""}`);
        if (String(input).startsWith("http://169.254.169.254/")) return Response.json({ access_token: "imds", expires_in: "3600" });
        return Response.json({ kid: "https://unit.vault.azure.net/keys/content/v1", value: Buffer.alloc(32, 1).toString("base64url") });
      }) as typeof fetch,
    });
    await provider.wrap(Buffer.alloc(32), Buffer.alloc(0));
    expect(seen[0]).toBe("http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net true");
  });
});

it("never logs key material or content", () => {
  const lines: string[] = [];
  const spies = (["log", "warn", "error", "info"] as const).map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
  owners = { a: { owner: "alice", confidential: true } };
  insertMessage("a", msg("m1", "orchid log check"));
  const keys = contentKeysForExport();
  closeMessageDb();
  const db = new DatabaseSync(file());
  db.exec("UPDATE messages SET sealed = zeroblob(64)");
  db.close();
  readThread("a", legacy("a"));
  eraseContentOwner("alice");
  for (const spy of spies) spy.mockRestore();
  const text = lines.join("\n");
  expect(text).not.toContain("orchid");
  for (const key of keys) {
    expect(text).not.toContain(Buffer.from(key.raw).toString("hex"));
    expect(text).not.toContain(Buffer.from(key.raw).toString("base64"));
  }
});
