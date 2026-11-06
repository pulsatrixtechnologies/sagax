// The Apple apps of This Mac (electron/mac-apps.mjs): bounded operations,
// osascript built without injection, the On/Off file, the test. Mocks only:
// no real osascript runs here (it would open Mail or Messages on screen).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAC_APP_IDS,
  MAC_APP_SCRIPTS,
  MAC_APP_TEST_SCRIPTS,
  MAC_APP_TOOLS,
  appleDate,
  automationHelperPath,
  automationStateOf,
  isMacAppTool,
  macAppsStatusLive,
  messagesReadErrorText,
  probeMacAppAutomation,
  readMessages,
  requestMacAppAutomation,
  macAppArgv,
  macAppEnabled,
  macAppErrorText,
  macAppOperation,
  macAppsStatus,
  macAppTarget,
  macAppToolWrites,
  readMacAppSettings,
  runMacAppCall,
  testMacApp,
  writeMacAppSettings,
} from "./mac-apps.mjs";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "sagax-mac-apps-"));
const recorder = (stdout = "{\"ok\":true}") => {
  const calls = [];
  const execFile = async (file, args, options) => { calls.push({ file, args, options }); return { stdout }; };
  return { calls, execFile };
};

test("the twelve tools: single underscore names, one script each, reads and writes", () => {
  const names = MAC_APP_TOOLS.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "mac_calendar_create", "mac_calendar_list", "mac_contacts_search", "mac_mail_read", "mac_mail_search", "mac_mail_send",
    "mac_messages_read", "mac_messages_send", "mac_notes_create", "mac_notes_search", "mac_reminders_create", "mac_reminders_list",
  ]);
  for (const name of names) {
    assert.ok(!name.includes("__"), name);
    assert.ok(isMacAppTool(name));
    if (name !== "mac_messages_read") assert.equal(typeof MAC_APP_SCRIPTS[name], "string", name);
  }
  assert.equal(isMacAppTool("mac_shell"), false);
  assert.deepEqual(names.filter(macAppToolWrites).sort(), ["mac_calendar_create", "mac_mail_send", "mac_messages_send", "mac_notes_create", "mac_reminders_create"]);
  for (const id of MAC_APP_IDS) assert.equal(typeof MAC_APP_TEST_SCRIPTS[id], "string", id);
});

test("osascript gets a constant script and the arguments as one JSON argv, never concatenated", async () => {
  const hostile = "\"); do shell script \"rm -rf ~\" --'${x}`\\";
  for (const [name, args] of [
    ["mac_messages_send", { to: "+1 555 0100", text: hostile }],
    ["mac_mail_send", { to: ["ada@example.com"], subject: hostile, body: hostile }],
    ["mac_notes_create", { title: "Plan", body: hostile, folder: "Work" }],
    ["mac_reminders_create", { title: "Call back", notes: hostile }],
    ["mac_calendar_create", { title: "Review", start: "2026-11-10T14:00:00Z", end: "2026-11-10T15:00:00Z", notes: hostile }],
    ["mac_contacts_search", { query: "Ada" }],
  ]) {
    const { calls, execFile } = recorder();
    const result = await runMacAppCall(name, args, { platform: "darwin", execFile });
    assert.equal(result.isError, undefined, `${name}: ${result.content[0].text}`);
    assert.equal(calls.length, 1);
    const [{ file, args: argv }] = calls;
    assert.equal(file, "osascript");
    assert.deepEqual(argv.slice(0, 3), ["-l", "JavaScript", "-e"]);
    assert.equal(argv[3], MAC_APP_SCRIPTS[name], `${name}: the script text never changes`);
    assert.ok(!argv[3].includes(hostile));
    assert.equal(argv.length, 5);
    assert.deepEqual(JSON.parse(argv[4]), JSON.parse(JSON.stringify(macAppOperation(name, args))));
  }
  assert.throws(() => macAppArgv("x", ["not", "an", "object"]), /object/);
  assert.throws(() => macAppArgv("x", "text"), /object/);
});

test("operations are bounded and validated before anything runs", () => {
  assert.throws(() => macAppOperation("mac_messages_send", { to: "a; rm -rf", text: "hi" }), /phone number or email/);
  assert.throws(() => macAppOperation("mac_messages_send", { to: "+15550100", text: "" }), /required/);
  assert.throws(() => macAppOperation("mac_messages_send", { to: "+15550100\nx", text: "hi" }), /control characters|phone/);
  assert.throws(() => macAppOperation("mac_mail_send", { to: ["not-an-email"], subject: "s", body: "b" }), /email addresses/);
  assert.throws(() => macAppOperation("mac_mail_send", { to: [], subject: "s", body: "b" }), /required/);
  assert.throws(() => macAppOperation("mac_mail_read", { id: "12" }), /message id/);
  assert.throws(() => macAppOperation("mac_calendar_list", { from: "2026-11-10", to: "2026-11-01" }), /after/);
  assert.throws(() => macAppOperation("mac_calendar_list", { from: "2026-01-01", to: "2028-01-01" }), /one year/);
  assert.throws(() => macAppOperation("mac_calendar_create", { title: "x", start: "soon", end: "later" }), /ISO date/);
  assert.throws(() => macAppOperation("mac_notes_create", { title: "a\u0007b", body: "x" }), /control characters/);
  assert.throws(() => macAppOperation("mac_shell", {}), /unknown tool/);
  assert.equal(macAppOperation("mac_mail_search", { limit: 10_000 }).limit, 50);
  assert.equal(macAppOperation("mac_notes_create", { title: "T", body: "line 1\nline 2" }).body, "line 1\nline 2");
});

