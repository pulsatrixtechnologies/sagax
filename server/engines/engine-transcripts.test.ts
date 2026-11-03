import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  confidentialEngineSessionPath, dataEngineHomes, databaseSidecarOf, distinctHomes, engineStoreKind, environmentEngineHomes,
  eventLogSessionIds, purgeEngineSessions, readPendingPurges, scrubEngineDatabase, sessionKey, taskEngineKeys, threadKeys, widenKeys, writePendingPurges,
} from "./engine-transcripts.ts";

const roots: string[] = [];
const temp = () => { const path = mkdtempSync(join(tmpdir(), "omb-engine-transcripts-")); roots.push(path); return path; };
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };

// Two threads of one bot, each in its own folder, as a server runs them.
const BOT = "b0b0b0b0-0000-4000-8000-000000000001";
const SECRET_THREAD = "5ec5ec5e-1111-4111-8111-111111111111";
const OTHER_THREAD = "0d0d0d0d-2222-4222-8222-222222222222";
const SECRET_SESSION = "aaaaaaaa-3333-4333-8333-333333333333";
const OLD_SECRET_SESSION = "abababab-3333-4333-8333-444444444444";
const OTHER_SESSION = "bbbbbbbb-4444-4444-8444-444444444444";
const CODEX_SECRET = "019a0000-5555-7555-8555-555555555555";
const CODEX_OTHER = "019a0000-6666-7666-8666-666666666666";

function folders(data: string) {
  const secret = join(data, "task-workspaces", BOT, SECRET_THREAD);
  const other = join(data, "task-workspaces", BOT, OTHER_THREAD);
  mkdirSync(secret, { recursive: true });
  mkdirSync(other, { recursive: true });
  return { secret, other };
}
const slug = (path: string) => path.replace(/[^a-zA-Z0-9]/g, "-");

describe("engine session keys", () => {
  it("takes distinctive session ids only", () => {
    expect(sessionKey(SECRET_SESSION)).toBe(SECRET_SESSION);
    expect(sessionKey("20261018_101500_a1b2c3")).toBe("20261018_101500_a1b2c3");
    expect(sessionKey("ses_01JABCDEF0123456")).toBe("ses_01JABCDEF0123456");
    for (const value of ["fake-session", "default", "short-1", "", "a b c 1234567890", null, 12345678901234, "../../etc/1234567890"]) expect(sessionKey(value)).toBeNull();
  });

  it("keys a thread by its id, its folder's hashes and every session it had", () => {
    const data = temp();
    const { secret } = folders(data);
    const keys = taskEngineKeys({ threadId: SECRET_THREAD, resumeCursors: { claude: SECRET_SESSION, codex: { threadId: CODEX_SECRET, model: "gpt-5.5-codex-2026" } }, engineSessions: [OLD_SECRET_SESSION, "fake-session"] }, [secret]);
    // a cursor object gives its id fields only, never a model name
    expect(keys).not.toContain("gpt-5.5-codex-2026");
    expect(keys).toEqual(expect.arrayContaining([SECRET_THREAD, SECRET_SESSION, CODEX_SECRET, OLD_SECRET_SESSION,
      createHash("md5").update(secret).digest("hex"), createHash("sha256").update(secret).digest("hex")]));
    expect(keys).not.toContain("fake-session");
    expect(threadKeys("x")).toEqual([]);
  });

  it("reads the session ids a thread's event log announced", () => {
    const data = temp();
    put(join(data, "events", `${SECRET_THREAD}.ndjson`), [
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "session.started", sessionId: OLD_SECRET_SESSION }),
      "{torn",
      JSON.stringify({ type: "session.started", sessionId: SECRET_SESSION }),
      JSON.stringify({ type: "session.started", sessionId: null }),
    ].join("\n"));
    expect(eventLogSessionIds(join(data, "events", `${SECRET_THREAD}.ndjson`)).sort()).toEqual([OLD_SECRET_SESSION, SECRET_SESSION].sort());
    expect(eventLogSessionIds(join(data, "events", "missing.ndjson"))).toEqual([]);
  });
});

