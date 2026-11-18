// The Apple apps of the person's own Mac (Messages, Mail, Calendar, Contacts,
// Reminders, Notes, Photos) as bot tools. One module for both modes:
// - solo: the Sagax server on this Mac runs them (server/imessage/imessage-mcp.ts);
// - organization server: the desktop app runs them for the server's bots
//   through the desktop bridge (action "mac_app", electron/desktop-bridge.mjs).
//
// Every app call is JXA run by osascript with a CONSTANT script and one JSON
// argument: `osascript -l JavaScript -e <script> <json>`. Nothing the bot
// sends is ever spliced into the script text, and the JSON starts with "{",
// so osascript never reads it as an option. Messages reads come straight
// from chat.db (read only, parameterized SQL), which needs Full Disk Access.
import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const MAC_APPS = [
  { id: "messages", name: "Messages", bundleId: "com.apple.MobileSMS", fullDiskAccess: true },
  { id: "mail", name: "Mail", bundleId: "com.apple.mail", fullDiskAccess: false },
  { id: "calendar", name: "Calendar", bundleId: "com.apple.iCal", fullDiskAccess: false },
  { id: "contacts", name: "Contacts", bundleId: "com.apple.AddressBook", fullDiskAccess: false },
  { id: "reminders", name: "Reminders", bundleId: "com.apple.reminders", fullDiskAccess: false },
  { id: "notes", name: "Notes", bundleId: "com.apple.Notes", fullDiskAccess: false },
  { id: "photos", name: "Photos", bundleId: "com.apple.Photos", fullDiskAccess: false },
];
export const MAC_APP_IDS = MAC_APPS.map((app) => app.id);

const where = "in the Apple app on the Mac of the person you work for";
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const limit = (max) => ({ type: "number", description: `How many to return (at most ${max}).` });

// Each row: its app, its class (`kind`: read, write, delete or send to
// someone; the one place a tool's class is written) and the permission it
// needs (`needs`). Names stay mac_<app>_<verb>[_<noun>] and are never renamed:
// saved Always allow rules and routines name them.
const mailIdSchema = { type: "string", description: "A message id from mac_mail_search or mac_mail_read." };
const mailIdsSchema = { type: "array", items: mailIdSchema, description: "Up to 50 message ids from mac_mail_search." };
const emails = (what) => ({ type: "array", items: { type: "string" }, description: what });
const mailboxSchema = { type: "string", description: "A mailbox name as mac_mail_list_mailboxes gives it (a nested one as Parent/Child)." };
const accountSchema = { type: "string", description: "An account name as mac_mail_list_mailboxes gives it." };

const cursorSchema = { type: "string", description: "The next value of the previous result." };
const idSchema = (what) => ({ type: "string", description: what });
const idsSchema = (what) => ({ type: "array", items: { type: "string" }, description: `Up to 50 ${what}.` });
const rruleSchema = { type: "string", description: "Repeat rule in RFC 5545 form, e.g. FREQ=WEEKLY;INTERVAL=1;COUNT=10 or FREQ=MONTHLY;UNTIL=20271231T000000Z. Empty string: no repeat." };
const alarmsSchema = { type: "array", items: { type: "number" }, description: "Alerts, in minutes before the start (0 = at the start), up to 10." };
const labeled = (what) => ({ type: "array", items: { anyOf: [{ type: "string" }, { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["value"], additionalProperties: false }] }, description: `${what}: a value, or { label, value } (label e.g. home, work, mobile). Replaces the card's list on an update.` });
const PRIORITIES = ["none", "low", "medium", "high"];
const photoAlbumSchema = { type: "string", description: "An album id from mac_photos_list_albums, or its name." };
const filesSchema = { type: "array", items: { type: "string" }, description: "Files to attach: paths in this bot's folder (25 MB each at most)." };
const scopeSchema = { type: "string", enum: ["this", "future", "all"], description: "For a repeating event: this occurrence only, this one and the ones after it, or the whole series. Default: this, for an occurrence id from mac_calendar_list; all, for a series id." };
const attachmentIndex = { type: "number", description: "The attachment's index from the read." };
const contactFields = {
  firstName: { type: "string" }, lastName: { type: "string" }, middleName: { type: "string" }, nickname: { type: "string" },
  organization: { type: "string" }, jobTitle: { type: "string" }, department: { type: "string" },
  birthday: { type: "string", description: "ISO date." }, note: { type: "string" },
  emails: labeled("Email addresses"), phones: labeled("Phone numbers"), urls: labeled("Links"),
};

export const MAC_APP_TOOLS = [
  { name: "mac_messages_list_chats", app: "messages", kind: "read", needs: "fullDiskAccess", description: `List the conversations ${where} Messages, people and groups, newest first, with their members and last activity. Gives the chat id mac_messages_read and mac_messages_send take. Names of people come from mac_contacts_search.`,
    inputSchema: obj({ query: { type: "string", description: "Words in the chat name, a member's phone number or email." }, limit: limit(100), cursor: cursorSchema }) },
  { name: "mac_messages_read", app: "messages", kind: "read", needs: "fullDiskAccess", description: `Read messages ${where} Messages, newest first, with their reactions, attachments (index, name, type, size; mac_messages_read_attachment saves one), edited and unsent marks, and the message each one replies to. Filter by a chat (its chat id, a phone number, an email or a chat name), by words (found in every message, the ones kept as rich text included) and by date. A result with next may have more, even with fewer messages than the limit (a word search reads older messages in windows): pass it back as cursor.`,
    inputSchema: obj({ chat: { type: "string", description: "Chat id from mac_messages_list_chats, phone number, email or chat name." }, query: { type: "string", description: "Words the message contains." }, since: { type: "string", description: "ISO date: sent on or after." }, limit: limit(100), cursor: cursorSchema }) },
  { name: "mac_messages_read_attachment", app: "messages", kind: "read", needs: "fullDiskAccess", description: `Save one file someone sent ${where} Messages (a photo or any file) into this conversation's folder, by the message id and the attachment index mac_messages_read gave. Returns the saved file's path, name, type and size.`,
    inputSchema: obj({ id: { type: "string", description: "A message id from mac_messages_read." }, index: attachmentIndex }, ["id", "index"]) },
  { name: "mac_messages_send", app: "messages", kind: "send", needs: "automation", description: `Send an iMessage or SMS ${where} Messages: to one phone number or email (to), or into an existing conversation, a group included (chat, its id from mac_messages_list_chats). Text, files from this bot's folder (by iMessage), or both.`,
    inputSchema: obj({ to: { type: "string", description: "One phone number or email." }, chat: { type: "string", description: "A chat id from mac_messages_list_chats (a group works)." }, text: { type: "string" }, files: filesSchema, service: { type: "string", enum: ["iMessage", "SMS", "auto"], description: "For to: iMessage, SMS or auto (default). A file goes by iMessage." } }) },
  { name: "mac_mail_list_mailboxes", app: "mail", kind: "read", needs: "automation", description: `List the accounts and their mailboxes ${where} Mail, with unread counts. Gives the mailbox and account names the other mac_mail_ tools take.`,
    inputSchema: obj({ account: { type: "string", description: "One account's name (default: all)." } }) },
  { name: "mac_mail_search", app: "mail", kind: "read", needs: "automation", description: `Search one mailbox ${where} Mail (default: the inbox of every account). Filters: words in the subject or sender (and the body with inBody, which is slow), sender, dates, unread, flagged. Returns summaries with ids for the other mac_mail_ tools; a result with next has more: pass it back as cursor. On a large mailbox, give since to keep it fast.`,
    inputSchema: obj({ mailbox: mailboxSchema, account: accountSchema, query: { type: "string", description: "Words in the subject or the sender. Empty: the latest messages." }, from: { type: "string", description: "Words in the sender (name or address)." }, since: { type: "string", description: "ISO date: received on or after." }, until: { type: "string", description: "ISO date: received before." }, unread: { type: "boolean", description: "true: only unread; false: only read." }, flagged: { type: "boolean", description: "true: only flagged; false: only unflagged." }, inBody: { type: "boolean", description: "Also look for query in the body (slow)." }, limit: limit(50), cursor: { type: "string", description: "The next value of the previous result." } }) },
  { name: "mac_mail_read", app: "mail", kind: "read", needs: "automation", description: `Read one email ${where} Mail, by the id mac_mail_search gave: sender, to, cc, dates, attachments (index, name, type, size; mac_mail_read_attachment saves one) and the body (20,000 characters at a time; when truncated, call again with offset).`,
    inputSchema: obj({ id: mailIdSchema, offset: { type: "number", description: "Where to continue the body (the offset the last read gave)." }, headers: { type: "boolean", description: "Also return all the headers." } }, ["id"]) },
  { name: "mac_mail_read_attachment", app: "mail", kind: "read", needs: "automation", description: `Save one attachment of an email ${where} Mail into this conversation's folder, by the email id and the attachment index mac_mail_read gave. Returns the saved file's path, name, type and size.`,
    inputSchema: obj({ id: mailIdSchema, index: attachmentIndex }, ["id", "index"]) },
  { name: "mac_mail_update", app: "mail", kind: "write", needs: "automation", description: `Change emails ${where} Mail: mark read or unread, flag or unflag (with a colour), mark as junk or not junk. Junk also moves the email to its account's junk mailbox when one is found; not junk moves it from there back to the inbox.`,
    inputSchema: obj({ ids: mailIdsSchema, read: { type: "boolean" }, flagged: { type: "boolean" }, flagColor: { type: "string", enum: ["red", "orange", "yellow", "green", "blue", "purple", "gray"] }, junk: { type: "boolean" } }, ["ids"]) },
  { name: "mac_mail_move", app: "mail", kind: "write", needs: "automation", description: `Move emails ${where} Mail: to a mailbox by name, or with to: "archive" (the archive mailbox of each email's own account), "inbox" or "junk". When an account has no archive mailbox, the answer lists its mailboxes: move by name instead.`,
    inputSchema: obj({ ids: mailIdsSchema, mailbox: mailboxSchema, account: { type: "string", description: "The account of that mailbox (default: each email's own account)." }, to: { type: "string", enum: ["archive", "inbox", "junk"] } }, ["ids"]) },
  { name: "mac_mail_delete", app: "mail", kind: "delete", needs: "automation", description: `Delete emails ${where} Mail: they go to the account's Trash.`,
    inputSchema: obj({ ids: mailIdsSchema }, ["ids"]) },
  { name: "mac_mail_send", app: "mail", kind: "send", needs: "automation", description: `Send an email ${where} Mail, from its default account or from one of its addresses, with files from this bot's folder if wanted.`,
    inputSchema: obj({ to: emails("Email addresses."), cc: emails("Email addresses."), bcc: emails("Email addresses."), from: { type: "string", description: "One of the person's addresses in Mail (default: the default account)." }, subject: { type: "string" }, body: { type: "string" }, files: filesSchema }, ["to", "subject", "body"]) },
  { name: "mac_mail_reply", app: "mail", kind: "send", needs: "automation", description: `Reply to one email ${where} Mail, by its id, with Mail's own reply, and send it at once. all: reply to all. files: attach files from this bot's folder.`,
    inputSchema: obj({ id: mailIdSchema, body: { type: "string" }, all: { type: "boolean", description: "Reply to all the recipients." }, files: filesSchema }, ["id", "body"]) },
  { name: "mac_mail_forward", app: "mail", kind: "send", needs: "automation", description: `Forward one email ${where} Mail, by its id, with Mail's own forward, and send it at once.`,
    inputSchema: obj({ id: mailIdSchema, to: emails("Email addresses."), cc: emails("Email addresses."), body: { type: "string", description: "Text above the forwarded email." } }, ["id", "to"]) },
  { name: "mac_mail_create_draft", app: "mail", kind: "write", needs: "automation", description: `Save an email as a draft ${where} Mail (in Drafts, not sent): a new email, or a reply to one email (replyTo, its id; all: reply to all), with files from this bot's folder if wanted. A saved draft is changed by saving a new one and deleting the old one with mac_mail_delete.`,
    inputSchema: obj({ to: emails("Email addresses."), cc: emails("Email addresses."), bcc: emails("Email addresses."), from: { type: "string", description: "One of the person's addresses in Mail (default: the default account)." }, subject: { type: "string", description: "Required for a new email; a reply keeps Mail's Re: subject." }, body: { type: "string" }, replyTo: { type: "string", description: "A message id from mac_mail_search: the draft is a reply to it." }, all: { type: "boolean", description: "With replyTo: reply to all." }, files: filesSchema }, ["body"]) },
  { name: "mac_mail_list_rules", app: "mail", kind: "read", needs: "automation", description: `List the rules ${where} Mail, with whether each is on.`,
    inputSchema: obj({}) },
  { name: "mac_mail_update_rule", app: "mail", kind: "write", needs: "automation", description: `Turn one rule ${where} Mail on or off, by its name from mac_mail_list_rules.`,
    inputSchema: obj({ name: { type: "string" }, enabled: { type: "boolean" } }, ["name", "enabled"]) },
  { name: "mac_calendar_list_calendars", app: "calendar", kind: "read", needs: "automation", description: `List the calendars ${where} Calendar, with whether each can be written.`,
    inputSchema: obj({}) },
  { name: "mac_calendar_list", app: "calendar", kind: "read", needs: "automation", description: `List events ${where} Calendar that start between two dates (default: the next 7 days), with their ids for the other mac_calendar_ tools. A repeating event gives each occurrence in the range, computed from its repeat rule, with an occurrence id; a rule this cannot compute (BYSETPOS, hourly and the like) gives the series once, with occurrences: "unknown". query: words in the title, the place or the notes. A result with next was cut short by a slow Calendar: pass it back as cursor for the rest.`,
    inputSchema: obj({ from: { type: "string", description: "ISO date or date-time." }, to: { type: "string", description: "ISO date or date-time." }, calendar: { type: "string", description: "One calendar's name (default: all)." }, query: { type: "string", description: "Words in the title, place or notes." }, limit: limit(200), cursor: cursorSchema }) },
  { name: "mac_calendar_read", app: "calendar", kind: "read", needs: "automation", description: `Read one event ${where} Calendar by its id: dates, place, notes, link, repeat rule, alerts, and who is invited with their answer (an invitation is answered in Calendar itself).`,
    inputSchema: obj({ id: idSchema("An event or occurrence id from mac_calendar_list.") }, ["id"]) },
  { name: "mac_calendar_create", app: "calendar", kind: "write", needs: "automation", description: `Create an event ${where} Calendar, with alerts and a repeat rule if wanted.`,
    inputSchema: obj({ title: { type: "string" }, start: { type: "string", description: "ISO date-time." }, end: { type: "string", description: "ISO date-time." }, calendar: { type: "string", description: "Calendar name (default: the first writable one)." }, location: { type: "string" }, notes: { type: "string" }, url: { type: "string" }, allDay: { type: "boolean" }, alarms: alarmsSchema, repeat: rruleSchema }, ["title", "start", "end"]) },
  { name: "mac_calendar_update", app: "calendar", kind: "write", needs: "automation", description: `Change one event ${where} Calendar by its id: title, dates (a move), place, notes, link, all day, alerts (replaced), repeat rule, or its calendar. For a repeating event, scope says which occurrences change: this one (it leaves the series as an event of its own), this one and the ones after it (the series ends before it and a new one starts), or all.`,
    inputSchema: obj({ id: idSchema("An event or occurrence id from mac_calendar_list."), title: { type: "string" }, start: { type: "string", description: "ISO date-time." }, end: { type: "string", description: "ISO date-time." }, location: { type: "string" }, notes: { type: "string" }, url: { type: "string" }, allDay: { type: "boolean" }, alarms: alarmsSchema, repeat: rruleSchema, calendar: { type: "string", description: "Move it to this calendar." }, scope: scopeSchema }, ["id"]) },
  { name: "mac_calendar_delete", app: "calendar", kind: "delete", needs: "automation", description: `Delete events ${where} Calendar by their ids. For a repeating event, scope says which occurrences go: this one, this one and the ones after it, or the whole series.`,
    inputSchema: obj({ ids: idsSchema("event or occurrence ids from mac_calendar_list"), scope: scopeSchema }, ["ids"]) },
  { name: "mac_calendar_create_calendar", app: "calendar", kind: "write", needs: "automation", description: `Create a calendar ${where} Calendar.`,
    inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "mac_calendar_update_calendar", app: "calendar", kind: "write", needs: "automation", description: `Rename a calendar ${where} Calendar.`,
    inputSchema: obj({ name: { type: "string", description: "Its name now." }, newName: { type: "string" } }, ["name", "newName"]) },
  { name: "mac_calendar_delete_calendar", app: "calendar", kind: "delete", needs: "automation", description: `Delete a calendar ${where} Calendar, with all its events.`,
    inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "mac_contacts_search", app: "contacts", kind: "read", needs: "automation", description: `Find people ${where} Contacts by name, email or phone: ids for the other mac_contacts_ tools, emails, phones and organization.`,
    inputSchema: obj({ query: { type: "string" }, limit: limit(50), cursor: cursorSchema }, ["query"]) },
  { name: "mac_contacts_read", app: "contacts", kind: "read", needs: "automation", description: `Read one full card ${where} Contacts: names, organization, title, emails, phones, addresses, birthday, links, related names, note and groups. me: true reads the person's own card.`,
    inputSchema: obj({ id: idSchema("A card id from mac_contacts_search."), me: { type: "boolean" } }) },
  { name: "mac_contacts_create", app: "contacts", kind: "write", needs: "automation", description: `Create a card ${where} Contacts.`,
    inputSchema: obj(contactFields) },
  { name: "mac_contacts_update", app: "contacts", kind: "write", needs: "automation", description: `Change one card ${where} Contacts by its id. A list given (emails, phones, urls) replaces the card's list.`,
    inputSchema: obj({ id: idSchema("A card id from mac_contacts_search."), ...contactFields }, ["id"]) },
  { name: "mac_contacts_delete", app: "contacts", kind: "delete", needs: "automation", description: `Delete cards ${where} Contacts by their ids.`,
    inputSchema: obj({ ids: idsSchema("card ids from mac_contacts_search") }, ["ids"]) },
  { name: "mac_contacts_list_groups", app: "contacts", kind: "read", needs: "automation", description: `List the groups ${where} Contacts, with their ids and how many people each holds.`,
    inputSchema: obj({}) },
  { name: "mac_contacts_create_group", app: "contacts", kind: "write", needs: "automation", description: `Create a group ${where} Contacts.`,
    inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "mac_contacts_update_group", app: "contacts", kind: "write", needs: "automation", description: `Rename a group ${where} Contacts, or add and remove people (card ids).`,
    inputSchema: obj({ id: idSchema("A group id from mac_contacts_list_groups."), name: { type: "string" }, add: idsSchema("card ids to add"), remove: idsSchema("card ids to remove") }, ["id"]) },
  { name: "mac_contacts_delete_group", app: "contacts", kind: "delete", needs: "automation", description: `Delete a group ${where} Contacts (its people stay).`,
    inputSchema: obj({ id: idSchema("A group id from mac_contacts_list_groups.") }, ["id"]) },
  { name: "mac_reminders_list_lists", app: "reminders", kind: "read", needs: "automation", description: `List the reminder lists ${where} Reminders.`,
    inputSchema: obj({}) },
  { name: "mac_reminders_list", app: "reminders", kind: "read", needs: "automation", description: `List reminders ${where} Reminders (open ones by default), with their ids. Filters: a list, words in the title or notes, a due range.`,
    inputSchema: obj({ list: { type: "string", description: "One list's name (default: all)." }, includeCompleted: { type: "boolean" }, query: { type: "string" }, dueFrom: { type: "string", description: "ISO date." }, dueTo: { type: "string", description: "ISO date." }, limit: limit(200), cursor: cursorSchema }) },
  { name: "mac_reminders_create", app: "reminders", kind: "write", needs: "automation", description: `Create a reminder ${where} Reminders, with a due date, a priority and an alert if wanted.`,
    inputSchema: obj({ title: { type: "string" }, notes: { type: "string" }, due: { type: "string", description: "ISO date (all day) or date-time." }, remind: { type: "string", description: "ISO date-time of the alert." }, priority: { type: "string", enum: PRIORITIES }, list: { type: "string", description: "List name (default: the default list)." } }, ["title"]) },
  { name: "mac_reminders_update", app: "reminders", kind: "write", needs: "automation", description: `Change one reminder ${where} Reminders by its id: title, notes, due date, alert, priority, or move it to another list. An empty string clears due or remind.`,
    inputSchema: obj({ id: idSchema("A reminder id from mac_reminders_list."), title: { type: "string" }, notes: { type: "string" }, due: { type: "string" }, remind: { type: "string" }, priority: { type: "string", enum: PRIORITIES }, list: { type: "string", description: "Move it to this list." } }, ["id"]) },
  { name: "mac_reminders_complete", app: "reminders", kind: "write", needs: "automation", description: `Mark reminders done ${where} Reminders (completed: false reopens them).`,
    inputSchema: obj({ ids: idsSchema("reminder ids from mac_reminders_list"), completed: { type: "boolean" } }, ["ids"]) },
  { name: "mac_reminders_delete", app: "reminders", kind: "delete", needs: "automation", description: `Delete reminders ${where} Reminders by their ids.`,
    inputSchema: obj({ ids: idsSchema("reminder ids from mac_reminders_list") }, ["ids"]) },
  { name: "mac_reminders_create_list", app: "reminders", kind: "write", needs: "automation", description: `Create a list ${where} Reminders.`,
    inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "mac_reminders_update_list", app: "reminders", kind: "write", needs: "automation", description: `Rename a list ${where} Reminders.`,
    inputSchema: obj({ name: { type: "string", description: "Its name now." }, newName: { type: "string" } }, ["name", "newName"]) },
  { name: "mac_reminders_delete_list", app: "reminders", kind: "delete", needs: "automation", description: `Delete a list ${where} Reminders, with its reminders.`,
    inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "mac_notes_list_folders", app: "notes", kind: "read", needs: "automation", description: `List the folders ${where} Notes, per account, with how many notes each holds.`,
    inputSchema: obj({}) },
  { name: "mac_notes_search", app: "notes", kind: "read", needs: "automation", description: `Search notes ${where} Notes, by title or text, optionally in one folder: ids and a short preview (mac_notes_read gives the whole note). Empty query: the latest notes.`,
    inputSchema: obj({ query: { type: "string" }, folder: { type: "string", description: "One folder's name." }, limit: limit(50), cursor: cursorSchema }) },
  { name: "mac_notes_read", app: "notes", kind: "read", needs: "automation", description: `Read one note ${where} Notes by its id: the text (or its HTML with format: "html") 20,000 characters at a time (when truncated, call again with offset), and its attachment names. A locked note says so and gives no content.`,
    inputSchema: obj({ id: idSchema("A note id from mac_notes_search."), offset: { type: "number" }, format: { type: "string", enum: ["text", "html"] } }, ["id"]) },
  { name: "mac_notes_create", app: "notes", kind: "write", needs: "automation", description: `Create a note ${where} Notes.`,
    inputSchema: obj({ title: { type: "string" }, body: { type: "string" }, folder: { type: "string", description: "Folder name (default: the default folder)." } }, ["title", "body"]) },
  { name: "mac_notes_update", app: "notes", kind: "write", needs: "automation", description: `Change one note ${where} Notes by its id. mode "append" (default) adds the text at the end of the note. Notes keeps a note as HTML and both modes write that HTML back: mode "replace" rewrites the whole note, which loses its attachments, drawings, tables and checklists, so on a note with attachments it is refused unless force is true. title renames it.`,
    inputSchema: obj({ id: idSchema("A note id from mac_notes_search."), body: { type: "string" }, mode: { type: "string", enum: ["append", "replace"] }, force: { type: "boolean" }, title: { type: "string" } }, ["id"]) },
  { name: "mac_notes_move", app: "notes", kind: "write", needs: "automation", description: `Move notes ${where} Notes to a folder.`,
    inputSchema: obj({ ids: idsSchema("note ids from mac_notes_search"), folder: { type: "string" } }, ["ids", "folder"]) },
  { name: "mac_notes_delete", app: "notes", kind: "delete", needs: "automation", description: `Delete notes ${where} Notes (they go to Recently Deleted).`,
    inputSchema: obj({ ids: idsSchema("note ids from mac_notes_search") }, ["ids"]) },
  { name: "mac_notes_create_folder", app: "notes", kind: "write", needs: "automation", description: `Create a folder ${where} Notes.`,
    inputSchema: obj({ name: { type: "string" }, account: { type: "string", description: "Account name (default: the default account)." } }, ["name"]) },
  { name: "mac_notes_update_folder", app: "notes", kind: "write", needs: "automation", description: `Rename a folder ${where} Notes.`,
    inputSchema: obj({ name: { type: "string", description: "Its name now." }, newName: { type: "string" } }, ["name", "newName"]) },
  { name: "mac_notes_delete_folder", app: "notes", kind: "delete", needs: "automation", description: `Delete a folder ${where} Notes, with its notes.`,
    inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "mac_photos_list_albums", app: "photos", kind: "read", needs: "automation", description: `List the albums ${where} Photos (in folders too), with their ids for the other mac_photos_ tools and how many items each holds.`,
    inputSchema: obj({ limit: limit(200), cursor: cursorSchema }) },
  { name: "mac_photos_search", app: "photos", kind: "read", needs: "automation", description: `Find photos and videos ${where} Photos. query, person and place go through Photos' own search (a person's name as named in People, a place, a keyword, a title, words Photos recognizes in the picture). album, a date range (from, to), keyword and favorite narrow it. Without words: the newest first. Returns ids, dates, size, favorite, keywords and the position for mac_photos_read and mac_photos_export; a result with next has more: pass it back as cursor.`,
    inputSchema: obj({ query: { type: "string", description: "Words for Photos' search." }, person: { type: "string", description: "A person's name as named in Photos' People." }, place: { type: "string", description: "A place name (city, country, venue)." }, album: photoAlbumSchema, from: { type: "string", description: "ISO date: taken on or after." }, to: { type: "string", description: "ISO date: taken before." }, keyword: { type: "string", description: "One keyword the photo carries." }, favorite: { type: "boolean", description: "true: only favorites." }, limit: limit(100), cursor: cursorSchema }) },
  { name: "mac_photos_read", app: "photos", kind: "read", needs: "automation", description: `Read the details of photos ${where} Photos by their ids: file name, title, caption, keywords, date, size, position and altitude, favorite.`,
    inputSchema: obj({ ids: idsSchema("photo ids from mac_photos_search"), cursor: cursorSchema }, ["ids"]) },
  { name: "mac_photos_export", app: "photos", kind: "read", needs: "automation", description: `Save photos ${where} Photos into this conversation's folder, by their ids, so you can look at them or attach them: a JPEG resized to maxSize pixels on its longest side by default (2048), or the original file with original: true (a video stays a video). Returns each saved file's path, name, type and size; a result with next has more: call again with the same ids and that cursor.`,
    inputSchema: obj({ ids: idsSchema("photo ids from mac_photos_search"), original: { type: "boolean", description: "The original file, as imported (HEIC, RAW, a video), not resized." }, maxSize: { type: "number", description: "Longest side of a resized photo, in pixels (256 to 8192, default 2048)." }, cursor: cursorSchema }, ["ids"]) },
  { name: "mac_photos_create_album", app: "photos", kind: "write", needs: "automation", description: `Create an album ${where} Photos, in a folder if wanted, and add photos to it by their ids.`,
    inputSchema: obj({ name: { type: "string" }, folder: { type: "string", description: "A folder's name in Photos." }, ids: idsSchema("photo ids from mac_photos_search to add") }, ["name"]) },
  { name: "mac_photos_add_to_album", app: "photos", kind: "write", needs: "automation", description: `Add photos ${where} Photos to an album, by their ids.`,
    inputSchema: obj({ album: photoAlbumSchema, ids: idsSchema("photo ids from mac_photos_search") }, ["album", "ids"]) },
];

