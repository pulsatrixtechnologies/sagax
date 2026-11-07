// Content encryption at rest for files and logs (docs/content-encryption.md,
// "Files and logs"): the chunked file format and its additional data, bot
// memory (files and the memory_files index), attachments with ranges, event
// logs, the reversible migration and its check before every replacement, a
// Key Vault that stops answering in the middle of it, erasure and the
// backup's plaintext copy.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAttachment, saveFile, saveImage, setAttachmentStillShown } from "../attachments/attachments.ts";
import { DATA_DIR, EVENTS_DIR, NATIVE_DIR } from "../config.ts";
import {
  ContentErased,
  ContentExportLocked,
  atRestHintSizesForTests,
  atRestInfoSync,
  atRestStream,
  describeHandle,
  exportPlainCopy,
  holdPlain,
  LogReader,
  forgetLogMemory,
  noteAtRestWrite,
  sealLogLines,
  setAtRestThreadFiles,
  readAtRestSync,
  releasePlain,
  replaceInPlace,
  resetAtRestState,
  runAtRestMigration,
  setAtRestFaultForTests,
  setAtRestGrace,
  useExportedContentKeys,
} from "./content-at-rest.ts";
import { ContentSealError } from "./content-crypto.ts";
import { contentKeysForExport } from "../content-export.ts";
import { CHUNK_BYTES, FileSealer, openBuffer, parseBlockLine, parseHeader, plainSizeOf, sealBuffer, type FileKey } from "./content-file-crypto.ts";
import { azureKeyVaultProvider } from "./content-key-azure.ts";
import { ContentKeyUnavailable, WORKSPACE_OWNER } from "./content-keys.ts";
import { appendNative, flushNativeLog } from "../drivers/native.ts";
import { chatFollowups, closeMessageDb, closeMessageSearch, configureContentEncryption, contentKeyForOwner, contentOwnerChanged, eraseContentOwner, insertMessage, readThread, runContentMigration, saveChatFollowup, unlockContentKeys } from "../messages/message-db.ts";
import { appendDecision, flushDecisionLog, readDecisions } from "../decision-log.ts";
import { journalFile, readMemoryJournal, recordMemoryChange, flushMemoryJournal, resetMemoryJournalState } from "../memory/memory-journal.ts";
import { readMemoryDoc } from "../memory/memory-store.ts";
import { readRecentLines } from "../threads/thread-events.ts";
import { createWorkspaceBackup, stageWorkspaceBackup } from "../workspace-backup.ts";
import { holdBotMemoryPlain, readMemoryFile, searchMemoryFiles, workspaceDir, writeMemoryFile, writeMemoryTopic } from "../workspace/workspace.ts";
import { open as openHandle } from "node:fs/promises";
import { createSecretKey, randomBytes } from "node:crypto";

let botOwners: Record<string, string> = {};
let threadOwners: Record<string, { owner: string; confidential: boolean }> = {};
const turn = (mode: "on" | "off", provider?: Parameters<typeof configureContentEncryption>[0]["provider"]) =>
  configureContentEncryption({ mode, autoMigrate: false, resolveBotOwner: (botId) => botOwners[botId] ?? WORKSPACE_OWNER, resolveOwner: (threadId) => threadOwners[threadId] ?? { owner: WORKSPACE_OWNER, confidential: false }, ...(provider ? { provider } : {}) });
const migrateAll = async () => {
  for (let i = 0; i < 20; i++) {
    const pass = await runAtRestMigration({ sliceMs: Infinity });
    for (let j = 0; j < 100 && !runContentMigration(Infinity).done; j++);
    if (!pass.sealed && !pass.opened && !pass.resealed && !pass.logs) return pass;
  }
  return runAtRestMigration({ sliceMs: Infinity });
};
const bytesOnDisk = (path: string) => readFileSync(path).toString("latin1");
const sealedOnDisk = (path: string) => atRestInfoSync(path)?.sealed === true;
const prose = (length: number) => {
  const words = ["orchid", "zebra", "copper", "lantern", "meadow", "quartz", "harbor", "velvet"];
  let out = "";
  for (let i = 0; out.length < length; i++) out += `${words[i % words.length]}${i} `;
  return out.slice(0, length);
};
async function* chunksOf(buffer: Buffer, size = 64 * 1024) {
  for (let offset = 0; offset < buffer.length; offset += size) yield buffer.subarray(offset, offset + size);
}
const allTemps = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(path, entry.name));
      else if (entry.name.endsWith(".sgx-tmp")) out.push(join(path, entry.name));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
};