describe("engine homes", () => {
  it("lists a server's homes under its data folder and the process's own", () => {
    const data = temp();
    for (const dir of ["principals/pr_ana/claude", "principals/pr_ana/codex", "org/grokAgent-key", "engine-policies/hermes-org", "providers/hosted"]) mkdirSync(join(data, dir), { recursive: true });
    writeFileSync(join(data, "engine-policies", "claude-settings.json"), "{}");
    expect(dataEngineHomes(data).map((path) => path.slice(data.length + 1)).sort()).toEqual([
      "engine-policies/hermes-org", "org/grokAgent-key", "principals/pr_ana/claude", "principals/pr_ana/codex", "providers",
    ]);
    const home = temp();
    for (const dir of [".claude", ".codex", ".grok", ".pi/agent", ".local/share/opencode", "elsewhere/hermes"]) mkdirSync(join(home, dir), { recursive: true });
    expect(environmentEngineHomes({ HOME: home, HERMES_HOME: join(home, "elsewhere", "hermes") }).map((path) => path.slice(home.length + 1)).sort())
      .toEqual([".claude", ".codex", ".grok", ".local/share/opencode", ".pi/agent", "elsewhere/hermes"]);
    expect(distinctHomes([join(home, ".claude"), home, join(home, ".claude")])).toEqual([home]);
  });
});