const TOOL_BY_NAME = new Map(MAC_APP_TOOLS.map((tool) => [tool.name, tool]));

// The 12 tools a desktop app from before the full action set runs. Such a
// desktop reports no `tools` with its On apps, and checks each call against
// its own older table: an organization server lists exactly these for it, as
// they were, so a bot never calls a tool or a field that Mac cannot run.
const legacy = (name, description, inputSchema) => ({ name, app: TOOL_BY_NAME.get(name).app, description, inputSchema });
export const MAC_APP_LEGACY_TOOLS = [
  legacy("mac_messages_read", `Read recent messages ${where} Messages. Filter by a chat (a phone number, an email or a chat name) and by words.`,
    obj({ chat: { type: "string", description: "Phone number, email or chat name." }, query: { type: "string", description: "Words the message contains." }, limit: limit(100) })),
  legacy("mac_messages_send", `Send an iMessage or SMS ${where} Messages, to one phone number or email.`,
    obj({ to: { type: "string", description: "One phone number or email." }, text: { type: "string" } }, ["to", "text"])),
  legacy("mac_mail_search", `Search the inbox ${where} Mail, by subject or sender. Returns ids for mac_mail_read.`,
    obj({ query: { type: "string", description: "Words in the subject or the sender. Empty: the latest messages." }, limit: limit(50) })),
  legacy("mac_mail_read", `Read one email ${where} Mail, by the id mac_mail_search gave.`, obj({ id: { type: "number" } }, ["id"])),
  legacy("mac_mail_send", `Send an email ${where} Mail, from its default account.`,
    obj({ to: { type: "array", items: { type: "string" } }, cc: { type: "array", items: { type: "string" } }, subject: { type: "string" }, body: { type: "string" } }, ["to", "subject", "body"])),
  legacy("mac_calendar_list", `List events ${where} Calendar between two dates (default: the next 7 days).`,
    obj({ from: { type: "string", description: "ISO date or date-time." }, to: { type: "string", description: "ISO date or date-time." }, calendar: { type: "string", description: "One calendar's name (default: all)." }, limit: limit(200) })),
  legacy("mac_calendar_create", `Create an event ${where} Calendar.`,
    obj({ title: { type: "string" }, start: { type: "string", description: "ISO date-time." }, end: { type: "string", description: "ISO date-time." }, calendar: { type: "string", description: "Calendar name (default: the first writable one)." }, location: { type: "string" }, notes: { type: "string" }, allDay: { type: "boolean" } }, ["title", "start", "end"])),
  legacy("mac_contacts_search", `Find people ${where} Contacts by name: emails, phones and organization.`, obj({ query: { type: "string" }, limit: limit(50) }, ["query"])),
  legacy("mac_reminders_list", `List reminders ${where} Reminders (open ones by default).`,
    obj({ list: { type: "string", description: "One list's name (default: all)." }, includeCompleted: { type: "boolean" }, limit: limit(200) })),
  legacy("mac_reminders_create", `Create a reminder ${where} Reminders.`,
    obj({ title: { type: "string" }, notes: { type: "string" }, due: { type: "string", description: "ISO date-time." }, list: { type: "string", description: "List name (default: the default list)." } }, ["title"])),
  legacy("mac_notes_search", `Search notes ${where} Notes, by title or text.`, obj({ query: { type: "string" }, limit: limit(50) }, ["query"])),
  legacy("mac_notes_create", `Create a note ${where} Notes.`,
    obj({ title: { type: "string" }, body: { type: "string" }, folder: { type: "string", description: "Folder name (default: the default folder)." } }, ["title", "body"])),
];
const LEGACY_NAMES = new Set(MAC_APP_LEGACY_TOOLS.map((tool) => tool.name));
/** The sentence a call answers when the person's Mac runs an older Sagax app. */
export const MAC_APP_UPDATE_DESKTOP = "The Sagax app on your Mac is too old for this. Update the Sagax app on your Mac, then try again. Nothing was done.";
/** The tools a Mac runs, from what its desktop reported: its own list, or the
 * 12 older tools for a desktop that reports none. */
export function macAppToolsFor(reported) {
  if (!Array.isArray(reported)) return MAC_APP_LEGACY_TOOLS;
  const names = new Set(reported.filter((name) => typeof name === "string"));
  return MAC_APP_TOOLS.filter((tool) => names.has(tool.name));
}
/** Whether a call fits a Mac with an older desktop: one of its 12 tools, with
 * only the fields it knew. */
export function macAppLegacyCall(name, args) {
  if (!LEGACY_NAMES.has(name)) return false;
  const known = Object.keys(MAC_APP_LEGACY_TOOLS.find((tool) => tool.name === name).inputSchema.properties);
  const a = args && typeof args === "object" ? args : {};
  return Object.entries(a).every(([key, value]) => known.includes(key) || value === undefined || value === null || value === "" || value === false);
}
export const isMacAppTool = (name) => typeof name === "string" && TOOL_BY_NAME.has(name);
export const macAppOfTool = (name) => TOOL_BY_NAME.get(name)?.app ?? null;
/** A write, a delete or a send (anything but a read): what today's gate asks about. */
export const macAppToolWrites = (name) => { const kind = TOOL_BY_NAME.get(name)?.kind; return Boolean(kind) && kind !== "read"; };
export const macAppInfo = (id) => MAC_APPS.find((app) => app.id === id) ?? null;
/** A tool that saves files into the conversation's folder (an attachment, an
 * exported photo): it needs that folder, and the relay copies them back. */