beforeEach(async () => {
  await closeMessageSearch();
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(EVENTS_DIR, { recursive: true });
  mkdirSync(NATIVE_DIR, { recursive: true });
  process.env.SAGAX_MCP_OAUTH_KEY = "cd".repeat(32); // a synthetic vault key, this process only
  botOwners = {};
  threadOwners = {};
  resetAtRestState();
  resetMemoryJournalState();
  setAtRestGrace(0);
  setAtRestFaultForTests(null);
  useExportedContentKeys(null);
  turn("on");
});
afterEach(async () => {
  setAtRestFaultForTests(null);
  useExportedContentKeys(null);
  resetAtRestState();
  await closeMessageSearch();
  closeMessageDb();
  delete process.env.SAGAX_MCP_OAUTH_KEY;
});

describe("file format", () => {
  const key = (): FileKey => ({ keyId: "k1", owner: "@workspace", dek: createSecretKey(randomBytes(32)) });

  it("round-trips every size around a chunk boundary, streamed or whole", () => {
    const k = key();
    for (const size of [0, 1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 3 * CHUNK_BYTES + 17]) {
      const plain = randomBytes(size);
      const whole = sealBuffer(k, "attachments/a.bin", plain);
      expect(openBuffer(whole, k, "attachments/a.bin").equals(plain)).toBe(true);
      expect(plainSizeOf(parseHeader(whole)!, whole.length)).toBe(size);
      const sealer = new FileSealer(k, "attachments/a.bin");
      const parts: Buffer[] = [];
      for (let offset = 0; offset < size; offset += 1000) parts.push(...sealer.push(plain.subarray(offset, offset + 1000)));
      parts.push(...sealer.end());
      expect(openBuffer(Buffer.concat(parts), k, "attachments/a.bin").equals(plain)).toBe(true);
    }
  });

  it("binds the key, the context, the order and the end of the chunks", () => {
    const k = key();
    const plain = randomBytes(3 * CHUNK_BYTES);
    const sealed = sealBuffer(k, "attachments/a.bin", plain);
    const header = parseHeader(sealed)!;
    expect(() => openBuffer(sealed, k, "attachments/b.bin")).toThrow(ContentSealError);
    expect(() => openBuffer(sealed, { ...k, owner: "someone" })).toThrow(ContentSealError);
    expect(() => openBuffer(sealed, { ...k, dek: createSecretKey(randomBytes(32)) })).toThrow(ContentSealError);
    // the last chunk dropped: the new last one was not sealed as the end
    const stride = CHUNK_BYTES + 28;
    expect(() => openBuffer(sealed.subarray(0, header.length + 2 * stride), k)).toThrow(ContentSealError);
    // two chunks swapped
    const swapped = Buffer.concat([sealed.subarray(0, header.length), sealed.subarray(header.length + stride, header.length + 2 * stride), sealed.subarray(header.length, header.length + stride), sealed.subarray(header.length + 2 * stride)]);
    expect(() => openBuffer(swapped, k)).toThrow(ContentSealError);
  });
});

