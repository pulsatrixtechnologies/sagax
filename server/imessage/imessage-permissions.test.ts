import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { probeFullDiskAccess, testMessagesConversationNames } from "./imessage-permissions.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), "msg-perm-"));
  dirs.push(home);
  const messages = join(home, "Library", "Messages");
  mkdirSync(messages, { recursive: true });
  const db = new DatabaseSync(join(messages, "chat.db"));
  db.exec(`
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT, service_name TEXT);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    INSERT INTO chat (ROWID, guid, chat_identifier, display_name, service_name)
      VALUES (1, 'iMessage;-;+15145551234', '+15145551234', 'Ada Lovelace', 'iMessage');
    INSERT INTO chat (ROWID, guid, chat_identifier, display_name, service_name)
      VALUES (2, 'SMS;-;+15145555678', '+15145555678', 'Bea Example', 'SMS');
    INSERT INTO handle (ROWID, id, service) VALUES (1, '+15145551234', 'iMessage');
    INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1);
  `);
  db.close();
  return home;
}

describe("imessage-permissions", () => {
  it("grants Full Disk Access when chat.db opens", () => {
    const home = fixtureHome();
    expect(probeFullDiskAccess(home)).toBe("granted");
  });

  it("denies Full Disk Access when the Messages folder is missing", () => {
    const home = mkdtempSync(join(tmpdir(), "msg-perm-empty-"));
    dirs.push(home);
    expect(probeFullDiskAccess(home)).toBe("denied");
  });

  it("returns conversation name counts without message bodies", () => {
    const home = fixtureHome();
    const result = testMessagesConversationNames(home);
    expect(result.conversationCount).toBe(2);
    expect(result.names).toEqual(expect.arrayContaining(["Ada Lovelace", "Bea Example"]));
    expect(result.names).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/hello|secret|body/i);
  });

  it("returns an empty test when chat.db cannot open", () => {
    const home = mkdtempSync(join(tmpdir(), "msg-perm-bad-"));
    dirs.push(home);
    mkdirSync(join(home, "Library", "Messages"), { recursive: true });
    writeFileSync(join(home, "Library", "Messages", "chat.db"), "not-a-db");
    expect(probeFullDiskAccess(home)).toBe("denied");
    expect(testMessagesConversationNames(home)).toEqual({ conversationCount: 0, names: [] });
  });
});