export const macAppSavesFiles = (name) => typeof name === "string" && (name.endsWith("_read_attachment") || name === "mac_photos_export");

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/;
const bad = (message) => { throw new Error(message); };
function str(value, field, { max = 2_000, required = false, multiline = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) bad(`${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") bad(`${field} must be a string`);
  const clean = value.trim();
  if (required && !clean) bad(`${field} is required`);
  if (clean.length > max) bad(`${field} is at most ${max} characters`);
  if (value.includes("\0") || (!multiline && /[\r\n]/.test(value)) || CONTROL.test(value)) bad(`${field} has control characters`);
  return clean || undefined;
}
const num = (value, fallback, max) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value))) : fallback);
function date(value, field, required = false) {
  const raw = str(value, field, { max: 64, required });
  if (raw === undefined) return undefined;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) bad(`${field} must be an ISO date`);
  return new Date(parsed).toISOString();
}
const ADDRESS = /^[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+$/;
function addresses(value, field, required) {
  const list = typeof value === "string" ? [value] : value;
  if (list === undefined || list === null) {
    if (required) bad(`${field} is required`);
    return [];
  }
  if (!Array.isArray(list) || list.length > 50) bad(`${field} must be a list of at most 50 emails`);
  const out = list.map((entry) => str(entry, field, { max: 320, required: true }));
  if (out.some((entry) => !ADDRESS.test(entry))) bad(`${field} must hold email addresses`);
  if (required && !out.length) bad(`${field} is required`);
  return out;
}
const RECIPIENT = /^(?:\+?[0-9 ().-]{3,32}|[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+)$/;

// --- Mail ids. One opaque string: the account, the mailbox and Mail's message
// number, so a read or a write goes straight to the message. A bare number
// (the id of the first mac_mail_search) is still read, by a scan.
const MAIL_ID_PREFIX = "mail.";
export function mailId(account, mailbox, n) {
  return MAIL_ID_PREFIX + Buffer.from(JSON.stringify([String(account ?? ""), String(mailbox ?? ""), n]), "utf8").toString("base64url");
}
const isMessageNumber = (n) => typeof n === "number" && Number.isInteger(n) && n >= 0;
/** { account, mailbox, n } for an id, { n } for the old bare number, else null. */
export function parseMailId(value) {
  if (isMessageNumber(value)) return { n: value };
  if (typeof value !== "string" || value.length > 4_000) return null;
  if (/^\d{1,15}$/.test(value)) return { n: Number(value) };
  if (!value.startsWith(MAIL_ID_PREFIX)) return null;
  const body = value.slice(MAIL_ID_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  try {
    const parts = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Array.isArray(parts) || parts.length !== 3) return null;
    const [account, mailbox, n] = parts;
    if (typeof account !== "string" || typeof mailbox !== "string" || !mailbox || !isMessageNumber(n)) return null;
    if (CONTROL.test(account + mailbox) || /[\r\n\0]/.test(account + mailbox)) return null;
    return { account, mailbox, n };
  } catch {
    return null;
  }
}
function mailIdArg(value, field = "id") {
  const id = typeof value === "string" ? value.trim() : value;
  if (parseMailId(id) === null) bad(`${field} must be a message id from mac_mail_search`);
  return id;
}
function mailIdList(value) {
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || !list.length) bad("ids must list 1 to 50 message ids from mac_mail_search");
  if (list.length > 50) bad("ids holds at most 50 message ids");
  return list.map((entry) => mailIdArg(entry, "ids"));
}
const optBool = (value) => (typeof value === "boolean" ? value : undefined);
const MAIL_FLAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "gray"];
function flagColor(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MAIL_FLAG_COLORS.length) return value;
  const index = MAIL_FLAG_COLORS.indexOf(typeof value === "string" ? value.trim().toLowerCase() : "");
  if (index < 0) bad(`flagColor is one of ${MAIL_FLAG_COLORS.join(", ")}`);
  return index;
}
function cursor(value) {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : /^\d{1,9}$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0) bad("cursor must be the next value of the previous result");
  return n;
}
function sender(value) {
  const raw = str(value, "from", { max: 400 });
  if (raw === undefined) return undefined;
  const address = /<([^<>]+)>\s*$/.exec(raw)?.[1]?.trim() ?? raw;
  if (!ADDRESS.test(address)) bad("from must be one of the person's email addresses");
  return raw;
}
const without = (op) => Object.fromEntries(Object.entries(op).filter(([, value]) => value !== undefined));

// Ids of Calendar, Reminders, Contacts and Notes are the app's own opaque
// strings, passed back as they came.
const idArg = (value, field = "id") => str(value, field, { max: 1_000, required: true });
function idList(value, field = "ids", { required = true } = {}) {
  const list = typeof value === "string" ? [value] : value;
  if (list === undefined || list === null) {
    if (required) bad(`${field} must list 1 to 50 ids`);
    return undefined;
  }
  if (!Array.isArray(list) || (required && !list.length)) bad(`${field} must list 1 to 50 ids`);
  if (list.length > 50) bad(`${field} holds at most 50 ids`);
  return list.map((entry) => idArg(entry, field));
}
const nameArg = (value, field = "name") => str(value, field, { max: 200, required: true });
/** An RFC 5545 repeat rule (without its RRULE: prefix); "" clears it. */
function rrule(value) {
  if (value === undefined || value === null) return undefined;
  if (value === "") return "";
  const raw = str(value, "repeat", { max: 300 });
  if (raw === undefined) return "";
  const rule = raw.replace(/^RRULE:/i, "").toUpperCase();
  if (!/^FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:;[A-Z]+=[A-Z0-9,+-]+)*$/.test(rule)) bad("repeat must be an RFC 5545 rule such as FREQ=WEEKLY;INTERVAL=1");
  return rule;
}
function alarmList(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 10) bad("alarms is a list of at most 10 minute counts");
  return value.map((minutes) => {
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0 || minutes > 40_320) bad("each alarm is a number of minutes before the start (0 to 40320)");
    return Math.round(minutes);
  });
}
function labeledList(value, field) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) bad(`${field} is a list of at most 20 values`);
  return value.map((entry) => {
    const row = typeof entry === "string" ? { value: entry } : entry && typeof entry === "object" ? entry : bad(`${field} holds values or { label, value }`);
    return without({ label: str(row.label, `${field} label`, { max: 60 }), value: str(row.value, field, { max: 500, required: true }) });
  });
}
function priority(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!PRIORITIES.includes(value)) bad(`priority is one of ${PRIORITIES.join(", ")}`);
  return value;
}
/** Files to attach: paths (the server checks they sit in the bot's folder;
 * the desktop app takes names of files staged in its attachments folder). */
function fileList(value) {
  if (value === undefined || value === null) return undefined;
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || list.length > 20) bad("files is a list of at most 20 paths");
  const out = list.map((entry) => str(entry, "files", { max: 4_096, required: true }));
  return out.length ? out : undefined;
}
function attachmentIndexArg(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 999) bad("index must be an attachment index from the read");
  return value;
}
const SCOPES = ["this", "future", "all"];
function scopeArg(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!SCOPES.includes(value)) bad("scope is this, future or all");
  return value;
}
// A Calendar id: the event's uid, or for one occurrence of a repeating event
// the uid, "#" and the occurrence's start (ISO, UTC).
const OCCURRENCE = /#(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)$/;
export function calendarRef(id) {
  const hit = OCCURRENCE.exec(id);
  return hit ? { uid: id.slice(0, hit.index), occurrence: new Date(hit[1]).toISOString() } : { uid: id };
}
export const calendarOccurrenceId = (uid, start) => `${uid}#${new Date(start).toISOString()}`;
/** A date alone (no time): an all-day due date. */
const dayOnly = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? true : undefined);
/** A date that may be cleared with "". */
const clearableDate = (value, field) => (value === "" ? "" : date(value, field));
function contactOp(a) {
  return without({
    firstName: str(a.firstName, "firstName", { max: 200 }), lastName: str(a.lastName, "lastName", { max: 200 }),
    middleName: str(a.middleName, "middleName", { max: 200 }), nickname: str(a.nickname, "nickname", { max: 200 }),
    organization: str(a.organization, "organization", { max: 300 }), jobTitle: str(a.jobTitle, "jobTitle", { max: 300 }),
    department: str(a.department, "department", { max: 300 }), birthday: date(a.birthday, "birthday"),
    note: str(a.note, "note", { max: 20_000, multiline: true }),
    emails: labeledList(a.emails, "emails"), phones: labeledList(a.phones, "phones"), urls: labeledList(a.urls, "urls"),
  });
}

/** The bounded arguments one call becomes. Throws on bad input. */
export function macAppOperation(name, args) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  switch (name) {
    case "mac_messages_list_chats":
      return without({ query: str(a.query, "query", { max: 200 }), limit: num(a.limit, 30, 100), offset: cursor(a.cursor ?? a.offset) });
    case "mac_messages_read":
      return without({ chat: str(a.chat, "chat", { max: 300 }), query: str(a.query, "query", { max: 200 }), since: date(a.since, "since"), limit: num(a.limit, 20, 100), offset: cursor(a.cursor ?? a.offset) });
    case "mac_messages_read_attachment":
      return { id: str(a.id, "id", { max: 300, required: true }), index: attachmentIndexArg(a.index) };
    case "mac_messages_send": {
      const files = fileList(a.files);
      const text = str(a.text, "text", { max: 4_000, required: !files, multiline: true });
      if (a.service !== undefined && a.service !== null && !["iMessage", "SMS", "auto"].includes(a.service)) bad("service is iMessage, SMS or auto");
      const service = a.service === "iMessage" || a.service === "SMS" ? a.service : undefined;
      if (files && service === "SMS") bad("A file goes by iMessage, not SMS");
      const chat = str(a.chat, "chat", { max: 300 });
      if (chat !== undefined) {
        if (a.to !== undefined && a.to !== null && a.to !== "") bad("give to or chat, not both");
        return without({ chat, text, files });
      }
      const to = str(a.to, "to", { max: 320, required: true });
      if (!RECIPIENT.test(to)) bad("to must be one phone number or email");
      return without({ to, text, files, service });
    }
    case "mac_mail_list_mailboxes":
      return without({ account: str(a.account, "account", { max: 200 }) });
    case "mac_mail_search": {
      const since = date(a.since, "since");
      const until = date(a.until, "until");
      if (since && until && Date.parse(until) <= Date.parse(since)) bad("until must be after since");
      return without({
        mailbox: str(a.mailbox, "mailbox", { max: 500 }), account: str(a.account, "account", { max: 200 }),
        query: str(a.query, "query", { max: 200 }) ?? "", from: str(a.from, "from", { max: 200 }), since, until,
        unread: optBool(a.unread), flagged: optBool(a.flagged), inBody: a.inBody === true, limit: num(a.limit, 10, 50), offset: cursor(a.cursor ?? a.offset),
      });
    }
    case "mac_mail_read":
      return { id: mailIdArg(a.id), offset: cursor(a.offset), headers: a.headers === true };
    case "mac_mail_read_attachment":
      return { id: mailIdArg(a.id), index: attachmentIndexArg(a.index) };
    case "mac_mail_update": {
      const op = without({ ids: mailIdList(a.ids), read: optBool(a.read), flagged: optBool(a.flagged), flagColor: flagColor(a.flagColor), junk: optBool(a.junk) });
      if (Object.keys(op).length === 1) bad("nothing to change: give read, flagged, flagColor or junk");
      return op;
    }
    case "mac_mail_move": {
      const to = str(a.to, "to", { max: 20 });
      if (to !== undefined && !["archive", "inbox", "junk"].includes(to)) bad("to is archive, inbox or junk");
      const mailbox = str(a.mailbox, "mailbox", { max: 500 });
      if (!to && !mailbox) bad("give a mailbox or to");
      return without({ ids: mailIdList(a.ids), ...(to ? { to } : { mailbox, account: str(a.account, "account", { max: 200 }) }) });
    }
    case "mac_mail_delete":
      return { ids: mailIdList(a.ids) };
    case "mac_mail_send":
      return without({
        to: addresses(a.to, "to", true),
        cc: addresses(a.cc, "cc", false),
        bcc: addresses(a.bcc, "bcc", false),
        from: sender(a.from),
        subject: str(a.subject, "subject", { max: 500, required: true }),
        body: str(a.body, "body", { max: 100_000, required: true, multiline: true }),
        files: fileList(a.files),
      });
    case "mac_mail_reply":
      return without({ id: mailIdArg(a.id), body: str(a.body, "body", { max: 100_000, required: true, multiline: true }), all: a.all === true, files: fileList(a.files) });
    case "mac_mail_forward":
      return without({ id: mailIdArg(a.id), to: addresses(a.to, "to", true), cc: addresses(a.cc, "cc", false), body: str(a.body, "body", { max: 100_000, multiline: true }) });
    case "mac_mail_create_draft": {
      const replyTo = a.replyTo === undefined || a.replyTo === null || a.replyTo === "" ? undefined : mailIdArg(a.replyTo, "replyTo");
      return without({
        to: addresses(a.to, "to", false), cc: addresses(a.cc, "cc", false), bcc: addresses(a.bcc, "bcc", false), from: sender(a.from),
        subject: str(a.subject, "subject", { max: 500, required: replyTo === undefined }), body: str(a.body, "body", { max: 100_000, required: true, multiline: true }),
        replyTo, all: replyTo !== undefined && a.all === true ? true : undefined, files: fileList(a.files),
      });
    }
    case "mac_mail_list_rules":
    case "mac_calendar_list_calendars":
    case "mac_contacts_list_groups":
    case "mac_reminders_list_lists":
    case "mac_notes_list_folders":
      return {};
    case "mac_mail_update_rule":
      if (typeof a.enabled !== "boolean") bad("enabled must be true or false");
      return { name: nameArg(a.name), enabled: a.enabled };
    case "mac_calendar_list": {
      const from = date(a.from, "from") ?? new Date().toISOString();
      const to = date(a.to, "to") ?? new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
      if (Date.parse(to) <= Date.parse(from)) bad("to must be after from");
      if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) bad("A range is at most one year");
      return without({ from, to, calendar: str(a.calendar, "calendar", { max: 200 }), query: str(a.query, "query", { max: 200 }), limit: num(a.limit, 50, 200), offset: cursor(a.cursor ?? a.offset) });
    }
    case "mac_calendar_read":
      return { id: idArg(a.id) };
    case "mac_calendar_create": {
      const start = date(a.start, "start", true);
      const end = date(a.end, "end", true);
      if (Date.parse(end) < Date.parse(start)) bad("end must not be before start");
      return without({
        title: str(a.title, "title", { max: 500, required: true }), start, end,
        calendar: str(a.calendar, "calendar", { max: 200 }), location: str(a.location, "location", { max: 500 }),
        notes: str(a.notes, "notes", { max: 20_000, multiline: true }), url: str(a.url, "url", { max: 2_000 }), allDay: a.allDay === true,
        alarms: alarmList(a.alarms), repeat: rrule(a.repeat) || undefined,
      });
    }
    case "mac_calendar_update": {
      const start = date(a.start, "start");
      const end = date(a.end, "end");
      if (start && end && Date.parse(end) < Date.parse(start)) bad("end must not be before start");
      const op = without({
        id: idArg(a.id), title: str(a.title, "title", { max: 500 }), start, end,
        location: a.location === "" ? "" : str(a.location, "location", { max: 500 }), notes: a.notes === "" ? "" : str(a.notes, "notes", { max: 20_000, multiline: true }),
        url: a.url === "" ? "" : str(a.url, "url", { max: 2_000 }), allDay: optBool(a.allDay), alarms: alarmList(a.alarms), repeat: rrule(a.repeat),
        calendar: str(a.calendar, "calendar", { max: 200 }),
      });
      if (Object.keys(op).length === 1) bad("nothing to change");
      return without({ ...op, scope: scopeArg(a.scope) });
    }
    case "mac_calendar_delete":
      return without({ ids: idList(a.ids), scope: scopeArg(a.scope) });
    case "mac_contacts_delete":
    case "mac_reminders_delete":
    case "mac_notes_delete":
      return { ids: idList(a.ids) };
    case "mac_calendar_create_calendar":
    case "mac_reminders_create_list":
    case "mac_calendar_delete_calendar":
    case "mac_reminders_delete_list":
    case "mac_notes_delete_folder":
      return { name: nameArg(a.name) };
    case "mac_calendar_update_calendar":
    case "mac_reminders_update_list":
    case "mac_notes_update_folder":
      return { name: nameArg(a.name), newName: nameArg(a.newName, "newName") };
    case "mac_contacts_search":
      return { query: str(a.query, "query", { max: 200, required: true }), limit: num(a.limit, 10, 50), offset: cursor(a.cursor ?? a.offset) };
    case "mac_contacts_read":
      if (a.me === true) return { me: true };
      return { id: idArg(a.id) };
    case "mac_contacts_create": {
      const op = contactOp(a);
      if (!op.firstName && !op.lastName && !op.organization) bad("give a firstName, a lastName or an organization");
      return op;
    }
    case "mac_contacts_update": {
      const op = { id: idArg(a.id), ...contactOp(a) };
      if (Object.keys(op).length === 1) bad("nothing to change");
      return op;
    }
    case "mac_contacts_create_group":
      return { name: nameArg(a.name) };
    case "mac_contacts_update_group": {
      const op = without({ id: idArg(a.id), name: str(a.name, "name", { max: 200 }), add: idList(a.add, "add", { required: false }), remove: idList(a.remove, "remove", { required: false }) });
      if (Object.keys(op).length === 1) bad("nothing to change: give name, add or remove");
      return op;
    }
    case "mac_contacts_delete_group":
      return { id: idArg(a.id) };
    case "mac_reminders_list": {
      const dueFrom = date(a.dueFrom, "dueFrom");
      const dueTo = date(a.dueTo, "dueTo");
      return without({ list: str(a.list, "list", { max: 200 }), includeCompleted: a.includeCompleted === true, query: str(a.query, "query", { max: 200 }), dueFrom, dueTo, limit: num(a.limit, 50, 200), offset: cursor(a.cursor ?? a.offset) });
    }
    case "mac_reminders_create":
      return without({ title: str(a.title, "title", { max: 500, required: true }), notes: str(a.notes, "notes", { max: 20_000, multiline: true }), due: date(a.due, "due"), dueAllDay: dayOnly(a.due) ?? (a.dueAllDay === true && a.due ? true : undefined), remind: date(a.remind, "remind"), priority: priority(a.priority), list: str(a.list, "list", { max: 200 }) });
    case "mac_reminders_update": {
      const op = without({
        id: idArg(a.id), title: str(a.title, "title", { max: 500 }), notes: a.notes === "" ? "" : str(a.notes, "notes", { max: 20_000, multiline: true }),
        due: clearableDate(a.due, "due"), dueAllDay: dayOnly(a.due) ?? (a.dueAllDay === true && a.due ? true : undefined), remind: clearableDate(a.remind, "remind"), priority: priority(a.priority), list: str(a.list, "list", { max: 200 }),
      });
      if (Object.keys(op).length === 1) bad("nothing to change");
      return op;
    }
    case "mac_reminders_complete":
      return { ids: idList(a.ids), completed: a.completed !== false };
    case "mac_notes_search":
      return without({ query: str(a.query, "query", { max: 200 }) ?? "", folder: str(a.folder, "folder", { max: 200 }), limit: num(a.limit, 10, 50), offset: cursor(a.cursor ?? a.offset) });
    case "mac_notes_read":
      if (a.format !== undefined && a.format !== "text" && a.format !== "html") bad("format is text or html");
      return { id: idArg(a.id), offset: cursor(a.offset), format: a.format === "html" ? "html" : "text" };
    case "mac_notes_create":
      return { title: str(a.title, "title", { max: 500, required: true }), body: str(a.body, "body", { max: 100_000, required: true, multiline: true }), folder: str(a.folder, "folder", { max: 200 }) };
    case "mac_notes_update": {
      if (a.mode !== undefined && a.mode !== "append" && a.mode !== "replace") bad("mode is append or replace");
      const op = without({ id: idArg(a.id), body: str(a.body, "body", { max: 100_000, multiline: true }), title: str(a.title, "title", { max: 500 }) });
      if (!op.body && !op.title) bad("give a body or a title");
      return { ...op, mode: a.mode === "replace" ? "replace" : "append", force: a.force === true };
    }
    case "mac_notes_move":
      return { ids: idList(a.ids), folder: nameArg(a.folder, "folder") };
    case "mac_notes_create_folder":
      return without({ name: nameArg(a.name), account: str(a.account, "account", { max: 200 }) });
    case "mac_photos_list_albums":
      return { limit: num(a.limit, 100, 200), offset: cursor(a.cursor ?? a.offset) };
    case "mac_photos_search": {
      const from = date(a.from, "from");
      const to = date(a.to, "to");
      if (from && to && Date.parse(to) <= Date.parse(from)) bad("to must be after from");
      return without({
        query: str(a.query, "query", { max: 200 }), person: str(a.person, "person", { max: 200 }), place: str(a.place, "place", { max: 200 }),
        album: str(a.album, "album", { max: 300 }), from, to, keyword: str(a.keyword, "keyword", { max: 200 }), favorite: optBool(a.favorite),
        limit: num(a.limit, 30, 100), offset: cursor(a.cursor ?? a.offset),
      });
    }
    case "mac_photos_read":
      return { ids: idList(a.ids), offset: cursor(a.cursor ?? a.offset) };
    case "mac_photos_export": {
      if (a.maxSize !== undefined && a.maxSize !== null && (typeof a.maxSize !== "number" || !Number.isFinite(a.maxSize) || a.maxSize < 256 || a.maxSize > 8192)) bad("maxSize is a number of pixels from 256 to 8192");
      return { ids: idList(a.ids), original: a.original === true, maxSize: typeof a.maxSize === "number" ? Math.round(a.maxSize) : PHOTO_EXPORT_MAX_SIZE, offset: cursor(a.cursor ?? a.offset) };
    }
    case "mac_photos_create_album":
      return without({ name: nameArg(a.name), folder: str(a.folder, "folder", { max: 200 }), ids: idList(a.ids, "ids", { required: false }) });
    case "mac_photos_add_to_album":
      return { album: str(a.album, "album", { max: 300, required: true }), ids: idList(a.ids) };
    default:
      return bad(`unknown tool ${name}`);
  }
}

const counted = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const emailCount = (n) => counted(n, "email");
const countOf = (a) => (Array.isArray(a.ids) ? a.ids.length : a.id !== undefined ? 1 : 0);

/** One-line summary for an approval card or a log: the verb, a count and the
 * recipients or the mailbox, never the content. */