describe("memory", () => {
  it("seals the files and the index, keeps every read and the recall, and goes plain for a turn", async () => {
    writeMemoryFile("b1", "# Memory\n\n- The orchid project lives in the copper lantern repo.\n");
    writeMemoryTopic("b1", "clients.md", "---\ntitle: Clients\n---\nThe zebra account pays in quartz.\n");
    await migrateAll();
    const index = join(workspaceDir("b1"), "MEMORY.md");
    const topic = join(workspaceDir("b1"), "memory", "clients.md");
    expect(sealedOnDisk(index) && sealedOnDisk(topic)).toBe(true);
    expect(bytesOnDisk(index)).not.toContain("orchid");
    expect(bytesOnDisk(topic)).not.toContain("zebra");
    expect(readMemoryFile("b1").text).toContain("copper lantern");
    expect(readMemoryDoc("b1", "memory/clients.md").text).toContain("zebra account");
    const hits = searchMemoryFiles("b1", "zebra quartz");
    expect(hits.map((hit) => hit.file)).toEqual(["memory/clients.md"]);
    expect(hits[0]!.snippet).toContain("[zebra]");
    // the index row holds no plaintext either
    closeMessageDb();
    const db = new DatabaseSync(join(DATA_DIR, "messages.db"), { readOnly: true });
    const rows = db.prepare("SELECT text, sealed, key_id FROM memory_files").all() as Array<{ text: string; sealed: Uint8Array | null; key_id: string | null }>;
    db.close();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.text).toBe("");
      expect(row.key_id).toBeTruthy();
      expect(Buffer.from(row.sealed!).toString("latin1")).not.toContain("zebra");
    }
    // a turn: plain in place for the engine's own file tools, sealed again after
    await holdBotMemoryPlain("b1", "turn:t1");
    expect(readFileSync(topic, "utf8")).toContain("zebra account");
    await migrateAll();
    expect(sealedOnDisk(topic)).toBe(false);
    releasePlain("turn:t1");
    await migrateAll();
    expect(sealedOnDisk(topic)).toBe(true);
    expect(readMemoryDoc("b1", "memory/clients.md").text).toContain("zebra account");
  });

  it("seals the journal's rows and reads them back", async () => {
    writeMemoryFile("b1", "first\n");
    recordMemoryChange("b1", { path: "MEMORY.md", actor: "person", via: "ui", before: "the velvet harbor note\n", after: "first\n" });
    await flushMemoryJournal("b1");
    expect(readFileSync(journalFile("b1"), "utf8")).not.toContain("velvet");
    expect(readMemoryJournal("b1")[0]?.before).toBe("the velvet harbor note\n");
  });
});

describe("attachments", () => {
  it("seals an upload of several megabytes, serves byte ranges and reads it whole", async () => {
    const plain = Buffer.from(prose(3 * 1024 * 1024 + 4321));
    const saved = await saveFile(chunksOf(plain), "notes.txt", "text/plain");
    const image = saveImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(prose(5000))]), "image/png");
    await migrateAll();
    expect(sealedOnDisk(saved.path)).toBe(true);
    expect(bytesOnDisk(saved.path)).not.toContain("orchid");
    expect(readAtRestSync(saved.path).equals(plain)).toBe(true);
    expect(readAttachment(image.path.split("/").at(-1)!)?.bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // a range in the middle, across a chunk boundary: only its chunks are read
    const handle = await openHandle(saved.path, "r");
    const file = await describeHandle(handle, saved.path);
    expect(file.size).toBe(plain.length);
    const start = CHUNK_BYTES - 10;
    const end = 2 * CHUNK_BYTES + 5;
    const parts: Buffer[] = [];
    for await (const part of atRestStream(handle, file, start, end)) parts.push(part as Buffer);
    expect(Buffer.concat(parts).equals(plain.subarray(start, end + 1))).toBe(true);
  });

  it("keeps the sealed original while a file is plain for a turn, and puts it back after a power cut", async () => {
    const saved = await saveFile(chunksOf(Buffer.from(prose(90_000))), "keep.txt", "text/plain");
    await migrateAll();
    await holdPlain("turn:p1", [saved.path]);
    const originals = join(DATA_DIR, ".at-rest-originals");
    expect(readdirSync(originals).length).toBe(2);
    releasePlain("turn:p1");
    // the plain copy was never flushed and the power went: zeros on disk
    writeFileSync(saved.path, Buffer.alloc(statSync(saved.path).size));
    await runAtRestMigration({ sliceMs: Infinity });
    expect(readAtRestSync(saved.path).toString()).toBe(prose(90_000));
    await migrateAll();
    expect(sealedOnDisk(saved.path)).toBe(true);
    expect(readdirSync(originals)).toEqual([]);
    // and an original whose file was deleted goes with it
    await holdPlain("turn:p2", [saved.path]);
    releasePlain("turn:p2");
    rmSync(saved.path);
    await runAtRestMigration({ sliceMs: Infinity });
    expect(readdirSync(originals)).toEqual([]);
  });

  it("goes plain in place for a turn and back after it", async () => {
    const saved = await saveFile(chunksOf(Buffer.from(prose(200_000))), "spec.md", "text/markdown");
    await migrateAll();
    expect(sealedOnDisk(saved.path)).toBe(true);
    await holdPlain("turn:t9", [saved.path]);
    expect(readFileSync(saved.path, "utf8")).toContain("orchid0");
    await migrateAll();
    expect(sealedOnDisk(saved.path)).toBe(false);
    releasePlain("turn:t9");
    await migrateAll();
    expect(sealedOnDisk(saved.path)).toBe(true);
  });
});

