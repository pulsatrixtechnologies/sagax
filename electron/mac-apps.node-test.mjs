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
  MAC_APP_BUDGET_MS,
  MAC_APP_TEST_SCRIPTS,
  MAC_APP_TOOLS,
  appleDate,
  automationHelperPath,
  automationStateOf,
  isMacAppTool,
  macAppScriptArgs,
  macAppsStatusLive,
  mailId,
  parseMailId,
  messagesReadErrorText,
  probeMacAppAutomation,
  readMessages,
  readMessageAttachment,
  listChats,
  occurrences,
  calendarRef,
  MAC_APP_LEGACY_TOOLS,
  MAC_APP_UPDATE_DESKTOP,
  macAppToolsFor,
  macAppLegacyCall,
  requestMacAppAutomation,
  macAppArgv,
  macAppEnabled,
  macAppErrorText,
  macAppOperation,
  macAppsStatus,
  macAppTarget,
  macAppToolWrites,
  macAppSavesFiles,
  exportPhotos,
  MUSIC_QUEUE_PLAYLIST,
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

test("the tools: single underscore names, one script each, a kind and a need on every row", () => {
  const names = MAC_APP_TOOLS.map((tool) => tool.name).sort();
  // #4158: the full action set of the six apps (design, section 3).
  assert.deepEqual(names, [
    "mac_calendar_create", "mac_calendar_create_calendar", "mac_calendar_delete", "mac_calendar_delete_calendar", "mac_calendar_list", "mac_calendar_list_calendars", "mac_calendar_read", "mac_calendar_update", "mac_calendar_update_calendar",
    "mac_contacts_create", "mac_contacts_create_group", "mac_contacts_delete", "mac_contacts_delete_group", "mac_contacts_list_groups", "mac_contacts_read", "mac_contacts_search", "mac_contacts_update", "mac_contacts_update_group",
    "mac_mail_create_draft", "mac_mail_delete", "mac_mail_forward", "mac_mail_list_mailboxes", "mac_mail_list_rules", "mac_mail_move", "mac_mail_read", "mac_mail_read_attachment", "mac_mail_reply", "mac_mail_search", "mac_mail_send", "mac_mail_update", "mac_mail_update_rule",
    "mac_messages_list_chats", "mac_messages_read", "mac_messages_read_attachment", "mac_messages_send",
    "mac_music_add_to_playlist", "mac_music_create_playlist", "mac_music_list_playlists", "mac_music_next", "mac_music_now_playing", "mac_music_pause", "mac_music_play", "mac_music_previous", "mac_music_search", "mac_music_set_volume",
    "mac_notes_create", "mac_notes_create_folder", "mac_notes_delete", "mac_notes_delete_folder", "mac_notes_list_folders", "mac_notes_move", "mac_notes_read", "mac_notes_search", "mac_notes_update", "mac_notes_update_folder",
    "mac_photos_add_to_album", "mac_photos_create_album", "mac_photos_export", "mac_photos_list_albums", "mac_photos_read", "mac_photos_search",
    "mac_reminders_complete", "mac_reminders_create", "mac_reminders_create_list", "mac_reminders_delete", "mac_reminders_delete_list", "mac_reminders_list", "mac_reminders_list_lists", "mac_reminders_update", "mac_reminders_update_list",
  ]);
  assert.equal(new Set(names).size, names.length);
  for (const tool of MAC_APP_TOOLS) {
    assert.ok(["read", "write", "delete", "send"].includes(tool.kind), tool.name);
    assert.ok(["automation", "fullDiskAccess"].includes(tool.needs), tool.name);
    assert.equal(tool.inputSchema.type, "object", tool.name);
  }
  const kinds = Object.fromEntries(MAC_APP_TOOLS.filter((tool) => tool.app === "mail").map((tool) => [tool.name, tool.kind]));
  assert.deepEqual(kinds, {
    mac_mail_list_mailboxes: "read", mac_mail_search: "read", mac_mail_read: "read", mac_mail_read_attachment: "read",
    mac_mail_update: "write", mac_mail_move: "write", mac_mail_delete: "delete",
    mac_mail_send: "send", mac_mail_reply: "send", mac_mail_forward: "send",
    mac_mail_create_draft: "write", mac_mail_list_rules: "read", mac_mail_update_rule: "write",
  });
  // The class follows the verb: list, search, read, now (playing) and export read (an
  // export copies photos into the conversation, Photos is unchanged); delete
  // deletes; send, reply and forward send.
  for (const tool of MAC_APP_TOOLS) {
    const verb = tool.name.split("_")[2];
    const expected = ["list", "search", "read", "export", "now"].includes(verb) ? "read" : verb === "delete" ? "delete" : ["send", "reply", "forward"].includes(verb) ? "send" : "write";
    assert.equal(tool.kind, expected, tool.name);
  }
  assert.equal(MAC_APP_TOOLS.find((tool) => tool.name === "mac_messages_read").needs, "fullDiskAccess");
  assert.equal(MAC_APP_TOOLS.find((tool) => tool.name === "mac_messages_list_chats").needs, "fullDiskAccess");
  for (const name of names) {
    assert.ok(!name.includes("__"), name);
    assert.ok(isMacAppTool(name));
    if (!["mac_messages_read", "mac_messages_list_chats", "mac_messages_read_attachment"].includes(name)) assert.equal(typeof MAC_APP_SCRIPTS[name], "string", name);
  }
  assert.equal(isMacAppTool("mac_shell"), false);
  assert.deepEqual(names.filter(macAppToolWrites).sort(), MAC_APP_TOOLS.filter((tool) => tool.kind !== "read").map((tool) => tool.name).sort());
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
    assert.deepEqual(JSON.parse(argv[4]), JSON.parse(JSON.stringify(macAppScriptArgs(name, macAppOperation(name, args)))));
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
  assert.throws(() => macAppOperation("mac_mail_read", { id: "twelve" }), /message id/);
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
  const messages = await testMacApp(dir, "messages", { platform: "darwin", readMessages: async () => ({ messages: [{ chat: "Ada" }, { chat: "Ada" }, { chat: "Bea" }] }) });
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
const NANOS = 815692699090360064n; // a real message.date from AB's chat.db

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
  const { messages: rows } = await readMessages(dir, { limit: 10 });
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

// 2026-11-17: an Apple Mail routine's calls failed with "did not answer in
// time" and "returned an error: The operation was aborted".
test("a timeout and a cancelled call say what happened, per app", async () => {
  const timedOut = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
  const mail = macAppErrorText("mail", timedOut).message;
  assert.match(mail, /^Mail did not answer in time\. Mail is busy/);
  assert.match(mail, /narrow the call/);
  assert.doesNotMatch(macAppErrorText("calendar", timedOut).message, /narrow the call|Mail/);
  const aborted = Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" });
  assert.match(macAppErrorText("mail", aborted).message, /^The call to Mail was cancelled before Mail answered/);
  const result = await runMacAppCall("mac_mail_list_mailboxes", {}, { platform: "darwin", execFile: async () => { throw timedOut; } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^Mail did not answer in time/);
});

test("Mail's list and search stop at their time budget and say so", () => {
  assert.ok(MAC_APP_BUDGET_MS < 60_000 / 2);
  assert.match(MAC_APP_SCRIPTS.mac_mail_list_mailboxes, new RegExp(`late\\(${MAC_APP_BUDGET_MS}\\)\\)\\{STOP=true`));
  assert.match(MAC_APP_SCRIPTS.mac_mail_list_mailboxes, /r\.partial=/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_search, new RegExp(`if\\(out\\.length&&late\\(${MAC_APP_BUDGET_MS}\\)\\)\\{end=i;break\\}`));
  assert.match(MAC_APP_SCRIPTS.mac_mail_search, /if\(preview\)\{try\{o\.preview=/);
});

// 2026-11-17: a search of an account without a mailbox threw "No mailbox
// named undefined" when that account's inbox has a localized name.
test("an account's inbox is found by Mail's own inbox, whatever its name", () => {
  assert.match(MAC_APP_SCRIPTS.mac_mail_search, /if\(!box&&key==='inbox'\)box=inboxOf\(account\)/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_search, /Mail\.inbox\.mailboxes\(\)/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_search, /'boîte de réception'/);
  assert.doesNotMatch(MAC_APP_SCRIPTS.mac_mail_search, /'No mailbox named '\+mailbox\+' in '/);
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
  const resourcesPath = path.join(os.tmpdir(), "app-resources");
  const packagedHelper = path.join(resourcesPath, "automation-helper");
  assert.equal(automationHelperPath({ env: {}, resourcesPath, exists: (file) => file === packagedHelper }), packagedHelper);
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

// --- Mail actions (#4158, lot mac-mail-actions) -----------------------------
const ID = (n, mailbox = "INBOX", account = "Work") => mailId(account, mailbox, n);

test("a Mail id carries the account, the mailbox and the number; the old bare number still reads", () => {
  const id = ID(42, "Projects/2026");
  assert.equal(typeof id, "string");
  assert.ok(!id.includes("Work"), "opaque, not the account name in clear");
  assert.deepEqual(parseMailId(id), { account: "Work", mailbox: "Projects/2026", n: 42 });
  assert.deepEqual(parseMailId(42), { n: 42 });
  assert.deepEqual(parseMailId("42"), { n: 42 });
  for (const bad of ["", "abc", -1, 1.5, "mail:%%%", mailId("Work", "INBOX", 1).slice(0, -3) + "!!!", null, {}]) {
    assert.equal(parseMailId(bad), null, String(bad));
  }
  assert.throws(() => macAppOperation("mac_mail_read", { id: "nope" }), /message id/);
  assert.deepEqual(macAppScriptArgs("mac_mail_read", macAppOperation("mac_mail_read", { id })).ref, { account: "Work", mailbox: "Projects/2026", n: 42 });
  assert.deepEqual(macAppScriptArgs("mac_mail_read", macAppOperation("mac_mail_read", { id: 7 })).ref, { n: 7 });
});

test("every Mail operation is bounded, and validating twice gives the same operation (cards and the relay re-check it)", () => {
  const calls = [
    ["mac_mail_list_mailboxes", { account: "Work" }],
    ["mac_mail_search", { mailbox: "Projects/2026", account: "Work", query: "invoice", from: "ada@example.com", since: "2026-11-01", until: "2026-11-10", unread: true, flagged: false, inBody: true, limit: 20, cursor: "40" }],
    ["mac_mail_read", { id: ID(3), offset: 20_000, headers: true }],
    ["mac_mail_update", { ids: [ID(1), ID(2)], read: true, flagged: true, flagColor: "green", junk: false }],
    ["mac_mail_move", { ids: [ID(1)], to: "archive" }],
    ["mac_mail_move", { ids: [ID(1)], mailbox: "Receipts", account: "Home" }],
    ["mac_mail_delete", { ids: [ID(9)] }],
    ["mac_mail_send", { to: ["ada@example.com"], cc: ["bea@example.com"], bcc: ["cy@example.com"], from: "me@example.com", subject: "Hi", body: "Line 1\nLine 2" }],
    ["mac_mail_reply", { id: ID(5), body: "Thanks", all: true }],
    ["mac_mail_forward", { id: ID(5), to: ["dan@example.com"], cc: ["eve@example.com"], body: "FYI" }],
  ];
  for (const [name, args] of calls) {
    const op = macAppOperation(name, args);
    assert.deepEqual(macAppOperation(name, JSON.parse(JSON.stringify(op))), op, name);
  }
  const search = macAppOperation("mac_mail_search", calls[1][1]);
  assert.equal(search.offset, 40);
  assert.equal(search.unread, true);
  assert.equal(search.flagged, false);
  assert.equal(search.since, "2026-11-01T00:00:00.000Z");
  assert.equal(macAppOperation("mac_mail_search", {}).flagged, undefined);
  assert.equal(macAppOperation("mac_mail_search", { limit: 999 }).limit, 50);
  assert.equal(macAppOperation("mac_mail_update", { ids: [ID(1)], flagColor: "green" }).flagColor, 3);
  assert.throws(() => macAppOperation("mac_mail_search", { since: "2026-11-10", until: "2026-11-01" }), /after/);
  assert.throws(() => macAppOperation("mac_mail_search", { cursor: "x" }), /cursor/);
  assert.throws(() => macAppOperation("mac_mail_update", { ids: [ID(1)] }), /nothing to change/);
  assert.throws(() => macAppOperation("mac_mail_update", { ids: [ID(1)], flagColor: "pink" }), /flagColor/);
  assert.throws(() => macAppOperation("mac_mail_delete", { ids: [] }), /ids/);
  assert.throws(() => macAppOperation("mac_mail_delete", { ids: Array.from({ length: 51 }, (_, i) => ID(i)) }), /at most 50/);
  assert.throws(() => macAppOperation("mac_mail_delete", { ids: ["bogus"] }), /message id/);
  assert.throws(() => macAppOperation("mac_mail_move", { ids: [ID(1)] }), /mailbox or to/);
  assert.throws(() => macAppOperation("mac_mail_move", { ids: [ID(1)], to: "trash" }), /archive, inbox or junk/);
  assert.throws(() => macAppOperation("mac_mail_send", { to: ["a@example.com"], bcc: ["nope"], subject: "s", body: "b" }), /email addresses/);
  assert.throws(() => macAppOperation("mac_mail_send", { to: ["a@example.com"], from: "a@b.c\nBcc: x@y.z", subject: "s", body: "b" }), /control characters|email/);
  assert.throws(() => macAppOperation("mac_mail_reply", { id: ID(1), body: "" }), /required/);
  assert.throws(() => macAppOperation("mac_mail_forward", { id: ID(1), to: [] }), /required/);
  assert.throws(() => macAppOperation("mac_mail_list_mailboxes", { account: "a\u0007" }), /control characters/);
});

test("the Mail scripts are constants and get ids decoded to account, mailbox and number", async () => {
  const hostile = "\"); do shell script \"rm -rf ~\" --'${x}`\\";
  for (const [name, args] of [
    ["mac_mail_list_mailboxes", {}],
    ["mac_mail_search", { mailbox: hostile, query: hostile }],
    ["mac_mail_read", { id: ID(3, hostile) }],
    ["mac_mail_update", { ids: [ID(1)], read: false }],
    ["mac_mail_move", { ids: [ID(1), ID(2, "Other", "Home")], mailbox: hostile }],
    ["mac_mail_delete", { ids: [ID(9)] }],
    ["mac_mail_send", { to: ["ada@example.com"], bcc: ["cy@example.com"], from: "me@example.com", subject: hostile, body: hostile }],
    ["mac_mail_reply", { id: ID(5), body: hostile }],
    ["mac_mail_forward", { id: ID(5), to: ["dan@example.com"], body: hostile }],
  ]) {
    const { calls, execFile } = recorder("{}");
    const result = await runMacAppCall(name, args, { platform: "darwin", execFile });
    assert.equal(result.isError, undefined, `${name}: ${result.content[0].text}`);
    const argv = calls[0].args;
    assert.equal(argv[3], MAC_APP_SCRIPTS[name], name);
    assert.ok(!argv[3].includes("rm -rf"), name);
    const sent = JSON.parse(argv[4]);
    assert.ok(!JSON.stringify(sent).includes("\"ids\""), `${name}: ids are decoded before the script`);
    if (name === "mac_mail_move") assert.deepEqual(sent.refs, [{ account: "Work", mailbox: "INBOX", n: 1 }, { account: "Home", mailbox: "Other", n: 2 }]);
    if (name === "mac_mail_read") assert.deepEqual(sent.ref, { account: "Work", mailbox: hostile, n: 3 });
  }
  // The scripts use only Mail's dictionary verbs and properties.
  assert.match(MAC_APP_SCRIPTS.mac_mail_delete, /Mail\.delete\(/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_move, /Mail\.move\(/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_update, /readStatus/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_update, /flagIndex/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_update, /junkMailStatus/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_reply, /Mail\.reply\(m,\{openingWindow:false,replyToAll:/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_forward, /Mail\.forward\(m,\{openingWindow:false\}\)/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_send, /BccRecipient/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_send, /sender/);
  assert.match(MAC_APP_SCRIPTS.mac_mail_search, /dateReceived/);
});

test("Mail results come back with opaque ids, never the raw reference", async () => {
  const stdout = JSON.stringify({ messages: [{ ref: ["Work", "INBOX", 12], subject: "Hi" }], next: 10, failed: [{ ref: ["Home", "Old", 3], error: "gone" }] });
  const result = await runMacAppCall("mac_mail_search", {}, { platform: "darwin", execFile: async () => ({ stdout }) });
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.messages[0].id, mailId("Work", "INBOX", 12));
  assert.equal(body.messages[0].ref, undefined);
  assert.equal(body.failed[0].id, mailId("Home", "Old", 3));
  assert.equal(body.next, "10");
  assert.deepEqual(parseMailId(body.messages[0].id), { account: "Work", mailbox: "INBOX", n: 12 });
});

test("an archive with no archive mailbox answers the account's mailbox names, as an error", async () => {
  const stdout = JSON.stringify({ moved: 0, failed: [{ ref: ["Home", "INBOX", 3], error: "Home has no archive mailbox", mailboxes: ["INBOX", "Sent", "Receipts"] }] });
  const result = await runMacAppCall("mac_mail_move", { ids: [ID(3, "INBOX", "Home")], to: "archive" }, { platform: "darwin", execFile: async () => ({ stdout }) });
  assert.equal(result.isError, true);
  const body = JSON.parse(result.content[0].text);
  assert.deepEqual(body.failed[0].mailboxes, ["INBOX", "Sent", "Receipts"]);
});

test("the card target names the verb and a count, never the content", () => {
  assert.equal(macAppTarget("mac_mail_delete", { ids: [ID(1), ID(2)] }), "Mail: delete 2 emails");
  assert.equal(macAppTarget("mac_mail_move", { ids: [ID(1)], to: "archive" }), "Mail: archive 1 email");
  assert.equal(macAppTarget("mac_mail_move", { ids: [ID(1)], mailbox: "Receipts" }), "Mail: move 1 email to Receipts");
  assert.equal(macAppTarget("mac_mail_update", { ids: [ID(1), ID(2), ID(3)], read: true, flagged: false }), "Mail: mark 3 emails read, unflagged");
  assert.equal(macAppTarget("mac_mail_send", { to: ["a@example.com"], cc: [], bcc: ["b@example.com"], subject: "secret", body: "secret" }), "Mail to a@example.com, bcc b@example.com");
  assert.equal(macAppTarget("mac_mail_reply", { id: ID(1), body: "secret", all: true }), "Mail: reply to all on 1 email");
  assert.equal(macAppTarget("mac_mail_forward", { id: ID(1), to: ["d@example.com"], body: "secret" }), "Mail: forward 1 email to d@example.com");
  for (const name of ["mac_mail_update", "mac_mail_move", "mac_mail_delete", "mac_mail_send", "mac_mail_reply", "mac_mail_forward"]) {
    assert.ok(!macAppTarget(name, { ids: [ID(1)], id: ID(1), to: ["a@example.com"], subject: "secret", body: "secret", read: true }).includes("secret"), name);
  }
});

test("the status lists each app's actions with their kind and the permission each needs", () => {
  const dir = tempDir();
  writeMacAppSettings(dir, "mail", { enabled: true, automation: "granted" });
  const status = macAppsStatus(dir, { platform: "darwin", messagesAccess: () => "denied" });
  const mail = status.apps.find((row) => row.id === "mail");
  assert.deepEqual(mail.actions.map((action) => action.tool), MAC_APP_TOOLS.filter((tool) => tool.app === "mail").map((tool) => tool.name));
  assert.deepEqual(mail.actions.find((action) => action.tool === "mac_mail_delete"), { tool: "mac_mail_delete", kind: "delete", needs: "automation", granted: true });
  const messages = status.apps.find((row) => row.id === "messages");
  assert.equal(messages.actions.find((action) => action.tool === "mac_messages_read").granted, false);
  assert.equal(messages.actions.find((action) => action.tool === "mac_messages_send").needs, "automation");
  assert.deepEqual(macAppsStatus(dir, { platform: "win32" }).apps[0].actions, []);
});

test("every script is valid JavaScript for osascript's JXA", () => {
  for (const [name, script] of [...Object.entries(MAC_APP_SCRIPTS), ...Object.entries(MAC_APP_TEST_SCRIPTS)]) {
    assert.doesNotThrow(() => new Function(script), name);
  }
});

// A small stand-in for Mail's scripting objects, so the JXA itself runs here
// (no Apple Event, no real Mail).
function fakeMail() {
  const collection = (items, extra = {}) => {
    const fn = () => items.slice();
    Object.defineProperty(fn, "length", { get: () => items.length });
    items.forEach((item, index) => { fn[index] = item; });
    fn.byName = (name) => { const hit = items.find((item) => item.name() === name); if (!hit) return { name: () => { throw new Error("no such mailbox"); } }; return hit; };
    fn.byId = (id) => { const hit = items.find((item) => item.id() === id); if (!hit) throw new Error("no such message"); return hit; };
    fn.whose = (filter) => collection(items.filter((item) => Object.entries(filter).every(([key, value]) => item[key]() === value)));
    fn.push = (item) => items.push(item);
    return Object.assign(fn, extra);
  };
  const log = { moved: [], deleted: [] };
  const box = (name, account, children = []) => {
    const messages = [];
    const self = { name: () => name, account: () => { if (!account) throw new Error("local"); return account; }, unreadCount: () => messages.filter((m) => !m.readStatus()).length };
    self.mailboxes = collection(children);
    self.messages = collection(messages);
    self.add = (n, props = {}) => {
      const message = { id: () => n, subject: () => props.subject ?? `s${n}`, sender: () => "a@example.com", dateReceived: () => new Date("2026-11-01T00:00:00Z"), readStatus: () => false, flaggedStatus: () => false, content: () => props.content ?? "body", mailbox: () => self };
      messages.push(message);
      self.messages = collection(messages);
      return message;
    };
    return self;
  };
  const work = { name: () => "Work", enabled: () => true, emailAddresses: () => ["me@example.com"] };
  const home = { name: () => "Home", enabled: () => true, emailAddresses: () => ["me@home.example"] };
  const workInbox = box("INBOX", work);
  const archive = box("Archive", work);
  const projects = box("Projects", work, [box("2026", work)]);
  work.mailboxes = collection([workInbox, archive, projects]);
  const homeInbox = box("INBOX", home);
  home.mailboxes = collection([homeInbox, box("Receipts", home)]);
  const mail = {
    accounts: collection([work, home]),
    mailboxes: collection([]),
    inbox: workInbox,
    move: (message, { to }) => { log.moved.push([message.id(), to.name()]); },
    delete: (message) => { log.deleted.push(message.id()); },
  };
  return { mail, log, workInbox, homeInbox };
}
const runJxa = (name, op, mail) => {
  const run = new Function("Application", `${MAC_APP_SCRIPTS[name]}\nreturn run;`)(() => mail);
  return JSON.parse(run([JSON.stringify(macAppScriptArgs(name, macAppOperation(name, op)))]));
};

test("the Mail scripts act on the right messages through Mail's objects", () => {
  const { mail, log, workInbox, homeInbox } = fakeMail();
  const one = workInbox.add(11);
  workInbox.add(12);
  workInbox.add(13);
  homeInbox.add(21);
  const page = runJxa("mac_mail_search", { limit: 2 }, mail);
  assert.deepEqual(page.messages.map((m) => m.ref), [["Work", "INBOX", 11], ["Work", "INBOX", 12]]);
  assert.equal(page.next, 2);
  assert.equal(runJxa("mac_mail_search", { limit: 2, cursor: "2" }, mail).next, undefined);
  const boxes = runJxa("mac_mail_list_mailboxes", {}, mail);
  assert.deepEqual(boxes.accounts[0].mailboxes.map((b) => b.name), ["INBOX", "Archive", "Projects", "Projects/2026"]);
  const archived = runJxa("mac_mail_move", { ids: [ID(11), ID(21, "INBOX", "Home")], to: "archive" }, mail);
  assert.equal(archived.moved, 1);
  assert.deepEqual(log.moved, [[11, "Archive"]]);
  assert.match(archived.failed[0].error, /Home has no archive mailbox/);
  assert.deepEqual(archived.failed[0].mailboxes, ["INBOX", "Receipts"]);
  assert.equal(runJxa("mac_mail_move", { ids: [ID(12)], mailbox: "Projects/2026" }, mail).moved, 1);
  assert.deepEqual(log.moved.at(-1), [12, "2026"]);
  assert.equal(runJxa("mac_mail_delete", { ids: [ID(13), ID(99)] }, mail).deleted, 1);
  assert.deepEqual(log.deleted, [13]);
  const updated = runJxa("mac_mail_update", { ids: [ID(11)], read: true, flagColor: "blue" }, mail);
  assert.equal(updated.updated, 1);
  assert.equal(one.readStatus, true);
  assert.equal(one.flagIndex, 4);
  assert.equal(runJxa("mac_mail_read", { id: 12 }, mail).subject, "s12");
});

// --- #4158: the full action set of Messages, Calendar, Contacts, Reminders, Notes.
const SAMPLES = {
  mac_messages_list_chats: { query: "Ada", limit: 5, cursor: "5" },
  mac_messages_read: { chat: "iMessage;+;chat0001", query: "plan", since: "2026-11-01", limit: 5, cursor: "10" },
  mac_messages_read_attachment: { id: "g1", index: 0 },
  mac_messages_send: { chat: "iMessage;+;chat0001", text: "secret plan" },
  mac_mail_list_mailboxes: {},
  mac_mail_search: { query: "x" },
  mac_mail_read: { id: 12 },
  mac_mail_read_attachment: { id: 12, index: 1 },
  mac_mail_update: { ids: [12], read: true },
  mac_mail_move: { ids: [12], to: "archive" },
  mac_mail_delete: { ids: [12] },
  mac_mail_send: { to: ["ada@example.com"], subject: "secret", body: "secret plan" },
  mac_mail_reply: { id: 12, body: "secret plan" },
  mac_mail_forward: { id: 12, to: ["ada@example.com"], body: "secret plan" },
  mac_mail_create_draft: { to: ["ada@example.com"], bcc: ["bo@example.com"], subject: "secret", body: "secret plan" },
  mac_mail_list_rules: {},
  mac_mail_update_rule: { name: "Receipts", enabled: false },
  mac_calendar_list_calendars: {},
  mac_calendar_list: { from: "2026-11-10", to: "2026-11-17", query: "review" },
  mac_calendar_read: { id: "EV-1" },
  mac_calendar_create: { title: "Review", start: "2026-11-10T14:00:00Z", end: "2026-11-10T15:00:00Z", notes: "secret plan", alarms: [15, 0], repeat: "freq=weekly;count=4" },
  mac_calendar_update: { id: "EV-1", start: "2026-11-11T14:00:00Z", notes: "secret plan", repeat: "", calendar: "Work" },
  mac_calendar_delete: { ids: ["EV-1", "EV-2"] },
  mac_calendar_create_calendar: { name: "Team" },
  mac_calendar_update_calendar: { name: "Team", newName: "Crew" },
  mac_calendar_delete_calendar: { name: "Crew" },
  mac_contacts_search: { query: "514 555", cursor: "10" },
  mac_contacts_read: { id: "P-1" },
  mac_contacts_create: { firstName: "Ada", lastName: "Byron", note: "secret plan", emails: ["ada@example.com", { label: "home", value: "a@home.example" }], phones: ["+1 514 555 0100"] },
  mac_contacts_update: { id: "P-1", jobTitle: "Engineer", note: "secret plan" },
  mac_contacts_delete: { ids: ["P-1"] },
  mac_contacts_list_groups: {},
  mac_contacts_create_group: { name: "Team" },
  mac_contacts_update_group: { id: "G-1", add: ["P-1", "P-2"], remove: ["P-3"] },
  mac_contacts_delete_group: { id: "G-1" },
  mac_reminders_list_lists: {},
  mac_reminders_list: { query: "call", dueFrom: "2026-11-01", dueTo: "2026-12-01", cursor: "20" },
  mac_reminders_create: { title: "Call back", notes: "secret plan", due: "2026-11-20", priority: "high", remind: "2026-11-20T13:00:00Z" },
  mac_reminders_update: { id: "R-1", due: "", priority: "low", list: "Home", notes: "secret plan" },
  mac_reminders_complete: { ids: ["R-1", "R-2"] },
  mac_reminders_delete: { ids: ["R-1"] },
  mac_reminders_create_list: { name: "Errands" },
  mac_reminders_update_list: { name: "Errands", newName: "Chores" },
  mac_reminders_delete_list: { name: "Chores" },
  mac_notes_list_folders: {},
  mac_notes_search: { query: "plan", folder: "Work", cursor: "10" },
  mac_notes_read: { id: "N-1", offset: 20000, format: "html" },
  mac_notes_create: { title: "Plan", body: "secret plan" },
  mac_notes_update: { id: "N-1", body: "secret plan" },
  mac_notes_move: { ids: ["N-1"], folder: "Archive" },
  mac_notes_delete: { ids: ["N-1"] },
  mac_notes_create_folder: { name: "Projects" },
  mac_notes_update_folder: { name: "Projects", newName: "Work" },
  mac_notes_delete_folder: { name: "Work" },
  mac_photos_list_albums: { limit: 20, cursor: "20" },
  mac_photos_search: { person: "Ada", place: "Lisbon", album: "Trips", from: "2026-01-01", to: "2026-12-31", keyword: "beach", favorite: true, cursor: "30" },
  mac_photos_read: { ids: ["PH-1", "PH-2"] },
  mac_photos_export: { ids: ["PH-1"], maxSize: 1024 },
  mac_photos_create_album: { name: "Picks", ids: ["PH-1"] },
  mac_photos_add_to_album: { album: "Picks", ids: ["PH-1", "PH-2"] },
  mac_music_now_playing: {},
  mac_music_play: { album: "Blue", artist: "Joni", shuffle: false },
  mac_music_pause: {},
  mac_music_next: {},
  mac_music_previous: {},
  mac_music_set_volume: { volume: 40 },
  mac_music_search: { query: "river", kind: "albums", cursor: "25" },
  mac_music_list_playlists: { limit: 50 },
  mac_music_create_playlist: { name: "Road", ids: ["0123456789ABCDEF"] },
  mac_music_add_to_playlist: { playlist: "Road", ids: ["0123456789ABCDEF"] },
};

test("every tool has a bounded operation that validates twice to the same thing (the relay re-checks it)", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), MAC_APP_TOOLS.map((tool) => tool.name).sort());
  for (const [name, args] of Object.entries(SAMPLES)) {
    const op = macAppOperation(name, args);
    assert.deepEqual(macAppOperation(name, JSON.parse(JSON.stringify(op))), op, name);
  }
  assert.equal(macAppOperation("mac_calendar_create", SAMPLES.mac_calendar_create).repeat, "FREQ=WEEKLY;COUNT=4");
  assert.equal(macAppOperation("mac_calendar_update", SAMPLES.mac_calendar_update).repeat, "");
  assert.equal(macAppOperation("mac_reminders_create", SAMPLES.mac_reminders_create).dueAllDay, true);
  assert.equal(macAppOperation("mac_reminders_update", SAMPLES.mac_reminders_update).due, "");
  assert.equal(macAppOperation("mac_reminders_complete", { ids: ["R-1"] }).completed, true);
  assert.equal(macAppOperation("mac_reminders_complete", { ids: ["R-1"], completed: false }).completed, false);
  assert.deepEqual(macAppOperation("mac_notes_update", { id: "N-1", body: "x" }), { id: "N-1", body: "x", mode: "append", force: false });
  assert.deepEqual(macAppOperation("mac_contacts_read", { me: true }), { me: true });
  assert.equal(macAppOperation("mac_messages_read", SAMPLES.mac_messages_read).offset, 10);
  assert.throws(() => macAppOperation("mac_messages_send", { to: "+15550100", chat: "iMessage;+;chat1", text: "x" }), /not both/);
  assert.throws(() => macAppOperation("mac_calendar_create", { title: "x", start: "2026-11-10T14:00:00Z", end: "2026-11-10T15:00:00Z", repeat: "rm -rf" }), /RFC 5545/);
  assert.throws(() => macAppOperation("mac_calendar_create", { title: "x", start: "2026-11-10T14:00:00Z", end: "2026-11-10T15:00:00Z", alarms: [-5] }), /minutes/);
  assert.throws(() => macAppOperation("mac_calendar_update", { id: "EV-1" }), /nothing to change/);
  assert.throws(() => macAppOperation("mac_calendar_delete", { ids: Array.from({ length: 51 }, (_, i) => `E${i}`) }), /at most 50/);
  assert.throws(() => macAppOperation("mac_contacts_create", { note: "x" }), /firstName/);
  assert.throws(() => macAppOperation("mac_contacts_update_group", { id: "G-1" }), /nothing to change/);
  assert.throws(() => macAppOperation("mac_reminders_create", { title: "x", priority: "urgent" }), /priority/);
  assert.throws(() => macAppOperation("mac_notes_update", { id: "N-1" }), /body or a title/);
  assert.throws(() => macAppOperation("mac_notes_update", { id: "N-1", body: "x", mode: "overwrite" }), /append or replace/);
  assert.throws(() => macAppOperation("mac_mail_update_rule", { name: "R" }), /enabled/);
  assert.throws(() => macAppOperation("mac_notes_read", { id: "N-1\nx" }), /control characters/);
});

test("every new script is a constant and gets the operation as one JSON argv; the card names the verb and a count, never the content", async () => {
  for (const [name, args] of Object.entries(SAMPLES)) {
    if (name === "mac_messages_read" || name === "mac_messages_list_chats" || macAppSavesFiles(name)) continue;
    const { calls, execFile } = recorder();
    const result = await runMacAppCall(name, args, { platform: "darwin", execFile });
    assert.equal(result.isError, undefined, `${name}: ${result.content[0].text}`);
    assert.equal(calls[0].args[3], MAC_APP_SCRIPTS[name], name);
    assert.ok(!calls[0].args[3].includes("secret"), name);
    assert.deepEqual(JSON.parse(calls[0].args[4]), JSON.parse(JSON.stringify(macAppScriptArgs(name, macAppOperation(name, args)))), name);
    if (macAppToolWrites(name)) {
      const target = macAppTarget(name, macAppOperation(name, args));
      assert.notEqual(target, name, `${name} has a card line`);
      assert.ok(!target.includes("secret"), `${name}: ${target}`);
    }
  }
  assert.equal(macAppTarget("mac_calendar_delete", { ids: ["a", "b"] }), "Calendar: delete 2 events");
  assert.equal(macAppTarget("mac_reminders_complete", { ids: ["a"], completed: true }), "Reminders: mark 1 reminder done");
  assert.equal(macAppTarget("mac_notes_update", { id: "N", body: "x", mode: "append" }), "Notes: add to 1 note");
  assert.equal(macAppTarget("mac_contacts_update_group", { id: "G", add: ["a", "b"] }), "Contacts: group, add 2 cards");
});

test("a write where every item failed is an error; a partial one lists what failed", async () => {
  const all = await runMacAppCall("mac_notes_delete", { ids: ["N-1"] }, { platform: "darwin", execFile: async () => ({ stdout: JSON.stringify({ deleted: 0, failed: [{ id: "N-1", error: "gone" }] }) }) });
  assert.equal(all.isError, true);
  const some = await runMacAppCall("mac_reminders_complete", { ids: ["R-1", "R-2"] }, { platform: "darwin", execFile: async () => ({ stdout: JSON.stringify({ completed: 1, failed: [{ id: "R-2", error: "gone" }] }) }) });
  assert.equal(some.isError, undefined);
});

// A chat.db with a group, a person, and a message whose text lives only in
// attributedBody (the rich-text column), as current macOS stores many.
function richText(textValue) {
  const bytes = Buffer.from(textValue, "utf8");
  return Buffer.concat([Buffer.from("streamtyped\u0001NSString\u0001", "latin1"), Buffer.from([0x2b, bytes.length]), bytes, Buffer.from([0x86, 0x84])]);
}
async function chatFixture() {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = tempDir();
  const db = new DatabaseSync(path.join(dir, "chat.db"));
  db.exec(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, is_from_me INTEGER, text TEXT, attributedBody BLOB, service TEXT, handle_id INTEGER);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    INSERT INTO chat VALUES (1, 'iMessage;-;+15145550000', '+15145550000', '');
    INSERT INTO chat VALUES (2, 'iMessage;+;chat0001', 'chat0001', 'Team');
    INSERT INTO handle VALUES (1, '+15145550000'), (2, 'bo@example.com');
    INSERT INTO chat_handle_join VALUES (1, 1), (2, 1), (2, 2);`);
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, 'iMessage', ?)");
  insert.run(1, "g1", NANOS - 3_000_000_000_000n, 0, "old hello", null, 1);
  insert.run(2, "g2", NANOS - 2_000_000_000_000n, 0, null, richText("Lunch plan at noon"), 1);
  insert.run(3, "g3", NANOS - 1_000_000_000_000n, 1, "group hello", null, 2);
  insert.run(4, "g4", NANOS, 0, "latest", null, 2);
  db.exec("INSERT INTO chat_message_join VALUES (1, 1), (1, 2), (2, 3), (2, 4)");
  db.close();
  return dir;
}

test("a word search finds a message kept only as rich text (attributedBody), with paging and a date floor", async () => {
  const dir = await chatFixture();
  const { messages: found } = await readMessages(dir, { query: "plan", limit: 10 });
  assert.deepEqual(found.map((row) => [row.id, row.text]), [["g2", "Lunch plan at noon"]]);
  assert.equal(found[0].chatId, "iMessage;-;+15145550000");
  const { messages: recent } = await readMessages(dir, { since: appleDate(NANOS - 1_500_000_000_000n), limit: 10 });
  assert.deepEqual(recent.map((row) => row.id), ["g4", "g3"]);
  const tool = await runMacAppCall("mac_messages_read", { limit: 1, cursor: "1" }, { platform: "darwin", messagesDir: dir });
  const page = JSON.parse(tool.content[0].text);
  assert.deepEqual(page.messages.map((row) => row.id), ["g3"]);
  assert.equal(page.next, "2");
});

test("a word search finds an old message kept only as rich text behind many newer ones, and pages by a cursor that never skips one (#4158)", async () => {
  const dir = await chatFixture();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dir, "chat.db"));
  // 25,000 newer messages kept only as rich text, none with the word: more
  // than one call reads, so the search must hand back a cursor, not stop.
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, 0, NULL, ?, 'iMessage', 1)");
  const join = db.prepare("INSERT INTO chat_message_join VALUES (1, ?)");
  const filler = richText("see you soon");
  db.exec("BEGIN");
  for (let i = 0; i < 25_000; i += 1) {
    insert.run(100 + i, `f${i}`, NANOS + BigInt(i + 1) * 1_000_000_000n, filler);
    join.run(100 + i);
  }
  db.exec("COMMIT");
  db.close();
  const seen = [];
  let cursor;
  for (let call = 0; call < 5; call += 1) {
    const tool = await runMacAppCall("mac_messages_read", { query: "plan", limit: 10, ...(cursor ? { cursor } : {}) }, { platform: "darwin", messagesDir: dir });
    const page = JSON.parse(tool.content[0].text);
    seen.push(...page.messages.map((row) => row.id));
    cursor = page.next;
    if (!cursor) break;
  }
  assert.deepEqual(seen, ["g2"]);
  // A plain text match is found by SQL over every message, and the cursor
  // resumes right after the last one given: one by one, none skipped.
  const all = [];
  let next;
  for (let call = 0; call < 10; call += 1) {
    const page = JSON.parse((await runMacAppCall("mac_messages_read", { query: "hello", limit: 1, ...(next ? { cursor: next } : {}) }, { platform: "darwin", messagesDir: dir })).content[0].text);
    assert.ok(page.messages.length <= 1);
    all.push(...page.messages.map((row) => row.id));
    next = page.next;
    if (!next) break;
  }
  assert.deepEqual(all, ["g3", "g1"]);
});

test("the conversations list people and groups with their members, newest first", async () => {
  const dir = await chatFixture();
  const chats = await listChats(dir, { limit: 10 });
  assert.deepEqual(chats.map((chat) => [chat.chat, chat.name, chat.group, chat.members]), [
    ["iMessage;+;chat0001", "Team", true, ["+15145550000", "bo@example.com"]],
    ["iMessage;-;+15145550000", null, false, ["+15145550000"]],
  ]);
  assert.deepEqual((await listChats(dir, { query: "bo@", limit: 10 })).map((chat) => chat.chat), ["iMessage;+;chat0001"]);
  const tool = await runMacAppCall("mac_messages_list_chats", { limit: 1 }, { platform: "darwin", messagesDir: dir });
  assert.equal(JSON.parse(tool.content[0].text).next, "1");
});

// Small stand-ins for the apps' scripting objects, so the JXA itself runs here.
function elements(items) {
  const fn = () => items.slice();
  Object.defineProperty(fn, "length", { get: () => items.length });
  items.forEach((item, index) => { fn[index] = item; });
  fn.byId = (id) => { const hit = items.find((item) => item.id() === id); if (!hit) throw new Error("no such item"); return hit; };
  fn.whose = (filter) => elements(items.filter((item) => Object.entries(filter).every(([key, value]) => (typeof value === "object" && value._contains !== undefined ? String(item[key]()).includes(value._contains) : item[key]() === value))));
  fn.push = (item) => items.push(item);
  return fn;
}
const runApp = (name, op, app) => {
  const run = new Function("Application", `${MAC_APP_SCRIPTS[name]}\nreturn run;`)(() => app);
  return JSON.parse(run([JSON.stringify(macAppOperation(name, op))]));
};

test("the Notes scripts append by default, refuse a replace that would lose attachments, and never read a locked note", () => {
  const note = (id, name, body, extra = {}) => {
    const self = { id: () => id, name: () => name, body: () => self._body, plaintext: () => self._body.replace(/<[^>]+>/g, ""), modificationDate: () => new Date("2026-11-01T00:00:00Z"), container: () => ({ name: () => "Notes" }), attachments: () => extra.attachments ?? [], passwordProtected: () => extra.locked === true, _body: body };
    Object.defineProperty(self, "body", { get: () => () => self._body, set: (value) => { self._body = value; } });
    return self;
  };
  const plain = note("N-1", "Plan", "<h1>Plan</h1><div>one</div>");
  const rich = note("N-2", "Trip", "<h1>Trip</h1>", { attachments: [{ name: () => "map.png" }] });
  const locked = note("N-3", "Keys", "<div>hidden</div>", { locked: true });
  const notes = { notes: elements([plain, rich, locked]), folders: elements([]) };
  assert.equal(runApp("mac_notes_update", { id: "N-1", body: "two" }, notes).updated, true);
  assert.equal(plain._body, "<h1>Plan</h1><div>one</div><div>two</div>");
  assert.throws(() => runApp("mac_notes_update", { id: "N-2", body: "new", mode: "replace" }, notes), /1 attachment\(s\): replace would lose them/);
  assert.equal(runApp("mac_notes_update", { id: "N-2", body: "new", mode: "replace", force: true }, notes).updated, true);
  assert.equal(rich._body, "<h1>Trip</h1><div>new</div>");
  const read = runApp("mac_notes_read", { id: "N-3" }, notes);
  assert.equal(read.locked, true);
  assert.equal(read.content, undefined);
  assert.equal(runApp("mac_notes_read", { id: "N-1" }, notes).content, "Planonetwo");
  const search = runApp("mac_notes_search", { query: "", limit: 2 }, notes);
  assert.equal(search.notes.length, 2);
  assert.equal(search.next, "2");
  assert.equal(search.notes.find((n) => n.id === "N-3"), undefined);
});

test("the Reminders scripts filter by words and due range, page, and complete by id", () => {
  const reminder = (id, name, due, extra = {}) => {
    const self = { id: () => id, name: () => name, dueDate: () => due, alldayDueDate: () => null, remindMeDate: () => null, priority: () => extra.priority ?? 0, body: () => extra.body ?? "", completed: () => self._done, _done: false };
    Object.defineProperty(self, "completed", { get: () => () => self._done, set: (value) => { self._done = value; } });
    return self;
  };
  const items = [reminder("R-1", "Call Ada", new Date("2026-11-05T12:00:00Z"), { priority: 1 }), reminder("R-2", "Call Bo", new Date("2026-12-05T12:00:00Z")), reminder("R-3", "Buy milk", null, { body: "call first" })];
  const list = { id: () => "L-1", name: () => "Home", reminders: elements(items) };
  list.reminders.whose = (filter) => elements(items.filter((item) => item.completed() === filter.completed));
  const app = { lists: elements([list]), reminders: elements(items) };
  const calls = runApp("mac_reminders_list", { query: "call", limit: 1 }, app);
  assert.deepEqual(calls.reminders.map((r) => [r.id, r.priority]), [["R-1", "high"]]);
  assert.equal(calls.next, "1");
  const ranged = runApp("mac_reminders_list", { dueFrom: "2026-11-01", dueTo: "2026-12-01" }, app);
  assert.deepEqual(ranged.reminders.map((r) => r.id), ["R-1"]);
  assert.deepEqual(runApp("mac_reminders_complete", { ids: ["R-1", "R-9"] }, app), { completed: 1, failed: [{ id: "R-9", error: "no such item" }] });
  assert.equal(items[0]._done, true);
  assert.deepEqual(runApp("mac_reminders_list", {}, app).reminders.map((r) => r.id), ["R-2", "R-3"]);
});

test("the Contacts search matches a name, an email or a phone's digits in one bulk read", () => {
  const ids = ["P-1", "P-2"];
  const people = elements([{ id: () => "P-1", name: () => "Ada Byron", organization: () => "Analytical" }, { id: () => "P-2", name: () => "Bo", organization: () => "" }]);
  people.id = () => ids;
  Object.defineProperty(people, "name", { value: () => ["Ada Byron", "Bo"] });
  people.emails = { value: () => [["ada@example.com"], []] };
  people.phones = { value: () => [[], ["+1 (514) 555-0100"]] };
  const app = { people };
  assert.deepEqual(runApp("mac_contacts_search", { query: "514-555" }, app).people.map((p) => p.id), ["P-2"]);
  assert.deepEqual(runApp("mac_contacts_search", { query: "ADA@" }, app).people.map((p) => [p.id, p.organization]), [["P-1", "Analytical"]]);
  assert.deepEqual(runApp("mac_contacts_search", { query: "byron" }, app).people.map((p) => p.id), ["P-1"]);
});

// --- #4158 review: older desktops, files, attachments, reactions, repeating events.
test("a desktop app that reports no tools runs its 12 older tools, as they were; a current one, the tools it reports", () => {
  assert.deepEqual(MAC_APP_LEGACY_TOOLS.map((tool) => tool.name), [
    "mac_messages_read", "mac_messages_send", "mac_mail_search", "mac_mail_read", "mac_mail_send", "mac_calendar_list",
    "mac_calendar_create", "mac_contacts_search", "mac_reminders_list", "mac_reminders_create", "mac_notes_search", "mac_notes_create",
  ]);
  assert.deepEqual(MAC_APP_LEGACY_TOOLS.find((tool) => tool.name === "mac_mail_read").inputSchema.properties, { id: { type: "number" } });
  assert.deepEqual(Object.keys(MAC_APP_LEGACY_TOOLS.find((tool) => tool.name === "mac_messages_send").inputSchema.properties), ["to", "text"]);
  assert.equal(macAppToolsFor(null), MAC_APP_LEGACY_TOOLS);
  assert.deepEqual(macAppToolsFor(["mac_mail_delete", "bogus"]).map((tool) => tool.name), ["mac_mail_delete"]);
  assert.equal(macAppLegacyCall("mac_mail_search", { query: "x", limit: 5 }), true);
  assert.equal(macAppLegacyCall("mac_mail_read", { id: 3, offset: 20000 }), false);
  assert.equal(macAppLegacyCall("mac_messages_send", { chat: "iMessage;+;chat0001", text: "x" }), false);
  assert.equal(macAppLegacyCall("mac_mail_delete", { ids: [1] }), false);
  assert.match(MAC_APP_UPDATE_DESKTOP, /Update the Sagax app on your Mac/);
});

test("a card never shows a conversation's chat id: its name or members, else a conversation; files are counted", () => {
  assert.equal(macAppTarget("mac_messages_send", { chat: "iMessage;+;chat0001", text: "x" }), "Messages to a conversation");
  assert.equal(macAppTarget("mac_messages_send", { chat: "iMessage;+;chat0001", chatLabel: "Team", text: "x", files: ["/a", "/b"] }), "Messages to Team, with 2 files");
  assert.equal(macAppTarget("mac_mail_send", { to: ["a@example.com"], files: ["/a"] }), "Mail to a@example.com, with 1 file");
  assert.equal(macAppTarget("mac_mail_create_draft", { replyTo: "mail.x", all: true, body: "b" }), "Mail: save a draft reply to all");
  assert.equal(macAppTarget("mac_calendar_delete", { ids: ["E#2026-11-10T14:00:00.000Z"], scope: "this" }), "Calendar: delete 1 event, this occurrence");
});

test("files to attach: a staged name in the desktop's folder, a checked path on the solo Mac; anything else is refused before osascript", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "mac-1-plan.pdf"), "pdf");
  const { calls, execFile } = recorder("{\"sent\":true}");
  const ok = await runMacAppCall("mac_mail_send", { to: ["a@example.com"], subject: "s", body: "b", files: ["mac-1-plan.pdf"] }, { platform: "darwin", execFile, filesDir: dir });
  assert.equal(ok.isError, undefined, ok.content[0].text);
  assert.deepEqual(JSON.parse(calls[0].args[4]).files, [path.join(dir, "mac-1-plan.pdf")]);
  const escape = await runMacAppCall("mac_mail_send", { to: ["a@example.com"], subject: "s", body: "b", files: ["../etc/passwd"] }, { platform: "darwin", execFile, filesDir: dir });
  assert.equal(escape.isError, true);
  const relative = await runMacAppCall("mac_messages_send", { to: "+15145550000", files: ["plan.pdf"] }, { platform: "darwin", execFile });
  assert.equal(relative.isError, true);
  assert.equal(calls.length, 1);
  assert.throws(() => macAppOperation("mac_messages_send", { to: "+15145550000", files: ["/a"], service: "SMS" }), /iMessage/);
  assert.deepEqual(macAppOperation("mac_messages_send", { to: "+15145550000", files: ["/a"] }), { to: "+15145550000", files: ["/a"] });
});

test("Mail: send and reply attach files, a draft can be a reply, and an attachment is saved into the conversation's folder", async () => {
  const pushed = [];
  const outgoing = () => { const msg = { toRecipients: [], ccRecipients: [], bccRecipients: [], attachments: { push: (x) => pushed.push(x) }, send: () => { msg.sent = true; }, save: () => { msg.saved = true; } }; return msg; };
  const original = { id: () => 12, subject: () => "Hi", mailbox: () => ({ name: () => "INBOX", account: () => ({ name: () => "Work" }) }) };
  let made;
  const mail = {
    accounts: () => [],
    inbox: { messages: Object.assign(() => [original], { whose: () => () => [original] }) },
    OutgoingMessage: () => (made = outgoing()),
    outgoingMessages: { push: () => {} },
    Recipient: (x) => x, CcRecipient: (x) => x, BccRecipient: (x) => x,
    Attachment: (x) => x,
    reply: (m, opts) => { made = outgoing(); made.content = () => "> quoted"; made.opts = opts; made.toRecipients = Object.assign([], { push: () => {} }); return made; },
  };
  const run = (name, op) => JSON.parse(new Function("Application", "Path", `${MAC_APP_SCRIPTS[name]}\nreturn run;`)(() => mail, (p) => `file:${p}`)([JSON.stringify(macAppScriptArgs(name, macAppOperation(name, op)))]));
  assert.equal(run("mac_mail_send", { to: ["a@example.com"], subject: "s", body: "b", files: ["/x/plan.pdf"] }).files, 1);
  assert.deepEqual(pushed, [{ fileName: "file:/x/plan.pdf" }]);
  assert.equal(made.sent, true);
  const draft = run("mac_mail_create_draft", { replyTo: 12, all: true, body: "draft text", files: ["/x/b.pdf"] });
  assert.equal(draft.reply, true);
  assert.equal(made.saved, true);
  assert.equal(made.sent, undefined);
  assert.deepEqual(made.opts, { openingWindow: false, replyToAll: true });
  assert.equal(made.content, "draft text\n\n> quoted");
  assert.deepEqual(pushed.at(-1), { fileName: "file:/x/b.pdf" });
  assert.throws(() => macAppOperation("mac_mail_create_draft", { body: "x" }), /subject is required/);

  const saveDir = tempDir();
  const execFile = async (_file, args) => {
    const a = JSON.parse(args[4]);
    const target = `${a.dir}/${a.prefix}report.pdf`;
    fs.writeFileSync(target, "pdf!");
    return { stdout: JSON.stringify({ name: "report.pdf", mime: "application/pdf", bytes: 4, path: target }) };
  };
  const saved = await runMacAppCall("mac_mail_read_attachment", { id: 12, index: 0 }, { platform: "darwin", execFile, saveDir });
  const out = JSON.parse(saved.content[0].text);
  assert.ok(out.path.startsWith(saveDir), out.path);
  assert.equal(out.bytes, 4);
  const elsewhere = await runMacAppCall("mac_mail_read_attachment", { id: 12, index: 0 }, { platform: "darwin", saveDir, execFile: async () => ({ stdout: JSON.stringify({ name: "x", path: "/etc/hosts" }) }) });
  assert.equal(elsewhere.isError, true);
  const noFolder = await runMacAppCall("mac_mail_read_attachment", { id: 12, index: 0 }, { platform: "darwin", execFile });
  assert.equal(noFolder.isError, true);
});

test("Messages: a read carries reactions (removed ones taken off), attachments by index, edited, unsent and reply marks; reaction rows are not messages", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = tempDir();
  const db = new DatabaseSync(path.join(dir, "chat.db"));
  db.exec(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, is_from_me INTEGER, text TEXT, attributedBody BLOB, service TEXT, handle_id INTEGER,
      associated_message_guid TEXT, associated_message_type INTEGER, date_edited INTEGER, date_retracted INTEGER, thread_originator_guid TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT, mime_type TEXT, transfer_name TEXT, total_bytes INTEGER);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    INSERT INTO chat VALUES (1, 'iMessage;+;chat0001', 'chat0001', 'Team');
    INSERT INTO handle VALUES (1, '+15145550000'), (2, 'bo@example.com');`);
  fs.mkdirSync(path.join(dir, "Attachments"));
  fs.writeFileSync(path.join(dir, "Attachments", "photo.heic"), "img");
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?, NULL, 'iMessage', ?, ?, ?, ?, ?, ?)");
  insert.run(1, "g1", NANOS - 5_000_000_000n, 0, "lunch?", 1, null, 0, 0, 0, null);
  insert.run(2, "g2", NANOS - 4_000_000_000n, 1, "yes", null, null, 0, NANOS, 0, "g1");
  insert.run(3, "g3", NANOS - 3_000_000_000n, 0, "Loved “lunch?”", 2, "p:0/g1", 2000, 0, 0, null);
  insert.run(4, "g4", NANOS - 2_000_000_000n, 1, "Liked “lunch?”", null, "p:0/g1", 2001, 0, 0, null);
  insert.run(5, "g5", NANOS - 1_000_000_000n, 1, "Removed a like", null, "p:0/g1", 3001, 0, 0, null);
  insert.run(6, "g6", NANOS, 1, "", null, null, 0, 0, NANOS, null);
  db.exec("INSERT INTO chat_message_join VALUES (1,1),(1,2),(1,3),(1,4),(1,5),(1,6)");
  db.exec(`INSERT INTO attachment VALUES (9, '${path.join(dir, "Attachments", "photo.heic")}', 'image/heic', 'photo.heic', 3); INSERT INTO message_attachment_join VALUES (1, 9);`);
  db.close();
  const { messages: rows } = await readMessages(dir, { limit: 10 });
  assert.deepEqual(rows.map((row) => row.id), ["g6", "g2", "g1"]);
  const [unsent, reply, first] = rows;
  assert.equal(unsent.unsent, true);
  assert.equal(reply.edited, true);
  assert.equal(reply.replyTo, "g1");
  assert.deepEqual(first.reactions, [{ from: "bo@example.com", reaction: "love" }]);
  assert.deepEqual(first.attachments, [{ index: 0, name: "photo.heic", mime: "image/heic", bytes: 3 }]);
  const saveDir = tempDir();
  const saved = await readMessageAttachment(dir, { id: "g1", index: 0 }, saveDir);
  assert.ok(saved.path.startsWith(saveDir));
  assert.equal(fs.readFileSync(saved.path, "utf8"), "img");
  await assert.rejects(() => readMessageAttachment(dir, { id: "g1", index: 3 }, saveDir), /1 attachment/);
  const tool = await runMacAppCall("mac_messages_read_attachment", { id: "g1", index: 0 }, { platform: "darwin", messagesDir: dir, saveDir });
  assert.equal(JSON.parse(tool.content[0].text).name, "photo.heic");
});

test("a repeating event's occurrences come from its rule, in the Mac's own time zone", () => {
  const start = new Date(2026, 0, 5, 9, 30); // a Monday
  const iso = (list) => list.map((d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`);
  assert.deepEqual(iso(occurrences("FREQ=WEEKLY;BYDAY=MO,WE", start, new Date(2026, 10, 9), new Date(2026, 10, 16), 50)), ["2026-11-9 9:30", "2026-11-11 9:30"]);
  assert.deepEqual(iso(occurrences("FREQ=WEEKLY;INTERVAL=2", start, new Date(2026, 0, 1), new Date(2026, 1, 10), 50)), ["2026-1-5 9:30", "2026-1-19 9:30", "2026-2-2 9:30"]);
  assert.deepEqual(iso(occurrences("FREQ=MONTHLY;BYDAY=2TU", start, new Date(2026, 1, 1), new Date(2026, 3, 1), 50)), ["2026-2-10 9:30", "2026-3-10 9:30"]);
  assert.deepEqual(iso(occurrences("FREQ=MONTHLY;BYDAY=-1FR", start, new Date(2026, 4, 1), new Date(2026, 5, 1), 50)), ["2026-5-29 9:30"]);
  assert.deepEqual(iso(occurrences("FREQ=MONTHLY;BYMONTHDAY=31", new Date(2026, 0, 31, 8), new Date(2026, 0, 1), new Date(2026, 4, 1), 50)), ["2026-1-31 8:0", "2026-3-31 8:0"]);
  assert.deepEqual(iso(occurrences("FREQ=DAILY;COUNT=3", start, new Date(2026, 0, 1), new Date(2026, 1, 1), 50)), ["2026-1-5 9:30", "2026-1-6 9:30", "2026-1-7 9:30"]);
  assert.deepEqual(iso(occurrences("FREQ=DAILY;UNTIL=20260107", start, new Date(2026, 0, 1), new Date(2026, 1, 1), 50)), ["2026-1-5 9:30", "2026-1-6 9:30", "2026-1-7 9:30"]);
  assert.deepEqual(iso(occurrences("FREQ=DAILY;COUNT=3", start, new Date(2026, 0, 1), new Date(2026, 1, 1), 50, [new Date(2026, 0, 6, 9, 30)])), ["2026-1-5 9:30", "2026-1-7 9:30"]);
  assert.deepEqual(iso(occurrences("FREQ=YEARLY", new Date(2024, 1, 29, 10), new Date(2024, 0, 1), new Date(2029, 0, 1), 50)), ["2024-2-29 10:0", "2028-2-29 10:0"]);
  assert.equal(occurrences("FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU", start, start, new Date(2027, 0, 1), 50), null);
  assert.equal(occurrences("FREQ=HOURLY", start, start, new Date(2027, 0, 1), 50), null);
  assert.deepEqual(calendarRef("abc@x.com#2026-11-09T14:30:00.000Z"), { uid: "abc@x.com", occurrence: "2026-11-09T14:30:00.000Z" });
  assert.deepEqual(calendarRef("abc@x.com"), { uid: "abc@x.com" });
});

// A small Calendar: events with uid, dates, recurrence, excluded dates.
function fakeCalendar() {
  const log = { deleted: [], made: [] };
  let next = 0;
  const event = (props, cal) => {
    const e = { _p: { ...props }, _alarms: [] };
    for (const key of ["summary", "startDate", "endDate", "alldayEvent", "location", "description", "url", "recurrence", "excludedDates", "uid"]) {
      Object.defineProperty(e, key, { get: () => () => (key === "excludedDates" ? e._p.excludedDates ?? [] : e._p[key]), set: (value) => { e._p[key] = value; }, enumerable: true });
    }
    e._p.uid = e._p.uid ?? `NEW-${(next += 1)}`;
    e.displayAlarms = Object.assign(() => e._alarms.slice(), { push: (x) => e._alarms.push(x) });
    e.cal = cal;
    return e;
  };
  const calendar = (name) => {
    const events = [];
    const cal = { name: () => name, writable: () => true, _events: events };
    const spec = (list) => {
      const fn = () => list.slice();
      list.forEach((item, index) => { fn[index] = item; });
      fn.startDate = () => list.map((item) => item.startDate());
      fn.recurrence = () => list.map((item) => item.recurrence() ?? "");
      return fn;
    };
    cal.events = {
      whose: (filter) => {
        if (filter.uid !== undefined) return () => events.filter((item) => item.uid() === filter.uid);
        const to = filter.startDate?._lessThan;
        return spec(events.filter((item) => !to || item.startDate() < to));
      },
      push: (e) => { e.cal = cal; events.push(e); log.made.push(e); },
    };
    cal.add = (props) => { const e = event(props, cal); events.push(e); return e; };
    return cal;
  };
  const work = calendar("Work");
  const home = calendar("Home");
  const app = {
    calendars: Object.assign(() => [work, home], { whose: (filter) => () => [work, home].filter((c) => c.name() === filter.name) }),
    Event: (props) => event(props, null),
    DisplayAlarm: (x) => x,
    delete: (e) => { log.deleted.push(e.uid()); const list = e.cal._events; list.splice(list.indexOf(e), 1); },
  };
  return { app, work, home, log };
}
const runCal = (name, op, app) => JSON.parse(new Function("Application", `${MAC_APP_SCRIPTS[name]}\nreturn run;`)(() => app)([JSON.stringify(macAppScriptArgs(name, macAppOperation(name, op)))]));

test("Calendar: the list gives each occurrence of a repeating event that started before the range; scope changes or deletes one, the rest, or the whole series", () => {
  const { app, work, log } = fakeCalendar();
  const weekly = work.add({ uid: "W1", summary: "Standup", startDate: new Date(2026, 0, 5, 9), endDate: new Date(2026, 0, 5, 9, 15), alldayEvent: false, recurrence: "FREQ=WEEKLY;COUNT=60" });
  work.add({ uid: "P1", summary: "Review", startDate: new Date(2026, 10, 10, 14), endDate: new Date(2026, 10, 10, 15), alldayEvent: false, recurrence: "" });
  work.add({ uid: "X1", summary: "Odd", startDate: new Date(2026, 0, 1, 8), endDate: new Date(2026, 0, 1, 9), alldayEvent: false, recurrence: "FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO" });
  const listed = runCal("mac_calendar_list", { from: new Date(2026, 10, 9).toISOString(), to: new Date(2026, 10, 17).toISOString(), calendar: "Work" }, app);
  const occ = listed.events.filter((e) => e.series === "W1");
  assert.deepEqual(occ.map((e) => new Date(e.start).getDate()), [9, 16]);
  assert.equal(occ[0].id, `W1#${new Date(2026, 10, 9, 9).toISOString()}`);
  assert.equal(new Date(occ[0].end) - new Date(occ[0].start), 15 * 60_000);
  assert.ok(listed.events.some((e) => e.id === "P1"));
  assert.equal(listed.events.find((e) => e.id === "X1").occurrences, "unknown");

  // This occurrence: it leaves the series as an event of its own.
  const one = runCal("mac_calendar_update", { id: occ[0].id, title: "Standup (moved)", start: new Date(2026, 10, 9, 10).toISOString(), end: new Date(2026, 10, 9, 10, 15).toISOString() }, app);
  assert.equal(one.scope, "this");
  assert.deepEqual(weekly.excludedDates().map((d) => +d), [+new Date(2026, 10, 9, 9)]);
  const made = log.made.at(-1);
  assert.equal(made.summary(), "Standup (moved)");
  assert.equal(made.recurrence(), undefined);
  // This one and the ones after: the series ends before it, a new one starts with the rest of COUNT.
  const later = runCal("mac_calendar_update", { id: occ[1].id, title: "Standup v2", scope: "future" }, app);
  assert.equal(later.scope, "future");
  assert.match(weekly.recurrence(), /^FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z$/);
  assert.equal(log.made.at(-1).recurrence(), "FREQ=WEEKLY;COUNT=15");
  assert.equal(log.made.at(-1).summary(), "Standup v2");
  // Delete one occurrence of the new series, then the whole series.
  const series2 = log.made.at(-1).uid();
  const second = `${series2}#${new Date(2026, 10, 23, 9).toISOString()}`;
  assert.equal(runCal("mac_calendar_delete", { ids: [second] }, app).deleted, 1);
  assert.deepEqual(log.made.at(-1).excludedDates().map((d) => +d), [+new Date(2026, 10, 23, 9)]);
  assert.equal(runCal("mac_calendar_delete", { ids: [second], scope: "all" }, app).deleted, 1);
  assert.ok(log.deleted.includes(series2));
  // A series id with scope this has no occurrence to name.
  const refused = runCal("mac_calendar_delete", { ids: ["W1"], scope: "this" }, app);
  assert.match(refused.failed[0].error, /occurrence id/);
});

// 2026-11-17: a slow app (one Apple Event per item) took past the script's
// 60 s and the call failed with nothing. Each list or search answers by
// MAC_APP_BUDGET_MS with what it read, and a cursor or a partial note.
// The clock below moves 10 s at each reading, so a budget runs out in a few items.
const slowClock = (t) => { let now = 0; t.mock.method(Date, "now", () => (now += 10_000)); };

test("every Apple app list answers within its budget, and a cursor resumes it", (t) => {
  assert.ok(MAC_APP_BUDGET_MS < 60_000 / 2);
  const { app, work, home } = fakeCalendar();
  for (let day = 10; day < 14; day += 1) work.add({ uid: `W${day}`, summary: `Work ${day}`, startDate: new Date(2026, 10, day, 9), endDate: new Date(2026, 10, day, 10), alldayEvent: false, recurrence: "" });
  home.add({ uid: "H1", summary: "Home", startDate: new Date(2026, 10, 12, 18), endDate: new Date(2026, 10, 12, 19), alldayEvent: false, recurrence: "" });
  const range = { from: new Date(2026, 10, 9).toISOString(), to: new Date(2026, 10, 17).toISOString() };
  slowClock(t);
  const seen = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const listed = runCal("mac_calendar_list", { ...range, ...(cursor ? { cursor } : {}) }, app);
    seen.push(...listed.events.map((e) => e.id));
    if (!listed.next) break;
    assert.match(listed.partial, /Calendar was slow/);
    cursor = listed.next;
  }
  assert.deepEqual(seen.sort(), ["H1", "W10", "W11", "W12", "W13"]);

  const reminder = (id) => ({ id: () => id, name: () => id, dueDate: () => null, alldayDueDate: () => null, remindMeDate: () => null, priority: () => 0, body: () => "", completed: () => false });
  const items = ["R-1", "R-2", "R-3", "R-4"].map(reminder);
  const list = { id: () => "L-1", name: () => "Home", reminders: elements(items) };
  list.reminders.whose = () => elements(items);
  const rem = { lists: elements([list]), reminders: elements(items) };
  const got = [];
  cursor = undefined;
  for (let page = 0; page < 10; page += 1) {
    const listed = runApp("mac_reminders_list", { limit: 50, ...(cursor ? { cursor } : {}) }, rem);
    got.push(...listed.reminders.map((r) => r.id));
    if (!listed.next) break;
    cursor = listed.next;
  }
  assert.deepEqual(got, ["R-1", "R-2", "R-3", "R-4"]);
  assert.equal(runApp("mac_reminders_list_lists", {}, { lists: elements([list, list, list, list]) }).partial !== undefined, true);
});

test("Notes and Contacts searches stop at their budget with a next cursor, extras skipped past half", (t) => {
  const note = (id) => ({ id: () => id, name: () => id, plaintext: () => `text ${id}`, modificationDate: () => new Date(0), container: () => ({ name: () => "Notes" }), passwordProtected: () => false });
  const notes = { notes: elements(["N-1", "N-2", "N-3"].map(note)), folders: elements([]) };
  const people = elements([["P-1", "One"], ["P-2", "Two"], ["P-3", "Three"]].map(([id, org]) => ({ id: () => id, name: () => id, organization: () => org })));
  people.id = () => ["P-1", "P-2", "P-3"];
  Object.defineProperty(people, "name", { value: () => ["Ann A", "Ann B", "Ann C"] });
  people.emails = { value: () => [[], [], []] };
  people.phones = { value: () => [[], [], []] };
  slowClock(t);
  const found = runApp("mac_notes_search", { query: "", limit: 3 }, notes);
  assert.deepEqual(found.notes.map((n) => [n.id, n.preview !== null]), [["N-1", true], ["N-2", false]]);
  assert.equal(found.next, "2");
  const ann = runApp("mac_contacts_search", { query: "ann", limit: 3 }, { people });
  assert.deepEqual(ann.people.map((p) => [p.id, p.organization]), [["P-1", "One"], ["P-2", null]]);
  assert.equal(ann.next, "2");
  const folders = runApp("mac_notes_list_folders", {}, { accounts: () => [{ name: () => "iCloud", folders: () => [1, 2, 3, 4].map((n) => ({ name: () => `F${n}`, notes: [] })) }] });
  assert.match(folders.partial, /stopped early/);
  const groups = runApp("mac_contacts_list_groups", {}, { groups: () => [1, 2, 3, 4].map((n) => ({ id: () => `G${n}`, name: () => `G${n}`, people: [] })) });
  assert.ok(groups.groups.length < 4);
  assert.match(groups.partial, /stopped early/);
});

// --- Photos (2026-11-17): a stand-in for Photos' scripting objects, so the
// JXA runs here with no Apple Event and no real Photos.
function fakePhotos() {
  const item = (id, date, extra = {}) => ({ id: () => id, date: () => (date ? new Date(date) : null), filename: () => `${id}.HEIC`, name: () => extra.title ?? null, description: () => extra.caption ?? null, width: () => 4032, height: () => 3024, favorite: () => extra.favorite === true, keywords: () => extra.keywords ?? [], location: () => extra.location ?? [null, null], altitude: () => null });
  const items = [
    item("PH-1", "2026-03-01T10:00:00Z", { keywords: ["Beach"], location: [38.72, -9.14] }),
    item("PH-2", "2026-07-01T10:00:00Z", { favorite: true }),
    item("PH-3", "2026-05-01T10:00:00Z", { keywords: ["beach"], favorite: true }),
    item("PH-4", "2025-12-31T10:00:00Z"),
  ];
  const bulk = (list) => {
    const fn = () => list.slice();
    Object.defineProperty(fn, "length", { get: () => list.length });
    list.forEach((entry, index) => { fn[index] = entry; });
    for (const key of ["id", "date", "favorite", "keywords", "name"]) Object.defineProperty(fn, key, { value: () => list.map((entry) => entry[key]()), writable: true, configurable: true });
    fn.byId = (id) => { const hit = list.find((entry) => entry.id() === id); if (!hit) return { id: () => { throw new Error("no such item"); }, name: () => { throw new Error("no such item"); } }; return hit; };
    fn.whose = (filter) => bulk(list.filter((entry) => Object.entries(filter).every(([key, value]) => entry[key]() === value)));
    return fn;
  };
  const albumMembers = { "AL-1": [items[0], items[2]], "AL-2": [items[1]] };
  const album = (id, name) => ({ id: () => id, name: () => name, mediaItems: bulk(albumMembers[id]) });
  const albums = [album("AL-1", "Trips")];
  const nested = album("AL-2", "Kids");
  const folder = { name: () => "Family", albums: bulk([nested]), folders: () => [] };
  const log = { added: [], exported: [], made: [] };
  const photos = {
    mediaItems: bulk(items),
    albums: bulk([...albums, nested]),
    folders: Object.assign(() => [folder], { whose: (filter) => () => (filter.name === "Family" ? [folder] : []) }),
    search: ({ for: words }) => (words.includes("Lisbon") ? [items[0], items[3]] : []),
    add: (list, { to }) => log.added.push([to.name(), list.map((entry) => entry.id())]),
    export: (list, options) => log.exported.push([list.map((entry) => entry.id()), options.to, options.usingOriginals]),
    make: (props) => { log.made.push(props); albumMembers["AL-9"] = []; return album("AL-9", props.named); },
  };
  // The app's own albums list holds the top level only; a folder's albums are reached through it.
  photos.albums.id = () => albums.map((entry) => entry.id());
  photos.albums.name = () => albums.map((entry) => entry.name());
  return { photos, log };
}
const runPhotos = (name, op, photos) => JSON.parse(new Function("Application", "Path", `${MAC_APP_SCRIPTS[name]}\nreturn run;`)(() => photos, (p) => `file:${p}`)([JSON.stringify(macAppScriptArgs(name, macAppOperation(name, op)))]));

test("Photos: albums in folders are listed; a search without words is newest first, filtered by dates, favorite and keyword, paged", () => {
  const { photos } = fakePhotos();
  const albums = runPhotos("mac_photos_list_albums", {}, photos);
  assert.deepEqual(albums.albums.map((a) => [a.id, a.name, a.folder, a.count]), [["AL-1", "Trips", null, 2], ["AL-2", "Kids", "Family", 1]]);
  const all = runPhotos("mac_photos_search", { limit: 2 }, photos);
  assert.deepEqual(all.photos.map((p) => p.id), ["PH-2", "PH-3"]);
  assert.equal(all.next, "2");
  assert.equal(all.total, 4);
  assert.deepEqual(runPhotos("mac_photos_search", { cursor: "2" }, photos).photos.map((p) => p.id), ["PH-1", "PH-4"]);
  assert.deepEqual(runPhotos("mac_photos_search", { from: "2026-01-01", to: "2026-06-01" }, photos).photos.map((p) => p.id), ["PH-3", "PH-1"]);
  assert.deepEqual(runPhotos("mac_photos_search", { favorite: true }, photos).photos.map((p) => p.id), ["PH-2", "PH-3"]);
  assert.deepEqual(runPhotos("mac_photos_search", { keyword: "BEACH", album: "Trips" }, photos).photos.map((p) => p.id), ["PH-3", "PH-1"]);
  const first = runPhotos("mac_photos_search", { album: "AL-1", limit: 1 }, photos).photos[0];
  assert.deepEqual(first.location, null);
  assert.deepEqual(runPhotos("mac_photos_search", { keyword: "beach", from: "2026-02-01", to: "2026-04-01" }, photos).photos[0].location, { latitude: 38.72, longitude: -9.14 });
  assert.throws(() => runPhotos("mac_photos_search", { album: "Nope" }, photos), /Photos has no album Nope/);
});

test("Photos: a person or a place goes through Photos' own search, narrowed by album and dates", () => {
  const { photos } = fakePhotos();
  assert.deepEqual(runPhotos("mac_photos_search", { place: "Lisbon" }, photos).photos.map((p) => p.id), ["PH-1", "PH-4"]);
  assert.deepEqual(runPhotos("mac_photos_search", { place: "Lisbon", album: "Trips" }, photos).photos.map((p) => p.id), ["PH-1"]);
  assert.deepEqual(runPhotos("mac_photos_search", { place: "Lisbon", to: "2026-01-01" }, photos).photos.map((p) => p.id), ["PH-4"]);
  const paged = runPhotos("mac_photos_search", { place: "Lisbon", limit: 1 }, photos);
  assert.equal(paged.next, "1");
  assert.deepEqual(runPhotos("mac_photos_search", { person: "Nobody" }, photos).photos, []);
});

test("Photos: read gives details and names a missing id; albums are made and filled by id; the card never shows an id", () => {
  const { photos, log } = fakePhotos();
  const read = runPhotos("mac_photos_read", { ids: ["PH-1", "PH-9"] }, photos);
  assert.deepEqual(read.photos.map((p) => [p.id, p.filename, p.keywords]), [["PH-1", "PH-1.HEIC", ["Beach"]]]);
  assert.match(read.failed[0].error, /no photo with that id/);
  const made = runPhotos("mac_photos_create_album", { name: "Picks", folder: "Family", ids: ["PH-1", "PH-9"] }, photos);
  assert.equal(made.created, true);
  assert.equal(made.added, 1);
  assert.equal(log.made[0].named, "Picks");
  assert.deepEqual(log.added, [["Picks", ["PH-1"]]]);
  assert.throws(() => runPhotos("mac_photos_create_album", { name: "X", folder: "Nope" }, photos), /no folder named Nope/);
  assert.deepEqual(runPhotos("mac_photos_add_to_album", { album: "Kids", ids: ["PH-3"] }, photos), { added: 1, failed: [], album: "Kids" });
  assert.equal(macAppTarget("mac_photos_add_to_album", { album: "Kids", ids: ["a", "b"] }), 'Photos: add 2 photos to "Kids"');
  assert.equal(macAppTarget("mac_photos_add_to_album", { album: "0A1B2C3D-0000-4000-8000-00000000AAAA/L0/040", ids: ["a"] }), "Photos: add 1 photo to an album");
  assert.equal(macAppTarget("mac_photos_create_album", { name: "Picks", ids: ["a"] }), 'Photos: create the album "Picks", with 1 photo');
  assert.equal(macAppToolWrites("mac_photos_export"), false);
  assert.equal(macAppToolWrites("mac_photos_create_album"), true);
  assert.throws(() => macAppOperation("mac_photos_export", { ids: ["PH-1"], maxSize: 10 }), /256 to 8192/);
  assert.equal(macAppOperation("mac_photos_export", { ids: ["PH-1"] }).maxSize, 2048);
  assert.ok(MAC_APP_SCRIPTS.mac_photos_search.includes("late(25000)"));
});

test("Photos: export saves a resized JPEG by default, the original on request, names each failure, and leaves no temporary folder", async () => {
  const saveDir = tempDir();
  const calls = [];
  // osascript: Photos writes each item into its own folder; sips: reads the size, then writes the JPEG.
  const execFile = async (file, args) => {
    calls.push([file, args]);
    if (file === "osascript") {
      const op = JSON.parse(args[4]);
      const exported = [];
      const failed = [];
      op.ids.forEach((id, index) => {
        if (index < op.offset) return;
        if (id === "PH-9") { failed.push({ id, error: "Can't get media item id \"PH-9\"." }); return; }
        if (id === "PH-8") { exported.push({ id, index }); return; }
        fs.writeFileSync(path.join(op.dirs[index], `${id}.HEIC`), "heic");
        if (op.original) fs.writeFileSync(path.join(op.dirs[index], `${id}.MOV`), "mov");
        exported.push({ id, index });
      });
      return { stdout: JSON.stringify({ exported, failed }) };
    }
    if (args[0] === "-g") return { stdout: `${args.at(-1)}\n  pixelWidth: 4032\n  pixelHeight: 3024\n` };
    fs.writeFileSync(args.at(-1), "jpeg");
    return { stdout: "" };
  };
  const result = await runMacAppCall("mac_photos_export", { ids: ["PH-1", "PH-9", "PH-8"] }, { platform: "darwin", execFile, saveDir });
  assert.equal(result.isError, undefined, result.content[0].text);
  const out = JSON.parse(result.content[0].text);
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].id, "PH-1");
  assert.equal(out.files[0].mime, "image/jpeg");
  assert.equal(out.files[0].name, "PH-1.jpg");
  assert.ok(out.files[0].path.startsWith(saveDir + path.sep));
  assert.deepEqual(out.failed.map((row) => row.id), ["PH-9", "PH-8"]);
  assert.match(out.failed[0].error, /Photos could not export it/);
  assert.match(out.failed[1].error, /wrote no file/);
  const sips = calls.filter(([file]) => file === "sips").map(([, args]) => args);
  assert.deepEqual(sips[1].slice(0, 6), ["-s", "format", "jpeg", "-s", "formatOptions", "85"]);
  assert.deepEqual(sips[1].slice(6, 8), ["-Z", "2048"]);
  assert.equal(calls[0][1][3], MAC_APP_SCRIPTS.mac_photos_export);
  assert.deepEqual(fs.readdirSync(saveDir).filter((entry) => entry.startsWith(".")), []);
  // The original: every file Photos wrote (a Live Photo's still and video), moved as is.
  const original = JSON.parse((await runMacAppCall("mac_photos_export", { ids: ["PH-1"], original: true }, { platform: "darwin", execFile, saveDir })).content[0].text);
  assert.deepEqual(original.files.map((file) => [file.name, file.mime]).sort(), [["PH-1.HEIC", "image/heic"], ["PH-1.MOV", "video/quicktime"]]);
  // Nothing exported at all: an error result.
  const none = await runMacAppCall("mac_photos_export", { ids: ["PH-9"] }, { platform: "darwin", execFile, saveDir });
  assert.equal(none.isError, true);
  // No folder to save in: refused before osascript.
  const before = calls.length;
  assert.equal((await runMacAppCall("mac_photos_export", { ids: ["PH-1"] }, { platform: "darwin", execFile })).isError, true);
  assert.equal(calls.length, before);
  assert.equal(typeof exportPhotos, "function");
});

test("Photos: an Automation refusal names Photos and the Automation pane; a timeout says how to narrow", () => {
  const denied = Object.assign(new Error("Command failed"), { stderr: "execution error: Not authorized to send Apple events to Photos. (-1743)" });
  const said = macAppErrorText("photos", denied);
  assert.equal(said.denied, true);
  assert.match(said.message, /control Photos.*Automation and turn on Photos under Sagax/);
  assert.match(macAppErrorText("photos", Object.assign(new Error("x"), { killed: true })).message, /Photos did not answer in time.*an album, a date range/);
});

// --- Music (2026-11-17): a stand-in for Music's scripting objects.
function fakeMusic() {
  const track = (id, name, album, artist, disc, number) => ({ persistentID: () => id, name: () => name, album: () => album, artist: () => artist, albumArtist: () => artist, duration: () => 200, year: () => 1971, discNumber: () => disc, trackNumber: () => number, play: () => { log.played.push(id); state.player = "playing"; state.current = id; } });
  const log = { played: [], duplicated: [], deleted: [], made: [] };
  const state = { player: "stopped", current: null, volume: 50 };
  const tracks = [
    track("00000000000000A2", "California", "Blue", "Joni", 1, 2),
    track("00000000000000A1", "All I Want", "Blue", "Joni", 1, 1),
    track("00000000000000B1", "River", "Blue", "Joni", 2, 1),
    track("00000000000000C1", "River", "Other", "Someone", 1, 1),
  ];
  const coll = (list) => {
    const fn = () => list.slice();
    Object.defineProperty(fn, "length", { get: () => list.length });
    for (const key of ["persistentID", "name", "smart", "discNumber", "trackNumber"]) Object.defineProperty(fn, key, { value: () => list.map((entry) => entry[key]?.()), writable: true, configurable: true });
    fn.whose = (filter) => {
      const test = (entry, f) => (f._and ? f._and.every((part) => test(entry, part)) : Object.entries(f).every(([key, value]) => (value && typeof value === "object" && value._contains !== undefined ? String(entry[key]()).includes(value._contains) : entry[key]() === value)));
      return coll(list.filter((entry) => test(entry, filter)));
    };
    list.forEach((entry, index) => { fn[index] = entry; });
    return fn;
  };
  const playlist = (id, name, smart = false) => { const own = []; const self = { persistentID: () => id, name: () => name, smart: () => smart, play: () => { log.played.push(name); state.player = "playing"; }, own }; self.tracks = () => own.slice(); Object.defineProperty(self.tracks, "length", { get: () => own.length }); return self; };
  const playlists = [playlist("1111111111111111", "Road"), playlist("2222222222222222", "Top 25", true)];
  const music = {
    libraryPlaylists: [{ tracks: coll(tracks) }],
    get userPlaylists() { return coll(playlists); },
    playerState: () => state.player,
    soundVolume: () => state.volume,
    shuffleEnabled: () => false,
    songRepeat: () => "off",
    playerPosition: () => 12,
    currentTrack: () => tracks.find((entry) => entry.persistentID() === state.current) ?? (() => { throw new Error("none"); })(),
    currentPlaylist: () => ({ name: () => "Library" }),
    search: (_lib, { for: words, only }) => { log.only = only; return tracks.filter((entry) => `${entry.name()} ${entry.album()}`.includes(words)); },
    duplicate: (entry, { to }) => { log.duplicated.push([entry.persistentID(), to.name()]); to.own.push(entry); },
    delete: (entry) => log.deleted.push(entry.persistentID()),
    make: ({ withProperties }) => { log.made.push(withProperties.name); const made = playlist("3333333333333333", withProperties.name); playlists.push(made); return made; },
    play: () => { state.player = "playing"; log.played.push("resume"); },
    pause: () => { state.player = "paused"; },
    nextTrack: () => log.played.push("next"),
    previousTrack: () => log.played.push("previous"),
  };
  Object.defineProperty(music, "soundVolume", { get: () => Object.assign(() => state.volume), set: (value) => { state.volume = value; }, configurable: true });
  Object.defineProperty(music, "shuffleEnabled", { get: () => () => false, set: (value) => { log.shuffle = value; }, configurable: true });
  return { music, log, state };
}
const runMusic = (name, op, music) => JSON.parse(new Function("Application", `${MAC_APP_SCRIPTS[name]}\nreturn run;`)(() => music)([JSON.stringify(macAppScriptArgs(name, macAppOperation(name, op)))]));

test("Music: an album plays in disc and track order through the queue playlist; a track, a playlist and a query play; now playing reads the state", () => {
  const { music, log, state } = fakeMusic();
  assert.deepEqual(runMusic("mac_music_now_playing", {}, music).state, "stopped");
  const album = runMusic("mac_music_play", { album: "Blue", artist: "Joni", shuffle: false }, music);
  assert.equal(album.queued, 3);
  assert.equal(log.shuffle, false);
  assert.deepEqual(log.made, [MUSIC_QUEUE_PLAYLIST]);
  assert.deepEqual(log.duplicated.map(([id]) => id), ["00000000000000A1", "00000000000000A2", "00000000000000B1"]);
  assert.deepEqual(log.played, [MUSIC_QUEUE_PLAYLIST]);
  // A second album refills the same playlist, never a new one.
  runMusic("mac_music_play", { album: "Blue" }, music);
  assert.deepEqual(log.made, [MUSIC_QUEUE_PLAYLIST]);
  assert.equal(log.deleted.length, 3);
  assert.throws(() => runMusic("mac_music_play", { album: "Nope" }, music), /Music has no album Nope/);
  const one = runMusic("mac_music_play", { id: "00000000000000C1" }, music);
  assert.equal(one.track.id, "00000000000000C1");
  assert.equal(one.state, "playing");
  runMusic("mac_music_play", { playlist: "Road" }, music);
  assert.equal(log.played.at(-1), "Road");
  runMusic("mac_music_play", { query: "California" }, music);
  assert.equal(log.played.at(-1), "00000000000000A2");
  runMusic("mac_music_play", {}, music);
  assert.equal(log.played.at(-1), "resume");
  assert.equal(runMusic("mac_music_pause", {}, music).state, "paused");
  runMusic("mac_music_next", {}, music);
  runMusic("mac_music_previous", {}, music);
  assert.deepEqual(log.played.slice(-2), ["next", "previous"]);
  assert.deepEqual(runMusic("mac_music_set_volume", { volume: 30 }, music), { volume: 30 });
  assert.equal(state.volume, 30);
});

test("Music: search gives songs with ids, distinct albums or artists, and playlists by name; playlists are made and filled, never a smart one", () => {
  const { music, log } = fakeMusic();
  const songs = runMusic("mac_music_search", { query: "River" }, music);
  assert.equal(log.only, "songs");
  assert.deepEqual(songs.songs.map((t) => t.id), ["00000000000000B1", "00000000000000C1"]);
  const albums = runMusic("mac_music_search", { query: "River", kind: "albums" }, music);
  assert.deepEqual(albums.albums.map((a) => [a.album, a.artist]), [["Blue", "Joni"], ["Other", "Someone"]]);
  const paged = runMusic("mac_music_search", { query: "Blue", limit: 1 }, music);
  assert.equal(paged.next, "1");
  assert.deepEqual(runMusic("mac_music_search", { query: "Ro", kind: "playlists" }, music).playlists, [{ id: "1111111111111111", name: "Road" }]);
  const lists = runMusic("mac_music_list_playlists", {}, music);
  assert.deepEqual(lists.playlists.map((p) => [p.name, p.smart]), [["Road", false], ["Top 25", true]]);
  const made = runMusic("mac_music_create_playlist", { name: "Trip", ids: ["00000000000000A1", "FFFFFFFFFFFFFFFF"] }, music);
  assert.equal(made.added, 1);
  assert.match(made.failed[0].error, /no track with that id/);
  assert.equal(runMusic("mac_music_add_to_playlist", { playlist: "Road", ids: ["00000000000000A1"] }, music).added, 1);
  assert.throws(() => runMusic("mac_music_add_to_playlist", { playlist: "Top 25", ids: ["00000000000000A1"] }, music), /smart playlist/);
  assert.throws(() => runMusic("mac_music_add_to_playlist", { playlist: "Nope", ids: ["00000000000000A1"] }, music), /no playlist Nope/);
});

test("Music: operations are bounded, the card never shows an id, and reads never ask", () => {
  assert.throws(() => macAppOperation("mac_music_play", { id: "0123456789ABCDEF", album: "Blue" }), /one of id, album, playlist or query/);
  assert.throws(() => macAppOperation("mac_music_play", { artist: "Joni" }), /artist goes with album/);
  assert.throws(() => macAppOperation("mac_music_set_volume", { volume: 120 }), /0 to 100/);
  assert.throws(() => macAppOperation("mac_music_search", { query: "x", kind: "genres" }), /kind is/);
  assert.equal(macAppOperation("mac_music_search", { query: "x" }).kind, "songs");
  assert.equal(macAppTarget("mac_music_play", { id: "0123456789ABCDEF" }), "Music: play a track");
  assert.equal(macAppTarget("mac_music_play", { playlist: "0123456789ABCDEF" }), "Music: play a playlist");
  assert.equal(macAppTarget("mac_music_play", { playlist: "Road" }), 'Music: play the playlist "Road"');
  assert.equal(macAppTarget("mac_music_play", {}), "Music: resume");
  assert.equal(macAppTarget("mac_music_add_to_playlist", { playlist: "0123456789ABCDEF", ids: ["a", "b"] }), "Music: add 2 tracks to a playlist");
  for (const name of ["mac_music_now_playing", "mac_music_search", "mac_music_list_playlists"]) assert.equal(macAppToolWrites(name), false, name);
  for (const name of ["mac_music_play", "mac_music_pause", "mac_music_next", "mac_music_previous", "mac_music_set_volume", "mac_music_create_playlist", "mac_music_add_to_playlist"]) assert.equal(macAppToolWrites(name), true, name);
  assert.ok(!MAC_APP_SCRIPTS.mac_music_search.includes("\u0000"));
  const denied = Object.assign(new Error("Command failed"), { stderr: "execution error: Not authorized to send Apple events to Music. (-1743)" });
  assert.match(macAppErrorText("music", denied).message, /control Music.*Automation and turn on Music under Sagax/);
});