export function macAppTarget(name, args) {
  const a = args ?? {};
  const list = (value) => (Array.isArray(value) ? value : []);
  const withFiles = list(a.files).length ? `, with ${counted(list(a.files).length, "file")}` : "";
  switch (name) {
    // A conversation by its name or members (chatLabel, filled by the caller
    // from Messages); its chat id is never shown.
    case "mac_messages_send": return `${a.chat !== undefined && a.to === undefined ? `Messages to ${typeof a.chatLabel === "string" && a.chatLabel.trim() ? a.chatLabel.trim().slice(0, 200) : "a conversation"}` : `Messages to ${a.to ?? ""}`}${withFiles}`;
    case "mac_mail_create_draft": return `Mail: save a draft${a.replyTo !== undefined ? ` reply${a.all === true ? " to all" : ""}` : ""}${list(a.to).length ? ` to ${list(a.to).join(", ")}` : ""}${withFiles}`;
    case "mac_mail_update_rule": return `Mail: turn ${a.enabled === false ? "off" : "on"} the rule "${a.name ?? ""}"`;
    case "mac_calendar_update": return `Calendar: change ${counted(countOf(a), "event")}${a.calendar ? ` (to ${a.calendar})` : ""}${a.scope === "this" ? ", this occurrence" : a.scope === "future" ? ", this and later occurrences" : a.scope === "all" ? ", the whole series" : ""}`;
    case "mac_calendar_delete": return `Calendar: delete ${counted(countOf(a), "event")}${a.scope === "this" ? ", this occurrence" : a.scope === "future" ? ", this and later occurrences" : a.scope === "all" ? ", the whole series" : ""}`;
    case "mac_calendar_create_calendar": return `Calendar: create the calendar "${a.name ?? ""}"`;
    case "mac_calendar_update_calendar": return `Calendar: rename "${a.name ?? ""}" to "${a.newName ?? ""}"`;
    case "mac_calendar_delete_calendar": return `Calendar: delete the calendar "${a.name ?? ""}"`;
    case "mac_contacts_create": return `Contacts: create a card for ${[a.firstName, a.lastName].filter(Boolean).join(" ") || a.organization || ""}`.trim();
    case "mac_contacts_update": return `Contacts: change ${counted(countOf(a), "card")}`;
    case "mac_contacts_delete": return `Contacts: delete ${counted(countOf(a), "card")}`;
    case "mac_contacts_create_group": return `Contacts: create the group "${a.name ?? ""}"`;
    case "mac_contacts_update_group": {
      const parts = [...(a.name ? [`rename to "${a.name}"`] : []), ...(list(a.add).length ? [`add ${counted(list(a.add).length, "card")}`] : []), ...(list(a.remove).length ? [`remove ${counted(list(a.remove).length, "card")}`] : [])];
      return `Contacts: group, ${parts.join(", ")}`;
    }
    case "mac_contacts_delete_group": return "Contacts: delete a group";
    case "mac_reminders_update": return `Reminders: change ${counted(countOf(a), "reminder")}${a.list ? ` (to ${a.list})` : ""}`;
    case "mac_reminders_complete": return `Reminders: mark ${counted(countOf(a), "reminder")} ${a.completed === false ? "not done" : "done"}`;
    case "mac_reminders_delete": return `Reminders: delete ${counted(countOf(a), "reminder")}`;
    case "mac_reminders_create_list": return `Reminders: create the list "${a.name ?? ""}"`;
    case "mac_reminders_update_list": return `Reminders: rename "${a.name ?? ""}" to "${a.newName ?? ""}"`;
    case "mac_reminders_delete_list": return `Reminders: delete the list "${a.name ?? ""}"`;
    case "mac_notes_update": return `Notes: ${a.mode === "replace" ? "replace" : a.body ? "add to" : "rename"} ${counted(countOf(a), "note")}`;
    case "mac_notes_move": return `Notes: move ${counted(countOf(a), "note")} to ${a.folder ?? ""}`;
    case "mac_notes_delete": return `Notes: delete ${counted(countOf(a), "note")}`;
    case "mac_notes_create_folder": return `Notes: create the folder "${a.name ?? ""}"`;
    case "mac_notes_update_folder": return `Notes: rename "${a.name ?? ""}" to "${a.newName ?? ""}"`;
    case "mac_notes_delete_folder": return `Notes: delete the folder "${a.name ?? ""}"`;
    case "mac_photos_create_album": return `Photos: create the album "${a.name ?? ""}"${list(a.ids).length ? `, with ${counted(list(a.ids).length, "photo")}` : ""}`;
    case "mac_photos_add_to_album": return `Photos: add ${counted(list(a.ids).length, "photo")} to ${typeof a.album === "string" && !PHOTOS_ID.test(a.album) ? `"${a.album}"` : "an album"}`;
    case "mac_mail_send":
      return [`Mail to ${list(a.to).join(", ")}`, ...(list(a.cc).length ? [`cc ${list(a.cc).join(", ")}`] : []), ...(list(a.bcc).length ? [`bcc ${list(a.bcc).join(", ")}`] : [])].join(", ") + withFiles;
    case "mac_mail_reply": return `Mail: reply${a.all === true ? " to all" : ""} on ${emailCount(countOf(a))}${withFiles}`;
    case "mac_mail_forward": return `Mail: forward ${emailCount(countOf(a))} to ${list(a.to).join(", ")}`;
    case "mac_mail_delete": return `Mail: delete ${emailCount(countOf(a))}`;
    case "mac_mail_move":
      return a.to === "archive" ? `Mail: archive ${emailCount(countOf(a))}` : `Mail: move ${emailCount(countOf(a))} to ${a.to ?? a.mailbox ?? ""}`;
    case "mac_mail_update": {
      const changes = [
        ...(a.read === true ? ["read"] : a.read === false ? ["unread"] : []),
        ...(a.flagged === true || (a.flagColor !== undefined && a.flagged !== false) ? ["flagged"] : a.flagged === false ? ["unflagged"] : []),
        ...(a.junk === true ? ["junk"] : a.junk === false ? ["not junk"] : []),
      ];
      return `Mail: mark ${emailCount(countOf(a))} ${changes.join(", ")}`.trim();
    }
    case "mac_calendar_create": return `Calendar event "${a.title ?? ""}"`;
    case "mac_reminders_create": return `Reminder "${a.title ?? ""}"`;
    case "mac_notes_create": return `Note "${a.title ?? ""}"`;
    default: return name;
  }
}

/** What a script gets: the operation, with Mail ids decoded to
 * { account, mailbox, n } (`ref`, `refs`). */
export function macAppScriptArgs(name, op) {
  if (!op || typeof op !== "object") return op;
  const { id, ids, replyTo, ...rest } = op;
  const app = macAppOfTool(name);
  if (app === "calendar" && (id !== undefined || ids !== undefined)) {
    return { ...rest, ...(id !== undefined ? { ref: calendarRef(id) } : {}), ...(ids !== undefined ? { refs: ids.map(calendarRef) } : {}) };
  }
  if (app !== "mail" || (id === undefined && ids === undefined && replyTo === undefined)) return op;
  return { ...rest, ...(id !== undefined ? { ref: parseMailId(id) } : {}), ...(ids !== undefined ? { refs: ids.map(parseMailId) } : {}), ...(replyTo !== undefined ? { replyRef: parseMailId(replyTo) } : {}) };
}

/** A Mail script names a message by `ref: [account, mailbox, number]`; the
 * bot gets the opaque id instead. A `next` offset becomes a cursor string. */
function mailResult(value) {
  if (Array.isArray(value)) return value.map(mailResult);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "ref" && Array.isArray(item) && item.length === 3) out.id = mailId(item[0], item[1], item[2]);
    else if (key === "next" && typeof item === "number") out.next = String(item);
    else out[key] = mailResult(item);
  }
  return out;
}

// --- JXA. Constant text: the only input is argv[0], a JSON object. ---------
/** 2026-11-17: an Apple app answers one Apple Event per item, so a large
 * mailbox, calendar, reminder list, notes folder or address book took past the
 * script's 60 s and the call failed with nothing. Every list or search stops
 * collecting at this budget and answers with what it has: a next cursor where
 * the tool pages, else a partial note; per-item extras (previews, counts) are
 * skipped past half of it. */
export const MAC_APP_BUDGET_MS = 25_000;
const HALF = MAC_APP_BUDGET_MS / 2;
const PARTIAL = "The app was slow, so this list stopped early: what it shows is right, the rest is missing. Ask again in a moment for the rest.";
const PRELUDE = "function run(argv){var a=JSON.parse(argv[0]);var out=main(a);return JSON.stringify(out===undefined?null:out);}\n"
  + "var T0=Date.now();function late(ms){return Date.now()-T0>ms}\n"
  + "function iso(d){try{return d?d.toISOString():null}catch(e){return null}}\n"
  + "function cut(s,n){s=s==null?'':String(s);return s.length>n?s.slice(0,n)+'...':s}\n"
  + "function eachOf(ids,fn){var done=0,failed=[];for(var i=0;i<ids.length;i++){try{fn(ids[i]);done++}catch(e){failed.push({id:ids[i],error:String(e&&e.message||e)})}}return {done:done,failed:failed}}\n";

// Mail's dictionary helpers, shared by every Mail script. A mailbox is named
// by its path (a nested one as Parent/Child) inside an account; the app-level
// mailboxes (inbox, drafts, sent, trash, junk, outbox) when no account is given.
const MAIL_LIB = `var Mail=Application('Mail');
var STOP=false;
var SPECIAL={inbox:'inbox',drafts:'draftsMailbox',sent:'sentMailbox',trash:'trashMailbox',junk:'junkMailbox',outbox:'outbox'};
var KIND={inbox:['inbox','boîte de réception','posteingang','bandeja de entrada','posta in arrivo','caixa de entrada','postvak in','inkorgen','受信','收件箱'],junk:['junk','spam','junk e-mail','junk email','bulk mail','courrier indésirable','indésirables','pourriel','spam-verdacht','junk-e-mail','correo no deseado','posta indesiderata','lixo eletrônico','迷惑メール','垃圾邮件','垃圾郵件'],archive:['archive','archives','all mail','archiv','archivo','archivio','arquivo','arquivar','archief','arkiv','アーカイブ','归档','歸檔','封存']};
function walk(acct,visit){var seen={};function go(list,prefix,d){for(var i=0;i<list.length;i++){if(STOP)return;var b=list[i];var nm='';try{nm=b.name()}catch(e){continue}
var p=prefix&&nm.indexOf(prefix+'/')!==0?prefix+'/'+nm:nm;if(!seen[p]){seen[p]=1;visit(p,b)}
if(d<6){var kids=[];try{kids=b.mailboxes()}catch(e){}if(kids.length)go(kids,p,d+1)}}}
go(acct?acct.mailboxes():Mail.mailboxes(),'',0)}
function names(acct){var out=[];walk(acct,function(p){if(out.length<500)out.push(p)});return out}
function touch(b){b.name();return b}
function findIn(acct,path){var root=acct||Mail;try{return touch(root.mailboxes.byName(path))}catch(e){}
var parts=path.split('/');if(parts.length>1){try{var c=root.mailboxes.byName(parts[0]);for(var i=1;i<parts.length;i++)c=c.mailboxes.byName(parts[i]);return touch(c)}catch(e){}}
var hit=null;walk(acct,function(p,b){if(!hit&&(p===path||p.split('/').pop()===parts[parts.length-1]))hit=b});return hit}
function acctNamed(n){var l=Mail.accounts();for(var i=0;i<l.length;i++){if(l[i].name()===n)return l[i]}throw new Error('No Mail account named '+n)}
function acctOf(m){try{return m.mailbox().account()}catch(e){return null}}
function kindBox(acct,kind){var hit=null;walk(acct,function(p,b){if(hit)return;var low=p.toLowerCase();var leaf=low.split('/').pop();if(KIND[kind].indexOf(low)>=0||KIND[kind].indexOf(leaf)>=0)hit=b});return hit}
function boxFor(account,mailbox){var key=String(mailbox||'').toLowerCase();
if(!account){if(!mailbox)return Mail.inbox;if(SPECIAL[key])return Mail[SPECIAL[key]];var b=findIn(null,mailbox);if(b)return b;
var l=Mail.accounts();for(var i=0;i<l.length;i++){b=findIn(l[i],mailbox);if(b)return b}throw new Error('No mailbox named '+mailbox+'. mac_mail_list_mailboxes gives the names.')}
var acct=acctNamed(account);if(!mailbox)key='inbox';var box=mailbox?findIn(acct,mailbox):null;if(!box&&key==='inbox')box=inboxOf(account);if(!box&&KIND[key])box=kindBox(acct,key);
if(!box)throw new Error((mailbox?'No mailbox named '+mailbox:'No inbox found')+' in '+account+'. Its mailboxes: '+names(acct).join(', '));return box}
function inboxOf(account){var l=[];try{l=Mail.inbox.mailboxes()}catch(e){}for(var i=0;i<l.length;i++){try{if(l[i].account().name()===account)return l[i]}catch(e){}}return null}
function refOf(m){var b=m.mailbox();var bn=b.name();var an='';try{an=b.account().name()}catch(e){}return [an,bn,m.id()]}
function msgFor(r){if(r.mailbox){var b=findIn(r.account?acctNamed(r.account):null,r.mailbox);if(!b)throw new Error('No mailbox named '+r.mailbox+'. Search again.');
try{var m=b.messages.byId(r.n);m.subject();return m}catch(e){}var f=b.messages.whose({id:r.n})();if(f.length)return f[0];throw new Error('That email is no longer in '+r.mailbox+'. Search again.')}
var found=Mail.inbox.messages.whose({id:r.n})();if(!found.length){var accts=Mail.accounts();for(var i=0;i<accts.length&&!found.length;i++){var boxes=accts[i].mailboxes();
for(var j=0;j<boxes.length&&!found.length;j++){try{found=boxes[j].messages.whose({id:r.n})()}catch(e){}}}}
if(!found.length)throw new Error('No email with that id');return found[0]}
function each(refs,fn){var done=0,failed=[];for(var i=0;i<refs.length;i++){var r=refs[i];try{fn(msgFor(r));done++}catch(e){
var f=r.mailbox?{ref:[r.account||'',r.mailbox,r.n]}:{id:r.n};f.error=String(e&&e.message||e);if(e&&e.mailboxes)f.mailboxes=e.mailboxes;failed.push(f)}}return {done:done,failed:failed}}
function moveTo(m,box){try{Mail.move(m,{to:box})}catch(e){m.mailbox=box}}
function addrs(o,k){try{return o[k]().map(function(x){return x.address()})}catch(e){return []}}
function wantAddress(s){var lt=s.lastIndexOf('<');return (lt>=0?s.slice(lt+1,s.indexOf('>',lt)):s).trim().toLowerCase()}
function compose(a){var p={subject:a.subject,content:a.body,visible:false};
if(a.from){var want=wantAddress(a.from);var all=[];Mail.accounts().forEach(function(x){try{x.emailAddresses().forEach(function(e){all.push(String(e))})}catch(e){}});
if(!all.some(function(e){return e.toLowerCase()===want}))throw new Error('from must be one of the addresses in Mail: '+all.join(', '));p.sender=a.from}
var msg=Mail.OutgoingMessage(p);Mail.outgoingMessages.push(msg);
(a.to||[]).forEach(function(x){msg.toRecipients.push(Mail.Recipient({address:x}))});
(a.cc||[]).forEach(function(x){msg.ccRecipients.push(Mail.CcRecipient({address:x}))});
(a.bcc||[]).forEach(function(x){msg.bccRecipients.push(Mail.BccRecipient({address:x}))});return msg}
function attach(msg,files){if(!files||!files.length)return;files.forEach(function(f){var x=Mail.Attachment({fileName:Path(f)});try{msg.attachments.push(x)}catch(e){msg.content.attachments.push(x)}});
if(typeof delay==='function')delay(1)}
function replyOf(a,ref){var m=msgFor(ref);var r=Mail.reply(m,{openingWindow:false,replyToAll:a.all===true});
var quoted='';try{quoted=String(r.content()||'')}catch(e){}r.content=a.body+(quoted?'\\n\\n'+quoted:'');attach(r,a.files);return r}
`;
const MAIL = PRELUDE + MAIL_LIB;
const MAIL_SCRIPTS = {
  mac_mail_list_mailboxes: MAIL + `function boxes(acct){var out=[];walk(acct,function(p,b){if(out.length>=500)return;if(late(${MAC_APP_BUDGET_MS})){STOP=true;return}var o={name:p,unread:null};if(!late(${HALF})){try{o.unread=b.unreadCount()}catch(e){}}out.push(o)});return out}
function main(a){var out=[];var l=Mail.accounts();for(var i=0;i<l.length;i++){var x=l[i];var nm=x.name();if(a.account&&nm!==a.account)continue;
var o={name:nm,enabled:true,emails:[],mailboxes:boxes(x)};try{o.enabled=x.enabled()}catch(e){}try{o.emails=x.emailAddresses()}catch(e){}out.push(o)}
if(a.account&&!out.length)throw new Error('No Mail account named '+a.account);var r={accounts:out};
if(!a.account){var local=boxes(null);if(local.length)r.onMyMac=local;try{r.inboxUnread=Mail.inbox.unreadCount()}catch(e){}}
if(STOP)r.partial='Mail was slow: this list stopped early. Ask again for one account (account) to get all of its mailboxes.';return r;}`,
  mac_mail_search: MAIL + `function summary(m,preview){var r=refOf(m);var o={ref:r,account:r[0],mailbox:r[1],subject:cut(m.subject(),300),sender:cut(m.sender(),300),date:iso(m.dateReceived()),read:m.readStatus(),flagged:false,preview:null};
try{o.flagged=m.flaggedStatus()}catch(e){}if(preview){try{o.preview=cut(m.content(),200)}catch(e){}}return o}
function main(a){var box=boxFor(a.account,a.mailbox);var c=[];
if(a.query){var q=[{subject:{_contains:a.query}},{sender:{_contains:a.query}}];if(a.inBody)q.push({content:{_contains:a.query}});c.push({_or:q})}
if(a.from)c.push({sender:{_contains:a.from}});if(a.since)c.push({dateReceived:{_greaterThanEquals:new Date(a.since)}});if(a.until)c.push({dateReceived:{_lessThan:new Date(a.until)}});
if(a.unread===true)c.push({readStatus:false});if(a.unread===false)c.push({readStatus:true});if(a.flagged===true)c.push({flaggedStatus:true});if(a.flagged===false)c.push({flaggedStatus:false});
var list=c.length===0?box.messages:c.length===1?box.messages.whose(c[0]):box.messages.whose({_and:c});
var total=list.length;var end=Math.min(total,a.offset+a.limit);var out=[];
for(var i=a.offset;i<end;i++){if(out.length&&late(${MAC_APP_BUDGET_MS})){end=i;break}out.push(summary(list[i],!late(${HALF})))}
var r={messages:out};if(end<total)r.next=end;return r;}`,
  mac_mail_read: MAIL + `function main(a){var m=msgFor(a.ref);var r=refOf(m);var body='';try{body=String(m.content()||'')}catch(e){}
var att=[];try{var l=m.mailAttachments();for(var i=0;i<l.length;i++){var x=l[i];var o={index:i,name:null,mime:null,bytes:null,downloaded:null};
try{o.name=x.name()}catch(e){}try{o.mime=x.mimeType()}catch(e){}try{o.bytes=x.fileSize()}catch(e){}try{o.downloaded=x.downloaded()}catch(e){}att.push(o)}}catch(e){}
var out={ref:r,account:r[0],mailbox:r[1],subject:m.subject(),sender:m.sender(),to:addrs(m,'toRecipients'),cc:addrs(m,'ccRecipients'),replyTo:null,
date:iso(m.dateReceived()),sent:null,read:m.readStatus(),flagged:false,attachments:att,content:body.slice(a.offset,a.offset+20000),offset:a.offset,length:body.length,truncated:a.offset+20000<body.length};
try{out.replyTo=m.replyTo()}catch(e){}try{out.sent=iso(m.dateSent())}catch(e){}try{out.flagged=m.flaggedStatus()}catch(e){}
if(out.truncated)out.nextOffset=a.offset+20000;if(a.headers){try{out.headers=cut(m.allHeaders(),20000)}catch(e){}}return out;}`,
  mac_mail_read_attachment: MAIL + `function main(a){var m=msgFor(a.ref);var l=m.mailAttachments();if(a.index>=l.length)throw new Error('That email has '+l.length+' attachment(s). mac_mail_read lists them.');
var x=l[a.index];var name='attachment';try{name=String(x.name()||name)}catch(e){}var o={name:name,mime:null,bytes:null};try{o.mime=x.mimeType()}catch(e){}try{o.bytes=x.fileSize()}catch(e){}
var safe=name.replace(/[\\/:\\u0000-\\u001f]/g,'_').replace(/^\\.+/,'_').slice(0,180)||'attachment';var target=a.dir+'/'+a.prefix+safe;
try{Mail.save(x,{in:Path(target)})}catch(e){x.save({in:Path(target)})}o.path=target;return o;}`,
  mac_mail_update: MAIL + `function main(a){var res=each(a.refs,function(m){
if(a.read!==undefined)m.readStatus=a.read;
if(a.flagColor!==undefined&&a.flagged!==false)m.flagIndex=a.flagColor;else if(a.flagged!==undefined)m.flaggedStatus=a.flagged;
if(a.junk!==undefined){m.junkMailStatus=a.junk;var acct=acctOf(m);if(acct){var junk=kindBox(acct,'junk');
if(a.junk){if(junk)moveTo(m,junk)}else if(junk&&m.mailbox().name()===junk.name()){var inbox=kindBox(acct,'inbox');if(inbox)moveTo(m,inbox)}}}});
return {updated:res.done,failed:res.failed};}`,
  mac_mail_move: MAIL + `function main(a){var res=each(a.refs,function(m){var target=null;
if(a.to){var acct=acctOf(m);target=acct?kindBox(acct,a.to):null;if(!target){var e=new Error((acct?acct.name():'This mailbox')+' has no '+a.to+' mailbox. Move by name to one of its mailboxes.');e.mailboxes=acct?names(acct):names(null);throw e}
if(a.to==='junk'){try{m.junkMailStatus=true}catch(x){}}}
else{if(a.account)target=findIn(acctNamed(a.account),a.mailbox);else{var own=acctOf(m);target=(own&&findIn(own,a.mailbox))||findIn(null,a.mailbox)}
if(!target)throw new Error('No mailbox named '+a.mailbox+'. mac_mail_list_mailboxes gives the names.')}
moveTo(m,target)});return {moved:res.done,failed:res.failed};}`,
  mac_mail_delete: MAIL + `function main(a){var res=each(a.refs,function(m){Mail.delete(m)});return {deleted:res.done,failed:res.failed};}`,
  mac_mail_send: MAIL + `function main(a){var msg=compose(a);attach(msg,a.files);msg.send();return {sent:true,to:a.to,cc:a.cc||[],bcc:a.bcc||[],files:(a.files||[]).length};}`,
  mac_mail_create_draft: MAIL + `function main(a){if(a.replyRef){var r=replyOf(a,a.replyRef);(a.to||[]).forEach(function(x){r.toRecipients.push(Mail.Recipient({address:x}))});(a.cc||[]).forEach(function(x){r.ccRecipients.push(Mail.CcRecipient({address:x}))});(a.bcc||[]).forEach(function(x){r.bccRecipients.push(Mail.BccRecipient({address:x}))});
r.save();return {saved:true,mailbox:'Drafts',reply:true,to:addrs(r,'toRecipients')}}
var msg=compose(a);attach(msg,a.files);msg.save();return {saved:true,mailbox:'Drafts',to:a.to||[]};}`,
  mac_mail_list_rules: MAIL + `function main(a){var out=[];Mail.rules().forEach(function(r){var o={name:null,enabled:null};try{o.name=r.name()}catch(e){}try{o.enabled=r.enabled()}catch(e){}out.push(o)});return {rules:out};}`,
  mac_mail_update_rule: MAIL + `function main(a){var hit=null;Mail.rules().forEach(function(r){try{if(!hit&&r.name()===a.name)hit=r}catch(e){}});
if(!hit)throw new Error('No Mail rule named '+a.name+'. mac_mail_list_rules gives the names.');hit.enabled=a.enabled;return {updated:true,name:a.name,enabled:a.enabled};}`,
  mac_mail_reply: MAIL + `function main(a){var r=replyOf(a,a.ref);
var to=addrs(r,'toRecipients');var cc=addrs(r,'ccRecipients');r.send();return {sent:true,to:to,cc:cc,all:a.all,files:(a.files||[]).length};}`,
  mac_mail_forward: MAIL + `function main(a){var m=msgFor(a.ref);var f=Mail.forward(m,{openingWindow:false});
a.to.forEach(function(x){f.toRecipients.push(Mail.Recipient({address:x}))});(a.cc||[]).forEach(function(x){f.ccRecipients.push(Mail.CcRecipient({address:x}))});
if(a.body){var quoted='';try{quoted=String(f.content()||'')}catch(e){}f.content=a.body+(quoted?'\\n\\n'+quoted:'')}
f.send();return {sent:true,to:a.to,cc:a.cc||[]};}`,
};