describe("event logs", () => {
  it("seals every line under the thread's key and reads the log as before", () => {
    appendNative("t1", { dir: "out", source: "test", msg: { text: "the meadow password" } });
    appendNative("t1", { dir: "in", source: "test", msg: { text: "a second line" } });
    flushNativeLog("t1");
    const file = join(NATIVE_DIR, "t1.ndjson");
    // out flushes at once; in is sealed with the batch on flush (server/drivers/native.ts)
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
    expect(readFileSync(file, "utf8")).not.toContain("meadow");
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).p[0].dir)).toEqual(["out", "in"]);
    const { lines } = readRecentLines(file, 10, (value): value is { msg: { text: string } } => Boolean(value));
    expect(lines.map((line) => line.msg.text)).toEqual(["the meadow password", "a second line"]);
    // a reader that needs only the "in" line opens nothing it drops (read from the disk)
    forgetLogMemory(file);
    const only = readRecentLines(file, 10, (value): value is { dir: string } => Boolean(value), (projection) => projection.dir !== "in");
    expect(only.lines.map((line) => (line as { msg?: unknown }).msg === undefined)).toEqual([true, false]);
  });

  it("has every line on disk, sealed, when its append returns: a hard kill right after loses none", () => {
    // a separate process appends one line and is killed at once: no flush, no timer, no exit handler
    const script = [
      `const db = await import(${JSON.stringify(new URL("../messages/message-db.ts", import.meta.url).href)});`,
      `db.configureContentEncryption({ mode: "on", autoMigrate: false });`,
      `const native = await import(${JSON.stringify(new URL("../drivers/native.ts", import.meta.url).href)});`,
      `native.appendNative("killed", { dir: "out", source: "test", msg: { text: "written before the kill" } });`,
      `process.kill(process.pid, "SIGKILL");`,
    ].join("\n");
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script], { env: { ...process.env }, encoding: "utf8" });
    expect(result.signal).toBe("SIGKILL");
    const file = join(NATIVE_DIR, "killed.ndjson");
    expect(readFileSync(file, "utf8")).not.toContain("written before the kill");
    const { lines } = readRecentLines(file, 10, (value): value is { msg: { text: string } } => Boolean(value));
    expect(lines.map((line) => line.msg.text)).toEqual(["written before the kill"]);
  });

  it("serves a view's next read from what it read and what this process appended since, and from the disk once the file changed otherwise", () => {
    const file = join(NATIVE_DIR, "t8.ndjson");
    const read = () => readRecentLines(file, 10, (value): value is { msg: { text: string } } => Boolean(value)).lines.map((line) => line.msg.text);
    appendNative("t8", { dir: "out", source: "test", msg: { text: "one" } });
    expect(read()).toEqual(["one"]);
    appendNative("t8", { dir: "out", source: "test", msg: { text: "two" } });
    expect(read()).toEqual(["one", "two"]);
    // another writer: the memory no longer matches the file, the disk answers
    appendFileSync(file, `${JSON.stringify({ at: "x", dir: "in", source: "elsewhere", msg: { text: "three" } })}\n`);
    expect(read()).toEqual(["one", "two", "three"]);
  });

  it("keeps what this process just wrote or opened only while its key lives", () => {
    threadOwners = { t7: { owner: "person-a", confidential: false } };
    appendNative("t7", { dir: "out", source: "test", msg: { text: "cached orchid" } });
    const file = join(NATIVE_DIR, "t7.ndjson");
    const read = () => readRecentLines(file, 10, (value): value is { msg: { text: string } } => Boolean(value)).lines.map((line) => line.msg.text);
    expect(read()).toEqual(["cached orchid"]);
    // the person is erased: their key goes, and what was kept opened of it with it
    eraseContentOwner("person-a");
    expect(read()).toEqual([]);
  });

  it("gathers a log's one-line blocks into blocks once it is quiet, checked line for line", async () => {
    for (let i = 0; i < 70; i++) appendNative("t9", { dir: "out", source: "test", msg: { text: `line ${i}` } });
    const file = join(NATIVE_DIR, "t9.ndjson");
    const blocks = () => readFileSync(file, "utf8").split("\n").filter((line) => line.includes('"sealed":"')).length;
    expect(blocks()).toBe(70);
    await migrateAll();
    expect(blocks()).toBe(2);
    const { lines } = readRecentLines(file, 100, (value): value is { msg: { text: string } } => Boolean(value));
    expect(lines.map((line) => line.msg.text)).toEqual(Array.from({ length: 70 }, (_, i) => `line ${i}`));
  });

  it("migrates a plain log to sealed and back, line for line", async () => {
    const file = join(EVENTS_DIR, "t2.ndjson");
    const plain = Array.from({ length: 50 }, (_, i) => JSON.stringify({ type: "content.delta", createdAt: `2026-10-27T00:00:${String(i).padStart(2, "0")}Z`, text: `harbor line ${i}` }));
    writeFileSync(file, `${plain.join("\n")}\n`);
    // the bus registers events/ when it loads
    await import("../harness/bus.ts");
    await migrateAll();
    const sealed = readFileSync(file, "utf8");
    expect(sealed).not.toContain("harbor");
    expect(sealed.split("\n").filter(Boolean)).toHaveLength(50);
    const physical = sealed.split("\n").filter(Boolean);
    expect(new LogReader(file).all(physical).map((record) => JSON.stringify(record))).toEqual(plain);
    turn("off");
    await migrateAll();
    expect(readFileSync(file, "utf8")).toBe(`${plain.join("\n")}\n`);
  });
});

