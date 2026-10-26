import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appleDate, fileInsideRoot, openMessagesReader } from "./imessage-db.ts";
import { resetImessageSends } from "./imessage-cards.ts";
import { handleMessagesMcp } from "./imessage-mcp.ts";
import { appleScriptString, imessageSendScript } from "./imessage-send.ts";
import type { ImessageSend, ImessageSender } from "./imessage-send.ts";

function fixtureDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-messages-"));
  const db = new DatabaseSync(join(dir, "chat.db"));
  db.exec(`
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT, service_name TEXT);
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, date INTEGER, is_from_me INTEGER, handle_id INTEGER, service TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    INSERT INTO chat (ROWID, guid, chat_identifier, display_name, service_name) VALUES (1, 'iMessage;-;+15145551234', '+15145551234', 'Ada', 'iMessage');
    INSERT INTO handle (ROWID, id, service) VALUES (1, '+15145551234', 'iMessage');
    INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1);
    INSERT INTO message (ROWID, guid, text, date, is_from_me, handle_id, service) VALUES (1, 'm1', 'hello there', 700000000, 0, 1, 'iMessage');
    INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, 1);
  `);
  db.close();
  return dir;
}

function textOf(result: { result: unknown }): string {
  const content = (result.result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("Messages database", () => {
  it("reads chats and messages from a snapshot and keeps files inside their root", () => {
    expect(appleDate(700000000)).toBe(new Date((700000000 + 978307200) * 1000).toISOString());
    const dir = fixtureDb();
    const opened = openMessagesReader(dir);
    try {
      expect(opened.reader.findChats({ displayName: "ada" })).toMatchObject([{ guid: "iMessage;-;+15145551234", handles: ["+15145551234"] }]);
      expect(opened.reader.items("iMessage;-;+15145551234")[0]).toMatchObject({ text: "hello there", fromMe: false });
      expect(opened.reader.search("hello")).toHaveLength(1);
    } finally {
      opened.close();
    }
    const outside = join(tmpdir(), "not-messages.txt");
    writeFileSync(outside, "no");
    expect(fileInsideRoot(dir, outside)).toBeNull();
  });
});

describe("Messages send", () => {
  it("escapes AppleScript text and does not send until the plan says so", () => {
    expect(appleScriptString(`say "hi"`)).toBe(`"say \\"hi\\""`);
    expect(imessageSendScript({ to: "+15145551234", text: "hi", service: "iMessage" })).toContain("participant");
    expect(imessageSendScript({ to: "+15145551234", text: "hi", service: "iMessage" })).not.toContain("osascript");
  });

  it("sends to an allowed recipient and cards everyone else, and never on an organization server", async () => {
    resetImessageSends();
    const sent: ImessageSend[] = [];
    const sender: ImessageSender = { send: async (input) => { sent.push(input); return { service: "iMessage", via: "participant" }; } };
    const cards: string[] = [];
    const base = {
      host: { platform: "darwin", identityKind: "solo" },
      useMessages: true,
      dbDir: null,
      allowedRecipients: ["phone:+15145551234"],
      sender,
      botId: "bot",
      threadId: "thread",
      openCard: (pending: { to: string }) => { cards.push(pending.to); },
    };
    const allowed = await handleMessagesMcp({ method: "tools/call", params: { name: "send_message", arguments: { to: "(514) 555-1234", text: "hi" } } }, base);
    expect(textOf(allowed)).toContain('"sent":true');
    expect(sent).toHaveLength(1);
    const blocked = await handleMessagesMcp({ method: "tools/call", params: { name: "send_message", arguments: { to: "5145559999", text: "no" } } }, base);
    expect(textOf(blocked)).toContain("Not sent");
    expect(cards).toEqual(["5145559999"]);
    expect(sent).toHaveLength(1);
    const remote = await handleMessagesMcp({ method: "tools/call", params: { name: "send_message", arguments: { to: "+15145551234", text: "x" } } }, {
      ...base, host: { platform: "darwin", identityKind: "perspicax" },
    });
    expect(textOf(remote)).toContain("only on the Mac");
    expect(sent).toHaveLength(1);
    const bridged = await handleMessagesMcp({ method: "tools/call", params: { name: "send_message", arguments: { to: "+15145551234", text: "x" } } }, {
      ...base, host: { platform: "darwin", identityKind: "solo", bridgeAction: true },
    });
    expect(textOf(bridged)).toContain("only on the Mac");
    const group = await handleMessagesMcp({ method: "tools/call", params: { name: "send_message", arguments: { chatId: "any;-;a,b", text: "x" } } }, base);
    expect(textOf(group)).toContain("group");
    expect(sent).toHaveLength(1);
  });
});