/**
 * The starts of a repeating event's occurrences in [from, to), from its RFC
 * 5545 rule (without RRULE:), in the Mac's own time zone (wall-clock times
 * kept across a clock change). `excluded`: starts removed from the series.
 * Null when the rule uses a part this does not compute (BYSETPOS, hourly and
 * the like). Plain ES5: the Calendar scripts embed its source.
 */
export function occurrences(rule, start, from, to, max, excluded) {
  var p = {};
  String(rule || "").replace(/^RRULE:/i, "").split(";").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).toUpperCase(); });
  var KNOWN = { FREQ: 1, INTERVAL: 1, COUNT: 1, UNTIL: 1, BYDAY: 1, BYMONTHDAY: 1, BYMONTH: 1, WKST: 1 };
  for (var key in p) if (!KNOWN[key]) return null;
  var freq = p.FREQ;
  if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].indexOf(freq) < 0) return null;
  var DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  var interval = Math.max(1, parseInt(p.INTERVAL || "1", 10) || 1);
  var count = p.COUNT ? parseInt(p.COUNT, 10) : 0;
  var until = null;
  if (p.UNTIL) {
    var u = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(p.UNTIL);
    if (!u) return null;
    until = u[4] === undefined ? new Date(+u[1], +u[2] - 1, +u[3], 23, 59, 59)
      : u[7] ? new Date(Date.UTC(+u[1], +u[2] - 1, +u[3], +u[4], +u[5], +u[6])) : new Date(+u[1], +u[2] - 1, +u[3], +u[4], +u[5], +u[6]);
  }
  var ints = function (v) { return v ? v.split(",").map(function (x) { return parseInt(x, 10); }) : null; };
  var bymd = ints(p.BYMONTHDAY), bymonth = ints(p.BYMONTH);
  if ((bymd && bymd.some(isNaN)) || (bymonth && bymonth.some(isNaN))) return null;
  var byday = null;
  if (p.BYDAY) {
    byday = p.BYDAY.split(",").map(function (d) { var m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d); return m ? { n: m[1] ? parseInt(m[1], 10) : 0, day: DAYS.indexOf(m[2]) } : null; });
    if (byday.some(function (x) { return !x; })) return null;
  }
  var wkst = p.WKST ? DAYS.indexOf(p.WKST) : 1;
  if (wkst < 0) wkst = 1;
  var s0 = new Date(start), lo = new Date(from), hi = new Date(to);
  var skip = {};
  (excluded || []).forEach(function (d) { skip[+new Date(d)] = 1; });
  var at = function (y, m, d) { return new Date(y, m, d, s0.getHours(), s0.getMinutes(), s0.getSeconds()); };
  var inMonth = function (y, m, d) { var x = at(y, m, d); return x.getMonth() === ((m % 12) + 12) % 12 ? x : null; };
  var monthDays = function (y, m) {
    var out = [], last = new Date(y, m + 1, 0).getDate(), d;
    if (bymd) bymd.forEach(function (n) { d = n > 0 ? n : last + n + 1; if (d >= 1 && d <= last) out.push(at(y, m, d)); });
    else if (byday) byday.forEach(function (b) {
      var all = [];
      for (d = 1; d <= last; d++) if (new Date(y, m, d).getDay() === b.day) all.push(d);
      if (b.n === 0) all.forEach(function (x) { out.push(at(y, m, x)); });
      else { var pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) out.push(at(y, m, pick)); }
    });
    else { var one = inMonth(y, m, s0.getDate()); if (one) out.push(one); }
    return out;
  };
  var out = [], n = 0, limit = max > 0 ? max : 500;
  for (var period = 0; period < 200000; period++) {
    var cands = [], base;
    if (freq === "DAILY") {
      base = at(s0.getFullYear(), s0.getMonth(), s0.getDate() + period * interval);
      cands = [base];
    } else if (freq === "WEEKLY") {
      var back = (s0.getDay() - wkst + 7) % 7;
      base = at(s0.getFullYear(), s0.getMonth(), s0.getDate() - back + period * 7 * interval);
      var days = byday ? byday.map(function (b) { return b.day; }) : [s0.getDay()];
      cands = days.map(function (dd) { return at(base.getFullYear(), base.getMonth(), base.getDate() + (dd - wkst + 7) % 7); });
    } else if (freq === "MONTHLY") {
      base = new Date(s0.getFullYear(), s0.getMonth() + period * interval, 1);
      cands = monthDays(base.getFullYear(), base.getMonth());
    } else {
      base = new Date(s0.getFullYear() + period * interval, 0, 1);
      var months = bymonth ? bymonth.map(function (x) { return x - 1; }) : [s0.getMonth()];
      months.forEach(function (mo) { cands = cands.concat(bymd || byday ? monthDays(base.getFullYear(), mo) : [inMonth(base.getFullYear(), mo, s0.getDate())].filter(Boolean)); });
    }
    if (freq === "DAILY" && (bymonth || bymd || byday)) cands = cands.filter(function (c) {
      return (!bymonth || bymonth.indexOf(c.getMonth() + 1) >= 0) && (!bymd || bymd.indexOf(c.getDate()) >= 0) && (!byday || byday.some(function (b) { return b.day === c.getDay(); }));
    });
    cands.sort(function (x, y) { return x - y; });
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c < s0) continue;
      if ((until && c > until) || c >= hi) return out;
      n += 1;
      if (count && n > count) return out;
      if (c >= lo && !skip[+c]) { out.push(c); if (out.length >= limit) return out; }
    }
    if (base > hi || (until && base > until)) return out;
  }
  return out;
}

// Calendar: an event is named by its uid, looked up in every calendar; one
// occurrence of a repeating event by its uid and start (calendarRef).
const CAL = PRELUDE + `var Cal=Application('Calendar');
var occurrences=${occurrences.toString()};
function pad(n){return (n<10?'0':'')+n}
function untilBefore(rule,occ){var t=new Date(occ.getTime()-1000);
return rule.split(';').filter(function(x){return !/^(COUNT|UNTIL)=/i.test(x)}).concat(['UNTIL='+t.getUTCFullYear()+pad(t.getUTCMonth()+1)+pad(t.getUTCDate())+'T'+pad(t.getUTCHours())+pad(t.getUTCMinutes())+pad(t.getUTCSeconds())+'Z']).join(';')}
function restRule(rule,before){var m=/(?:^|;)COUNT=(\\d+)/i.exec(rule);if(!m)return rule;var left=parseInt(m[1],10)-before;
return rule.split(';').map(function(x){return /^COUNT=/i.test(x)?'COUNT='+Math.max(1,left):x}).join(';')}
function excludedOf(e){try{return e.excludedDates()||[]}catch(x){return []}}
function before(e,rule,occ){return occurrences(rule,e.startDate(),e.startDate(),occ,100000,[]).length}
function scopeOf(a,ref,rule){if(!rule)return 'all';if(!ref.occurrence){if(a.scope&&a.scope!=='all')throw new Error('scope '+a.scope+' needs an occurrence id from mac_calendar_list.');return 'all'}return a.scope||'this'}
function propsOf(e){var p={summary:e.summary(),startDate:e.startDate(),endDate:e.endDate(),alldayEvent:e.alldayEvent()};['location','description','url'].forEach(function(k){var v=opt(e,k);if(v!=null)p[k]=v});return p}
function alarmsOf(e){var out=[];try{e.displayAlarms().forEach(function(x){var t=opt(x,'triggerInterval');if(t!=null)out.push(-t)})}catch(x){}return out}
function apply(p,a){if(a.title!==undefined)p.summary=a.title;if(a.allDay!==undefined)p.alldayEvent=a.allDay;if(a.start!==undefined)p.startDate=new Date(a.start);if(a.end!==undefined)p.endDate=new Date(a.end);
if(a.location!==undefined)p.location=a.location;if(a.notes!==undefined)p.description=a.notes;if(a.url!==undefined)p.url=a.url;return p}
function exclude(e,occ){e.excludedDates=excludedOf(e).concat([occ])}
function endSeries(e,rule,occ){if(before(e,rule,occ)===0){Cal.delete(e);return}e.recurrence=untilBefore(rule,occ)}
function calNamed(n){var c=Cal.calendars.whose({name:n})();if(!c.length)throw new Error('No calendar named '+n+'. mac_calendar_list_calendars gives the names.');return c[0]}
function evFor(id){var cs=Cal.calendars();for(var i=0;i<cs.length;i++){var f=[];try{f=cs[i].events.whose({uid:id})()}catch(e){}if(f.length)return {e:f[0],cal:cs[i]}}throw new Error('No event with that id. List again.')}
function setAlarms(e,list){try{var cur=e.displayAlarms();for(var i=cur.length-1;i>=0;i--)Cal.delete(cur[i])}catch(x){}
list.forEach(function(m){e.displayAlarms.push(Cal.DisplayAlarm({triggerInterval:-m}))})}
function opt(e,k){try{var v=e[k]();return v===undefined||v===''?null:v}catch(x){return null}}
`;
// Reminders: a reminder is named by its id; lists by name.
const REM = PRELUDE + `var R=Application('Reminders');var PRI={none:0,high:1,medium:5,low:9};
function priName(p){return !p?'none':p<5?'high':p===5?'medium':'low'}
function listNamed(n){var l=R.lists.whose({name:n})();if(!l.length)throw new Error('No list named '+n+'. mac_reminders_list_lists gives the names.');return l[0]}
function remFor(id){var r=R.reminders.byId(id);r.name();return r}
function opt(e,k){try{var v=e[k]();return v===undefined||v===''?null:v}catch(x){return null}}
function setDue(r,a){if(a.due===undefined)return;if(a.due===''){try{r.dueDate=null}catch(e){}try{r.alldayDueDate=null}catch(e){}return}
if(a.dueAllDay){try{r.alldayDueDate=new Date(a.due);return}catch(e){}}r.dueDate=new Date(a.due)}
`;
// Contacts: cards and groups are named by their ids; every change ends with save.
const CON = PRELUDE + `var C=Application('Contacts');
function personFor(id){var p=C.people.byId(id);p.name();return p}
function groupFor(id){var g=C.groups.byId(id);g.name();return g}
function vals(p,k){try{return p[k]().map(function(x){var o={label:null,value:null};try{o.label=x.label()}catch(e){}try{o.value=x.value()}catch(e){}return o})}catch(e){return []}}
function opt(e,k){try{var v=e[k]();return v===undefined||v===''?null:v}catch(x){return null}}
function setList(p,k,ctor,list,def){var cur=p[k]();for(var i=cur.length-1;i>=0;i--)C.delete(cur[i]);list.forEach(function(x){p[k].push(C[ctor]({label:x.label||def,value:x.value}))})}
var SCALAR=['firstName','lastName','middleName','nickname','organization','jobTitle','department','note'];
function apply(p,a){SCALAR.forEach(function(k){if(a[k]!==undefined)p[k]=a[k]});if(a.birthday!==undefined)p.birthDate=new Date(a.birthday);
if(a.emails)setList(p,'emails','Email',a.emails,'work');if(a.phones)setList(p,'phones','Phone',a.phones,'mobile');if(a.urls)setList(p,'urls','Url',a.urls,'homepage')}
`;
// Notes: a note is named by its id; folders by name.
const NOTES = PRELUDE + `var N=Application('Notes');
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function html(t){return esc(t).split('\\n').map(function(l){return '<div>'+(l||'<br>')+'</div>'}).join('')}
function folderNamed(n){var f=N.folders.whose({name:n})();if(!f.length)throw new Error('No folder named '+n+'. mac_notes_list_folders gives the names.');return f[0]}
function noteFor(id){var n=N.notes.byId(id);n.name();return n}
function locked(n){try{return n.passwordProtected()===true}catch(e){return false}}
function folderOf(n){try{return n.container().name()}catch(e){return null}}
`;

// Photos: items and albums are named by Photos' own ids. Every list stops
// collecting at MAC_APP_BUDGET_MS and answers with what it has and a cursor.
/** The longest side of an exported photo unless the bot asks otherwise. */
export const PHOTO_EXPORT_MAX_SIZE = 2048;
/** A Photos id (uuid/L0/001): never shown on a card. */
const PHOTOS_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}(?:\/|$)/i;
const PHOTOS = PRELUDE + `var P=Application('Photos');var T0=Date.now();function late(ms){return Date.now()-T0>ms}
function opt(e,k){try{var v=e[k]();return v===undefined||v===''?null:v}catch(x){return null}}
function walkAlbums(){var out=[],seen={};function go(c,path,d){var ids=[],names=[];try{ids=c.albums.id();names=c.albums.name()}catch(e){}
for(var i=0;i<ids.length;i++){if(!seen[ids[i]]){seen[ids[i]]=1;out.push({id:ids[i],name:names[i],folder:path||null})}}
if(d<6){var fs=[];try{fs=c.folders()}catch(e){}for(var j=0;j<fs.length;j++){var n='';try{n=fs[j].name()}catch(e){continue}go(fs[j],path?path+'/'+n:n,d+1)}}}
go(P,'',0);return out}
function albumFor(x){try{var a=P.albums.byId(x);a.name();return a}catch(e){}var l=[];try{l=P.albums.whose({name:x})()}catch(e){}if(l.length)return l[0];
var all=walkAlbums();for(var i=0;i<all.length;i++){if(all[i].id===x||all[i].name===x){var b=P.albums.byId(all[i].id);b.name();return b}}
throw new Error('Photos has no album '+x+'. mac_photos_list_albums gives the albums.')}
function itemFor(id){var m=P.mediaItems.byId(id);m.id();return m}
function hasKw(list,k){k=k.toLowerCase();return (list||[]).some(function(x){return String(x).toLowerCase()===k})}
function where(m){var l=opt(m,'location');return l&&l.length===2&&l[0]!=null&&l[1]!=null?{latitude:l[0],longitude:l[1]}:null}
function row(m){return {id:m.id(),filename:opt(m,'filename'),title:opt(m,'name'),date:iso(opt(m,'date')),width:opt(m,'width'),height:opt(m,'height'),favorite:opt(m,'favorite')===true,keywords:opt(m,'keywords')||[],location:where(m)}}
function addTo(al,ids){var items=[],failed=[];ids.forEach(function(id){try{items.push(itemFor(id))}catch(e){failed.push({id:id,error:'Photos has no photo with that id. Search again.'})}});
if(items.length)P.add(items,{to:al});return {added:items.length,failed:failed}}
`;
const PHOTOS_SCRIPTS = {
  mac_photos_list_albums: PHOTOS + `function main(a){var all=walkAlbums();var end=Math.min(all.length,a.offset+a.limit);var out=[];
for(var i=a.offset;i<end;i++){if(out.length&&late(${MAC_APP_BUDGET_MS})){end=i;break}var o=all[i];o.count=null;if(!late(${HALF})){try{o.count=P.albums.byId(o.id).mediaItems.length}catch(e){}}out.push(o)}
var r={albums:out,total:all.length};if(end<all.length)r.next=String(end);return r}`,
  // Words go through Photos' own search (people, places, scenes); without
  // words the album or the library is read in bulk, filtered and sorted here.
  mac_photos_search: PHOTOS + `function main(a){var from=a.from?new Date(a.from):null,to=a.to?new Date(a.to):null;var words=[a.query,a.person,a.place].filter(Boolean).join(' ');
var al=a.album?albumFor(a.album):null;var out=[];var r;
if(words){var hits=P.search({for:words})||[];var keep=null;if(al){keep={};var ai=al.mediaItems.id();for(var x=0;x<ai.length;x++)keep[ai[x]]=1}
var i=a.offset;for(;i<hits.length&&out.length<a.limit;i++){if(out.length&&late(${MAC_APP_BUDGET_MS}))break;var m=hits[i];var id=m.id();if(keep&&!keep[id])continue;
var d=opt(m,'date');if(from&&!(d>=from))continue;if(to&&!(d<to))continue;if(a.favorite!==undefined&&(opt(m,'favorite')===true)!==a.favorite)continue;
if(a.keyword&&!hasKw(opt(m,'keywords'),a.keyword))continue;out.push(row(m))}
r={photos:out,total:hits.length};if(i<hits.length)r.next=String(i);return r}
var coll=al?al.mediaItems:P.mediaItems;var ids=coll.id(),dates=coll.date();var favs=a.favorite!==undefined?coll.favorite():null;var kws=a.keyword?coll.keywords():null;
var idx=[];for(var k=0;k<ids.length;k++){var dk=dates[k];if(from&&!(dk>=from))continue;if(to&&!(dk<to))continue;if(favs&&(favs[k]===true)!==a.favorite)continue;if(kws&&!hasKw(kws[k],a.keyword))continue;idx.push(k)}
idx.sort(function(p,q){return (dates[q]?dates[q].getTime():0)-(dates[p]?dates[p].getTime():0)});
var end=Math.min(idx.length,a.offset+a.limit);for(var n=a.offset;n<end;n++){if(out.length&&late(${MAC_APP_BUDGET_MS})){end=n;break}out.push(row(itemFor(ids[idx[n]])))}
r={photos:out,total:idx.length};if(end<idx.length)r.next=String(end);return r}`,
  mac_photos_read: PHOTOS + `function main(a){var out=[],failed=[];var i=a.offset;for(;i<a.ids.length;i++){if(out.length&&late(${MAC_APP_BUDGET_MS}))break;
try{var m=itemFor(a.ids[i]);var o=row(m);o.caption=opt(m,'description');o.altitude=opt(m,'altitude');out.push(o)}catch(e){failed.push({id:a.ids[i],error:'Photos has no photo with that id. Search again.'})}}
var r={photos:out,failed:failed};if(i<a.ids.length)r.next=String(i);return r}`,
  // Each item goes to its own folder (dirs[i], made by the caller), so every
  // file Photos writes is known to come from that id.
  mac_photos_export: PHOTOS + `function main(a){var out=[],failed=[];var i=a.offset;for(;i<a.ids.length;i++){if((out.length||failed.length)&&late(${MAC_APP_BUDGET_MS}))break;
try{var m=itemFor(a.ids[i]);P.export([m],{to:Path(a.dirs[i]),usingOriginals:a.original===true});out.push({id:a.ids[i],index:i})}catch(e){failed.push({id:a.ids[i],error:String(e&&e.message||e)})}}
var r={exported:out,failed:failed};if(i<a.ids.length)r.next=String(i);return r}`,
  mac_photos_create_album: PHOTOS + `function main(a){var props={new:'album',named:a.name};if(a.folder){var f=[];try{f=P.folders.whose({name:a.folder})()}catch(e){}if(!f.length)throw new Error('Photos has no folder named '+a.folder+'.');props.at=f[0]}
var al=P.make(props);var r={created:true,id:al.id(),name:al.name(),added:0,failed:[]};if(a.ids&&a.ids.length){var x=addTo(al,a.ids);r.added=x.added;r.failed=x.failed}return r}`,
  mac_photos_add_to_album: PHOTOS + `function main(a){var al=albumFor(a.album);var x=addTo(al,a.ids);return {added:x.added,failed:x.failed,album:al.name()}}`,
};