describe("migration", () => {
  it("files: plain to sealed to plain, every byte the same", async () => {
    writeMemoryFile("b1", "the quartz meadow\n");
    const saved = await saveFile(chunksOf(Buffer.from(prose(2 * CHUNK_BYTES + 99))), "blob.txt", "text/plain");
    const data = readFileSync(saved.path);
    const index = join(workspaceDir("b1"), "MEMORY.md");
    const before = readFileSync(index);
    const mtime = statSync(index).mtimeMs;
    await migrateAll();
    expect(sealedOnDisk(index)).toBe(true);
    // the time a file was last written stays its own
    expect(statSync(index).mtimeMs).toBe(mtime);
    turn("off");
    await migrateAll();
    expect(readFileSync(index).equals(before)).toBe(true);
    expect(readFileSync(saved.path).equals(data)).toBe(true);
    expect(allTemps(DATA_DIR)).toEqual([]);
  });

  it("never replaces a file with a copy that does not read back the same", async () => {
    writeMemoryFile("b1", "the lantern note\n");
    const index = join(workspaceDir("b1"), "MEMORY.md");
    const before = readFileSync(index);
    setAtRestFaultForTests((temp) => { const bytes = readFileSync(temp); bytes[bytes.length - 1] ^= 1; writeFileSync(temp, bytes); });
    const pass = await runAtRestMigration({ sliceMs: Infinity });
    expect(pass.failed).toBeGreaterThan(0);
    expect(readFileSync(index).equals(before)).toBe(true);
    expect(allTemps(DATA_DIR)).toEqual([]);
    // nor a log
    const file = join(NATIVE_DIR, "t3.ndjson");
    turn("off");
    appendNative("t3", { dir: "in", source: "test", msg: { text: "velvet" } });
    flushNativeLog("t3");
    const log = readFileSync(file, "utf8");
    turn("on");
    await runAtRestMigration({ sliceMs: Infinity });
    expect(readFileSync(file, "utf8")).toBe(log);
    setAtRestFaultForTests(null);
    await migrateAll();
    expect(readFileSync(index).equals(before)).toBe(false);
    expect(readMemoryFile("b1").text).toBe("the lantern note\n");
  });

  it("leaves a file that changed during its copy as it is, and seals it on a later pass", async () => {
    writeMemoryFile("b1", "one\n");
    const index = join(workspaceDir("b1"), "MEMORY.md");
    setAtRestFaultForTests((_temp, original) => { if (original === index) writeFileSync(original, "two, written meanwhile\n"); });
    expect(await replaceInPlace(index, null)).toBe("skipped"); // plain to plain: nothing to do
    const key = contentKeyForOwner(WORKSPACE_OWNER)!;
    expect(await replaceInPlace(index, { keyId: key.keyId, owner: key.owner, dek: key.dek })).not.toBe("done");
    expect(readFileSync(index, "utf8")).toBe("two, written meanwhile\n");
    setAtRestFaultForTests(null);
    await migrateAll();
    expect(readMemoryFile("b1").text).toBe("two, written meanwhile\n");
    expect(sealedOnDisk(index)).toBe(true);
  });

  it("seals a file whose mtime is ahead of the clock when there is no grace", async () => {
    // mtimeMs has sub-millisecond precision; Date.now() does not. The idle
    // time is never negative, so a grace of 0 seals on the first pass.
    writeMemoryFile("b1", "the amber note\n");
    const index = join(workspaceDir("b1"), "MEMORY.md");
    const ahead = (Date.now() + 5_000) / 1000;
    utimesSync(index, ahead, ahead);
    await runAtRestMigration({ sliceMs: Infinity });
    expect(sealedOnDisk(index)).toBe(true);
    expect(readMemoryFile("b1").text).toBe("the amber note\n");
  });

  it("drops lastUse and scopeHints once a file is sealed or gone", async () => {
    writeMemoryFile("b1", "hint prune orchid\n");
    const path = join(workspaceDir("b1"), "MEMORY.md");
    noteAtRestWrite(path, { owner: WORKSPACE_OWNER });
    expect(atRestHintSizesForTests()).toEqual({ lastUse: 1, scopeHints: 1 });
    await migrateAll();
    expect(sealedOnDisk(path)).toBe(true);
    expect(atRestHintSizesForTests()).toEqual({ lastUse: 0, scopeHints: 0 });

    noteAtRestWrite(path, { owner: WORKSPACE_OWNER });
    expect(atRestHintSizesForTests().lastUse).toBe(1);
    rmSync(path);
    await runAtRestMigration({ sliceMs: Infinity });
    expect(atRestHintSizesForTests()).toEqual({ lastUse: 0, scopeHints: 0 });
  });
});

