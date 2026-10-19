import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { Header } from "tar";
import { openRuntimeStore } from "./runtime/store.ts";
import type { Assignment } from "./runtime/types.ts";
import { SessionRegistry } from "./sessions.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPendingWorkspaceRestore, commitPendingWorkspaceRestore, createWorkspaceBackup,
  readLastWorkspaceRestore, readPendingWorkspaceRestoreMetadata, readStagedWorkspaceBackup,
  removeWorkspaceBackupJob, stageWorkspaceBackup, stripConfidentialMessages,
} from "./workspace-backup.ts";
import { PrincipalRegistry } from "./principals.ts";

const PASSWORD = "correct horse battery staple";
const AVATAR_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
/** One settled assignment (server/runtime/types.ts) for the source's
 * runtime.db: the job runtime's record travels as a database snapshot. */
const RUNTIME_ROW: Assignment = {
  id: "handoff", rootId: "handoff", depth: 0,
  origin: { kind: "person", source: "chat", quote: "Ship it" },
  requester: { kind: "person", threadId: "thread" },
  assignee: { botId: "bot", destination: { kind: "standing_thread", threadId: "thread" } },
  mode: "work", reply: "resume", brief: "Ship it", status: "completed", outcome: "done", level: "ask", levelSource: "own",
  executions: 1, restarts: 0, createdAt: 1_000, lastActivityAt: 2_000, finishedAt: 2_000, result: "Built", rework: false, version: 1,
};
/** One unsettled assignment: a restore ends it instead of rerunning it. */
const RUNTIME_LIVE_ROW: Assignment = {
  ...RUNTIME_ROW, id: "live", rootId: "live", status: "running", executions: 1, restarts: 0, restart: "rerun", result: "",
  question: undefined, createdAt: 3_000, lastActivityAt: 3_000, startedAt: 3_000,
};
delete (RUNTIME_LIVE_ROW as { outcome?: unknown }).outcome;
delete (RUNTIME_LIVE_ROW as { finishedAt?: unknown }).finishedAt;
delete (RUNTIME_LIVE_ROW as { question?: unknown }).question;
const scratch: string[] = [];
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "omb-workspace-backup-"));
  scratch.push(path);
  return path;
}
function json(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value)); }
function readJson(path: string): any { return JSON.parse(readFileSync(path, "utf8")); }
function fixture(root: string): DatabaseSync {
  mkdirSync(join(root, "attachments"));
  writeFileSync(join(root, "attachments", "image.png"), Buffer.from([0, 1, 2, 255, 0, 128]));
  writeFileSync(join(root, "attachments", "avatar.png"), AVATAR_BYTES);
  mkdirSync(join(root, "task-workspaces", "bot", "thread"), { recursive: true });
  writeFileSync(join(root, "task-workspaces", "bot", "thread", "binary.bin"), Buffer.alloc(2 * 1024 * 1024, 0xa5));
  json(join(root, "config.json"), { language: "ja", instances: { custom: { driver: "claudeAgent", config: { configDir: join(root, "providers", "account") } } }, apiKey: "private-key-in-config" });
  json(join(root, "bots.json"), [{ id: "bot", threadId: "thread", cwd: join(root, "task-workspaces", "bot", "thread"), soul: `Do not rewrite this prose mentioning ${root}.`, avatarUrl: "/api/attachments/avatar.png", avatarCrop: "circle", voice: "source-provider-voice", tasks: [{ threadId: "thread", cwd: join(root, "task-workspaces", "bot", "thread") }] }]);
  json(join(root, "groups.json"), [{ id: "room", memberIds: ["bot"], cwd: "/external/project" }]);
  json(join(root, "routines.json"), { version: 1, routines: [{ id: "routine", enabled: true }], runs: [{ id: "waiting", status: "queued" }, { id: "historical", status: "completed" }] });
  json(join(root, "webhooks.json"), { version: 1, webhooks: [{ id: "hook", endpointId: "endpoint", enabled: true, secretHash: "a".repeat(64) }], deliveries: [{ id: "delivery" }] });
  json(join(root, "calendar-calls.json"), { version: 1, calls: [{ id: "call", nextRunAt: 100 }] });
  json(join(root, "delegations.json"), { thread: [{ id: "pending" }] });
  // The job runtime's record (server/runtime/store.ts): SQLite like messages.db.
  const runtime = openRuntimeStore(join(root, "runtime.db"));
  try {
    runtime.insert(RUNTIME_ROW, { kind: "enqueued", at: RUNTIME_ROW.createdAt });
    runtime.insert(RUNTIME_LIVE_ROW, { kind: "started", at: RUNTIME_LIVE_ROW.createdAt });
  } finally { runtime.close(); }
  json(join(root, "delegation-receipts.json"), [{ id: "receipt" }]);
  json(join(root, "sessions.json"), { identity: "source-session" });
  json(join(root, "cloud-owner.json"), { identity: "source-owner-record" });
  writeFileSync(join(root, "environment-id"), "source-environment");
  mkdirSync(join(root, "tools"));
  writeFileSync(join(root, "tools", "downloaded"), "reinstallable");
  mkdirSync(join(root, "decider-log"));
  writeFileSync(join(root, "decider-log", "2026-09.ndjson"), '{"seam":"roomRouting"}\n');
  const db = new DatabaseSync(join(root, "messages.db"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE messages(thread_id TEXT, id TEXT, text TEXT, json TEXT, PRIMARY KEY(thread_id,id)); CREATE TABLE thread_state(thread_id TEXT PRIMARY KEY, active_leaf_id TEXT);");
  const message = {
    id: "message", role: "user", kind: "text", at: 123,
    text: `Keep prose ${root}.\n<attached-image path="${join(root, "attachments", "image.png")}" name="image.png" />\n\n\`\`\`\n<attached-image path="${join(root, "attachments", "image.png")}" />\n\`\`\``,
    attachments: [{ kind: "image", path: join(root, "attachments", "image.png"), mime: "image/png" }],
  };
  db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?)").run("thread", message.id, message.text, JSON.stringify(message));
  db.prepare("INSERT INTO thread_state VALUES (?, ?)").run("thread", "message");
  db.exec("CREATE TABLE chat_followups(id TEXT PRIMARY KEY, kind TEXT, owner_id TEXT, thread_id TEXT, send_id TEXT, status TEXT, payload TEXT)");
  for (const status of ["pending", "dispatching", "cancelled"]) {
    db.prepare("INSERT INTO chat_followups VALUES (?, 'bot', 'bot', 'thread', ?, ?, ?)").run(status, `send-${status}`, status,
      JSON.stringify({ text: message.text, replyToId: "message", prompt: "Source-only reply context" }));
  }
  return db;
}
// One salt and key for every forged payload: the product scrypt (N = 2^17) is
// deliberately slow, and a test that forges many payloads would otherwise pay
// for it twice per payload and time out on a loaded machine.
let forgedKey: { salt: Buffer; key: Buffer } | undefined;
function encryptedPayload(root: string, plaintext: Buffer): string {
  if (!forgedKey) {
    const salt = randomBytes(16);
    forgedKey = { salt, key: scryptSync(PASSWORD, salt, 32, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 ** 2 }) };
  }
  const { salt, key } = forgedKey;
  const iv = randomBytes(12);
  const header = Buffer.concat([Buffer.from("OMB-WORKSPACE-1\n"), salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  // The importer reads the encrypted bytes. The old extension is still accepted.
  const path = join(root, "malicious.ombbackup");
  writeFileSync(path, Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]));
  return path;
}
function tarEntry(path: string, type: "File" | "Directory" | "SymbolicLink" | "Link" | "FIFO" = "File", content = "", size = Buffer.byteLength(content)): Buffer {
  const header = new Header({ path, type, size, mode: 0o600, ...(type === "Link" || type === "SymbolicLink" ? { linkpath: "/outside" } : {}) });
  const block = Buffer.alloc(512);
  header.encode(block);
  const body = Buffer.from(content);
  return Buffer.concat([block, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}
afterEach(() => { for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("encrypted full workspace backups", () => {
  it("round-trips WAL conversations, binary files, drafts and IDs; preserves destination identity and connections", async () => {
    const source = directory();
    const db = fixture(source);
    // Production closes its sole live message handle after draining writes,
    // while the maintenance gate is held. No server mutation can reopen it.
    db.close();
    try {
      json(join(source, "team-computers.json"), { version: 1, environmentId: "source-environment", computers: [{ id: "source-computer", name: "Source desktop", section: "Design" }] });
      const originalDb = readFileSync(join(source, "messages.db"));
      const originalRuntimeDb = readFileSync(join(source, "runtime.db"));
      const exported = await createWorkspaceBackup(source, {
        password: PASSWORD, appVersion: "test",
        clientState: { "omb-drafts": '{"thread":"unsent"}', "omb-draft-attachments": JSON.stringify({ thread: [{ kind: "file", path: join(source, "attachments", "image.png") }] }) },
      });
      expect(exported.path.endsWith("workspace.sagaxbackup")).toBe(true);
      expect(exported.summary).toMatchObject({ bots: 1, groups: 1, threads: 1, messages: 1 });
      expect(exported.summary).not.toHaveProperty("includesCredentials");
      const encrypted = readFileSync(exported.path);
      expect(encrypted.includes(Buffer.from("private-secret"))).toBe(false);
      expect(encrypted.includes(Buffer.from("private-key-in-config"))).toBe(false);
      expect(readFileSync(join(source, "messages.db"))).toEqual(originalDb);
      expect(readFileSync(join(source, "runtime.db"))).toEqual(originalRuntimeDb);
      const target = directory();
      const connections = { xai: { key: "destination-key", url: "https://destination.example" }, instances: { local: { driver: "claudeAgent", config: { configDir: join(target, "providers", "local") } } } };
      json(join(target, "config.json"), { ...connections, language: "en" });
      json(join(target, "bots.json"), [{ id: "old" }]);
      json(join(target, "sessions.json"), { identity: "target-session" });
      json(join(target, "cloud-owner.json"), { identity: "target-owner-record" });
      const targetComputers = { version: 1, environmentId: "target-environment", computers: [{ id: "target-computer", name: "Destination desktop", section: null }] };
      json(join(target, "team-computers.json"), targetComputers);
      writeFileSync(join(target, "environment-id"), "target-environment");
      writeFileSync(join(target, "openmausbot-server.lease"), "live-lease");
      writeFileSync(join(target, "messages.db-wal"), "old database WAL must not enter the new DB");
      writeFileSync(join(target, "messages.db-shm"), "old database shared memory");
      const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
      expect(staged.summary).toEqual(exported.summary);
      expect(readJson(join(target, "bots.json"))).toEqual([{ id: "old" }]);
      expect(readStagedWorkspaceBackup(target, staged.id)).not.toHaveProperty("credentials");
      const data = join(target, ".backups", staged.id, "staged", "data");
      expect(existsSync(join(data, "team-computers.json"))).toBe(false);
      expect(existsSync(join(data, "bots.json"))).toBe(true);
      expect(existsSync(join(data, "runtime.db"))).toBe(true);
      expect(existsSync(join(data, "cloud-owner.json"))).toBe(false);
      expect(readJson(join(data, "config.json"))).toEqual({ language: "ja" });
      expect(readJson(join(data, "webhooks.json")).webhooks[0]).not.toHaveProperty("secretHash");
      expect(commitPendingWorkspaceRestore(target, staged.id)).toMatchObject({ id: staged.id, restartRequired: true });
      expect(readPendingWorkspaceRestoreMetadata(target)?.id).toBe(staged.id);
      const result = applyPendingWorkspaceRestore(target);
      expect(result).toMatchObject({ restored: true, id: staged.id });
      const restoredBot = readJson(join(target, "bots.json"))[0];
      expect(restoredBot).toMatchObject({ id: "bot", cwd: join(target, "task-workspaces", "bot", "thread"), soul: `Do not rewrite this prose mentioning ${source}.`, avatarUrl: "/api/attachments/avatar.png", avatarCrop: "circle" });
      expect(restoredBot).not.toHaveProperty("voice");
      expect(readFileSync(join(target, restoredBot.avatarUrl.slice("/api/".length)))).toEqual(AVATAR_BYTES);
      expect(readJson(join(target, "groups.json"))[0].cwd).toBe("/external/project");
      expect(readJson(join(target, "config.json"))).toEqual({ ...connections, language: "ja" });
      expect(readFileSync(join(target, "task-workspaces", "bot", "thread", "binary.bin"))).toEqual(Buffer.alloc(2 * 1024 * 1024, 0xa5));
      expect(readJson(join(target, "sessions.json"))).toEqual({ identity: "target-session" });
      // A Cloud home's record of its owner is this machine's: never carried, kept in place.
      expect(readJson(join(target, "cloud-owner.json"))).toEqual({ identity: "target-owner-record" });
      expect(readJson(join(target, "team-computers.json"))).toEqual(targetComputers);
      expect(readFileSync(join(target, "environment-id"), "utf8")).toBe("target-environment");
      expect(readFileSync(join(target, "openmausbot-server.lease"), "utf8")).toBe("live-lease");
      expect(existsSync(join(target, "messages.db-wal"))).toBe(false);
      expect(readFileSync(join(result.safetyCopyPath!, "data", "messages.db-wal"), "utf8")).toBe("old database WAL must not enter the new DB");
      expect(existsSync(join(target, "tools"))).toBe(false);
      // this machine's decision-model log stays on this machine
      expect(existsSync(join(target, "decider-log"))).toBe(false);
      expect(readJson(join(result.safetyCopyPath!, "data", "bots.json"))).toEqual([{ id: "old" }]);
      const restoredDb = new DatabaseSync(join(target, "messages.db"), { readOnly: true });
      try {
        const row = restoredDb.prepare("SELECT json FROM messages WHERE id='message'").get()!;
        const message = JSON.parse(String(row.json));
        expect(message.attachments[0].path).toBe(join(target, "attachments", "image.png"));
        expect(readFileSync(message.attachments[0].path)).toEqual(Buffer.from([0, 1, 2, 255, 0, 128]));
        expect(message.text).toContain(`Keep prose ${source}.`);
        expect(message.text).toContain(`<attached-image path="${join(target, "attachments", "image.png")}" name="image.png" />`);
        expect(message.text).toContain(`\`\`\`\n<attached-image path="${join(source, "attachments", "image.png")}" />\n\`\`\``);
        expect(restoredDb.prepare("SELECT active_leaf_id FROM thread_state").get()?.active_leaf_id).toBe("message");
        expect(restoredDb.prepare("SELECT id, status FROM chat_followups ORDER BY rowid").all()).toEqual([
          { id: "pending", status: "interrupted" }, { id: "dispatching", status: "interrupted" }, { id: "cancelled", status: "cancelled" },
        ]);
        const followup = JSON.parse(String(restoredDb.prepare("SELECT payload FROM chat_followups WHERE id = 'pending'").get()!.payload));
        expect(followup).toMatchObject({ replyToId: "message", text: expect.stringContaining(join(target, "attachments", "image.png")) });
        expect(followup).not.toHaveProperty("prompt");
      } finally { restoredDb.close(); }
      expect(readJson(join(target, "routines.json"))).toMatchObject({ routines: [{ enabled: false }], runs: [{ status: "failed" }, { status: "completed" }] });
      expect(readJson(join(target, "webhooks.json"))).toMatchObject({ webhooks: [{ enabled: false }], deliveries: [{ id: "delivery" }] });
      expect(readJson(join(target, "webhooks.json")).webhooks[0].secretHash).toMatch(/^[a-f0-9]{64}$/);
      expect(readJson(join(target, "webhooks.json")).webhooks[0].secretHash).not.toBe("a".repeat(64));
      expect(readJson(join(target, "calendar-calls.json")).calls[0].nextRunAt).toBeNull();
      expect(readJson(join(target, "delegations.json"))).toEqual({});
      // The runtime's record arrives as a database snapshot like messages.db,
      // never its WAL. Settled rows travel as they are; unsettled work ends
      // here with the reason, because the source may still be running it and
      // a restore is not a restart (the §5 rerun is for restarts only).
      expect(existsSync(join(target, "runtime.db-wal"))).toBe(false);
      const restoredRuntime = new DatabaseSync(join(target, "runtime.db"), { readOnly: true });
      try {
        const rows = restoredRuntime.prepare("SELECT json FROM assignments ORDER BY created_at").all().map((row) => JSON.parse(String(row.json)));
        expect(rows[0]).toEqual(RUNTIME_ROW);
        expect(rows[1]).toMatchObject({ id: "live", status: "failed", outcome: "interrupted", result: "Not resumed after workspace restore." });
        expect(rows[1]).not.toHaveProperty("restart");
        expect(restoredRuntime.prepare("SELECT status FROM assignments WHERE id = 'live'").get()).toEqual({ status: "failed" });
        expect(restoredRuntime.prepare("SELECT kind FROM assignment_events ORDER BY id").all().map((row) => row.kind)).toEqual(["enqueued", "started", "settled"]);
      } finally { restoredRuntime.close(); }
      expect(readJson(join(target, "delegation-receipts.json"))).toEqual([{ id: "receipt" }]);
      const receipt = readLastWorkspaceRestore(target)!;
      expect(receipt.id).toBe(staged.id);
      expect(receipt).not.toHaveProperty("credentials");
      expect(JSON.parse(receipt.clientState!["omb-draft-attachments"]).thread[0].path).toBe(join(target, "attachments", "image.png"));
      expect(applyPendingWorkspaceRestore(target)).toEqual({ restored: false });
      if (process.platform !== "win32") {
        expect(statSync(exported.path).mode & 0o777).toBe(0o600);
        expect(statSync(join(target, "attachments", "image.png")).mode & 0o777).toBe(0o600);
      }
    } finally { if (db.isOpen) db.close(); }
  });

  it("also pauses pending chat follow-ups when restoring into the original home", async () => {
    const source = directory();
    fixture(source).close();
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(source, staged.id);
    applyPendingWorkspaceRestore(source);
    const db = new DatabaseSync(join(source, "messages.db"), { readOnly: true });
    try {
      expect(db.prepare("SELECT id, status FROM chat_followups ORDER BY rowid").all()).toEqual([
        { id: "pending", status: "interrupted" }, { id: "dispatching", status: "interrupted" }, { id: "cancelled", status: "cancelled" },
      ]);
    } finally { db.close(); }
  });

  it("authenticates before extraction and leaves the existing workspace unchanged for wrong passwords or damaged ciphertext", async () => {
    const source = directory();
    json(join(source, "bots.json"), []);
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    writeFileSync(join(target, "untouched"), "original");
    await expect(stageWorkspaceBackup(target, exported.path, { password: "incorrect-password" })).rejects.toThrow(/password is incorrect/);
    expect(readdirSync(join(target, ".backups"))).toEqual([]);
    const corrupted = readFileSync(exported.path);
    corrupted[corrupted.length - 1] ^= 1;
    // A damaged .ombbackup is still rejected as an import, not by its name.
    const path = join(source, "corrupted.ombbackup");
    writeFileSync(path, corrupted);
    await expect(stageWorkspaceBackup(target, path, { password: PASSWORD })).rejects.toThrow(/damaged/);
    expect(readFileSync(join(target, "untouched"), "utf8")).toBe("original");
    expect(readdirSync(join(target, ".backups"))).toEqual([]);
  });

  it("leaves owned authentication stores out of the archive and retains only the destination copies", async () => {
    const source = directory();
    const target = directory();
    const authPaths = [
      "workspace-credentials.json", "browser-engine-key", "config.json.123.tmp",
      "external-runtimes.json", "external-runtimes.json.123.tmp",
      "providers/account/auth.json", "providers/antigravity/account/acp_token.json",
      "caddy/data/private.key", "chrome-profile/Cookies", ".agent-browser/auth.json",
      "vm-home/.browser-profiles/chrome/Cookies", "vm-homes/abc/.browser-profiles/chromium/Cookies",
      "tmp/omb-mcp-123/mcp.json", ".tmp/secret",
      // Saved website logins and their key (server/login-store.ts).
      "logins.json.enc", "logins-key", "logins.json.enc.123.05a7b3e0-1234.tmp",
    ];
    for (const root of [source, target]) {
      for (const path of authPaths) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), root === source ? "SOURCE_SAVED_SECRET" : "DESTINATION_SAVED_SECRET");
      }
    }
    mkdirSync(join(source, "attachments"));
    writeFileSync(join(source, "attachments", "user-note.txt"), "A user-pasted secret is not silently redacted.");
    writeFileSync(join(source, "vm-home", "project.txt"), "ordinary managed VM file");
    json(join(source, "config.json"), { xai: { key: "SOURCE_SAVED_SECRET", url: "https://source.example" }, language: "ja" });
    json(join(source, "webhooks.json"), { webhooks: [
      { id: "same", endpointId: "same-endpoint", secretHash: "a".repeat(64), enabled: true, verificationPending: true },
      { id: "typed", endpointId: "typed-endpoint", secretHash: "c".repeat(64), pendingToken: "whsec_SOURCE_PENDING", signingSecret: "whsec_SOURCE_SIGNING", source: { type: "github", events: [], filters: {} }, enabled: true },
      { id: "kept", endpointId: "kept-endpoint", secretHash: "d".repeat(64), signingSecret: "whsec_SOURCE_SIGNING_KEPT", source: { type: "email", events: [], filters: {}, graph: { connector: "ms365" } }, graphSubscription: { id: "SOURCE_SUBSCRIPTION", resource: "me/events", connector: "ms365", expiresAt: 1, clientStateHash: "x" }, enabled: true },
    ] });
    // A poller's sealed password store never travels in a backup.
    writeFileSync(join(source, "trigger-poller-credentials.enc"), "SOURCE_SAVED_SECRET_POLLER");
    json(join(target, "config.json"), { xai: { key: "DESTINATION_SAVED_SECRET", url: "https://destination.example" }, language: "en" });
    json(join(target, "webhooks.json"), { webhooks: [
      { id: "same", endpointId: "same-endpoint", secretHash: "b".repeat(64) },
      { id: "kept", endpointId: "kept-endpoint", secretHash: "e".repeat(64), signingSecret: "whsec_DESTINATION_SIGNING", graphSubscription: { id: "DESTINATION_SUBSCRIPTION", resource: "me/events", connector: "ms365", expiresAt: 1, clientStateHash: "y" } },
    ] });
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    const staging = join(target, ".backups", staged.id, "staged");
    const manifest = readJson(join(staging, "manifest.json"));
    expect(manifest).not.toHaveProperty("credentials");
    expect(manifest.summary).not.toHaveProperty("includesCredentials");
    for (const path of authPaths) expect(existsSync(join(staging, "data", path))).toBe(false);
    for (const entry of manifest.entries) if (entry.type === "file") {
      const text = readFileSync(join(staging, "data", entry.path), "utf8");
      for (const secret of ["SOURCE_SAVED_SECRET", "SOURCE_PENDING", "SOURCE_SIGNING", "SOURCE_SUBSCRIPTION"]) expect(text).not.toContain(secret);
    }
    expect(existsSync(join(staging, "data", "trigger-poller-credentials.enc"))).toBe(false);
    commitPendingWorkspaceRestore(target, staged.id);
    applyPendingWorkspaceRestore(target);
    for (const path of authPaths) expect(readFileSync(join(target, path), "utf8")).toBe("DESTINATION_SAVED_SECRET");
    expect(readFileSync(join(target, "vm-home", "project.txt"), "utf8")).toBe("ordinary managed VM file");
    expect(readFileSync(join(target, "attachments", "user-note.txt"), "utf8")).toBe("A user-pasted secret is not silently redacted.");
    expect(readJson(join(target, "config.json"))).toEqual({ xai: { key: "DESTINATION_SAVED_SECRET", url: "https://destination.example" }, language: "ja" });
    const restoredHooks = readJson(join(target, "webhooks.json")).webhooks;
    expect(restoredHooks[0]).toMatchObject({ secretHash: "b".repeat(64), enabled: false, verificationPending: false });
    // A typed trigger new to this server has no signing secret (the pop-up
    // asks for a new one); one this server already knew keeps its own.
    expect(restoredHooks[1]).toMatchObject({ id: "typed", enabled: false });
    expect(restoredHooks[1]).not.toHaveProperty("signingSecret");
    expect(restoredHooks[1]).not.toHaveProperty("pendingToken");
    expect(restoredHooks[2]).toMatchObject({ id: "kept", signingSecret: "whsec_DESTINATION_SIGNING", graphSubscription: { id: "DESTINATION_SUBSCRIPTION" } });
    // Export is read-only: the original login stores and webhook hash remain.
    for (const path of authPaths) expect(readFileSync(join(source, path), "utf8")).toBe("SOURCE_SAVED_SECRET");
    expect(readJson(join(source, "webhooks.json")).webhooks[0].secretHash).toBe("a".repeat(64));
  });

  it("never lists a per-turn hook token directory in a backup manifest", async () => {
    const source = directory();
    mkdirSync(join(source, "hook-tokens"), { mode: 0o700 });
    writeFileSync(join(source, "hook-tokens", `${"a".repeat(24)}.token`), "SOURCE_TURN_BEARER", { mode: 0o600 });
    mkdirSync(join(source, "attachments"));
    writeFileSync(join(source, "attachments", "note.txt"), "ordinary user file");
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    const staging = join(source, ".backups", staged.id, "staged");
    const paths: string[] = readJson(join(staging, "manifest.json")).entries.map((entry: { path: string }) => entry.path);
    expect(paths).toContain("attachments/note.txt");
    expect(paths.filter((path) => /token/i.test(path))).toEqual([]);
    expect(existsSync(join(staging, "data", "hook-tokens"))).toBe(false);
    for (const path of paths) {
      if (statSync(join(staging, "data", path)).isFile()) expect(readFileSync(join(staging, "data", path), "utf8")).not.toContain("SOURCE_TURN_BEARER");
    }
  });

  it("leaves the Organization library's downloaded catalog and release files out, and keeps what the runtime added", async () => {
    const source = directory(), library = join(source, "org-library"), sha = "b".repeat(64);
    mkdirSync(join(library, "blobs"), { recursive: true, mode: 0o700 });
    json(join(library, "state.json"), { version: 1, source: null, appliedDigest: null, installs: {} });
    json(join(library, "presets.json"), { version: 1, presets: [] });
    writeFileSync(join(library, "catalog.json"), "ORGANIZATION_CATALOG_BYTES", { mode: 0o600 });
    writeFileSync(join(library, `catalog.json.${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}.tmp`), "ORGANIZATION_CATALOG_BYTES", { mode: 0o600 });
    writeFileSync(join(library, "blobs", `${sha}.json`), "ORGANIZATION_RELEASE_BYTES", { mode: 0o600 });
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    const staging = join(source, ".backups", staged.id, "staged");
    const paths: string[] = readJson(join(staging, "manifest.json")).entries.map((entry: { path: string }) => entry.path);
    expect(paths.filter((path) => path.startsWith("org-library"))).toEqual(["org-library", "org-library/presets.json", "org-library/state.json"]);
    expect(existsSync(join(staging, "data", "org-library", "blobs"))).toBe(false);
    for (const path of paths) {
      if (statSync(join(staging, "data", path)).isFile()) expect(readFileSync(join(staging, "data", path), "utf8")).not.toMatch(/ORGANIZATION_(?:CATALOG|RELEASE)_BYTES/);
    }
  });

  it("keeps the destination's local operator when restoring an archive without principals", async () => {
    const source = directory();
    writeFileSync(join(source, "note.txt"), "from before principals");
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    const local = new PrincipalRegistry({ path: join(target, "principals.json") }).localOperator("jc@example.com");
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(target, staged.id);
    expect(applyPendingWorkspaceRestore(target)).toMatchObject({ restored: true });
    expect(readFileSync(join(target, "note.txt"), "utf8")).toBe("from before principals");
    const after = new PrincipalRegistry({ path: join(target, "principals.json") });
    expect(after.local()?.id).toBe(local.id);
    expect(after.list()).toHaveLength(1);
  });

  it("merges an archive's principals by id and never replaces the destination's local operator", async () => {
    const source = directory();
    const sourceRegistry = new PrincipalRegistry({ path: join(source, "principals.json") });
    const sourceLocal = sourceRegistry.localOperator("old@example.com");
    const zach = sourceRegistry.forAccount({ email: "zach@example.com" });
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    const targetRegistry = new PrincipalRegistry({ path: join(target, "principals.json") });
    const local = targetRegistry.localOperator("jc@example.com");
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(target, staged.id);
    expect(applyPendingWorkspaceRestore(target)).toMatchObject({ restored: true });
    const after = new PrincipalRegistry({ path: join(target, "principals.json") });
    expect(after.local()?.id).toBe(local.id);
    expect(after.list().filter((p) => p.local)).toHaveLength(1);
    expect(after.byId(zach.id)).toMatchObject({ email: "zach@example.com" });
    expect(after.byId(sourceLocal.id)).toMatchObject({ email: "old@example.com" });
    expect(after.byId(sourceLocal.id)?.local).toBeUndefined();
  });

  it("leaves the destination's session open-marker in place, so a crash before a restore still ends account sign-ins", async () => {
    const source = directory(), target = directory();
    json(join(source, "bots.json"), [{ id: "bot" }]);
    // The source is running: its marker exists, and is never exported.
    writeFileSync(join(source, "sessions.json.open"), "Session registry is open.\n");
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    // The destination crashed with an account session saved.
    const sessions = new SessionRegistry({ file: join(target, "sessions.json") });
    sessions.issue({ label: "Member", scopes: ["client"], userId: "user-1" });
    expect(existsSync(join(target, "sessions.json.open"))).toBe(true);
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    expect(readJson(join(target, ".backups", staged.id, "staged", "manifest.json")).entries.map((entry: { path: string }) => entry.path)).not.toContain("sessions.json.open");
    commitPendingWorkspaceRestore(target, staged.id);
    expect(applyPendingWorkspaceRestore(target)).toMatchObject({ restored: true });
    expect(existsSync(join(target, "sessions.json.open"))).toBe(true);
    expect(existsSync(join(target, ".backups", `safety-${staged.id}`, "data", "sessions.json.open"))).toBe(false);
    expect(new SessionRegistry({ file: join(target, "sessions.json") }).list()).toEqual([]);
  });

  it("never lets tar decompress a payload: zstd is refused like gzip", async () => {
    const root = directory();
    const archive = encryptedPayload(root, Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.alloc(1020)]));
    await expect(stageWorkspaceBackup(directory(), archive, { password: PASSWORD })).rejects.toThrow(/Compressed payloads are not supported/);
  });

  it("leaves a confidential thread's Data folder out of the backup and keeps every other sheet", async () => {
    const source = directory();
    const thread = join(source, "data-scopes", "bot", "t-0123456789abcdef");
    const person = join(source, "data-scopes", "bot", "p-0123456789abcdef");
    for (const folderPath of [join(thread, "data-exports"), person, join(source, "bots", "bot")]) mkdirSync(folderPath, { recursive: true });
    writeFileSync(join(thread, "sheet.json"), '{"cards":[{"sql":"SELECT CONFIDENTIAL_SHEET"}]}');
    writeFileSync(join(thread, "data-exports", "x.csv"), "CONFIDENTIAL_SHEET");
    writeFileSync(join(person, "sheet.json"), '{"cards":[{"sql":"SELECT PERSON_SHEET"}]}');
    writeFileSync(join(source, "bots", "bot", "sheet.json"), '{"cards":[{"sql":"SELECT BOT_SHEET"}]}');
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    const staging = join(source, ".backups", staged.id, "staged");
    const paths: string[] = readJson(join(staging, "manifest.json")).entries.map((entry: { path: string }) => entry.path);
    expect(paths).toContain("data-scopes/bot/p-0123456789abcdef/sheet.json");
    expect(paths).toContain("bots/bot/sheet.json");
    expect(paths.filter((path) => path.includes("t-0123456789abcdef"))).toEqual([]);
    for (const path of paths) {
      if (statSync(join(staging, "data", path)).isFile()) expect(readFileSync(join(staging, "data", path), "utf8")).not.toContain("CONFIDENTIAL_SHEET");
    }
  });

  it("leaves a confidential thread's teammate work out of the runtime database it backs up", async () => {
    const source = directory();
    json(join(source, "bots.json"), [{ id: "bot", threadId: "plain", tasks: [{ threadId: "plain" }, { threadId: "secret", confidential: true }] }]);
    const runtime = openRuntimeStore(join(source, "runtime.db"));
    try {
      // the confidential thread asked a teammate (root and child), and did work for another tree
      runtime.insert({ ...RUNTIME_ROW, id: "asked", rootId: "asked", brief: "CONFIDENTIAL_BRIEF", result: "CONFIDENTIAL_RESULT",
        requester: { kind: "person", threadId: "secret" }, assignee: { botId: "bot", destination: { kind: "standing_thread", threadId: "secret" } } },
      { kind: "enqueued", detail: "needs_input: CONFIDENTIAL_QUESTION" });
      runtime.insert({ ...RUNTIME_ROW, id: "asked1", rootId: "asked", parentId: "asked", depth: 1, brief: "CONFIDENTIAL_CHILD",
        requester: { kind: "bot_turn", botId: "bot", threadId: "secret" }, assignee: { botId: "peer", destination: { kind: "work_thread", threadId: "w" } } },
      { kind: "enqueued" });
      runtime.addInbox({ id: "inbox", ownerThreadId: "secret", assignmentId: "asked1", kind: "settled", createdAt: 2_000 });
      runtime.insert({ ...RUNTIME_ROW, id: "theirs", rootId: "theirs", brief: "ORDINARY_BRIEF" }, { kind: "enqueued" });
      runtime.insert({ ...RUNTIME_ROW, id: "theirs1", rootId: "theirs", parentId: "theirs", depth: 1, brief: "CONFIDENTIAL_WORK",
        result: "CONFIDENTIAL_WORK_RESULT", requester: { kind: "bot_turn", botId: "bot", threadId: "thread" },
        assignee: { botId: "bot", destination: { kind: "work_thread", threadId: "secret" } } }, { kind: "enqueued" });
      runtime.insert({ ...RUNTIME_ROW, id: "plain", rootId: "plain", brief: "PLAIN_BRIEF",
        requester: { kind: "person", threadId: "plain" }, assignee: { botId: "bot", destination: { kind: "standing_thread", threadId: "plain" } } },
      { kind: "enqueued" });
    } finally { runtime.close(); }
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    const snapshot = join(target, ".backups", staged.id, "staged", "data", "runtime.db");
    expect(readFileSync(snapshot).includes("CONFIDENTIAL")).toBe(false);
    const db = new DatabaseSync(snapshot, { readOnly: true });
    try {
      expect((db.prepare("SELECT id FROM assignments ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id)).toEqual(["plain"]);
      expect(db.prepare("SELECT count(*) AS n FROM inbox").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) AS n FROM assignment_events WHERE assignment_id <> 'plain'").get()).toEqual({ n: 0 });
    } finally { db.close(); }
    // the live database itself is untouched by the backup
    const live = openRuntimeStore(join(source, "runtime.db"));
    try { expect(live.all().map((row) => row.id).sort()).toEqual(["asked", "asked1", "plain", "theirs", "theirs1"]); } finally { live.close(); }
  });

  it("strips a confidential thread's receipts and search terms from the message snapshot, and the terms of a thread deleted live", () => {
    const root = directory();
    const path = join(root, "messages-snapshot.db");
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE messages(thread_id TEXT, id TEXT, text TEXT, json TEXT, PRIMARY KEY(thread_id,id));
      CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='unicode61');
      CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text); END;
      CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text); END;
      CREATE TABLE command_receipts(kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, result TEXT NOT NULL, PRIMARY KEY (kind, key));`);
    const insert = db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?)");
    insert.run("secret", "m1", "confidentialterm alpha", "{}");
    insert.run("gone", "m1", "deletedterm beta", "{}");
    insert.run("plain", "m1", "ordinaryterm gamma", "{}");
    const receipt = db.prepare("INSERT INTO command_receipts VALUES ('digest.append', ?, 1, ?)");
    receipt.run("secret:turn", JSON.stringify({ text: "confidentialreceipt" }));
    receipt.run("plain:turn", JSON.stringify({ text: "ordinaryreceipt" }));
    // a thread deleted live before the backup: only a delete marker in the index
    db.prepare("DELETE FROM messages WHERE thread_id = 'gone'").run();
    db.close();
    stripConfidentialMessages(path, new Set(["secret"]));
    const bytes = readFileSync(path);
    for (const term of ["confidentialterm", "confidentialreceipt", "deletedterm"]) expect(bytes.includes(term)).toBe(false);
    const after = new DatabaseSync(path, { readOnly: true });
    try {
      expect(after.prepare("SELECT key FROM command_receipts").all()).toEqual([{ key: "plain:turn" }]);
      expect(after.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'ordinaryterm'").all()).toHaveLength(1);
    } finally { after.close(); }
    // with no confidential thread left, a deletion since the last backup still cleans the copy
    const second = join(root, "second.db");
    const db2 = new DatabaseSync(second);
    db2.exec("CREATE TABLE messages(thread_id TEXT, id TEXT, text TEXT, json TEXT, PRIMARY KEY(thread_id,id));");
    db2.prepare("INSERT INTO messages VALUES ('gone', 'm1', ?, '{}')").run(`freepageterm ${"x".repeat(8_000)}`);
    db2.prepare("DELETE FROM messages").run();
    db2.close();
    // nothing to do without a confidential thread or a deletion since the last backup
    stripConfidentialMessages(second, new Set());
    expect(readFileSync(second).includes("freepageterm")).toBe(true);
    stripConfidentialMessages(second, new Set(), true);
    expect(readFileSync(second).includes("freepageterm")).toBe(false);
  });

  // The engines' own transcripts of a confidential thread (server/engine-transcripts.ts).
  const SECRET_T = "5ec5ec5e-1111-4111-8111-111111111111";
  const SECRET_SID = "aaaaaaaa-3333-4333-8333-333333333333";
  const OLD_SID = "abababab-3333-4333-8333-444444444444";
  const LOGGED_SID = "acacacac-3333-4333-8333-555555555555";
  const PLAIN_SID = "bbbbbbbb-4444-4444-8444-444444444444";
  const CODEX_SECRET = "019a0000-5555-7555-8555-555555555555";
  const CODEX_PLAIN = "019a0000-6666-7666-8666-666666666666";
  const put = (path: string, content: string | Buffer) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); };
  function engineHomes(root: string, logged = true): void {
    const claude = join(root, "principals", "pr_ana", "claude");
    put(join(claude, "projects", `-x-task-workspaces-bot-${SECRET_T}`, `${SECRET_SID}.jsonl`), "CONFIDENTIAL_ENGINE transcript\n");
    put(join(claude, "projects", "-x-task-workspaces-bot-plain", `${PLAIN_SID}.jsonl`), `ORDINARY transcript that lists ${SECRET_T}\n`);
    put(join(claude, "todos", `${OLD_SID}-agent-${OLD_SID}.json`), "CONFIDENTIAL_ENGINE todo");
    put(join(claude, "history.jsonl"), `${JSON.stringify({ display: "CONFIDENTIAL_ENGINE prompt", project: `/x/task-workspaces/bot/${SECRET_T}`, sessionId: SECRET_SID })}\n${JSON.stringify({ display: "ORDINARY prompt", project: "/x/task-workspaces/bot/plain", sessionId: PLAIN_SID })}\n`);
    const codex = join(root, "principals", "pr_ana", "codex");
    put(join(codex, "sessions", "2026", "10", "18", `rollout-2026-10-18T10-00-00-${CODEX_SECRET}.jsonl`), "CONFIDENTIAL_ENGINE rollout\n");
    put(join(codex, "sessions", "2026", "10", "18", `rollout-2026-10-18T11-00-00-${CODEX_PLAIN}.jsonl`), "ORDINARY rollout\n");
    const state = new DatabaseSync(join(codex, "state_5.sqlite"));
    state.exec("PRAGMA journal_mode = WAL; CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, title TEXT NOT NULL)");
    state.prepare("INSERT INTO threads VALUES (?, ?, 'CONFIDENTIAL_ENGINE title')").run(CODEX_SECRET, `/x/task-workspaces/bot/${SECRET_T}`);
    state.prepare("INSERT INTO threads VALUES (?, ?, 'ORDINARY title')").run(CODEX_PLAIN, "/x/task-workspaces/bot/plain");
    state.close();
    put(join(root, "engine-policies", "hermes-org", "sessions", `session_${SECRET_SID}.json`), "CONFIDENTIAL_ENGINE hermes");
    // a session only the thread's event log names (no archive carries that log)
    if (logged) put(join(root, "principals", "pr_ana", "grok", ".grok", "sessions", "shared", LOGGED_SID, "chat_history.jsonl"), "CONFIDENTIAL_ENGINE grok");
  }
  const roster = [{ id: "bot", threadId: "plain", tasks: [
    { threadId: "plain", resumeCursors: { claude: PLAIN_SID } },
    { threadId: SECRET_T, confidential: true, resumeCursors: { claude: SECRET_SID }, engineSessions: [OLD_SID, SECRET_SID] },
  ] }];
  function expectNoEngineTranscript(data: string, paths: string[]): void {
    for (const path of paths) {
      const at = join(data, path);
      if (!statSync(at).isFile()) continue;
      expect(readFileSync(at).includes("CONFIDENTIAL_ENGINE"), path).toBe(false);
    }
    for (const path of [`principals/pr_ana/claude/projects/-x-task-workspaces-bot-plain/${PLAIN_SID}.jsonl`, `principals/pr_ana/codex/sessions/2026/10/18/rollout-2026-10-18T11-00-00-${CODEX_PLAIN}.jsonl`]) expect(paths).toContain(path);
    expect(readFileSync(join(data, "principals/pr_ana/claude/history.jsonl"), "utf8")).toContain("ORDINARY prompt");
    // read from a copy: opening the staged file would leave journal files beside it
    const copy = join(directory(), "state.sqlite");
    cpSync(join(data, "principals/pr_ana/codex/state_5.sqlite"), copy);
    const state = new DatabaseSync(copy, { readOnly: true });
    try { expect(state.prepare("SELECT id FROM threads").all()).toEqual([{ id: CODEX_PLAIN }]); } finally { state.close(); }
  }

  it("leaves the engines' own transcripts of a confidential thread out of the backup, and every other thread's in", async () => {
    const source = directory();
    json(join(source, "bots.json"), roster);
    engineHomes(source);
    // a session only its event log still names
    put(join(source, "events", `${SECRET_T}.ndjson`), `${JSON.stringify({ type: "session.started", sessionId: LOGGED_SID })}\n`);
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    const data = join(source, ".backups", staged.id, "staged", "data");
    const paths: string[] = readJson(join(source, ".backups", staged.id, "staged", "manifest.json")).entries.map((entry: { path: string }) => entry.path);
    expect(paths.filter((path) => [SECRET_T, SECRET_SID, OLD_SID, LOGGED_SID, CODEX_SECRET].some((key) => path.includes(key)))).toEqual([]);
    expect(paths.filter((path) => /state_5\.sqlite-(?:wal|shm)$/.test(path))).toEqual([]);
    expectNoEngineTranscript(data, paths);
    // the live homes are untouched: a backup only copies
    expect(existsSync(join(source, "principals", "pr_ana", "claude", "projects", `-x-task-workspaces-bot-${SECRET_T}`, `${SECRET_SID}.jsonl`))).toBe(true);
  });

  it("restores an archive that holds a confidential thread's engine transcripts without installing them", async () => {
    // an archive from a release that copied the engine homes whole
    const forged = directory();
    json(join(forged, "bots.json"), roster);
    engineHomes(forged, false);
    const probeSource = directory();
    const probeArchive = await createWorkspaceBackup(probeSource, { password: PASSWORD });
    const probe = await stageWorkspaceBackup(probeSource, probeArchive.path, { password: PASSWORD });
    const base = readJson(join(probeSource, ".backups", probe.id, "staged", "manifest.json"));
    const entries: Array<{ path: string; type: "file" | "directory"; size: number; mode: number; sha256?: string }> = [];
    const blocks: Buffer[] = [];
    const add = (dir: string, prefix = "") => {
      for (const name of readdirSync(dir).sort()) {
        const path = prefix ? `${prefix}/${name}` : name;
        const at = join(dir, name);
        if (statSync(at).isDirectory()) {
          entries.push({ path, type: "directory", size: 0, mode: 0o700 });
          blocks.push(tarEntry(`data/${path}`, "Directory"));
          add(at, path);
        } else {
          const content = readFileSync(at);
          entries.push({ path, type: "file", size: content.length, mode: 0o600, sha256: createHash("sha256").update(content).digest("hex") });
          const header = new Header({ path: `data/${path}`, type: "File", size: content.length, mode: 0o600 });
          const block = Buffer.alloc(512);
          header.encode(block);
          blocks.push(block, content, Buffer.alloc((512 - content.length % 512) % 512));
        }
      }
    };
    add(forged);
    const manifest = { ...base, sourceDataDir: "/x", entries, summary: { ...base.summary, bots: 1,
      files: entries.filter((entry) => entry.type === "file").length, directories: entries.filter((entry) => entry.type === "directory").length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0) } };
    const archive = encryptedPayload(forged, Buffer.concat([tarEntry("manifest.json", "File", JSON.stringify(manifest)), tarEntry("data", "Directory"), ...blocks, Buffer.alloc(1024)]));
    const target = directory();
    const staged = await stageWorkspaceBackup(target, archive, { password: PASSWORD });
    const staging = join(target, ".backups", staged.id, "staged");
    const stagedPaths: string[] = readJson(join(staging, "manifest.json")).entries.map((entry: { path: string }) => entry.path);
    expect(stagedPaths.filter((path) => [SECRET_SID, OLD_SID, CODEX_SECRET].some((key) => path.includes(key)) || path.includes(SECRET_T) && path.startsWith("principals/"))).toEqual([]);
    expectNoEngineTranscript(join(staging, "data"), stagedPaths);
    commitPendingWorkspaceRestore(target, staged.id);
    expect(applyPendingWorkspaceRestore(target)).toMatchObject({ restored: true });
    expect(existsSync(join(target, "principals", "pr_ana", "claude", "projects", `-x-task-workspaces-bot-${SECRET_T}`))).toBe(false);
    expect(existsSync(join(target, "principals", "pr_ana", "claude", "todos", `${OLD_SID}-agent-${OLD_SID}.json`))).toBe(false);
    expect(readFileSync(join(target, "principals", "pr_ana", "claude", "projects", "-x-task-workspaces-bot-plain", `${PLAIN_SID}.jsonl`), "utf8")).toContain("ORDINARY");
    expect(readFileSync(join(target, "principals", "pr_ana", "claude", "history.jsonl"), "utf8")).not.toContain("CONFIDENTIAL_ENGINE");
  });

  it("cleans the database copies after a confidential thread was deleted, then clears the note", async () => {
    const source = directory();
    json(join(source, "bots.json"), [{ id: "bot", threadId: "plain", tasks: [{ threadId: "plain" }] }]);
    const db = new DatabaseSync(join(source, "messages.db"));
    db.exec("CREATE TABLE messages(thread_id TEXT, id TEXT, text TEXT, json TEXT, PRIMARY KEY(thread_id,id)); CREATE TABLE thread_state(thread_id TEXT PRIMARY KEY, active_leaf_id TEXT);");
    db.prepare("INSERT INTO messages VALUES ('gone', 'm1', ?, '{}')").run(`deletedconfidential ${"x".repeat(8_000)}`);
    db.prepare("INSERT INTO messages VALUES ('plain', 'm1', 'kept', '{}')").run();
    db.prepare("DELETE FROM messages WHERE thread_id = 'gone'").run();
    db.close();
    writeFileSync(join(source, "confidential-forgotten"), "");
    writeFileSync(join(source, "room-handoffs.json.migrated"), "[]");
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    expect(existsSync(join(source, "confidential-forgotten"))).toBe(false);
    const target = directory();
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    const data = join(target, ".backups", staged.id, "staged", "data");
    expect(readFileSync(join(data, "messages.db")).includes("deletedconfidential")).toBe(false);
    for (const name of ["confidential-forgotten", "room-handoffs.json.migrated"]) expect(existsSync(join(data, name))).toBe(false);
  });

  it("restores an archive that holds a confidential thread's sheet without ever installing it", async () => {
    const source = directory();
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const probe = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    const base = readJson(join(source, ".backups", probe.id, "staged", "manifest.json"));
    const sheet = '{"cards":[{"sql":"SELECT CONFIDENTIAL_SHEET"}]}';
    const other = '{"cards":[{"sql":"SELECT PERSON_SHEET"}]}';
    const file = (path: string, content: string) => ({ path, type: "file", size: Buffer.byteLength(content), mode: 0o600, sha256: createHash("sha256").update(content).digest("hex") });
    const dir = (path: string) => ({ path, type: "directory", size: 0, mode: 0o700 });
    const confidential = "data-scopes/bot/t-0123456789abcdef";
    const person = "data-scopes/bot/p-0123456789abcdef";
    // another spelling of the same folder, and an empty thread folder alone
    const cased = "data-scopes/other/T-fedcba9876543210";
    const empty = "data-scopes/bot/t-00000000000000ff";
    const manifest = {
      ...base,
      entries: [dir("data-scopes"), dir("data-scopes/bot"), dir(confidential), file(`${confidential}/sheet.json`, sheet), dir(person), file(`${person}/sheet.json`, other),
        dir("data-scopes/other"), dir(cased), file(`${cased}/sheet.json`, sheet), dir(empty)],
      summary: { ...base.summary, directories: 7, files: 3, bytes: 2 * Buffer.byteLength(sheet) + Buffer.byteLength(other) },
    };
    const archive = encryptedPayload(source, Buffer.concat([
      tarEntry("manifest.json", "File", JSON.stringify(manifest)), tarEntry("data", "Directory"), tarEntry("data/data-scopes", "Directory"),
      tarEntry("data/data-scopes/bot", "Directory"), tarEntry(`data/${confidential}`, "Directory"), tarEntry(`data/${confidential}/sheet.json`, "File", sheet),
      tarEntry(`data/${person}`, "Directory"), tarEntry(`data/${person}/sheet.json`, "File", other),
      tarEntry("data/data-scopes/other", "Directory"), tarEntry(`data/${cased}`, "Directory"), tarEntry(`data/${cased}/sheet.json`, "File", sheet),
      tarEntry(`data/${empty}`, "Directory"), Buffer.alloc(1024),
    ]));
    const target = directory();
    // the destination's own confidential Data is not carried into the restored workspace either
    mkdirSync(join(target, confidential), { recursive: true });
    writeFileSync(join(target, confidential, "sheet.json"), "DESTINATION_SHEET");
    const staged = await stageWorkspaceBackup(target, archive, { password: PASSWORD });
    // the staged copy keeps nothing of it, and the preview counts nothing of it
    expect(staged.summary).toMatchObject({ files: 1, directories: 4, bytes: Buffer.byteLength(other) });
    const staging = join(target, ".backups", staged.id, "staged");
    const stagedPaths: string[] = readJson(join(staging, "manifest.json")).entries.map((entry: { path: string }) => entry.path);
    expect(stagedPaths.filter((path) => /\/t-/i.test(path))).toEqual([]);
    for (const path of [confidential, cased, empty]) expect(existsSync(join(staging, "data", path))).toBe(false);
    expect(readStagedWorkspaceBackup(target, staged.id).summary).toMatchObject({ files: 1 });
    commitPendingWorkspaceRestore(target, staged.id);
    expect(applyPendingWorkspaceRestore(target)).toMatchObject({ restored: true });
    expect(readFileSync(join(target, person, "sheet.json"), "utf8")).toBe(other);
    for (const path of [confidential, cased, empty]) expect(existsSync(join(target, path))).toBe(false);
  });

  it("still restores an archive from a release that exported hook tokens, without installing them", async () => {
    const source = directory();
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const probe = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    const base = readJson(join(source, ".backups", probe.id, "staged", "manifest.json"));
    const token = "STALE_TURN_BEARER";
    const note = "kept";
    const file = (path: string, content: string) => ({ path, type: "file", size: Buffer.byteLength(content), mode: 0o600, sha256: createHash("sha256").update(content).digest("hex") });
    const manifest = {
      ...base,
      entries: [{ path: "hook-tokens", type: "directory", size: 0, mode: 0o700 }, file("hook-tokens/old.token", token), file("note.txt", note)],
      summary: { ...base.summary, directories: 1, files: 2, bytes: Buffer.byteLength(token) + Buffer.byteLength(note) },
    };
    const archive = encryptedPayload(source, Buffer.concat([
      tarEntry("manifest.json", "File", JSON.stringify(manifest)), tarEntry("data", "Directory"), tarEntry("data/hook-tokens", "Directory"),
      tarEntry("data/hook-tokens/old.token", "File", token), tarEntry("data/note.txt", "File", note), Buffer.alloc(1024),
    ]));
    const target = directory();
    const staged = await stageWorkspaceBackup(target, archive, { password: PASSWORD });
    commitPendingWorkspaceRestore(target, staged.id);
    expect(applyPendingWorkspaceRestore(target)).toMatchObject({ restored: true });
    expect(readFileSync(join(target, "note.txt"), "utf8")).toBe(note);
    expect(existsSync(join(target, "hook-tokens"))).toBe(false);
  });

  it("rejects authenticated credential metadata, saved auth paths, and connection-bearing config", async () => {
    const source = directory();
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(source, exported.path, { password: PASSWORD });
    const base = readJson(join(source, ".backups", staged.id, "staged", "manifest.json"));
    for (const variant of [
      { credentials: { xaiApiKey: "secret" } },
      { summary: { ...base.summary, includesCredentials: false } },
    ]) {
      const path = encryptedPayload(source, Buffer.concat([tarEntry("manifest.json", "File", JSON.stringify({ ...base, ...variant })), tarEntry("data", "Directory"), Buffer.alloc(1024)]));
      await expect(stageWorkspaceBackup(directory(), path, { password: PASSWORD })).rejects.toThrow(/metadata/);
    }
    for (const [name, content] of [
      ["team-computers.json", '{"computers":[{"id":"foreign-computer","section":"Design"}]}'],
      ["workspace-credentials.json", '{"xaiApiKey":"secret"}'],
      ["external-runtimes.json", '{"bot-id":"external-runtime-secret"}'],
      ["External-Runtimes.json", "external-runtime-secret"],
      ["Sessions.json", "secret"],
      ["Providers", "secret"],
      ["Caddy", "secret"],
      ["Browser-Engine-Key", "secret"],
      ["vm-home/.Browser-Profiles", "secret"],
      ["vm-homes/bot/.BROWSER-PROFILES", "secret"],
      ["Config.json", '{"xai":{"key":"secret"}}'],
      ["Webhooks.json", '{"webhooks":[{"secretHash":"secret"}]}'],
      ["browser-engine-key", "secret"],
      ["config.json", '{"xai":{"key":"secret","url":"https://source.example"}}'],
      ["config.json", '{"futureAuth":{"field":"secret"}}'],
      ["webhooks.json", '{"webhooks":[{"secretHash":"secret"}]}'],
      ["webhooks.json", '{"webhooks":[{"signingSecret":"secret"}]}'],
      ["webhooks.json", '{"webhooks":[{"pendingToken":"secret"}]}'],
    ]) {
      const entry = { path: name, type: "file", size: Buffer.byteLength(content), mode: 0o600, sha256: createHash("sha256").update(content).digest("hex") };
      const parents = name.split("/").slice(0, -1).map((_part, index) => name.split("/").slice(0, index + 1).join("/"));
      const manifest = { ...base, entries: [...parents.map((path) => ({ path, type: "directory", size: 0, mode: 0o700 })), entry], summary: { ...base.summary, directories: parents.length, files: 1, bytes: entry.size } };
      const path = encryptedPayload(source, Buffer.concat([tarEntry("manifest.json", "File", JSON.stringify(manifest)), tarEntry("data", "Directory"), ...parents.map((parent) => tarEntry(`data/${parent}`, "Directory")), tarEntry(`data/${name}`, "File", content), Buffer.alloc(1024)]));
      await expect(stageWorkspaceBackup(directory(), path, { password: PASSWORD })).rejects.toThrow(/Unsafe|connection settings|webhook credentials/);
    }
   }, 120_000); // 20 restores, each one real scrypt by design

  it("retains differently cased destination auth roots and refuses them in recovery journals", async () => {
    const source = directory();
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    mkdirSync(join(target, "Providers"));
    writeFileSync(join(target, "Providers", "auth.json"), "destination-login");
    writeFileSync(join(target, "Sessions.json"), "destination-session");
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(target, staged.id);
    applyPendingWorkspaceRestore(target);
    expect(readFileSync(join(target, "Providers", "auth.json"), "utf8")).toBe("destination-login");
    expect(readFileSync(join(target, "Sessions.json"), "utf8")).toBe("destination-session");
    json(join(target, ".backups", "restore-journal.json"), { id: staged.id, phase: "applying", existing: [], incoming: ["Sessions.json"] });
    expect(() => applyPendingWorkspaceRestore(target)).toThrow(/recovery paths/);
    expect(readFileSync(join(target, "Sessions.json"), "utf8")).toBe("destination-session");
  });

  it("fails explicitly on noncanonical source auth paths rather than silently skipping them", async () => {
    const source = directory();
    mkdirSync(join(source, "vm-home", ".Browser-Profiles"), { recursive: true });
    writeFileSync(join(source, "vm-home", ".Browser-Profiles", "Cookies"), "source-login");
    await expect(createWorkspaceBackup(source, { password: PASSWORD })).rejects.toThrow(/protected authentication/);
    expect(readFileSync(join(source, "vm-home", ".Browser-Profiles", "Cookies"), "utf8")).toBe("source-login");
  });

  it("refuses registered custom auth homes inside ordinary workspace files before export or restore", async () => {
    const source = directory();
    const config = (field: string) => ({ instances: { custom: { driver: "claudeAgent", ...(field === "configDir" ? { config: { configDir: join(source, "custom-login") } } : { environment: { [field]: join(source, "custom-login") } }) } } });
    mkdirSync(join(source, "custom-login"));
    writeFileSync(join(source, "custom-login", "auth.json"), "registered-source-secret");
    for (const field of ["configDir", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "HOME", "XDG_DATA_HOME"]) {
      json(join(source, "config.json"), config(field));
      await expect(createWorkspaceBackup(source, { password: PASSWORD })).rejects.toThrow(/Provider authentication storage/);
      expect(existsSync(join(source, ".backups"))).toBe(false);
    }
    rmSync(join(source, "custom-login"), { recursive: true });
    json(join(source, "config.json"), { instances: { custom: { driver: "claudeAgent", config: { configDir: join(source, "providers", "custom") } } } });
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    json(join(target, "config.json"), { instances: { custom: { driver: "claudeAgent", config: { configDir: join(target, "custom-login") } } } });
    mkdirSync(join(target, "custom-login"));
    writeFileSync(join(target, "custom-login", "auth.json"), "registered-destination-secret");
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    expect(() => commitPendingWorkspaceRestore(target, staged.id)).toThrow(/Provider authentication storage/);
    expect(readPendingWorkspaceRestoreMetadata(target)).toBeNull();
    expect(readFileSync(join(target, "custom-login", "auth.json"), "utf8")).toBe("registered-destination-secret");
  });

  it.each([
    ["traversal", () => tarEntry("../escape")],
    ["absolute", () => tarEntry("/escape")],
    ["backslash", () => tarEntry("data\\escape")],
    ["symbolic link", () => tarEntry("data/link", "SymbolicLink")],
    ["hard link", () => tarEntry("data/link", "Link")],
    ["special entry", () => tarEntry("data/pipe", "FIFO")],
    ["duplicate", () => Buffer.concat([tarEntry("data/file"), tarEntry("data/file")])],
    ["case collision", () => Buffer.concat([tarEntry("data/FILE"), tarEntry("data/file")])],
    ["gzip payload", () => gzipSync(Buffer.alloc(1024))],
  ] as const)("rejects authenticated hostile archives: %s", async (_name, payload) => {
    const root = directory();
    const path = encryptedPayload(root, Buffer.concat([payload(), Buffer.alloc(1024)]));
    await expect(stageWorkspaceBackup(root, path, { password: PASSWORD })).rejects.toThrow(/unsafe|unsupported entries|Compressed payloads/);
    expect(readdirSync(join(root, ".backups"))).toEqual([]);
  });

  it("refuses external and arbitrary internal symlinks while reporting omitted managed discovery links", async () => {
    const root = directory();
    const outside = directory();
    writeFileSync(join(outside, "secret"), "must never be read");
    symlinkSync(join(outside, "secret"), join(root, "external"));
    await expect(createWorkspaceBackup(root, { password: PASSWORD })).rejects.toThrow(/outside the workspace/);
    rmSync(join(root, "external"));
    writeFileSync(join(root, "regular"), "data");
    symlinkSync(join(root, "regular"), join(root, "internal"));
    await expect(createWorkspaceBackup(root, { password: PASSWORD })).rejects.toThrow(/user-created symbolic link/);
    rmSync(join(root, "internal"));
    const skill = join(root, "workspaces", "bot", "skills", "example");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "# Example");
    const native = join(root, "workspaces", "bot", ".claude", "skills");
    mkdirSync(native, { recursive: true });
    symlinkSync(skill, join(native, "example"), process.platform === "win32" ? "junction" : "dir");
    const exported = await createWorkspaceBackup(root, { password: PASSWORD });
    expect(exported.summary.warnings.some((warning) => warning.includes("1 managed skill"))).toBe(true);
  });

  // A client's export failed on task-workspaces/<bot>/<thread>/node_modules, a
  // link an agent made to another checkout's install.
  it("leaves out node_modules and links in conversation work folders, and says so", async () => {
    const root = directory();
    const outside = directory();
    writeFileSync(join(outside, "secret"), "must never be read");
    const work = join(root, "task-workspaces", "bot", "thread");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "app.js"), "console.log(1)");
    symlinkSync(outside, join(work, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    symlinkSync(join(outside, "secret"), join(work, "linked-secret"));
    const installed = join(root, "workspaces", "bot", "project", "node_modules", "left-pad");
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, "index.js"), "module.exports = 1");
    const exported = await createWorkspaceBackup(root, { password: PASSWORD });
    expect(exported.summary.warnings.some((warning) => warning.startsWith("2 installed dependency folder(s) (node_modules)"))).toBe(true);
    expect(exported.summary.warnings.some((warning) => warning.startsWith("1 symbolic link(s) in conversation work folders"))).toBe(true);
    const target = directory();
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    const data = join(target, ".backups", staged.id, "staged", "data");
    expect(readFileSync(join(data, "task-workspaces", "bot", "thread", "app.js"), "utf8")).toBe("console.log(1)");
    expect(existsSync(join(data, "task-workspaces", "bot", "thread", "node_modules"))).toBe(false);
    expect(existsSync(join(data, "task-workspaces", "bot", "thread", "linked-secret"))).toBe(false);
    expect(existsSync(join(data, "workspaces", "bot", "project", "node_modules"))).toBe(false);
    // Outside a work folder, a link out of the workspace still stops the export.
    symlinkSync(join(outside, "secret"), join(root, "workspaces", "bot", "external"));
    await expect(createWorkspaceBackup(root, { password: PASSWORD })).rejects.toThrow(/outside the workspace/);
  });

  it("recovers an interrupted top-level swap before any application state is loaded", async () => {
    const source = directory();
    json(join(source, "bots.json"), []);
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    json(join(target, "bots.json"), [{ id: "original" }]);
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    commitPendingWorkspaceRestore(target, staged.id);
    const root = join(target, ".backups");
    const apply = join(root, staged.id, "apply", "data");
    cpSync(join(root, staged.id, "staged", "data"), apply, { recursive: true });
    const saved = join(root, `safety-${staged.id}`, "data");
    mkdirSync(saved, { recursive: true });
    json(join(root, "restore-journal.json"), { id: staged.id, phase: "applying", existing: ["bots.json"], incoming: ["bots.json"] });
    renameSync(join(target, "bots.json"), join(saved, "bots.json"));
    renameSync(join(apply, "bots.json"), join(target, "bots.json"));
    expect(applyPendingWorkspaceRestore(target)).toMatchObject({ restored: false, rolledBack: true, id: staged.id });
    expect(readJson(join(target, "bots.json"))).toEqual([{ id: "original" }]);
    expect(applyPendingWorkspaceRestore(target)).toEqual({ restored: false });
  });

  it("detects staged-file tampering before committing or replacing original data", async () => {
    const source = directory();
    json(join(source, "bots.json"), []);
    const exported = await createWorkspaceBackup(source, { password: PASSWORD });
    const target = directory();
    const staged = await stageWorkspaceBackup(target, exported.path, { password: PASSWORD });
    writeFileSync(join(target, ".backups", staged.id, "staged", "data", "bots.json"), "[{}]");
    expect(() => commitPendingWorkspaceRestore(target, staged.id)).toThrow(/match|checksum/);
    expect(readPendingWorkspaceRestoreMetadata(target)).toBeNull();
  });

  it("validates password strength, client preferences and downgrade compatibility", async () => {
    const root = directory();
    await expect(createWorkspaceBackup(root, { password: "short-password".slice(0, 11) })).rejects.toThrow(/at least 12/);
    await expect(createWorkspaceBackup(root, { password: PASSWORD, clientState: { untrusted: "not an app preference" } })).rejects.toThrow(/preferences/);
    const exported = await createWorkspaceBackup(root, { password: PASSWORD, appVersion: "2.0.0" });
    await expect(stageWorkspaceBackup(directory(), exported.path, { password: PASSWORD, currentAppVersion: "1.99.99" })).rejects.toThrow(/newer/);
    expect((await stageWorkspaceBackup(directory(), exported.path, { password: PASSWORD, currentAppVersion: "2.0.0" })).summary.appVersion).toBe("2.0.0");
  });

  it("cleans only unreferenced jobs and refuses traversal or pending/last/safety restore jobs", async () => {
    const root = directory();
    const exported = await createWorkspaceBackup(root, { password: PASSWORD });
    const staged = await stageWorkspaceBackup(root, exported.path, { password: PASSWORD });
    removeWorkspaceBackupJob(root, exported.id);
    expect(existsSync(exported.path)).toBe(false);
    expect(() => removeWorkspaceBackupJob(root, "../escape")).toThrow(/identifier/);
    commitPendingWorkspaceRestore(root, staged.id);
    expect(() => removeWorkspaceBackupJob(root, staged.id)).toThrow(/needed/);
    applyPendingWorkspaceRestore(root);
    expect(() => removeWorkspaceBackupJob(root, staged.id)).toThrow(/needed/);
  });
});