export const MAC_APP_SCRIPTS = {
  mac_messages_send: PRELUDE + `function main(a){var M=Application('Messages');var files=a.files||[];
function out(target){if(a.text)M.send(a.text,{to:target});files.forEach(function(f){M.send(Path(f),{to:target})})}
if(a.chat){var c=null;try{c=M.chats.byId(a.chat);c.id()}catch(e){c=null}
if(!c)throw new Error('Messages has no conversation with that chat id. mac_messages_list_chats gives them.');out(c);return {sent:true,chat:a.chat,files:files.length}}
var kind=a.service==='SMS'?'SMS':'iMessage';var svc=null;
try{svc=M.accounts.whose({serviceType:kind})()[0]||null}catch(e){}
if(!svc){try{svc=M.services.whose({serviceType:kind})()[0]||null}catch(e){}}
var who=null;if(svc){try{who=svc.participants.byName(a.to);who.name()}catch(e){who=null}
if(!who){try{who=svc.buddies.byName(a.to);who.name()}catch(e){who=null}}}
if(!who&&!a.service){try{who=M.participants.byName(a.to);who.name()}catch(e){who=null}}
if(!who)throw new Error('Messages does not know '+a.to);out(who);return {sent:true,to:a.to,service:kind,files:files.length};}`,
  ...MAIL_SCRIPTS,
  mac_calendar_list_calendars: CAL + `function main(a){return {calendars:Cal.calendars().map(function(c){return {name:c.name(),writable:opt(c,'writable'),description:opt(c,'description')}})};}`,
  // Every event that starts before the end of the range, read in bulk: a
  // plain one when it starts in the range, a repeating one by its occurrences.
  mac_calendar_list: CAL + `function main(a){var from=new Date(a.from),to=new Date(a.to);var q=a.query?a.query.toLowerCase():'';
var cals=a.calendar?[calNamed(a.calendar)]:Cal.calendars();var out=[];var next=null;var c0=Math.floor(a.offset/100000),j0=a.offset%100000;
scan:for(var i=c0;i<cals.length;i++){var ev=cals[i].events.whose({startDate:{_lessThan:to}});var st=[],rec=[];try{st=ev.startDate()}catch(x){}try{rec=ev.recurrence()}catch(x){}
for(var j=i===c0?j0:0;j<st.length;j++){if(late(${MAC_APP_BUDGET_MS})){next=String(i*100000+j);break scan}var rule=rec[j]||'';if(!rule&&!(st[j]>=from))continue;var e=ev[j];var loc=opt(e,'location');
if(q){var hay=[e.summary(),loc,opt(e,'description')].join(' ').toLowerCase();if(hay.indexOf(q)<0)continue}
var row={id:e.uid(),calendar:cals[i].name(),title:cut(e.summary(),300),start:iso(st[j]),end:iso(e.endDate()),allDay:e.alldayEvent(),location:loc?cut(loc,300):null,repeats:!!rule};
if(!rule){out.push(row);continue}var dur=e.endDate()-st[j];var starts=occurrences(rule,st[j],from,to,a.limit,excludedOf(e));
if(starts===null){row.occurrences='unknown';row.repeat=rule;out.push(row);continue}
starts.forEach(function(s){var o={};for(var k in row)o[k]=row[k];o.id=row.id+'#'+s.toISOString();o.series=row.id;o.start=iso(s);o.end=iso(new Date(s.getTime()+dur));out.push(o)})}}
out.sort(function(x,y){return x.start<y.start?-1:1});var r={events:out.slice(0,a.limit)};if(out.length>a.limit)r.more=true;
if(next!==null){r.next=next;r.partial='Calendar was slow: these are the events read so far, in order among themselves. Pass next as cursor for the rest, or narrow the range or the calendar.'}return r;}`,
  mac_calendar_read: CAL + `function main(a){var h=evFor(a.ref.uid);var e=h.e;
var o={id:e.uid(),calendar:h.cal.name(),title:e.summary(),start:iso(e.startDate()),end:iso(e.endDate()),allDay:e.alldayEvent(),
location:opt(e,'location'),notes:cut(opt(e,'description')||'',20000)||null,url:opt(e,'url'),repeat:opt(e,'recurrence'),status:opt(e,'status'),alarms:alarmsOf(e),invitees:[]};
if(a.ref.occurrence&&o.repeat){var dur=e.endDate()-e.startDate();o.id=a.ref.uid+'#'+a.ref.occurrence;o.series=a.ref.uid;o.seriesStart=o.start;o.start=a.ref.occurrence;o.end=new Date(new Date(a.ref.occurrence).getTime()+dur).toISOString()}
try{e.attendees().forEach(function(x){if(late(${MAC_APP_BUDGET_MS})){o.inviteesPartial=true;return}o.invitees.push({name:opt(x,'displayName'),email:opt(x,'email'),answer:opt(x,'participationStatus')})})}catch(x){}
return o;}`,
  mac_calendar_create: CAL + `function main(a){var cal=null;
if(a.calendar)cal=calNamed(a.calendar);
else{var all=Cal.calendars();for(var i=0;i<all.length&&!cal;i++){try{if(all[i].writable())cal=all[i]}catch(e){}}if(!cal)cal=all[0]}
var props={summary:a.title,startDate:new Date(a.start),endDate:new Date(a.end),alldayEvent:a.allDay};
if(a.location)props.location=a.location;if(a.notes)props.description=a.notes;if(a.url)props.url=a.url;if(a.repeat)props.recurrence=a.repeat;
var e=Cal.Event(props);cal.events.push(e);if(a.alarms)setAlarms(e,a.alarms);return {created:true,id:e.uid(),calendar:cal.name()};}`,
  mac_calendar_update: CAL + `function main(a){var h=evFor(a.ref.uid);var e=h.e;var rule=opt(e,'recurrence')||'';var scope=scopeOf(a,a.ref,rule);
if(scope!=='all'){var occ=new Date(a.ref.occurrence);var dur=e.endDate()-e.startDate();var p=propsOf(e);var keep=alarmsOf(e);p.startDate=occ;p.endDate=new Date(occ.getTime()+dur);apply(p,a);
var n=before(e,rule,occ);var target=a.calendar?calNamed(a.calendar):h.cal;
if(scope==='future'){var next=a.repeat!==undefined?a.repeat:restRule(rule,n);if(next)p.recurrence=next}
var made=Cal.Event(p);target.events.push(made);setAlarms(made,a.alarms!==undefined?a.alarms:keep);
if(scope==='this')exclude(e,occ);else endSeries(e,rule,occ);return {updated:true,scope:scope,id:made.uid(),calendar:target.name()}}
if(a.title!==undefined)e.summary=a.title;if(a.allDay!==undefined)e.alldayEvent=a.allDay;
if(a.start!==undefined&&a.end!==undefined&&new Date(a.start)>=e.endDate()){e.endDate=new Date(a.end);e.startDate=new Date(a.start)}
else{if(a.start!==undefined)e.startDate=new Date(a.start);if(a.end!==undefined)e.endDate=new Date(a.end)}
if(a.location!==undefined)e.location=a.location;if(a.notes!==undefined)e.description=a.notes;if(a.url!==undefined)e.url=a.url;if(a.repeat!==undefined)e.recurrence=a.repeat;
if(a.alarms!==undefined)setAlarms(e,a.alarms);
var cal=h.cal;if(a.calendar&&a.calendar!==cal.name()){cal=calNamed(a.calendar);try{Cal.move(e,{to:cal})}catch(x){Cal.duplicate(e,{to:cal});Cal.delete(e)}}
return {updated:true,scope:'all',id:a.ref.uid,calendar:cal.name()};}`,
  mac_calendar_delete: CAL + `function main(a){var done=0,failed=[];a.refs.forEach(function(ref){try{var e=evFor(ref.uid).e;var rule=opt(e,'recurrence')||'';var scope=scopeOf(a,ref,rule);
if(scope==='all')Cal.delete(e);else if(scope==='this')exclude(e,new Date(ref.occurrence));else endSeries(e,rule,new Date(ref.occurrence));done++}
catch(x){failed.push({id:ref.occurrence?ref.uid+'#'+ref.occurrence:ref.uid,error:String(x&&x.message||x)})}});return {deleted:done,failed:failed};}`,
  mac_calendar_create_calendar: CAL + `function main(a){var c=Cal.Calendar({name:a.name});Cal.calendars.push(c);return {created:true,name:a.name};}`,
  mac_calendar_update_calendar: CAL + `function main(a){calNamed(a.name).name=a.newName;return {updated:true,name:a.newName};}`,
  mac_calendar_delete_calendar: CAL + `function main(a){Cal.delete(calNamed(a.name));return {deleted:1,name:a.name};}`,
  mac_contacts_search: CON + `function main(a){var q=a.query.toLowerCase();var digits=a.query.replace(/[^0-9]/g,'');
var ids=C.people.id(),names=C.people.name(),ems=C.people.emails.value(),phs=C.people.phones.value(),hits=[];
for(var i=0;i<ids.length;i++){var hit=String(names[i]||'').toLowerCase().indexOf(q)>=0;
if(!hit)hit=(ems[i]||[]).some(function(x){return String(x).toLowerCase().indexOf(q)>=0});
if(!hit&&digits.length>=3)hit=(phs[i]||[]).some(function(x){return String(x).replace(/[^0-9]/g,'').indexOf(digits)>=0});if(hit)hits.push(i)}
var end=Math.min(hits.length,a.offset+a.limit);var out=[];
for(var k=a.offset;k<end;k++){if(out.length&&late(${MAC_APP_BUDGET_MS})){end=k;break}var i=hits[k];var o={id:ids[i],name:names[i],organization:null,emails:ems[i]||[],phones:phs[i]||[]};
if(!late(${HALF})){try{o.organization=personFor(ids[i]).organization()}catch(e){}}out.push(o)}
var r={people:out};if(end<hits.length)r.next=String(end);return r;}`,
  mac_contacts_read: CON + `function main(a){var p=a.me?C.myCard():personFor(a.id);if(!p)throw new Error('There is no card marked as yours in Contacts.');
var o={id:p.id(),name:p.name(),firstName:opt(p,'firstName'),lastName:opt(p,'lastName'),middleName:opt(p,'middleName'),nickname:opt(p,'nickname'),
organization:opt(p,'organization'),jobTitle:opt(p,'jobTitle'),department:opt(p,'department'),birthday:iso(opt(p,'birthDate')),note:opt(p,'note'),
emails:vals(p,'emails'),phones:vals(p,'phones'),urls:vals(p,'urls'),relatedNames:vals(p,'relatedNames'),dates:vals(p,'customDates').map(function(x){return {label:x.label,value:iso(x.value)}}),addresses:[],groups:[]};
try{p.addresses().forEach(function(x){o.addresses.push({label:opt(x,'label'),street:opt(x,'street'),city:opt(x,'city'),state:opt(x,'state'),zip:opt(x,'zip'),country:opt(x,'country')})})}catch(e){}
try{C.groups().forEach(function(g){if(late(${MAC_APP_BUDGET_MS})){o.groupsPartial=true;return}try{if(g.people.whose({id:o.id})().length)o.groups.push({id:g.id(),name:g.name()})}catch(e){}})}catch(e){}
return o;}`,
  mac_contacts_create: CON + `function main(a){var props={};SCALAR.forEach(function(k){if(a[k]!==undefined)props[k]=a[k]});
var p=C.Person(props);C.people.push(p);apply(p,{emails:a.emails,phones:a.phones,urls:a.urls,birthday:a.birthday});C.save();return {created:true,id:p.id(),name:p.name()};}`,
  mac_contacts_update: CON + `function main(a){var p=personFor(a.id);apply(p,a);C.save();return {updated:true,id:a.id,name:p.name()};}`,
  mac_contacts_delete: CON + `function main(a){var r=eachOf(a.ids,function(id){C.delete(personFor(id))});C.save();return {deleted:r.done,failed:r.failed};}`,
  mac_contacts_list_groups: CON + `function main(a){var out=[],cut=false;C.groups().forEach(function(g){if(cut||late(${MAC_APP_BUDGET_MS})){cut=true;return}var n=null;if(!late(${HALF})){try{n=g.people.length}catch(e){}}out.push({id:g.id(),name:g.name(),people:n})});
var r={groups:out};if(cut)r.partial='${PARTIAL}';return r;}`,
  mac_contacts_create_group: CON + `function main(a){var g=C.Group({name:a.name});C.groups.push(g);C.save();return {created:true,id:g.id(),name:a.name};}`,
  mac_contacts_update_group: CON + `function main(a){var g=groupFor(a.id);if(a.name)g.name=a.name;
var add=eachOf(a.add||[],function(id){C.add(personFor(id),{to:g})});var rem=eachOf(a.remove||[],function(id){C.remove(personFor(id),{from:g})});
C.save();return {updated:true,added:add.done,removed:rem.done,failed:add.failed.concat(rem.failed)};}`,
  mac_contacts_delete_group: CON + `function main(a){C.delete(groupFor(a.id));C.save();return {deleted:1};}`,
  mac_reminders_list_lists: REM + `function main(a){var out=[],cut=false;R.lists().forEach(function(l){if(cut||late(${MAC_APP_BUDGET_MS})){cut=true;return}var n=null;if(!late(${HALF})){try{n=l.reminders.whose({completed:false}).length}catch(e){}}out.push({id:l.id(),name:l.name(),open:n})});
var r={lists:out};if(cut)r.partial='${PARTIAL}';return r;}`,
  mac_reminders_list: REM + `function main(a){var lists=a.list?[listNamed(a.list)]:R.lists();var out=[];var q=a.query?a.query.toLowerCase():'';
var from=a.dueFrom?new Date(a.dueFrom):null,to=a.dueTo?new Date(a.dueTo):null;var next=null;var l0=Math.floor(a.offset/100000),j0=a.offset%100000;
scan:for(var i=l0;i<lists.length;i++){var rs=a.includeCompleted?lists[i].reminders():lists[i].reminders.whose({completed:false})();
for(var j=i===l0?j0:0;j<rs.length;j++){if(out.length===a.limit||(out.length&&late(${MAC_APP_BUDGET_MS}))){next=String(i*100000+j);break scan}var r=rs[j];var due=opt(r,'dueDate')||opt(r,'alldayDueDate');var body=opt(r,'body');
if(q&&(String(r.name())+' '+(body||'')).toLowerCase().indexOf(q)<0)continue;
if((from||to)&&(!due||(from&&due<from)||(to&&due>=to)))continue;
out.push({id:r.id(),list:lists[i].name(),title:cut(r.name(),300),due:iso(due),remind:iso(opt(r,'remindMeDate')),priority:priName(opt(r,'priority')),completed:r.completed(),notes:body?cut(body,200):null})}}
var res={reminders:out};if(next!==null)res.next=next;return res;}`,
  mac_reminders_create: REM + `function main(a){var list=null;
if(a.list)list=listNamed(a.list);else{try{list=R.defaultList()}catch(e){list=R.lists()[0]}}
var props={name:a.title};if(a.notes)props.body=a.notes;if(a.priority)props.priority=PRI[a.priority];if(a.remind)props.remindMeDate=new Date(a.remind);
var r=R.Reminder(props);list.reminders.push(r);setDue(r,a);return {created:true,id:r.id(),list:list.name()};}`,
  mac_reminders_update: REM + `function main(a){var r=remFor(a.id);
if(a.title!==undefined)r.name=a.title;if(a.notes!==undefined)r.body=a.notes;if(a.priority!==undefined)r.priority=PRI[a.priority];setDue(r,a);
if(a.remind!==undefined)r.remindMeDate=a.remind===''?null:new Date(a.remind);
var list=null;if(a.list){list=listNamed(a.list);R.move(r,{to:list})}return {updated:true,id:a.id,list:list?list.name():null};}`,
  mac_reminders_complete: REM + `function main(a){var r=eachOf(a.ids,function(id){remFor(id).completed=a.completed});return {completed:r.done,failed:r.failed};}`,
  mac_reminders_delete: REM + `function main(a){var r=eachOf(a.ids,function(id){R.delete(remFor(id))});return {deleted:r.done,failed:r.failed};}`,
  mac_reminders_create_list: REM + `function main(a){var l=R.List({name:a.name});R.lists.push(l);return {created:true,name:a.name};}`,
  mac_reminders_update_list: REM + `function main(a){listNamed(a.name).name=a.newName;return {updated:true,name:a.newName};}`,
  mac_reminders_delete_list: REM + `function main(a){R.delete(listNamed(a.name));return {deleted:1,name:a.name};}`,
  mac_notes_list_folders: NOTES + `function main(a){var cut=false;var r={accounts:N.accounts().map(function(x){var fs=[];try{x.folders().forEach(function(f){if(cut||late(${MAC_APP_BUDGET_MS})){cut=true;return}var n=null;if(!late(${HALF})){try{n=f.notes.length}catch(e){}}fs.push({name:f.name(),notes:n})})}catch(e){}return {name:x.name(),folders:fs}})};
if(cut)r.partial='${PARTIAL}';return r;}`,
  mac_notes_search: NOTES + `function main(a){var scope=a.folder?folderNamed(a.folder).notes:N.notes;
var list=a.query?scope.whose({_or:[{name:{_contains:a.query}},{plaintext:{_contains:a.query}}]}):scope;var total=list.length;var end=Math.min(total,a.offset+a.limit);var out=[];
for(var i=a.offset;i<end;i++){if(out.length&&late(${MAC_APP_BUDGET_MS})){end=i;break}var n=list[i];var lk=locked(n);out.push({id:n.id(),title:cut(n.name(),300),folder:folderOf(n),modified:iso(n.modificationDate()),locked:lk,preview:lk||late(${HALF})?null:cut(n.plaintext(),200)})}
var r={notes:out};if(end<total)r.next=String(end);return r;}`,
  mac_notes_read: NOTES + `function main(a){var n=noteFor(a.id);var o={id:n.id(),title:n.name(),folder:folderOf(n),modified:iso(n.modificationDate()),locked:locked(n)};
if(o.locked)return o;var t=String((a.format==='html'?n.body():n.plaintext())||'');o.format=a.format;o.content=t.slice(a.offset,a.offset+20000);o.offset=a.offset;o.length=t.length;o.truncated=a.offset+20000<t.length;
if(o.truncated)o.nextOffset=a.offset+20000;o.attachments=[];try{n.attachments().forEach(function(x,i){o.attachments.push({index:i,name:x.name()})})}catch(e){}return o;}`,
  mac_notes_create: NOTES + `function main(a){var folder=null;
if(a.folder)folder=folderNamed(a.folder);else{try{folder=N.defaultAccount().defaultFolder()}catch(e){folder=N.folders()[0]}}
var n=N.Note({body:'<h1>'+esc(a.title)+'</h1>'+html(a.body)});folder.notes.push(n);return {created:true,id:n.id(),folder:folder.name()};}`,
  mac_notes_update: NOTES + `function main(a){var n=noteFor(a.id);if(locked(n))throw new Error('This note is locked. Unlock it in Notes first.');
if(a.body){if(a.mode==='replace'){var att=0;try{att=n.attachments().length}catch(e){}
if(att&&!a.force)throw new Error('This note holds '+att+' attachment(s): replace would lose them. Use mode append, or force: true to replace anyway.');
n.body='<h1>'+esc(a.title||n.name())+'</h1>'+html(a.body)}else{n.body=String(n.body()||'')+html(a.body);if(a.title)n.name=a.title}}
else if(a.title)n.name=a.title;return {updated:true,id:a.id,mode:a.mode};}`,
  mac_notes_move: NOTES + `function main(a){var f=folderNamed(a.folder);var r=eachOf(a.ids,function(id){N.move(noteFor(id),{to:f})});return {moved:r.done,failed:r.failed};}`,
  mac_notes_delete: NOTES + `function main(a){var r=eachOf(a.ids,function(id){N.delete(noteFor(id))});return {deleted:r.done,failed:r.failed};}`,
  mac_notes_create_folder: NOTES + `function main(a){var acct=null;if(a.account){acct=N.accounts.whose({name:a.account})()[0]||null;if(!acct)throw new Error('No Notes account named '+a.account)}
else{try{acct=N.defaultAccount()}catch(e){acct=N.accounts()[0]}}acct.folders.push(N.Folder({name:a.name}));return {created:true,name:a.name,account:acct.name()};}`,
  mac_notes_update_folder: NOTES + `function main(a){folderNamed(a.name).name=a.newName;return {updated:true,name:a.newName};}`,
  mac_notes_delete_folder: NOTES + `function main(a){N.delete(folderNamed(a.name));return {deleted:1,name:a.name};}`,
  ...PHOTOS_SCRIPTS,
};