describe("Key Vault (fake client) that stops answering", () => {
  const vault = () => {
    const state = { down: false };
    const provider = azureKeyVaultProvider({
      keyUrl: "https://unit.vault.azure.net/keys/content",
      env: { AZURE_TENANT_ID: "tenant", AZURE_CLIENT_ID: "client", SAGAX_CONTENT_KEY_AZURE_CLIENT_SECRET: "client-secret-value" },
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        if (state.down) throw new TypeError("fetch failed");
        const url = String(input);
        if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "token", expires_in: 3600 });
        const value = (JSON.parse(String(init?.body)) as { value: string }).value;
        const flipped = Buffer.from(value, "base64url").reverse().toString("base64url");
        if (url.includes("/wrapkey")) return Response.json({ kid: "https://unit.vault.azure.net/keys/content/v1", value: flipped });
        if (url.includes("/unwrapkey")) return Response.json({ value: flipped });
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });
    return { state, provider };
  };

  it("seals what it can, leaves the rest exactly as it was, and finishes once it is back", async () => {
    const kv = vault();
    turn("on", kv.provider);
    await unlockContentKeys();
    botOwners = { b1: "person-a", b2: "person-b" };
    // person-a's key exists (Key Vault answered), person-b's does not yet
    expect(contentKeyForOwner("person-a")).toBeNull();
    await vi.waitFor(() => expect(contentKeyForOwner("person-a")).not.toBeNull());
    writeMemoryFile("b1", "alpha orchid\n");
    writeMemoryFile("b2", "beta zebra\n");
    const a = join(workspaceDir("b1"), "MEMORY.md");
    const b = join(workspaceDir("b2"), "MEMORY.md");
    const bBefore = readFileSync(b);
    kv.state.down = true;
    const pass = await migrateAll();
    expect(sealedOnDisk(a)).toBe(true);
    expect(readFileSync(b).equals(bBefore)).toBe(true);
    expect(pass.locked).toBeGreaterThan(0);
    expect(allTemps(DATA_DIR)).toEqual([]);
    expect(readMemoryFile("b1").text).toBe("alpha orchid\n");
    kv.state.down = false;
    contentKeyForOwner("person-b");
    await vi.waitFor(() => expect(contentKeyForOwner("person-b")).not.toBeNull());
    await migrateAll();
    expect(sealedOnDisk(b)).toBe(true);
    expect(readMemoryFile("b2").text).toBe("beta zebra\n");

    // a restart while Key Vault is unreachable: nothing reads as empty, nothing is lost
    closeMessageDb();
    const again = vault();
    again.state.down = true;
    turn("on", again.provider);
    resetAtRestState();
    setAtRestGrace(0);
    expect((await unlockContentKeys()).failed).toBeGreaterThan(0);
    expect(() => readAtRestSync(a)).toThrow(ContentKeyUnavailable);
    // never read as empty: an editor or a memory update would write over it
    expect(() => readMemoryFile("b1")).toThrow(ContentKeyUnavailable);
    turn("off", again.provider);
    await migrateAll();
    expect(sealedOnDisk(a)).toBe(true);
    again.state.down = false;
    closeMessageDb();
    turn("on", again.provider);
    await unlockContentKeys();
    expect(readMemoryFile("b1").text).toBe("alpha orchid\n");
  });
});