test("the log target names the recipient or the title, never the content", () => {
  const target = macAppTarget("mac_messages_send", { to: "+15550100", text: "secret plan" });
  assert.equal(target, "Messages to +15550100");
  assert.ok(!macAppTarget("mac_mail_send", { to: ["ada@example.com"], subject: "s", body: "secret plan" }).includes("secret"));
});

test("bad input and other systems answer an error result without running osascript", async () => {
  const { calls, execFile } = recorder();
  const windows = await runMacAppCall("mac_notes_search", { query: "x" }, { platform: "win32", execFile });
  assert.equal(windows.isError, true);
  assert.match(windows.content[0].text, /only on a Mac/);
  const invalid = await runMacAppCall("mac_messages_send", { to: "bad recipient!", text: "x" }, { platform: "darwin", execFile });
  assert.equal(invalid.isError, true);
  const unknown = await runMacAppCall("mac_shell", {}, { platform: "darwin", execFile });
  assert.equal(unknown.isError, true);
  assert.equal(calls.length, 0);
});

test("an Automation refusal reads plainly and the test records it", async () => {
  const denied = Object.assign(new Error("Command failed"), { stderr: "execution error: Not authorized to send Apple events to Mail. (-1743)" });
  assert.equal(macAppErrorText("mail", denied).denied, true);
  const dir = tempDir();
  const failed = await testMacApp(dir, "mail", { platform: "darwin", execFile: async () => { throw denied; } });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Automation/);
  assert.equal(readMacAppSettings(dir).mail.automation, "denied");
  const ok = await testMacApp(dir, "notes", { platform: "darwin", execFile: async () => ({ stdout: JSON.stringify({ count: 3, names: ["A", "B", "C"] }) }) });
  assert.deepEqual(ok, { ok: true, count: 3, names: ["A", "B", "C"] });
  assert.equal(readMacAppSettings(dir).notes.automation, "granted");
  const messages = await testMacApp(dir, "messages", { platform: "darwin", readMessages: async () => [{ chat: "Ada" }, { chat: "Ada" }, { chat: "Bea" }] });
  assert.deepEqual(messages, { ok: true, count: 2, names: ["Ada", "Bea"] });
  assert.equal((await testMacApp(dir, "mail", { platform: "win32" })).ok, false);
});

test("the On/Off switch is one private file, off by default", () => {
  const dir = tempDir();
  assert.equal(macAppEnabled(dir, "calendar"), false);
  writeMacAppSettings(dir, "calendar", { enabled: true });
  assert.equal(macAppEnabled(dir, "calendar"), true);
  assert.equal(macAppEnabled(dir, "mail"), false);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, "mac-apps.json")).mode & 0o777, 0o600);
  assert.throws(() => writeMacAppSettings(dir, "terminal", { enabled: true }), /Unknown app/);
  const status = macAppsStatus(dir, { platform: "darwin", messagesAccess: () => "granted" });
  assert.equal(status.available, true);
  assert.equal(status.apps.find((row) => row.id === "calendar").enabled, true);
  assert.equal(status.apps.find((row) => row.id === "messages").permissions.fullDiskAccess, "granted");
  const windows = macAppsStatus(dir, { platform: "win32" });
  assert.equal(windows.available, false);
  assert.equal(windows.apps[0].permissions.automation, "unsupported");
});

// --- chat.db dates past 2^53 and read errors --------------------------------
const NANOS = 815692699090360064n; // a real message.date from JC's chat.db

test("a nanosecond chat.db date past 2^53 converts without precision errors", () => {
  assert.equal(appleDate(NANOS), "2026-11-06T21:18:19.090Z");
  // old databases store whole seconds since 2001
  assert.equal(appleDate(815692699n), "2026-11-06T21:18:19.000Z");
  assert.equal(appleDate(815692699), "2026-11-06T21:18:19.000Z");
  assert.equal(appleDate(0n), null);
  assert.equal(appleDate(null), null);
});

