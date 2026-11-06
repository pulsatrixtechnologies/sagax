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
  isMacAppTool,
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