describe("a thread that changes hands", () => {
  it("is re-sealed whole under its new owner at once: the old owner's erasure right after takes nothing of it", async () => {
    await import("../harness/bus.ts");
    threadOwners = { t1: { owner: "person-a", confidential: true } };
    botOwners = { b1: "person-a" };
    insertMessage("t1", { id: "m1", role: "user", kind: "text", text: "the orchid contract", at: 1 });
    saveChatFollowup({ id: "f1", kind: "bot", ownerId: "b1", threadId: "t1", payload: { text: "queued zebra" } });
    appendNative("t1", { dir: "out", source: "test", msg: { text: "native quartz" } });
    writeFileSync(join(EVENTS_DIR, "t1.ndjson"), `${sealLogLines(join(EVENTS_DIR, "t1.ndjson"), [{ type: "content.delta", createdAt: "x" }], [JSON.stringify({ type: "content.delta", createdAt: "x", delta: "event lantern" })]).join("\n")}\n`);
    appendDecision(DATA_DIR, { threadId: "t1", botId: "b1", tool: "Bash", summary: "decision harbor", decision: "user-approved", source: "user" });
    await flushDecisionLog(DATA_DIR);
    writeMemoryFile("b1", "memory velvet\n");
    const saved = await saveFile(chunksOf(Buffer.from(prose(70_000))), "shared.txt", "text/plain", { owner: "person-a" });
    setAtRestThreadFiles((threadId) => (threadId === "t1" ? [saved.path] : []));
    await migrateAll();
    expect(sealedOnDisk(saved.path) && sealedOnDisk(join(workspaceDir("b1"), "MEMORY.md"))).toBe(true);
    const keysOf = () => ({
      native: readFileSync(join(NATIVE_DIR, "t1.ndjson"), "utf8").split("\n").filter(Boolean).map((line) => parseBlockLine(line)?.last?.keyId).filter(Boolean),
      file: atRestInfoSync(saved.path)?.keyId,
      memory: atRestInfoSync(join(workspaceDir("b1"), "MEMORY.md"))?.keyId,
    });
    const before = keysOf();
    // the bot and its confidential thread go to person-b, then person-a is erased at once
    threadOwners = { t1: { owner: "person-b", confidential: true } };
    botOwners = { b1: "person-b" };
    contentOwnerChanged(["t1"], ["b1"]);
    // re-sealed in the transfer itself, before any erasure
    const after = keysOf();
    expect(after.native.length && after.native.every((keyId) => !before.native.includes(keyId))).toBe(true);
    expect(after.file).not.toBe(before.file);
    expect(after.memory).not.toBe(before.memory);
    setAttachmentStillShown(() => false);
    eraseContentOwner("person-a");
    setAttachmentStillShown(() => true);
    closeMessageDb();
    expect(readThread("t1", join(DATA_DIR, "none.json")).messages.map((message) => message.text)).toEqual(["the orchid contract"]);
    expect(chatFollowups().map((followup) => followup.payload.text)).toEqual(["queued zebra"]);
    expect(readRecentLines(join(NATIVE_DIR, "t1.ndjson"), 10, (value): value is { msg: { text: string } } => Boolean(value)).lines.map((line) => line.msg.text)).toEqual(["native quartz"]);
    expect(readRecentLines(join(EVENTS_DIR, "t1.ndjson"), 10, (value): value is { delta: string } => Boolean(value)).lines.map((line) => line.delta)).toEqual(["event lantern"]);
    expect(readDecisions(DATA_DIR, 10).map((row) => row.summary)).toEqual(["decision harbor"]);
    expect(readMemoryFile("b1").text).toBe("memory velvet\n");
    expect(readAtRestSync(saved.path).toString()).toBe(prose(70_000));
    // and none of it is under the erased person's keys any more
    expect(readFileSync(join(NATIVE_DIR, "t1.ndjson"), "utf8")).not.toContain("quartz");
  });
});