test("readMessages reads a real sqlite chat.db whose dates exceed Number.MAX_SAFE_INTEGER", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = tempDir();
  const db = new DatabaseSync(path.join(dir, "chat.db"));
  db.exec(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, is_from_me INTEGER, text TEXT, attributedBody BLOB, service TEXT, handle_id INTEGER);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    INSERT INTO chat VALUES (1, 'iMessage;-;+15145550000', '+15145550000', 'Ada');
    INSERT INTO handle VALUES (1, '+15145550000');
    INSERT INTO message VALUES (1, 'g1', ${NANOS}, 0, 'hi', NULL, 'iMessage', 1);
    INSERT INTO message VALUES (2, 'g2', 815692600, 1, 'old', NULL, 'SMS', 1);
    INSERT INTO chat_message_join VALUES (1, 1), (1, 2);`);
  db.close();
  const rows = await readMessages(dir, { limit: 10 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2026-11-06T21:18:19.090Z");
  assert.equal(rows[0].from, "+15145550000");
  assert.equal(rows[1].from, "me");
  const result = await testMacApp(dir, "messages", { platform: "darwin", messagesDir: dir });
  assert.deepEqual(result, { ok: true, count: 1, names: ["Ada"] });
});

test("a chat.db read error reads as a read error, never as Messages refused", async () => {
  const failed = await testMacApp(tempDir(), "messages", { platform: "darwin", readMessages: async () => { throw new Error("Value is too large to be represented as a JavaScript number: 1"); } });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /could not be read from chat\.db/);
  assert.doesNotMatch(failed.error, /refused/);
  assert.match(messagesReadErrorText(Object.assign(new Error("x"), { code: "EPERM" })), /Full Disk Access/);
  assert.doesNotMatch(macAppErrorText("mail", new Error("execution error: boom")).message, /refused/);
});

// --- Automation: helper status and the Ask button (mocked native layer) -----
const helperRun = (answers) => {
  const calls = [];
  const execFile = async (file, args) => { calls.push({ file, args }); const out = answers[args[0]]; if (out instanceof Error) throw out; return { stdout: `${out}\n` }; };
  return { calls, execFile };
};

test("helper output maps to a permission state", () => {
  assert.equal(automationStateOf("granted\n"), "granted");
  assert.equal(automationStateOf("denied"), "denied");
  assert.equal(automationStateOf("notAsked"), "notAsked");
  assert.equal(automationStateOf("notRunning"), null);
  assert.equal(automationStateOf("unknown:-50"), null);
  assert.equal(automationHelperPath({ env: { SAGAX_AUTOMATION_HELPER: "/x/helper" }, exists: (file) => file === "/x/helper" }), "/x/helper");
  assert.equal(automationHelperPath({ env: {}, resourcesPath: "/R", exists: (file) => file === "/R/automation-helper" }), "/R/automation-helper");
  assert.equal(automationHelperPath({ env: {}, resourcesPath: undefined, exists: () => false }), null);
});

test("status reads the grant without prompting; Ask prompts once and saves the answer", async () => {
  const { calls, execFile } = helperRun({ status: "notAsked", ask: "granted" });
  assert.equal(await probeMacAppAutomation("messages", { platform: "darwin", helper: "/h", execFile }), "notAsked");
  assert.deepEqual(calls[0], { file: "/h", args: ["status", "com.apple.MobileSMS"] });
  const dir = tempDir();
  assert.equal(await requestMacAppAutomation(dir, "messages", { platform: "darwin", helper: "/h", execFile }), "granted");
  assert.deepEqual(calls[1].args, ["ask", "com.apple.MobileSMS"]);
  assert.equal(readMacAppSettings(dir).messages.automation, "granted");
  assert.equal(await probeMacAppAutomation("messages", { platform: "win32", helper: "/h", execFile }), null);
  assert.equal(calls.length, 2);
});

test("Ask without the helper falls back to a read-only tell by bundle id", async () => {
  const calls = [];
  const denied = Object.assign(new Error("Command failed"), { stderr: "Not authorized to send Apple events to Notes. (-1743)" });
  const execFile = async (file, args) => { calls.push({ file, args }); throw denied; };
  const dir = tempDir();
  assert.equal(await requestMacAppAutomation(dir, "notes", { platform: "darwin", helper: null, execFile }), "denied");
  assert.equal(calls[0].file, "osascript");
  assert.deepEqual(calls[0].args, ["-e", 'tell application id "com.apple.Notes" to get name']);
  assert.equal(readMacAppSettings(dir).notes.automation, "denied");
});

test("live status refreshes every app's Automation from macOS and keeps the saved one when unknown", async () => {
  const dir = tempDir();
  writeMacAppSettings(dir, "mail", { automation: "granted" });
  const execFile = async (_file, args) => ({ stdout: args[1] === "com.apple.MobileSMS" ? "denied" : args[1] === "com.apple.mail" ? "notRunning" : "notAsked" });
  const status = await macAppsStatusLive(dir, { platform: "darwin", helper: "/h", execFile, messagesAccess: () => "granted" });
  const row = (id) => status.apps.find((item) => item.id === id);
  assert.equal(row("messages").permissions.automation, "denied");
  assert.equal(row("mail").permissions.automation, "granted");
  assert.equal(row("notes").permissions.automation, "notAsked");
  const windows = await macAppsStatusLive(dir, { platform: "win32", helper: "/h", execFile: async () => { throw new Error("must not run"); } });
  assert.equal(windows.available, false);
});