/** Light reads the setup page's Test button runs (names and counts only). */
export const MAC_APP_TEST_SCRIPTS = {
  mail: PRELUDE + "function main(a){var M=Application('Mail');return {names:M.accounts().map(function(x){return x.name()})};}",
  calendar: PRELUDE + "function main(a){var C=Application('Calendar');return {names:C.calendars().map(function(x){return x.name()})};}",
  contacts: PRELUDE + "function main(a){var C=Application('Contacts');var g=C.groups().map(function(x){return x.name()});return {names:g,count:C.people.length};}",
  reminders: PRELUDE + "function main(a){var R=Application('Reminders');return {names:R.lists().map(function(x){return x.name()})};}",
  notes: PRELUDE + "function main(a){var N=Application('Notes');return {names:N.folders().map(function(x){return x.name()})};}",
  messages: PRELUDE + "function main(a){var M=Application('Messages');var n=0;try{n=M.chats.length}catch(e){}return {names:[],count:n};}",
  photos: PRELUDE + "function main(a){var P=Application('Photos');return {names:P.albums.name(),count:P.mediaItems.length};}",
};

/** osascript's argv for one call: constant script, one JSON argument. */
export function macAppArgv(script, args) {
  const json = JSON.stringify(args ?? {});
  if (!json.startsWith("{")) throw new Error("arguments must be an object");
  return ["-l", "JavaScript", "-e", script, json];
}

const execFilePromise = (file, args, options) => new Promise((resolve, reject) => {
  execFileCallback(file, args, options, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
    else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
  });
});

const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const failure = (message) => ({ ...text(message), isError: true });

/** -1743: the person has not allowed this app to control that one. */
export function macAppErrorText(appId, error) {
  const name = macAppInfo(appId)?.name ?? "that app";
  const raw = String(error?.stderr || error?.message || error || "");
  if (/-1743|not allowed|Not authorized/i.test(raw)) {
    return { denied: true, message: `macOS has not allowed Sagax to control ${name}. Open System Settings > Privacy & Security > Automation and turn on ${name} under Sagax.` };
  }
  // 2026-11-17: an aborted call (the turn ended, the server cancelled it)
  // and a timeout said "returned an error: The operation was aborted" and "did
  // not answer in time": each now says what happened and what to do.
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
    return { denied: false, message: `The call to ${name} was cancelled before ${name} answered (its turn ended or the server stopped waiting). Nothing more was done.` };
  }
  if (error?.killed || /ETIMEDOUT|timed out/i.test(raw)) {
    return { denied: false, message: `${name} did not answer in time. ${name} is busy (syncing a large account or library, or a dialog is open in it): try again in a moment${appId === "mail" ? ", or narrow the call (one account, a mailbox, since)" : appId === "photos" ? ", or narrow the call (an album, a date range, fewer ids)" : ""}.` };
  }
  const line = raw.split("\n").map((part) => part.replace(/^.*execution error:\s*/, "").trim()).find(Boolean) ?? "";
  return { denied: false, message: `${name} returned an error: ${line.slice(0, 300) || "unknown error"}` };
}

/** How long one Apple app script may run. Mail's own scripts stop collecting
 * at MAC_APP_BUDGET_MS and answer with what they have, well before this. */
export const MAC_APP_SCRIPT_TIMEOUT_MS = 60_000;

async function runScript(appId, script, args, { execFile = execFilePromise, signal, timeoutMs = MAC_APP_SCRIPT_TIMEOUT_MS } = {}) {
  const { stdout } = await execFile("osascript", macAppArgv(script, args), { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) });
  const raw = String(stdout ?? "").trim();
  try { return raw ? JSON.parse(raw) : null; } catch { return raw; }
}

// --- Messages database (read only). ----------------------------------------
const APPLE_EPOCH = 978_307_200;
/** chat.db dates: nanoseconds since 2001 on current macOS (past 2^53, so they
 * arrive as BigInt), whole seconds on old databases (below 1e10). */
export function appleDate(raw) {
  let seconds;
  if (typeof raw === "bigint") {
    if (raw <= 0n) return null;
    seconds = raw >= 10_000_000_000n ? Number(raw / 1_000_000n) / 1_000 : Number(raw);
  } else {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    seconds = value >= 1e10 ? value / 1e9 : value;
  }
  const date = new Date((seconds + APPLE_EPOCH) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A failed chat.db read, worded as a read error (never as a refusal). */
export function messagesReadErrorText(error) {
  const raw = String(error?.message || error || "").split("\n")[0].trim().slice(0, 300);
  if (error?.code === "EACCES" || error?.code === "EPERM" || /authorization denied|not permitted|unable to open database/i.test(raw)) {
    return `Messages could not be read: macOS blocked access to chat.db. Turn on Full Disk Access for Sagax in System Settings > Privacy & Security > Full Disk Access, then quit and reopen Sagax.`;
  }
  return `Messages could not be read from chat.db: ${raw || "unknown error"}`;
}
function attributedText(blob) {
  if (!(blob instanceof Uint8Array)) return "";
  const buf = Buffer.from(blob);
  const parts = [];
  for (let i = 0; i < buf.length - 1; i += 1) {
    if (buf[i] !== 0x2b) continue;
    const len = buf[i + 1];
    if (!len || i + 2 + len > buf.length) continue;
    const slice = buf.subarray(i + 2, i + 2 + len);
    if (slice.some((byte) => byte < 32 && byte !== 9)) continue;
    const piece = slice.toString("utf8").trim();
    if (piece) parts.push(piece);
  }
  return parts.join("").slice(0, 4_000);
}

export const messagesDir = (home = os.homedir()) => path.join(home, "Library", "Messages");

/** Full Disk Access shows as chat.db being readable. */
export function probeMessagesAccess(dir = messagesDir()) {
  const file = path.join(dir, "chat.db");
  try {
    fs.closeSync(fs.openSync(file, "r"));
    return "granted";
  } catch (error) {
    if (error?.code === "ENOENT") return fs.existsSync(dir) ? "notAsked" : "unknown";
    return "denied";
  }
}

async function openDatabase(file) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(file, { readOnly: true });
}

/** A date for chat.db: nanoseconds since 2001 (current) and whole seconds (old). */
function appleStamp(iso) {
  const seconds = Math.floor(Date.parse(iso) / 1000) - APPLE_EPOCH;
  return { nanos: BigInt(seconds) * 1_000_000_000n, seconds: BigInt(seconds) };
}
// A word search: SQL matches the text column over every message; a message
// kept only as rich text (attributedBody), which SQL cannot search, is
// decoded here, a window of candidates at a time. One call reads at most
// RICH_TEXT_BUDGET candidates; past that, its next cursor resumes the scan.
const RICH_TEXT_WINDOW = 2_000;
const RICH_TEXT_BUDGET = 20_000;

/** The columns a table has on this Mac's chat.db (they vary by macOS). */
function columnsOf(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name))); } catch { return new Set(); }
}
// associated_message_type: 2000 to 2006 add a reaction (love, like, dislike,
// laugh, emphasis, question, emoji); 3000 to 3006 remove the same one.
const REACTIONS = ["love", "like", "dislike", "laugh", "emphasize", "question", "emoji"];
const isReaction = (type) => type >= 2000 && type < 4000;
/** "p:0/GUID", "bp:GUID" or "GUID": the message a reaction or a reply points at. */
const targetGuid = (value) => String(value ?? "").replace(/^[a-z]+:(?:\d+\/)?/, "");

/** The attachment rows of some messages, per message ROWID, in a stable order. */
function attachmentsOf(db, rowids) {
  const out = new Map();
  if (!rowids.length || !columnsOf(db, "attachment").size) return out;
  const statement = db.prepare(`SELECT j.message_id AS mid, a.ROWID AS aid, a.transfer_name AS tname, a.filename AS fname, a.mime_type AS mime, a.total_bytes AS bytes
    FROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id
    WHERE j.message_id IN (${rowids.map(() => "?").join(",")}) ORDER BY j.message_id, a.ROWID`);
  statement.setReadBigInts?.(true);
  for (const row of statement.all(...rowids)) {
    const key = String(row.mid);
    const list = out.get(key) ?? [];
    list.push({ rowid: String(row.aid), name: String(row.tname || path.basename(String(row.fname ?? "")) || "attachment"), mime: row.mime ? String(row.mime) : null, bytes: row.bytes === null || row.bytes === undefined ? null : Number(row.bytes), file: row.fname ? String(row.fname) : null });
    out.set(key, list);
  }
  return out;
}

/** Messages, newest first, as { messages, next }: `next` (a cursor) when
 * more may follow. Without words, `offset` skips that many messages. With
 * words, `offset` is a position in the scan of candidates (the messages
 * whose text column matches, and every message kept only as rich text), so a
 * message whose text lives only in attributedBody is found however old it is.
 * Each message carries its reactions (who and which, the removed ones taken
 * off), its attachments by index, its edited and unsent marks and the
 * message it replies to, where this Mac's chat.db keeps them. */
export async function readMessages(dir, op, { open = openDatabase } = {}) {
  const db = await open(path.join(dir, "chat.db"));
  try {
    const cols = columnsOf(db, "message");
    const where = [];
    const params = [];
    if (cols.has("associated_message_type")) where.push("(m.associated_message_type IS NULL OR m.associated_message_type < 2000 OR m.associated_message_type >= 4000)");
    if (op.chat) {
      where.push("(c.chat_identifier = ? OR c.guid = ? OR c.display_name LIKE ? OR h.id = ?)");
      params.push(op.chat, op.chat, `%${op.chat}%`, op.chat);
    }
    if (op.since) {
      const stamp = appleStamp(op.since);
      where.push("(m.date >= ? OR (m.date < 10000000000 AND m.date >= ?))");
      params.push(stamp.nanos, stamp.seconds);
    }
    if (op.query) {
      where.push("(m.text LIKE ? OR ((m.text IS NULL OR m.text = '') AND m.attributedBody IS NOT NULL))");
      params.push(`%${op.query}%`);
    }
    const extra = [
      cols.has("date_edited") ? "m.date_edited AS edited" : "0 AS edited",
      cols.has("date_retracted") ? "m.date_retracted AS retracted" : "0 AS retracted",
      cols.has("thread_originator_guid") ? "m.thread_originator_guid AS reply_to" : "NULL AS reply_to",
    ].join(", ");
    const offset = Math.max(0, op.offset ?? 0);
    const sql = `SELECT m.ROWID AS rowid, m.guid AS guid, c.chat_identifier AS chat, c.display_name AS chat_name, c.guid AS chat_id, m.date AS date,
        m.is_from_me AS from_me, m.text AS text, m.attributedBody AS body, m.service AS service, h.id AS handle, ${extra}
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.date DESC, m.ROWID DESC LIMIT ? OFFSET ?`;
    const statement = db.prepare(sql);
    // message.date is nanoseconds since 2001: past Number.MAX_SAFE_INTEGER,
    // node:sqlite throws unless integers come back as BigInt.
    statement.setReadBigInts?.(true);
    const shape = (row) => ({
      rowid: String(row.rowid ?? ""),
      id: String(row.guid ?? ""),
      chat: String(row.chat_name || row.chat || ""),
      chatId: String(row.chat_id ?? ""),
      from: String(row.from_me) === "1" ? "me" : String(row.handle ?? ""),
      date: appleDate(row.date),
      service: String(row.service || "iMessage"),
      text: String(row.text ?? "").trim().slice(0, 4_000) || attributedText(row.body),
      edited: Boolean(appleDate(row.edited)),
      unsent: Boolean(appleDate(row.retracted)),
      replyTo: row.reply_to ? String(row.reply_to) : null,
    });
    let rows;
    let next;
    if (!op.query) {
      // One more row than asked says whether a next page exists.
      rows = statement.all(...params, op.limit + 1, offset).map(shape);
      if (rows.length > op.limit) { rows = rows.slice(0, op.limit); next = String(offset + op.limit); }
    } else {
      // The text column matched in SQL; a rich-text-only row is decoded and
      // matched here. `position` counts candidates, so the cursor resumes
      // right after the last message given, or where the budget stopped.
      const needle = op.query.toLowerCase();
      rows = [];
      let position = offset;
      scan: while (position - offset < RICH_TEXT_BUDGET) {
        const window = statement.all(...params, RICH_TEXT_WINDOW, position);
        for (const raw of window) {
          const plain = String(raw.text ?? "").trim() !== "";
          const row = shape(raw);
          if (plain || row.text.toLowerCase().includes(needle)) {
            if (rows.length === op.limit) { next = String(position); break scan; }
            rows.push(row);
          }
          position += 1;
        }
        if (window.length < RICH_TEXT_WINDOW) break;
        if (position - offset >= RICH_TEXT_BUDGET) next = String(position);
      }
    }
    const files = attachmentsOf(db, rows.map((row) => row.rowid));
    const reactions = new Map();
    if (rows.length && cols.has("associated_message_type") && cols.has("associated_message_guid")) {
      const react = db.prepare(`SELECT m.associated_message_guid AS target, m.associated_message_type AS type, m.is_from_me AS from_me, h.id AS handle
        FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE m.associated_message_type >= 2000 AND m.associated_message_type < 4000 AND (${rows.map(() => "m.associated_message_guid LIKE ?").join(" OR ")})
        ORDER BY m.date ASC`);
      react.setReadBigInts?.(true);
      for (const row of react.all(...rows.map((item) => `%${item.id}`))) {
        const type = Number(row.type);
        if (!isReaction(type)) continue;
        const target = targetGuid(row.target);
        const who = String(row.from_me) === "1" ? "me" : String(row.handle ?? "");
        const kind = REACTIONS[(type % 1000)] ?? "reaction";
        const list = (reactions.get(target) ?? []).filter((item) => !(item.from === who && item.reaction === kind));
        if (type < 3000) list.push({ from: who, reaction: kind });
        reactions.set(target, list);
      }
    }
    const messages = rows.map(({ rowid, ...row }) => ({
      ...row,
      ...(reactions.get(row.id)?.length ? { reactions: reactions.get(row.id) } : {}),
      ...(files.get(rowid)?.length ? { attachments: files.get(rowid).map((item, index) => ({ index, name: item.name, mime: item.mime, bytes: item.bytes })) } : {}),
    }));
    return next === undefined ? { messages } : { messages, next };
  } finally {
    try { db.close(); } catch { /* read only */ }
  }
}

const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** The short random prefix every file an Apple app tool saves or stages
 * takes, so two files of the same name never meet in one folder. */
const filePrefix = () => `${randomBytes(4).toString("hex")}-`;

/** The one name for a file an Apple app tool saves (an attachment) or
 * stages (a file to send, on the person's Mac): the random prefix, then the
 * file's own base name made safe for any folder. */
export function macAppFileName(name) {
  // oxlint-disable-next-line no-control-regex
  const safe = path.basename(String(name || "attachment")).replace(/[\\/:\u0000-\u001f]/g, "_").replace(/^\.+/, "_").slice(0, 180) || "attachment";
  return filePrefix() + safe;
}

/** Copy one attachment of a message (by index, or by its attachment row for
 * the older read_attachment name) into `saveDir`. Only a file inside the
 * Messages folder is read. */