describe("purgeEngineSessions", () => {
  it("removes a confidential thread's Claude Code sessions and history lines, and nothing of the other thread", () => {
    const data = temp();
    const { secret, other } = folders(data);
    const claude = join(data, "principals", "pr_ana", "claude");
    const secretProject = join(claude, "projects", slug(secret));
    const otherProject = join(claude, "projects", slug(other));
    put(join(secretProject, `${SECRET_SESSION}.jsonl`), '{"type":"user","message":"ULTRASECRET"}\n');
    put(join(secretProject, OLD_SECRET_SESSION, "subagents", "agent-1.jsonl"), "ULTRASECRET\n");
    put(join(secretProject, "memory", "MEMORY.md"), "ULTRASECRET\n");
    // the other thread's own session mentions the secret thread's id (a list_threads result): it stays whole
    const otherTranscript = `{"type":"user","message":"hello"}\n{"type":"tool_result","content":"${SECRET_THREAD}"}\n`;
    put(join(otherProject, `${OTHER_SESSION}.jsonl`), otherTranscript);
    put(join(claude, "todos", `${SECRET_SESSION}-agent-${SECRET_SESSION}.json`), "[]");
    put(join(claude, "file-history", SECRET_SESSION, "abc@v1"), "ULTRASECRET");
    put(join(claude, "session-env", SECRET_SESSION, "env"), "x");
    put(join(claude, "debug", `${SECRET_SESSION}.txt`), "ULTRASECRET");
    put(join(claude, "todos", `${OTHER_SESSION}-agent-${OTHER_SESSION}.json`), "[]");
    // the person pasted the secret thread's id in another conversation: that
    // one is kept whole, its history line too
    const pasted = "dddddddd-5555-4555-8555-555555555555";
    put(join(claude, "projects", "-Users-person-elsewhere", `${pasted}.jsonl`), `{"message":"look at ${SECRET_THREAD}"}\n`);
    put(join(claude, "history.jsonl"), [
      JSON.stringify({ display: "ULTRASECRET one", project: secret, sessionId: SECRET_SESSION }),
      JSON.stringify({ display: "hello", project: other, sessionId: OTHER_SESSION }),
      JSON.stringify({ display: "ULTRASECRET two", project: secret }),
      JSON.stringify({ display: `look at ${SECRET_THREAD}`, project: "/Users/person/elsewhere", sessionId: pasted }),
    ].join("\n") + "\n");
    put(join(claude, ".claude.json"), JSON.stringify({ projects: { [secret]: { history: [{ display: "ULTRASECRET" }] }, [other]: { history: [] } }, numStartups: 3 }));
    // only the thread id is known (an older release kept no session ids): the
    // folder named after it gives its sessions
    const result = purgeEngineSessions(dataEngineHomes(data), threadKeys(SECRET_THREAD, [secret]));
    expect(result.failed).toEqual([]);
    expect(existsSync(secretProject)).toBe(false);
    for (const path of [`todos/${SECRET_SESSION}-agent-${SECRET_SESSION}.json`, `file-history/${SECRET_SESSION}`, `session-env/${SECRET_SESSION}`, `debug/${SECRET_SESSION}.txt`]) expect(existsSync(join(claude, path)), path).toBe(false);
    expect(readFileSync(join(otherProject, `${OTHER_SESSION}.jsonl`), "utf8")).toBe(otherTranscript);
    expect(existsSync(join(claude, "todos", `${OTHER_SESSION}-agent-${OTHER_SESSION}.json`))).toBe(true);
    const history = readFileSync(join(claude, "history.jsonl"), "utf8");
    expect(history).not.toContain("ULTRASECRET");
    expect(history).toContain(OTHER_SESSION);
    expect(history).toContain(pasted);
    expect(existsSync(join(claude, "projects", "-Users-person-elsewhere", `${pasted}.jsonl`))).toBe(true);
    expect(result.keys.has(pasted)).toBe(false);
    const settings = JSON.parse(readFileSync(join(claude, ".claude.json"), "utf8"));
    expect(Object.keys(settings.projects)).toEqual([other]);
    expect(settings.numStartups).toBe(3);
    expect(result.keys.has(SECRET_SESSION) && result.keys.has(OLD_SECRET_SESSION)).toBe(true);
  });

  it("removes a Codex thread's rollouts, history lines and database rows found by its folder", () => {
    const data = temp();
    const { secret, other } = folders(data);
    const codex = join(data, "principals", "pr_ana", "codex");
    const secretRollout = join(codex, "sessions", "2026", "10", "18", `rollout-2026-10-18T10-00-00-${CODEX_SECRET}.jsonl`);
    const archived = join(codex, "archived_sessions", `rollout-2026-10-17T10-00-00-${CODEX_SECRET}.jsonl`);
    const otherRollout = join(codex, "sessions", "2026", "10", "18", `rollout-2026-10-18T11-00-00-${CODEX_OTHER}.jsonl`);
    put(secretRollout, "ULTRASECRET\n");
    put(archived, "ULTRASECRET\n");
    put(otherRollout, "hello\n");
    put(join(codex, "history.jsonl"), `${JSON.stringify({ session_id: CODEX_SECRET, ts: 1, text: "ULTRASECRET" })}\n${JSON.stringify({ session_id: CODEX_OTHER, ts: 2, text: "hello" })}\n`);
    const state = new DatabaseSync(join(codex, "state_5.sqlite"));
    state.exec("PRAGMA journal_mode = WAL");
    state.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, first_user_message TEXT NOT NULL DEFAULT '')");
    state.exec("CREATE TABLE thread_dynamic_tools (thread_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL)");
    state.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(CODEX_SECRET, secretRollout, secret, "ULTRASECRET title", "ULTRASECRET first");
    state.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(CODEX_OTHER, otherRollout, other, "hello", "hello");
    state.prepare("INSERT INTO thread_dynamic_tools VALUES (?, 0, 'x')").run(CODEX_SECRET);
    state.close();
    const logs = new DatabaseSync(join(codex, "logs_2.sqlite"));
    logs.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, feedback_log_body TEXT, thread_id TEXT)");
    logs.prepare("INSERT INTO logs (ts, feedback_log_body, thread_id) VALUES (1, 'ULTRASECRET body', ?)").run(CODEX_SECRET);
    logs.prepare("INSERT INTO logs (ts, feedback_log_body, thread_id) VALUES (2, 'hello', ?)").run(CODEX_OTHER);
    logs.close();
    const result = purgeEngineSessions(dataEngineHomes(data), threadKeys(SECRET_THREAD, [secret]));
    expect(result.failed).toEqual([]);
    expect(result.keys.has(CODEX_SECRET)).toBe(true);
    expect(existsSync(secretRollout) || existsSync(archived)).toBe(false);
    expect(existsSync(otherRollout)).toBe(true);
    expect(readFileSync(join(codex, "history.jsonl"), "utf8")).not.toContain("ULTRASECRET");
    const after = new DatabaseSync(join(codex, "state_5.sqlite"), { readOnly: true });
    expect(after.prepare("SELECT id FROM threads").all()).toEqual([{ id: CODEX_OTHER }]);
    expect(after.prepare("SELECT COUNT(*) AS n FROM thread_dynamic_tools").get()).toEqual({ n: 0 });
    after.close();
    const afterLogs = new DatabaseSync(join(codex, "logs_2.sqlite"), { readOnly: true });
    expect(afterLogs.prepare("SELECT thread_id FROM logs").all()).toEqual([{ thread_id: CODEX_OTHER }]);
    afterLogs.close();
    // no free page or WAL frame keeps the words
    for (const name of ["state_5.sqlite", "state_5.sqlite-wal", "logs_2.sqlite"]) {
      if (existsSync(join(codex, name))) expect(readFileSync(join(codex, name)).includes("ULTRASECRET"), name).toBe(false);
    }
  });

  it("removes a Hermes session from its state database and full-text index, and its session files", () => {
    const data = temp();
    const hermes = join(data, "engine-policies", "hermes-org");
    const session = "20261018_101500_a1b2c3";
    const otherSession = "20261018_111500_d4e5f6";
    put(join(hermes, "sessions", `session_${session}.json`), "ULTRASECRET");
    put(join(hermes, "sessions", `session_${otherSession}.json`), "hello");
    const db = new DatabaseSync(join(hermes, "state.db"));
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)");
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, content TEXT)");
    db.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(content, content=messages, content_rowid=id)");
    db.exec("CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content); END");
    db.exec("CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content); END");
    db.prepare("INSERT INTO sessions VALUES (?, 'ULTRASECRET title')").run(session);
    db.prepare("INSERT INTO sessions VALUES (?, 'hello')").run(otherSession);
    db.prepare("INSERT INTO messages (session_id, content) VALUES (?, 'ULTRASECRET words')").run(session);
    db.prepare("INSERT INTO messages (session_id, content) VALUES (?, 'hello words')").run(otherSession);
    db.close();
    const result = purgeEngineSessions(dataEngineHomes(data), [session]);
    expect(result.failed).toEqual([]);
    expect(existsSync(join(hermes, "sessions", `session_${session}.json`))).toBe(false);
    expect(existsSync(join(hermes, "sessions", `session_${otherSession}.json`))).toBe(true);
    const after = new DatabaseSync(join(hermes, "state.db"), { readOnly: true });
    expect(after.prepare("SELECT id FROM sessions").all()).toEqual([{ id: otherSession }]);
    expect(after.prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'ULTRASECRET'").get()).toEqual({ n: 0 });
    expect(after.prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'hello'").get()).toEqual({ n: 1 });
    after.close();
    expect(readFileSync(join(hermes, "state.db")).includes("ULTRASECRET")).toBe(false);
  });

  it("removes Grok, pi, Cursor, Gemini and OpenCode sessions of the thread, in a home outside the data folder too", () => {
    const data = temp();
    const { secret, other } = folders(data);
    const home = temp();
    const grokSecret = join(home, ".grok", "sessions", encodeURIComponent(secret), SECRET_SESSION, "chat_history.jsonl");
    const grokOther = join(home, ".grok", "sessions", encodeURIComponent(other), OTHER_SESSION, "chat_history.jsonl");
    const piSecret = join(home, ".pi", "agent", "sessions", `--${secret.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`, `2026-10-18T10-00-00-000Z_${SECRET_SESSION}.jsonl`);
    const cursorSecret = join(home, ".cursor", "acp-sessions", SECRET_SESSION, "store.db");
    const cursorOther = join(home, ".cursor", "acp-sessions", OTHER_SESSION, "meta.json");
    const md5 = createHash("md5").update(secret).digest("hex");
    const cursorChat = join(home, ".cursor", "chats", md5, "c0c0c0c0-7777-4777-8777-777777777777", "store.db");
    // Gemini: a shared folder's bucket (a withheld turn's workspace), the session by its id inside the file
    const bucket = join(home, ".gemini", "tmp", createHash("sha256").update("/shared/workspace").digest("hex"));
    put(join(bucket, "chats", "session-2026-10-18T10-00-aaaaaaaa.json"), JSON.stringify({ sessionId: SECRET_SESSION, messages: ["ULTRASECRET"] }));
    put(join(bucket, "chats", "session-2026-10-18T11-00-bbbbbbbb.json"), JSON.stringify({ sessionId: OTHER_SESSION, messages: [`mentions ${SECRET_SESSION}`] }));
    put(join(bucket, "logs.json"), JSON.stringify([{ sessionId: SECRET_SESSION, message: "ULTRASECRET" }, { sessionId: OTHER_SESSION, message: "hello" }]));
    const opencodeSession = "ses_01JZZZZZZZ0123456789";
    put(join(home, ".local", "share", "opencode", "storage", "session", "global", `${opencodeSession}.json`), "ULTRASECRET");
    put(join(home, ".local", "share", "opencode", "storage", "message", opencodeSession, "msg_01JQ8ZK2X3.json"), "ULTRASECRET");
    put(join(home, ".local", "share", "opencode", "storage", "part", "msg_01JQ8ZK2X3", "prt_01JQ8ZK2X4.json"), "ULTRASECRET words");
    put(join(home, ".local", "share", "opencode", "storage", "part", "msg_01JQ9OTHER5", "prt_01JQ9OTHER6.json"), "hello");
    for (const path of [grokSecret, grokOther, piSecret, cursorSecret, cursorOther, cursorChat]) put(path, "x");
    const homes = distinctHomes([...dataEngineHomes(data), ...environmentEngineHomes({ HOME: home })]);
    const result = purgeEngineSessions(homes, taskEngineKeys({ threadId: SECRET_THREAD, resumeCursors: { gemini: SECRET_SESSION, opencode: opencodeSession } }, [secret]));
    expect(result.failed).toEqual([]);
    for (const path of [grokSecret, piSecret, cursorSecret, cursorChat]) expect(existsSync(path), path).toBe(false);
    for (const path of [grokOther, cursorOther]) expect(existsSync(path), path).toBe(true);
    expect(existsSync(join(bucket, "chats", "session-2026-10-18T10-00-aaaaaaaa.json"))).toBe(false);
    expect(existsSync(join(bucket, "chats", "session-2026-10-18T11-00-bbbbbbbb.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(bucket, "logs.json"), "utf8"))).toEqual([{ sessionId: OTHER_SESSION, message: "hello" }]);
    expect(existsSync(join(home, ".local", "share", "opencode", "storage", "session", "global", `${opencodeSession}.json`))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "opencode", "storage", "message", opencodeSession))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "opencode", "storage", "part", "msg_01JQ8ZK2X3"))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "opencode", "storage", "part", "msg_01JQ9OTHER5"))).toBe(true);
  });

  it("is idempotent and never follows a symbolic link out of a home", async () => {
    const data = temp();
    const outside = temp();
    put(join(outside, `${SECRET_SESSION}.jsonl`), "kept");
    const hermes = join(data, "engine-policies", "hermes-solo");
    mkdirSync(hermes, { recursive: true });
    const { symlinkSync } = await import("node:fs");
    symlinkSync(outside, join(hermes, "linked"));
    const first = purgeEngineSessions(dataEngineHomes(data), [SECRET_SESSION]);
    expect(first.removed).toBe(0);
    expect(existsSync(join(outside, `${SECRET_SESSION}.jsonl`))).toBe(true);
    expect(purgeEngineSessions(dataEngineHomes(data), [SECRET_SESSION]).removed).toBe(0);
  });

  it("scrubs a database whose foreign keys tie a session's rows together", () => {
    const data = temp();
    const path = join(data, "engine-policies", "hermes-org", "state.db");
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE sessions (id TEXT PRIMARY KEY); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT REFERENCES sessions(id), content TEXT)");
    db.prepare("INSERT INTO sessions VALUES (?)").run(SECRET_SESSION);
    db.prepare("INSERT INTO messages (session_id, content) VALUES (?, 'ULTRASECRET')").run(SECRET_SESSION);
    db.close();
    const result = purgeEngineSessions(dataEngineHomes(data), [SECRET_SESSION]);
    expect(result.failed).toEqual([]);
    expect(result.rows).toBe(2);
    expect(readFileSync(path).includes("ULTRASECRET")).toBe(false);
  });

  it("matches ids exactly in id columns and names whatever their case", () => {
    const data = temp();
    const path = join(data, "engine-policies", "hermes-org", "state.db");
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    db.prepare("INSERT INTO sessions VALUES (?)").run(`${SECRET_SESSION}-child`);
    db.close();
    put(join(data, "engine-policies", "hermes-org", "sessions", `session_${SECRET_SESSION.toUpperCase()}.json`), "x");
    const result = purgeEngineSessions(dataEngineHomes(data), [SECRET_SESSION]);
    expect(result.rows).toBe(0);
    expect(existsSync(join(data, "engine-policies", "hermes-org", "sessions", `session_${SECRET_SESSION.toUpperCase()}.json`))).toBe(false);
    expect(confidentialEngineSessionPath(`Principals/p/claude/projects/x-${SECRET_THREAD.toUpperCase()}/a.jsonl`, new Set([SECRET_THREAD]))).toBe(true);
  });

  it("never takes a whole user home or the data folder for an engine home", () => {
    const home = temp();
    expect(distinctHomes([home, join(home, ".claude"), "/"], [home])).toEqual([join(home, ".claude")]);
  });

  it("leaves a database that names no key untouched, and scrubs one that does", () => {
    const data = temp();
    const path = join(data, "x.db");
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE sessions (id TEXT, title TEXT)");
    db.prepare("INSERT INTO sessions VALUES (?, 'a')").run(OTHER_SESSION);
    db.close();
    expect(scrubEngineDatabase(path, new Set([SECRET_SESSION]))).toBe(0);
    expect(scrubEngineDatabase(path, new Set([OTHER_SESSION]))).toBe(1);
  });

  it("widens keys read only", () => {
    const data = temp();
    const { secret } = folders(data);
    const claude = join(data, "principals", "pr_ana", "claude");
    put(join(claude, "projects", slug(secret), `${SECRET_SESSION}.jsonl`), "x");
    const keys = widenKeys(dataEngineHomes(data), [SECRET_THREAD]);
    expect(keys.has(SECRET_SESSION)).toBe(true);
    expect(existsSync(join(claude, "projects", slug(secret), `${SECRET_SESSION}.jsonl`))).toBe(true);
  });
});

