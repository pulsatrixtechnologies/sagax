import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fileInsideRoot } from "./imessage-db.ts";
import { resetImessageSends } from "./imessage-cards.ts";
import { handleMessagesMcp } from "./imessage-mcp.ts";
import { connectorReauthFailure, MAC_FULL_DISK_ACCESS_URL } from "../../shared/connector-setup.ts";
import { MAC_APP_LEGACY_TOOLS, MAC_APP_TOOLS, appleDate, runMacAppCall } from "../../electron/mac-apps.mjs";

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

/** The solo Mac's Apple apps, running electron/mac-apps.mjs on a fixture chat.db. */
const soloMacApps = (dir: string, unasked = true) => ({
  enabled: () => true,
  run: (tool: string, args: Record<string, unknown>, context?: { saveDir?: string }) => runMacAppCall(tool, args, { platform: "darwin", messagesDir: dir, ...context }),
  unasked,
});

function textOf(result: { result: unknown }): string {
  const content = (result.result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("Messages database", () => {
  const base = (dir: string) => ({
    host: { platform: "darwin", identityKind: "solo" as const },
    useMessages: true,
    dbDir: dir,
    botId: "bot",
    threadId: "thread",
    openCard: () => {},
    macApps: soloMacApps(dir),
  });

  it("#4158: the older Messages names leave the list and are answered by the mac_messages_ tools, with one chat.db reader", async () => {
    expect(appleDate(700000000)).toBe(new Date((700000000 + 978307200) * 1000).toISOString());
    const dir = fixtureDb();
    const listed = await handleMessagesMcp({ method: "tools/list" }, base(dir)) as { result: { tools: { name: string }[] } };
    const names = listed.result.tools.map((tool) => tool.name);
    for (const older of ["check_permissions", "find_chats", "read_messages", "search_messages", "read_attachment", "send_message"]) expect(names).not.toContain(older);
    expect(names).toEqual(expect.arrayContaining(["mac_messages_list_chats", "mac_messages_read", "mac_messages_read_attachment", "mac_messages_send"]));
    const chats = JSON.parse(textOf(await handleMessagesMcp({ method: "tools/call", params: { name: "find_chats", arguments: { displayName: "ada" } } }, base(dir))));
    expect(chats.chats).toMatchObject([{ chat: "iMessage;-;+15145551234", members: ["+15145551234"] }]);
    const read = JSON.parse(textOf(await handleMessagesMcp({ method: "tools/call", params: { name: "read_messages", arguments: { chatGuid: "iMessage;-;+15145551234" } } }, base(dir))));
    expect(read.messages[0]).toMatchObject({ text: "hello there", from: "+15145551234" });
    const found = JSON.parse(textOf(await handleMessagesMcp({ method: "tools/call", params: { name: "search_messages", arguments: { needle: "hello" } } }, base(dir))));
    expect(found.messages).toHaveLength(1);
    const outside = join(tmpdir(), "not-messages.txt");
    writeFileSync(outside, "no");
    expect(fileInsideRoot(dir, outside)).toBeNull();
  });
});

describe("Messages send", () => {
  it("#2690: Full Disk Access revoked while chat.db exists raises the reconnect Messages card", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-messages-"));
    const file = join(dir, "chat.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE chat (ROWID INTEGER PRIMARY KEY)");
    db.close();
    // macOS refuses the file to this app: here, no read permission at all
    chmodSync(file, 0o000);
    try {
      const out = await handleMessagesMcp({ method: "tools/call", params: { name: "find_chats", arguments: {} } }, {
        host: { platform: "darwin", identityKind: "solo" },
        useMessages: true,
        dbDir: dir,
        botId: "bot",
        threadId: "thread",
        openCard: () => {},
        macApps: soloMacApps(dir),
      });
      const said = textOf(out);
      // #4158: answered by mac_messages_list_chats, the same one sentence.
      expect(said).toContain("Messages could not be read. Sagax needs Full Disk Access on this Mac");
      expect(connectorReauthFailure("mcp__messages__find_chats", said)).toMatchObject({ label: "Messages", provider: "mac", url: MAC_FULL_DISK_ACCESS_URL });
    } finally {
      chmodSync(file, 0o600);
    }
    // the raw SQLite refusal, as an older build or another path says it
    expect(connectorReauthFailure("mcp__messages__read_messages", "unable to open database file")).toMatchObject({ provider: "mac" });
    expect(connectorReauthFailure("mcp__messages__read_messages", "authorization denied")).toMatchObject({ provider: "mac" });
    expect(connectorReauthFailure("mcp__claude_ai_Linear__list", "unable to open database file")).toBeNull();
  });

  // #4158 review: one send path (the Messages script) and one recipient
  // check for every Messages send, whatever its form.
  const sendDeps = (unasked: boolean, extra: Record<string, unknown> = {}) => {
    const runs: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const cards: Array<{ to: string; macApp: { tool: string } }> = [];
    const root = mkdtempSync(join(tmpdir(), "sagax-bot-"));
    const deps = {
      host: { platform: "darwin", identityKind: "solo" as const },
      useMessages: true,
      dbDir: null,
      filesRoots: [root],
      allowedRecipients: ["phone:+15145551234", "phone:+15145559876"],
      chatMembers: async (chat: string) => (chat === "iMessage;+;chat0001" ? ["+15145551234", "+15145559876"] : ["+15145551234", "+15145550000"]),
      botId: "bot",
      threadId: "thread",
      openCard: (pending: { to: string; macApp: { tool: string } }) => { cards.push(pending); },
      macApps: { enabled: () => true, run: async (tool: string, args: Record<string, unknown>) => { runs.push({ tool, args }); return { content: [{ type: "text" as const, text: "sent" }] }; }, unasked },
      ...extra,
    };
    const file = (name: string) => { const path = join(root, name); writeFileSync(path, "x"); return path; };
    return { deps, runs, cards, file };
  };
  const send = (args: Record<string, unknown>, name = "mac_messages_send") => ({ method: "tools/call", params: { name, arguments: args } });

  it("every Messages send goes through the Messages script with one recipient check, whatever its form (#4158)", async () => {
    resetImessageSends();
    // Ask: a listed person, with no file, one file or two, sends; an unlisted
    // one is a card, the same for every form.
    const ask = sendDeps(false);
    const one = ask.file("a.png");
    const two = ask.file("b.png");
    for (const files of [undefined, [one], [one, two]]) {
      expect(textOf(await handleMessagesMcp(send({ to: "(514) 555-1234", text: "hi", ...(files ? { files } : {}) }), ask.deps))).toBe("sent");
      expect(textOf(await handleMessagesMcp(send({ to: "5145550000", text: "hi", ...(files ? { files } : {}) }), ask.deps))).toContain("approval card");
    }
    // The older name answers the same way, through the same check.
    expect(textOf(await handleMessagesMcp(send({ to: "+15145551234", text: "hi", file: one }, "send_message"), ask.deps))).toBe("sent");
    expect(textOf(await handleMessagesMcp(send({ to: "+15145550000", text: "hi", file: one }, "send_message"), ask.deps))).toContain("approval card");
    // A conversation: a one-to-one by its handle, a group by every member.
    expect(textOf(await handleMessagesMcp(send({ chat: "iMessage;-;+15145551234", text: "hi" }), ask.deps))).toBe("sent");
    expect(textOf(await handleMessagesMcp(send({ chat: "iMessage;-;+15145550000", text: "hi" }), ask.deps))).toContain("approval card");
    expect(textOf(await handleMessagesMcp(send({ chat: "iMessage;+;chat0001", text: "hi" }), ask.deps))).toBe("sent");
    expect(textOf(await handleMessagesMcp(send({ chat: "iMessage;+;chat0002", text: "hi" }), ask.deps))).toContain("approval card");
    expect(ask.runs.every((run) => run.tool === "mac_messages_send")).toBe(true);
    expect(ask.runs).toHaveLength(6);
    expect(ask.cards).toHaveLength(6);
    expect(ask.cards.every((card) => card.macApp.tool === "mac_messages_send")).toBe(true);
    // Full: nobody is asked about, listed or not, one file or two, to or chat.
    const full = sendDeps(true);
    const f1 = full.file("a.png");
    const f2 = full.file("b.png");
    for (const args of [{ to: "5145550000", text: "hi" }, { to: "5145550000", files: [f1] }, { to: "5145550000", files: [f1, f2] }, { chat: "iMessage;+;chat0002", text: "hi" }]) {
      expect(textOf(await handleMessagesMcp(send(args), full.deps))).toBe("sent");
    }
    expect(full.cards).toEqual([]);
    expect(full.runs).toHaveLength(4);
  });

  it("refuses a send on an organization server without the person's Mac, a file outside the bot's folder, and a file by SMS", async () => {
    const solo = sendDeps(true);
    const remote = await handleMessagesMcp(send({ to: "+15145551234", text: "x" }), { ...solo.deps, host: { platform: "darwin", identityKind: "perspicax" as const } });
    expect(textOf(remote)).toContain("only on the Mac");
    const bridged = await handleMessagesMcp(send({ to: "+15145551234", text: "x" }), { ...solo.deps, host: { platform: "darwin", identityKind: "solo" as const, bridgeAction: true } });
    expect(textOf(bridged)).toContain("only on the Mac");
    const off = await handleMessagesMcp(send({ to: "+15145551234", text: "x" }), { ...solo.deps, useMessages: false });
    expect(textOf(off)).toContain("off");
    const outside = await handleMessagesMcp(send({ to: "+15145551234", text: "x", files: [join(tmpdir(), "nope.png")] }), solo.deps);
    expect(textOf(outside)).toContain("not in this bot's folder");
    const sms = await handleMessagesMcp(send({ to: "+15145551234", files: [solo.file("a.png")], service: "SMS" }), solo.deps);
    expect(textOf(sms)).toContain("not SMS");
    expect(solo.runs).toEqual([]);
    expect(solo.cards).toEqual([]);
  });
});

describe("Messages attachments", () => {
  it("lists any attachment by index and saves one into the conversation's folder, never one outside the Messages folder (#4158)", async () => {
    const dir = fixtureDb();
    mkdirSync(join(dir, "Attachments"));
    const pdf = join(dir, "Attachments", "plan.pdf");
    const bytes = Buffer.from("%PDF-1.4 test");
    writeFileSync(pdf, bytes);
    const outside = join(tmpdir(), `sagax-outside-${process.pid}.png`);
    writeFileSync(outside, Buffer.from("no"));
    const db = new DatabaseSync(join(dir, "chat.db"));
    db.exec(`
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, mime_type TEXT, uti TEXT, transfer_name TEXT, total_bytes INTEGER);
      CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    `);
    const insert = db.prepare(`INSERT INTO attachment (ROWID, guid, filename, mime_type, uti, transfer_name, total_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insert.run(7, "a7", pdf, "application/pdf", "com.adobe.pdf", "plan.pdf", bytes.length);
    insert.run(8, "a8", outside, "image/png", "public.png", "secret.png", 2);
    db.prepare(`INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)`).run(1, 7);
    db.prepare(`INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)`).run(1, 8);
    db.close();
    const saveDir = mkdtempSync(join(tmpdir(), "sagax-conversation-"));
    const deps = {
      host: { platform: "darwin", identityKind: "solo" as const },
      useMessages: true,
      dbDir: dir,
      saveDir,
      botId: "bot",
      threadId: "thread",
      openCard: () => {},
      macApps: soloMacApps(dir),
    };
    const read = JSON.parse(textOf(await handleMessagesMcp({ method: "tools/call", params: { name: "mac_messages_read", arguments: { chat: "iMessage;-;+15145551234" } } }, deps)));
    expect(read.messages[0].attachments).toEqual([
      { index: 0, name: "plan.pdf", mime: "application/pdf", bytes: bytes.length },
      { index: 1, name: "secret.png", mime: "image/png", bytes: 2 },
    ]);
    expect(JSON.stringify(read)).not.toContain(pdf);
    const saved = JSON.parse(textOf(await handleMessagesMcp({ method: "tools/call", params: { name: "mac_messages_read_attachment", arguments: { id: "m1", index: 0 } } }, deps)));
    expect(saved).toMatchObject({ name: "plan.pdf", mime: "application/pdf", bytes: bytes.length });
    expect(saved.path.startsWith(saveDir)).toBe(true);
    // The older name (by attachment row) is answered the same way.
    const older = JSON.parse(textOf(await handleMessagesMcp({ method: "tools/call", params: { name: "read_attachment", arguments: { messageGuid: "m1", attachmentId: 7 } } }, deps)));
    expect(older.name).toBe("plan.pdf");
    const refused = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_messages_read_attachment", arguments: { id: "m1", index: 1 } } }, deps);
    expect(textOf(refused)).toContain("outside the Messages folder");
  });
});

// The other Apple apps on the solo Mac (electron/mac-apps.mjs): only the apps
// the person turned on are offered; a write follows the bot's approval mode.
describe("Apple apps on the solo Mac", () => {
  const deps = (unasked: boolean, cards: Array<{ to: string; macApp?: unknown }>, runs: string[]) => ({
    host: { platform: "darwin", identityKind: "solo" as const },
    useMessages: false,
    dbDir: null,
    botId: "bot",
    threadId: "thread",
    openCard: (pending: { to: string; macApp?: unknown }) => { cards.push(pending); },
    macApps: {
      enabled: (app: string) => app === "notes",
      run: async (tool: string) => { runs.push(tool); return { content: [{ type: "text" as const, text: "done" }] }; },
      unasked,
    },
  });

  it("lists only the apps that are on, asks in Ask mode, acts in Auto, and refuses an app that is off", async () => {
    const cards: Array<{ to: string; macApp?: unknown }> = [];
    const runs: string[] = [];
    const listed = await handleMessagesMcp({ method: "tools/list" }, deps(false, cards, runs)) as { result: { tools: { name: string }[] } };
    const names = listed.result.tools.map((tool) => tool.name).filter((name) => name.startsWith("mac_"));
    // #4158: Notes offers its full action set (search, read, create, update, move, delete, folders).
    expect(names.sort()).toEqual(MAC_APP_TOOLS.filter((tool) => tool.app === "notes").map((tool) => tool.name).sort());
    expect(names).toEqual(expect.arrayContaining(["mac_notes_read", "mac_notes_update", "mac_notes_move", "mac_notes_delete", "mac_notes_create_folder"]));
    const asked = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_notes_create", arguments: { title: "Plan", body: "secret body" } } }, deps(false, cards, runs)) as { result: { content: { text: string }[] } };
    expect(asked.result.content[0]!.text).toContain("approval card");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.to).toBe('Note "Plan"');
    expect(cards[0]!.to).not.toContain("secret");
    expect(runs).toEqual([]);
    const auto = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_notes_create", arguments: { title: "Plan", body: "x" } } }, deps(true, cards, runs)) as { result: { content: { text: string }[] } };
    expect(auto.result.content[0]!.text).toBe("done");
    expect(runs).toEqual(["mac_notes_create"]);
    const off = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_mail_send", arguments: { to: ["a@example.com"], subject: "s", body: "b" } } }, deps(true, cards, runs)) as { result: { isError?: boolean } };
    expect(off.result.isError).toBe(true);
    expect(runs).toEqual(["mac_notes_create"]);
  });

  // 2026-11-17: Photos is one more app of the same family: an export is a read
  // (no card, saved into the conversation's folder), a new album follows the bot's mode.
  it("Photos: an export runs unasked into the conversation's folder; an album follows Ask mode", async () => {
    const cards: Array<{ to: string; macApp?: unknown }> = [];
    const runs: Array<[string, unknown]> = [];
    const base = deps(false, cards, []);
    const photos = { ...base, saveDir: "/tmp/sagax-conversation", macApps: { ...base.macApps, enabled: (app: string) => app === "photos", run: async (tool: string, _args: unknown, context?: unknown) => { runs.push([tool, context]); return { content: [{ type: "text" as const, text: "done" }] }; } } };
    const listed = await handleMessagesMcp({ method: "tools/list" }, photos) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((tool) => tool.name).filter((name) => name.startsWith("mac_")).sort()).toEqual(MAC_APP_TOOLS.filter((tool) => tool.app === "photos").map((tool) => tool.name).sort());
    const exported = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_photos_export", arguments: { ids: ["PH-1"] } } }, photos) as { result: { content: { text: string }[] } };
    expect(exported.result.content[0]!.text).toBe("done");
    expect(runs).toEqual([["mac_photos_export", { saveDir: "/tmp/sagax-conversation" }]]);
    const noFolder = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_photos_export", arguments: { ids: ["PH-1"] } } }, { ...photos, saveDir: undefined }) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(noFolder.result.isError).toBe(true);
    const asked = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_photos_create_album", arguments: { name: "Picks", ids: ["PH-1"] } } }, photos) as { result: { content: { text: string }[] } };
    expect(asked.result.content[0]!.text).toContain("approval card");
    expect(cards[0]!.to).toBe('Photos: create the album "Picks", with 1 photo');
  });

  it("acts without a card when the person kept Always allow for that tool", async () => {
    const cards: Array<{ to: string; macApp?: unknown }> = [];
    const runs: string[] = [];
    const base = deps(false, cards, runs);
    const kept = { ...base, macApps: { ...base.macApps, kept: (tool: string) => tool === "mac_notes_create" } };
    const res = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_notes_create", arguments: { title: "Plan", body: "x" } } }, kept) as { result: { content: { text: string }[] } };
    expect(res.result.content[0]!.text).toBe("done");
    expect(cards).toEqual([]);
    expect(runs).toEqual(["mac_notes_create"]);
  });

  it("sends into a conversation by its chat id (a group included) through the Messages script and the same approval (#4158)", async () => {
    const cards: Array<{ to: string; macApp?: unknown }> = [];
    const runs: string[] = [];
    const base = deps(false, cards, runs);
    const on = { ...base, useMessages: true };
    const call = { method: "tools/call", params: { name: "mac_messages_send", arguments: { chat: "iMessage;+;chat0001", text: "hello group" } } };
    const asked = await handleMessagesMcp(call, on) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(asked.result.isError).toBeUndefined();
    expect(asked.result.content[0]!.text).toContain("approval card");
    expect(cards).toHaveLength(1);
    // #4158: the card names a conversation by its name or members, never its id.
    expect(cards[0]!.to).toBe("Messages to a conversation");
    expect(cards[0]!.to).not.toContain("chat0001");
    expect(cards[0]!.to).not.toContain("hello group");
    const auto = await handleMessagesMcp(call, { ...on, macApps: { ...on.macApps, unasked: true } }) as { result: { content: { text: string }[] } };
    expect(auto.result.content[0]!.text).toBe("done");
    expect(runs).toEqual(["mac_messages_send"]);
  });

  it("a group counts as a listed recipient only when every member is on the bot's list (#4158)", async () => {
    const cards: Array<{ to: string; macApp?: unknown }> = [];
    const runs: string[] = [];
    const members: Record<string, string[]> = {
      "iMessage;+;chat0001": ["+15145551234", "+15145559876"],
      "iMessage;+;chat0002": ["+15145551234", "+15145550000"],
    };
    const on = {
      ...deps(false, cards, runs),
      useMessages: true,
      allowedRecipients: ["phone:+15145551234", "phone:+15145559876"],
      chatMembers: async (chat: string) => members[chat] ?? [],
    };
    const call = (chat: string) => ({ method: "tools/call", params: { name: "mac_messages_send", arguments: { chat, text: "hello group" } } });
    const all = await handleMessagesMcp(call("iMessage;+;chat0001"), on) as { result: { content: { text: string }[] } };
    expect(all.result.content[0]!.text).toBe("done");
    expect(cards).toEqual([]);
    const some = await handleMessagesMcp(call("iMessage;+;chat0002"), on) as { result: { content: { text: string }[] } };
    expect(some.result.content[0]!.text).toContain("approval card");
    const unknown = await handleMessagesMcp(call("iMessage;+;chat0003"), on) as { result: { content: { text: string }[] } };
    expect(unknown.result.content[0]!.text).toContain("approval card");
    const offPolicy = await handleMessagesMcp(call("iMessage;+;chat0001"), { ...on, grantsAllowed: false }) as { result: { content: { text: string }[] } };
    expect(offPolicy.result.content[0]!.text).toContain("approval card");
    expect(runs).toEqual(["mac_messages_send"]);
    expect(cards).toHaveLength(3);
  });
});

describe("Apple apps on an organization server, relayed to the person's Mac (#4158)", () => {
  const relayDeps = (tools: readonly string[] | null, runs: Array<{ tool: string; args: Record<string, unknown> }>, cards: Array<{ to: string }> = []) => ({
    host: { platform: "linux", identityKind: "perspicax" as const },
    useMessages: false,
    dbDir: null,
    botId: "bot",
    threadId: "thread",
    openCard: (pending: { to: string }) => { cards.push(pending); },
    macApps: {
      enabled: (app: string) => app === "mail" || app === "messages",
      tools: () => tools,
      run: async (tool: string, args: Record<string, unknown>) => {
        runs.push({ tool, args });
        if (tool === "mac_messages_list_chats") return { content: [{ type: "text" as const, text: JSON.stringify({ chats: [{ chat: "iMessage;+;chat0001", name: null, members: ["+15145551234", "bo@example.com"] }] }) }] };
        return { content: [{ type: "text" as const, text: "done" }] };
      },
      unasked: false,
      relay: { person: "ada@example.com" },
    },
  });

  it("a desktop app that reports no tools keeps its 12 older tools, as they were, and gets nothing else", async () => {
    const runs: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const listed = await handleMessagesMcp({ method: "tools/list" }, relayDeps(null, runs)) as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    const expected = MAC_APP_LEGACY_TOOLS.filter((tool) => tool.app === "mail" || tool.app === "messages");
    expect(listed.result.tools).toEqual(expected.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
    const deleted = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_mail_delete", arguments: { ids: ["1"] } } }, relayDeps(null, runs));
    expect(textOf(deleted)).toContain("Update the Sagax app on your Mac");
    const chat = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_messages_send", arguments: { chat: "iMessage;+;chat0001", text: "x" } } }, relayDeps(null, runs));
    expect(textOf(chat)).toContain("Update the Sagax app on your Mac");
    const paged = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_mail_read", arguments: { id: 12, offset: 20000 } } }, relayDeps(null, runs));
    expect(textOf(paged)).toContain("Update the Sagax app on your Mac");
    expect(runs).toEqual([]);
    const old = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_mail_search", arguments: { query: "x", limit: 5 } } }, relayDeps(null, runs));
    expect(textOf(old)).toBe("done");
    expect(runs.map((run) => run.tool)).toEqual(["mac_mail_search"]);
  });

  it("a current desktop app gets exactly the tools it reported", async () => {
    const runs: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const reported = ["mac_mail_search", "mac_mail_delete", "mac_messages_send", "mac_messages_list_chats"];
    const listed = await handleMessagesMcp({ method: "tools/list" }, relayDeps(reported, runs)) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name).sort()).toEqual([...reported].sort());
    const notReported = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_mail_move", arguments: { ids: ["1"], to: "archive" } } }, relayDeps(reported, runs));
    expect(textOf(notReported)).toContain("Update the Sagax app on your Mac");
  });

  it("the card for a send into a conversation names its members, never its chat id", async () => {
    const runs: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const cards: Array<{ to: string }> = [];
    const asked = await handleMessagesMcp({ method: "tools/call", params: { name: "mac_messages_send", arguments: { chat: "iMessage;+;chat0001", text: "hello group" } } }, relayDeps(MAC_APP_TOOLS.map((tool) => tool.name), runs, cards));
    expect(textOf(asked)).toContain("approval card");
    expect(cards[0]!.to).toBe("Messages to +15145551234, bo@example.com");
    expect(cards[0]!.to).not.toContain("chat0001");
  });
});

describe("files on an Apple app write come only from the bot's folder (#4158)", () => {
  it("passes a file of the bot's folder as its path and refuses one outside it before any card", async () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-bot-"));
    const file = join(root, "plan.pdf");
    writeFileSync(file, "pdf");
    const runs: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const deps = {
      host: { platform: "darwin", identityKind: "solo" as const },
      useMessages: false,
      dbDir: null,
      filesRoots: [root],
      botId: "bot",
      threadId: "thread",
      openCard: () => {},
      macApps: { enabled: () => true, run: async (tool: string, args: Record<string, unknown>) => { runs.push({ tool, args }); return { content: [{ type: "text" as const, text: "sent" }] }; }, unasked: true },
    };
    const call = (files: string[]) => ({ method: "tools/call", params: { name: "mac_mail_send", arguments: { to: ["a@example.com"], subject: "s", body: "b", files } } });
    expect(textOf(await handleMessagesMcp(call([file]), deps))).toBe("sent");
    // botFile returns realpathSync so /tmp and /var resolve under /private on macOS (#5455).
    expect(runs[0]!.args.files).toEqual([realpathSync(file)]);
    const outside = await handleMessagesMcp(call([join(tmpdir(), "nope.pdf")]), deps);
    expect(textOf(outside)).toContain("not in this bot's folder");
    expect(runs).toHaveLength(1);
  });
});