export async function readMessageAttachment(dir, op, saveDir, { open = openDatabase } = {}) {
  const db = await open(path.join(dir, "chat.db"));
  let item;
  try {
    const found = db.prepare("SELECT ROWID AS rowid FROM message WHERE guid = ?");
    found.setReadBigInts?.(true);
    const row = found.get(op.id);
    if (!row) throw new Error("No message with that id. mac_messages_read gives the ids.");
    const list = attachmentsOf(db, [String(row.rowid)]).get(String(row.rowid)) ?? [];
    item = op.attachmentId !== undefined ? list.find((entry) => entry.rowid === String(op.attachmentId)) : list[op.index];
    if (!item) throw new Error(`That message has ${list.length} attachment(s). mac_messages_read lists them.`);
  } finally {
    try { db.close(); } catch { /* read only */ }
  }
  if (!item.file) throw new Error("That attachment has no file on this Mac yet (not downloaded).");
  const home = path.resolve(dir, "..", "..");
  const source = item.file.startsWith("~/") ? path.join(home, item.file.slice(2)) : path.resolve(item.file);
  let real;
  try { real = fs.realpathSync(source); } catch { throw new Error("That attachment's file is not on this Mac (not downloaded, or removed)."); }
  const root = fs.realpathSync(dir);
  if (!real.startsWith(root + path.sep)) throw new Error("That attachment is outside the Messages folder. Nothing was read.");
  const info = fs.statSync(real);
  if (!info.isFile()) throw new Error("That attachment is not a file.");
  if (info.size > ATTACHMENT_MAX_BYTES) throw new Error("That attachment is over 25 MB. Nothing was saved.");
  fs.mkdirSync(saveDir, { recursive: true, mode: 0o700 });
  const target = path.join(saveDir, macAppFileName(item.name));
  fs.copyFileSync(real, target);
  return { path: target, name: item.name, mime: item.mime, bytes: info.size };
}

/** The conversations, newest activity first, with their members. */
export async function listChats(dir, op, { open = openDatabase } = {}) {
  const db = await open(path.join(dir, "chat.db"));
  try {
    const params = [];
    let having = "";
    if (op.query) {
      having = "HAVING (c.display_name LIKE ? OR c.chat_identifier LIKE ? OR members LIKE ?)";
      params.push(`%${op.query}%`, `%${op.query}%`, `%${op.query}%`);
    }
    const sql = `SELECT c.guid AS guid, c.chat_identifier AS ident, c.display_name AS name, MAX(m.date) AS last, COUNT(m.ROWID) AS count,
        (SELECT group_concat(h.id, char(10)) FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID) AS members
      FROM chat c
      LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
      LEFT JOIN message m ON m.ROWID = cmj.message_id
      GROUP BY c.ROWID ${having}
      ORDER BY last DESC LIMIT ? OFFSET ?`;
    params.push(op.limit, Math.max(0, op.offset ?? 0));
    const statement = db.prepare(sql);
    statement.setReadBigInts?.(true);
    return statement.all(...params).map((row) => {
      const members = String(row.members ?? "").split("\n").filter(Boolean);
      return {
        chat: String(row.guid ?? ""),
        name: String(row.name || "") || null,
        members: members.length ? members : [String(row.ident ?? "")].filter(Boolean),
        group: members.length > 1,
        lastActivity: appleDate(row.last),
        messages: Number(row.count ?? 0),
      };
    });
  } finally {
    try { db.close(); } catch { /* read only */ }
  }
}

/** A file to attach, as an absolute path: a staged name inside `filesDir`, or
 * (no filesDir) an absolute path already checked by the server. */
function attachableFile(file, filesDir) {
  let target;
  if (filesDir) {
    const name = path.basename(String(file));
    if (!name || name === "." || name === ".." || name !== String(file)) throw new Error("A file to attach must be staged by the server first. Nothing was sent.");
    target = path.join(filesDir, name);
  } else {
    if (!path.isAbsolute(String(file))) throw new Error("A file to attach must be a path in this bot's folder. Nothing was sent.");
    target = path.resolve(String(file));
  }
  let info;
  try { info = fs.statSync(target); } catch { throw new Error(`The file ${path.basename(target)} could not be read. Nothing was sent.`); }
  if (!info.isFile()) throw new Error(`${path.basename(target)} is not a file. Nothing was sent.`);
  if (info.size > ATTACHMENT_MAX_BYTES) throw new Error(`${path.basename(target)} is over 25 MB. Nothing was sent.`);
  return target;
}

const PHOTO_IMAGE_EXT = new Set([".heic", ".heif", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".webp", ".bmp", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2"]);
const MIME_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".heic": "image/heic", ".heif": "image/heif", ".png": "image/png", ".gif": "image/gif", ".tif": "image/tiff", ".tiff": "image/tiff", ".webp": "image/webp", ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/x-m4v", ".dng": "image/x-adobe-dng" };
const mimeOf = (file) => MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "application/octet-stream";
/** How long Photos may take to export: an original kept in iCloud downloads first. */
export const PHOTOS_EXPORT_TIMEOUT_MS = 180_000;

/** sips (built into macOS, no window): the longest side of a photo, then a
 * JPEG of at most maxSize pixels (never enlarged). */
async function resizedJpeg(source, target, maxSize, run) {
  let side = 0;
  try {
    const { stdout } = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", source], { timeout: 30_000, maxBuffer: 64 * 1024 });
    side = Math.max(...[...String(stdout).matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((hit) => Number(hit[1])), 0);
  } catch { /* unknown size: resize anyway */ }
  const resize = side === 0 || side > maxSize ? ["-Z", String(maxSize)] : [];
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", ...resize, source, "--out", target], { timeout: 60_000, maxBuffer: 256 * 1024 });
}

/** mac_photos_export: Photos writes each item into its own temporary folder
 * inside saveDir; each file is then resized to a JPEG (or kept as the
 * original) and moved into saveDir with a random prefix. */
export async function exportPhotos(op, deps = {}) {
  const run = deps.execFile ?? execFilePromise;
  const work = path.join(deps.saveDir, `.photos-${randomBytes(4).toString("hex")}`);
  fs.mkdirSync(work, { recursive: true, mode: 0o700 });
  try {
    const dirs = op.ids.map((_, index) => path.join(work, String(index)));
    for (const dir of dirs.slice(op.offset)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const found = await runScript("photos", MAC_APP_SCRIPTS.mac_photos_export, { ...op, dirs }, { ...deps, timeoutMs: deps.timeoutMs ?? PHOTOS_EXPORT_TIMEOUT_MS });
    const files = [];
    const failed = Array.isArray(found?.failed) ? found.failed.map((row) => ({ id: row.id, error: `Photos could not export it: ${String(row.error ?? "unknown error").slice(0, 300)}` })) : [];
    for (const item of Array.isArray(found?.exported) ? found.exported : []) {
      const dir = dirs[item.index];
      let names = [];
      try { names = dir ? fs.readdirSync(dir).filter((entry) => !entry.startsWith(".")) : []; } catch { names = []; }
      if (!names.length) { failed.push({ id: item.id, error: "Photos wrote no file for it (an original still in iCloud that could not download, or a format it does not export)." }); continue; }
      // A resized export keeps the still of a Live Photo, not its video.
      const picked = op.original ? names : [names.find((entry) => PHOTO_IMAGE_EXT.has(path.extname(entry).toLowerCase())) ?? names[0]];
      for (const entry of picked) {
        const source = path.join(dir, entry);
        const image = PHOTO_IMAGE_EXT.has(path.extname(entry).toLowerCase());
        const target = path.join(deps.saveDir, macAppFileName(!op.original && image ? `${path.basename(entry, path.extname(entry))}.jpg` : entry));
        try {
          if (!op.original && image) await resizedJpeg(source, target, op.maxSize, run);
          else fs.renameSync(source, target);
        } catch (error) {
          failed.push({ id: item.id, name: entry, error: `The photo could not be converted on this Mac: ${String(error?.stderr || error?.message || error).split("\n")[0].slice(0, 200)}` });
          continue;
        }
        let bytes = 0;
        try { bytes = fs.statSync(target).size; } catch { failed.push({ id: item.id, name: entry, error: "The exported file was not found." }); continue; }
        if (bytes > ATTACHMENT_MAX_BYTES) {
          fs.rmSync(target, { force: true });
          failed.push({ id: item.id, name: entry, error: "This file is over 25 MB, the most a file here can be. Export it resized (without original), or a shorter video." });
          continue;
        }
        files.push({ id: item.id, path: target, name: path.basename(target).slice(9), mime: !op.original && image ? "image/jpeg" : mimeOf(target), bytes });
      }
    }
    const out = { files, failed };
    if (typeof found?.next === "string") out.next = found.next;
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Run one tool on this Mac. Returns an MCP tool result, never throws. */
export async function runMacAppCall(name, args, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return failure(`Unknown tool: ${name}`);
  if (platform !== "darwin") return failure("The Apple apps run only on a Mac.");
  let op;
  try { op = macAppOperation(name, args); } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
  // Files to attach: on the desktop app, names of files the server staged in
  // its attachments folder (filesDir); on the solo Mac, paths the server
  // already checked sit in the bot's folder. Each must be a file of 25 MB at most.
  if (op.files) {
    try { op = { ...op, files: op.files.map((file) => attachableFile(file, deps.filesDir)) }; } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
  }
  try {
    if (macAppSavesFiles(name)) {
      if (!deps.saveDir) return failure(name === "mac_photos_export" ? "There is no folder to save the photos in here." : "There is no folder to save the attachment in here.");
    }
    if (name === "mac_photos_export") {
      const out = await exportPhotos(op, deps);
      return !out.files.length && out.failed.length ? { ...text(out), isError: true } : text(out);
    }
    if (name === "mac_messages_read_attachment") {
      const dir = deps.messagesDir ?? messagesDir();
      if (probeMessagesAccess(dir) !== "granted") return failure("Messages could not be read. Sagax needs Full Disk Access on this Mac (System Settings > Privacy & Security > Full Disk Access).");
      try {
        return text(await (deps.readMessageAttachment ?? readMessageAttachment)(dir, { ...op, ...(typeof args?.attachmentId === "number" ? { attachmentId: args.attachmentId } : {}) }, deps.saveDir));
      } catch (error) {
        return failure(error?.code ? messagesReadErrorText(error) : (error instanceof Error ? error.message : String(error)));
      }
    }
    if (name === "mac_mail_read_attachment") {
      fs.mkdirSync(deps.saveDir, { recursive: true, mode: 0o700 });
      const found = await runScript(tool.app, MAC_APP_SCRIPTS[name], { ...macAppScriptArgs(name, op), dir: deps.saveDir, prefix: filePrefix() }, deps);
      const saved = typeof found?.path === "string" ? path.resolve(found.path) : "";
      if (!saved.startsWith(path.resolve(deps.saveDir) + path.sep)) return failure("Mail did not save the attachment.");
      let size = 0;
      try { size = fs.statSync(saved).size; } catch { return failure("Mail did not save the attachment."); }
      if (size > ATTACHMENT_MAX_BYTES) { fs.rmSync(saved, { force: true }); return failure("That attachment is over 25 MB. Nothing was saved."); }
      return text({ ...found, path: saved, bytes: size });
    }
    if (name === "mac_messages_read" || name === "mac_messages_list_chats") {
      const dir = deps.messagesDir ?? messagesDir();
      if (probeMessagesAccess(dir) !== "granted") return failure("Messages could not be read. Sagax needs Full Disk Access on this Mac (System Settings > Privacy & Security > Full Disk Access).");
      try {
        if (name === "mac_messages_read") return text(await (deps.readMessages ?? readMessages)(dir, op));
        // One more row than asked says whether a next page exists.
        const rows = await (deps.listChats ?? listChats)(dir, { ...op, limit: op.limit + 1 });
        const out = { chats: rows.slice(0, op.limit) };
        return text(rows.length > op.limit ? { ...out, next: String((op.offset ?? 0) + op.limit) } : out);
      } catch (error) {
        return failure(messagesReadErrorText(error));
      }
    }
    const found = await runScript(tool.app, MAC_APP_SCRIPTS[name], macAppScriptArgs(name, op), deps);
    const out = tool.app === "mail" ? mailResult(found) : found;
    // A write where every item failed is an error; a partial one lists what failed.
    const failedAll = Array.isArray(out?.failed) && out.failed.length > 0 && !(out.updated || out.moved || out.deleted || out.completed || out.added || out.removed);
    return failedAll ? { ...text(out), isError: true } : text(out);
  } catch (error) {
    return failure(macAppErrorText(tool.app, error).message);
  }
}

// --- Automation (Apple Events) grant, per app. ------------------------------
// macOS lists an app under Sagax in Privacy & Security > Automation only after
// Sagax sent it an Apple Event and the person answered the prompt, so a page
// that only opens System Settings can never get the grant. The signed helper
// (electron/resources/automation-helper.swift) calls
// AEDeterminePermissionToAutomateTarget: "status" never prompts, "ask" shows
// macOS's prompt. It runs as a child of Sagax, so TCC attributes it to Sagax.
const HELPER_NAME = "automation-helper";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** The helper binary, or null (development without `pnpm build:speech`). */
export function automationHelperPath({ env = process.env, resourcesPath = process.resourcesPath, exists = fs.existsSync } = {}) {
  const candidates = [
    env.SAGAX_AUTOMATION_HELPER,
    resourcesPath ? path.join(resourcesPath, HELPER_NAME) : null,
    // packaged: Resources/app.asar/electron/mac-apps.mjs or Resources/server/electron/...
    path.join(moduleDir, "..", "..", HELPER_NAME),
    path.join(moduleDir, "..", "..", "..", HELPER_NAME),
    path.join(moduleDir, "resources", HELPER_NAME),
  ].filter(Boolean);
  return candidates.find((file) => { try { return exists(file); } catch { return false; } }) ?? null;
}

/** Helper output to a permission state; null when macOS could not say. */
export function automationStateOf(output) {
  const word = String(output ?? "").trim().split(/\s+/)[0];
  if (word === "granted" || word === "denied" || word === "notAsked") return word;
  return null;
}

async function runHelper(mode, bundleId, deps) {
  const helper = deps.helper !== undefined ? deps.helper : automationHelperPath();
  if (!helper) return { state: null, helper: false };
  const run = deps.execFile ?? execFilePromise;
  try {
    const { stdout } = await run(helper, [mode, bundleId], { timeout: mode === "ask" ? 120_000 : 8_000, maxBuffer: 64 * 1024 });
    return { state: automationStateOf(stdout), helper: true };
  } catch {
    return { state: null, helper: true };
  }
}

/** The live Automation state of one app, never prompting. Null: unknown
 * (the app is not running, or no helper). */
export async function probeMacAppAutomation(appId, deps = {}) {
  const app = macAppInfo(appId);
  if (!app || (deps.platform ?? process.platform) !== "darwin") return null;
  return (await runHelper("status", app.bundleId, deps)).state;
}

/** Ask macOS for the Automation grant: shows the system prompt naming Sagax
 * when the person has not answered yet. Saves and returns the state. */
export async function requestMacAppAutomation(dir, appId, deps = {}) {
  const app = macAppInfo(appId);
  if (!app) throw new Error("Unknown app");
  if ((deps.platform ?? process.platform) !== "darwin") return "unsupported";
  let { state, helper } = await runHelper("ask", app.bundleId, deps);
  if (!state && !helper) {
    // No helper: a harmless read-only tell (the app's name) from an osascript
    // child of Sagax raises the same prompt, attributed to Sagax.
    try {
      await (deps.execFile ?? execFilePromise)("osascript", ["-e", `tell application id "${app.bundleId}" to get name`], { timeout: 120_000, maxBuffer: 64 * 1024 });
      state = "granted";
    } catch (error) {
      state = macAppErrorText(appId, error).denied ? "denied" : null;
    }
  }
  if (state) writeMacAppSettings(dir, appId, { automation: state });
  return state ?? readMacAppSettings(dir)[appId].automation;
}

/** macAppsStatus with every app's Automation read live from macOS first. */
export async function macAppsStatusLive(dir, deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform === "darwin") {
    const states = await Promise.all(MAC_APP_IDS.map(async (id) => [id, await probeMacAppAutomation(id, { ...deps, platform })]));
    const saved = readMacAppSettings(dir);
    for (const [id, state] of states) {
      if (state && saved[id].automation !== state) writeMacAppSettings(dir, id, { automation: state });
    }
  }
  return macAppsStatus(dir, { platform, ...(deps.messagesAccess ? { messagesAccess: deps.messagesAccess } : {}) });
}

// --- Setup state (the On/Off switch and the last test), one JSON file. -----
const SETTINGS_FILE = "mac-apps.json";
export function readMacAppSettings(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8"));
    const apps = raw && typeof raw.apps === "object" && raw.apps ? raw.apps : {};
    return Object.fromEntries(MAC_APP_IDS.map((id) => {
      const row = apps[id] && typeof apps[id] === "object" ? apps[id] : {};
      return [id, { enabled: row.enabled === true, automation: ["granted", "denied", "notAsked"].includes(row.automation) ? row.automation : "notAsked" }];
    }));
  } catch {
    return Object.fromEntries(MAC_APP_IDS.map((id) => [id, { enabled: false, automation: "notAsked" }]));
  }
}

export function writeMacAppSettings(dir, appId, patch) {
  if (!MAC_APP_IDS.includes(appId)) throw new Error("Unknown app");
  const all = readMacAppSettings(dir);
  all[appId] = { ...all[appId], ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}), ...(patch.automation ? { automation: patch.automation } : {}) };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SETTINGS_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ apps: all }, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  return all;
}

export const macAppEnabled = (dir, appId) => readMacAppSettings(dir)[appId]?.enabled === true;

/** The setup page's status for every app. */
export function macAppsStatus(dir, { platform = process.platform, messagesAccess = () => probeMessagesAccess() } = {}) {
  const settings = readMacAppSettings(dir);
  const onMac = platform === "darwin";
  const fullDisk = onMac ? messagesAccess() : "unsupported";
  return {
    available: onMac,
    onThisMac: onMac,
    ...(onMac ? {} : { reason: "not_darwin" }),
    apps: MAC_APPS.map((app) => {
      const permissions = {
        automation: onMac ? settings[app.id].automation : "unsupported",
        ...(app.fullDiskAccess ? { fullDiskAccess: fullDisk } : {}),
      };
      return {
        id: app.id,
        enabled: settings[app.id].enabled,
        permissions,
        // What bots can do with this app on this Mac, one row per tool, with
        // the permission each needs and whether it is granted. The window's
        // detail and the tool list read this one list.
        actions: onMac
          ? MAC_APP_TOOLS.filter((tool) => tool.app === app.id).map((tool) => ({ tool: tool.name, kind: tool.kind, needs: tool.needs, granted: permissions[tool.needs] === "granted" }))
          : [],
      };
    }),
  };
}

/** The Test button: a light read that also asks macOS for Automation. */
export async function testMacApp(dir, appId, deps = {}) {
  const app = macAppInfo(appId);
  if (!app) throw new Error("Unknown app");
  if ((deps.platform ?? process.platform) !== "darwin") return { ok: false, error: "The Apple apps run only on a Mac.", count: 0, names: [] };
  try {
    if (appId === "messages") {
      let rows;
      try {
        rows = (await (deps.readMessages ?? readMessages)(deps.messagesDir ?? messagesDir(), { limit: 50 })).messages;
      } catch (error) {
        return { ok: false, error: messagesReadErrorText(error), count: 0, names: [] };
      }
      const names = [...new Set(rows.map((row) => row.chat).filter(Boolean))];
      return { ok: true, count: names.length, names: names.slice(0, 8).map((name) => name.slice(0, 60)) };
    }
    const found = await runScript(appId, MAC_APP_TEST_SCRIPTS[appId], {}, { ...deps, timeoutMs: 30_000 });
    writeMacAppSettings(dir, appId, { automation: "granted" });
    const names = Array.isArray(found?.names) ? found.names.map(String).filter(Boolean) : [];
    return { ok: true, count: typeof found?.count === "number" ? found.count : names.length, names: names.slice(0, 8).map((name) => name.slice(0, 60)) };
  } catch (error) {
    const reason = macAppErrorText(appId, error);
    if (reason.denied) writeMacAppSettings(dir, appId, { automation: "denied" });
    return { ok: false, error: reason.message, count: 0, names: [] };
  }
}