describe("the backup's view of engine homes", () => {
  it("names a confidential thread's engine files by path, inside engine homes only", () => {
    const keys = new Set([SECRET_THREAD, SECRET_SESSION]);
    expect(confidentialEngineSessionPath(`principals/pr_ana/claude/projects/-data-task-workspaces-${BOT}-${SECRET_THREAD}/${OTHER_SESSION}.jsonl`, keys)).toBe(true);
    expect(confidentialEngineSessionPath(`principals/pr_ana/codex/sessions/2026/10/18/rollout-x-${SECRET_SESSION}.jsonl`, keys)).toBe(true);
    expect(confidentialEngineSessionPath(`engine-policies/hermes-org/sessions/session_${SECRET_SESSION}.json`, keys)).toBe(true);
    expect(confidentialEngineSessionPath(`org/grokAgent-key/.grok/sessions/x/${SECRET_SESSION}`, keys)).toBe(true);
    expect(confidentialEngineSessionPath(`principals/pr_ana/claude/projects/x/${OTHER_SESSION}.jsonl`, keys)).toBe(false);
    // outside engine homes the backup's own rules apply (task-workspaces, events, ...)
    expect(confidentialEngineSessionPath(`workspaces/${BOT}/${SECRET_SESSION}.md`, keys)).toBe(false);
    expect(confidentialEngineSessionPath("principals/pr_ana/claude", keys)).toBe(false);
    expect(confidentialEngineSessionPath(`principals/pr_ana/claude/projects/${SECRET_THREAD}`, new Set())).toBe(false);
  });

  it("sorts the files a backup must filter inside", () => {
    const data = temp();
    const db = join(data, "state_5.sqlite");
    new DatabaseSync(db).exec("CREATE TABLE t (id TEXT)");
    expect(engineStoreKind("principals/p/claude/history.jsonl", join(data, "none"))).toBe("history");
    expect(engineStoreKind("principals/p/grok/.grok/logs/unified.jsonl", join(data, "none"))).toBe("logs");
    expect(engineStoreKind("principals/p/claude/.claude.json", join(data, "none"))).toBe("settings");
    expect(engineStoreKind("principals/p/gemini-key/.gemini/tmp/abc/logs.json", join(data, "none"))).toBe("array");
    expect(engineStoreKind("principals/p/gemini-key/.gemini/tmp/abc/chats/session-1.json", join(data, "none"))).toBe("chat");
    expect(engineStoreKind("principals/p/codex/state_5.sqlite", db)).toBe("database");
    expect(engineStoreKind("principals/p/claude/projects/x/y.jsonl", join(data, "none"))).toBeNull();
    expect(engineStoreKind("history.jsonl", join(data, "none"))).toBeNull();
    expect(databaseSidecarOf("principals/p/codex/state_5.sqlite-wal")).toBe("principals/p/codex/state_5.sqlite");
    expect(databaseSidecarOf("principals/p/codex/state_5.sqlite")).toBeNull();
  });

  it("keeps the purges left to retry", () => {
    const data = temp();
    expect(readPendingPurges(data)).toEqual([]);
    writePendingPurges(data, [{ keys: [SECRET_THREAD, SECRET_SESSION], vacuum: ["/x.db"], attempts: 2 }]);
    expect(readPendingPurges(data)).toEqual([{ keys: [SECRET_THREAD, SECRET_SESSION], vacuum: ["/x.db"], attempts: 2 }]);
    writePendingPurges(data, []);
    expect(readPendingPurges(data)).toEqual([]);
  });
});