describe("erasure and backups", () => {
  it("backs the workspace up in the clear inside the archive and restores plain files the destination seals", async () => {
    writeMemoryFile("b1", "the harbor velvet memory\n");
    const saved = await saveFile(chunksOf(Buffer.from(`${prose(150_000)} copperlantern`)), "doc.txt", "text/plain");
    appendNative("t1", { dir: "out", source: "test", msg: { text: "meadowquartz tool output" } });
    await migrateAll();
    expect(sealedOnDisk(saved.path) && sealedOnDisk(join(workspaceDir("b1"), "MEMORY.md"))).toBe(true);
    closeMessageDb();
    const exported = await createWorkspaceBackup(DATA_DIR, { password: "correct horse battery staple" });
    const target = mkdtempSync(join(tmpdir(), "sagax-at-rest-restore-"));
    try {
      const staged = await stageWorkspaceBackup(target, exported.path, { password: "correct horse battery staple" });
      const data = join(target, ".backups", staged.id, "staged", "data");
      expect(readFileSync(join(data, "workspaces", "b1", "MEMORY.md"), "utf8")).toBe("the harbor velvet memory\n");
      expect(readFileSync(join(data, "attachments", saved.path.split("/").at(-1)!), "utf8")).toContain("copperlantern");
      expect(readFileSync(join(data, "native", "t1.ndjson"), "utf8")).toContain("meadowquartz");
      // no sealed file and no kept original travels
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
      for (const file of walk(data)) expect(readFileSync(file).subarray(0, 4).toString("latin1")).not.toBe("SGXF");
      expect(existsSync(join(data, ".at-rest-originals"))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("erases a person's sealed files and keeps what now belongs to someone else", async () => {
    botOwners = { b1: "person-a", b2: "person-a" };
    writeMemoryFile("b1", "kept after a handover\n");
    writeMemoryFile("b2", "erased with its owner\n");
    const saved = await saveFile(chunksOf(Buffer.from(prose(70_000))), "theirs.txt", "text/plain", { owner: "person-a" });
    await migrateAll();
    expect(sealedOnDisk(saved.path)).toBe(true);
    // b1 changed hands just now (no migration pass since): the erasure
    // re-seals it under its new owner first; b2 and the upload stay person-a's
    botOwners = { b1: "person-b", b2: "person-a" };
    setAttachmentStillShown(() => false);
    eraseContentOwner("person-a");
    setAttachmentStillShown(() => true);
    expect(readMemoryFile("b1").text).toBe("kept after a handover\n");
    expect(() => readAtRestSync(join(workspaceDir("b2"), "MEMORY.md"))).toThrow(ContentErased);
    expect(readMemoryFile("b2").text).toBe("");
    expect(() => readAtRestSync(saved.path)).toThrow(ContentErased);
    expect(readAttachment(saved.path.split("/").at(-1)!)).toBeNull();
  });

  it("copies sealed files and logs in the clear for the archive, and refuses a locked key", async () => {
    writeMemoryFile("b1", "the copper harbor\n");
    appendNative("t1", { dir: "out", source: "test", msg: { text: "velvet quartz" } });
    await migrateAll();
    const out = join(DATA_DIR, "export");
    mkdirSync(out);
    const memory = join(workspaceDir("b1"), "MEMORY.md");
    expect(exportPlainCopy(memory, join(out, "MEMORY.md"), "workspaces/b1/MEMORY.md", 0o600)?.size).toBe(Buffer.byteLength("the copper harbor\n"));
    expect(readFileSync(join(out, "MEMORY.md"), "utf8")).toBe("the copper harbor\n");
    expect(exportPlainCopy(join(NATIVE_DIR, "t1.ndjson"), join(out, "t1.ndjson"), "native/t1.ndjson", 0o600)).not.toBeNull();
    expect(readFileSync(join(out, "t1.ndjson"), "utf8")).toContain("velvet quartz");
    // a plain file is the caller's to copy
    writeFileSync(join(DATA_DIR, "plain.txt"), "x");
    expect(exportPlainCopy(join(DATA_DIR, "plain.txt"), join(out, "plain.txt"), "plain.txt", 0o600)).toBeNull();
    // a worker given no key for a key that exists: the backup is refused
    const keys = contentKeysForExport();
    const stored = keys.map((key) => key.keyId);
    useExportedContentKeys([], stored);
    expect(() => exportPlainCopy(memory, join(out, "again.md"), "workspaces/b1/MEMORY.md", 0o600)).toThrow(ContentExportLocked);
    // and given the keys, it opens with them
    useExportedContentKeys(keys, stored);
    expect(exportPlainCopy(memory, join(out, "again2.md"), "workspaces/b1/MEMORY.md", 0o600)).not.toBeNull();
    expect(readFileSync(join(out, "again2.md"), "utf8")).toBe("the copper harbor\n");
  });
});
