// The Apple apps of the person's own Mac (Messages, Mail, Calendar, Contacts,
// Reminders, Notes) as bot tools. One module for both modes:
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
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const MAC_APPS = [
  { id: "messages", name: "Messages", bundleId: "com.apple.MobileSMS", fullDiskAccess: true },
  { id: "mail", name: "Mail", bundleId: "com.apple.mail", fullDiskAccess: false },
  { id: "calendar", name: "Calendar", bundleId: "com.apple.iCal", fullDiskAccess: false },
  { id: "contacts", name: "Contacts", bundleId: "com.apple.AddressBook", fullDiskAccess: false },
  { id: "reminders", name: "Reminders", bundleId: "com.apple.reminders", fullDiskAccess: false },
  { id: "notes", name: "Notes", bundleId: "com.apple.Notes", fullDiskAccess: false },
];
export const MAC_APP_IDS = MAC_APPS.map((app) => app.id);

const where = "in the Apple app on the Mac of the person you work for";
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const limit = (max) => ({ type: "number", description: `How many to return (at most ${max}).` });

export const MAC_APP_TOOLS = [
  { name: "mac_messages_read", app: "messages", write: false, description: `Read recent messages ${where} Messages. Filter by a chat (a phone number, an email or a chat name) and by words.`,
    inputSchema: obj({ chat: { type: "string", description: "Phone number, email or chat name." }, query: { type: "string", description: "Words the message contains." }, limit: limit(100) }) },
  { name: "mac_messages_send", app: "messages", write: true, description: `Send an iMessage or SMS ${where} Messages, to one phone number or email.`,
    inputSchema: obj({ to: { type: "string", description: "One phone number or email." }, text: { type: "string" } }, ["to", "text"]) },
  { name: "mac_mail_search", app: "mail", write: false, description: `Search the inbox ${where} Mail, by subject or sender. Returns ids for mac_mail_read.`,
    inputSchema: obj({ query: { type: "string", description: "Words in the subject or the sender. Empty: the latest messages." }, limit: limit(50) }) },
  { name: "mac_mail_read", app: "mail", write: false, description: `Read one email ${where} Mail, by the id mac_mail_search gave.`,
    inputSchema: obj({ id: { type: "number" } }, ["id"]) },
  { name: "mac_mail_send", app: "mail", write: true, description: `Send an email ${where} Mail, from its default account.`,
    inputSchema: obj({ to: { type: "array", items: { type: "string" } }, cc: { type: "array", items: { type: "string" } }, subject: { type: "string" }, body: { type: "string" } }, ["to", "subject", "body"]) },
  { name: "mac_calendar_list", app: "calendar", write: false, description: `List events ${where} Calendar between two dates (default: the next 7 days).`,
    inputSchema: obj({ from: { type: "string", description: "ISO date or date-time." }, to: { type: "string", description: "ISO date or date-time." }, calendar: { type: "string", description: "One calendar's name (default: all)." }, limit: limit(200) }) },
  { name: "mac_calendar_create", app: "calendar", write: true, description: `Create an event ${where} Calendar.`,
    inputSchema: obj({ title: { type: "string" }, start: { type: "string", description: "ISO date-time." }, end: { type: "string", description: "ISO date-time." }, calendar: { type: "string", description: "Calendar name (default: the first writable one)." }, location: { type: "string" }, notes: { type: "string" }, allDay: { type: "boolean" } }, ["title", "start", "end"]) },
  { name: "mac_contacts_search", app: "contacts", write: false, description: `Find people ${where} Contacts by name: emails, phones and organization.`,
    inputSchema: obj({ query: { type: "string" }, limit: limit(50) }, ["query"]) },
  { name: "mac_reminders_list", app: "reminders", write: false, description: `List reminders ${where} Reminders (open ones by default).`,
    inputSchema: obj({ list: { type: "string", description: "One list's name (default: all)." }, includeCompleted: { type: "boolean" }, limit: limit(200) }) },
  { name: "mac_reminders_create", app: "reminders", write: true, description: `Create a reminder ${where} Reminders.`,
    inputSchema: obj({ title: { type: "string" }, notes: { type: "string" }, due: { type: "string", description: "ISO date-time." }, list: { type: "string", description: "List name (default: the default list)." } }, ["title"]) },
  { name: "mac_notes_search", app: "notes", write: false, description: `Search notes ${where} Notes, by title or text.`,
    inputSchema: obj({ query: { type: "string" }, limit: limit(50) }, ["query"]) },
  { name: "mac_notes_create", app: "notes", write: true, description: `Create a note ${where} Notes.`,
    inputSchema: obj({ title: { type: "string" }, body: { type: "string" }, folder: { type: "string", description: "Folder name (default: the default folder)." } }, ["title", "body"]) },
];

const TOOL_BY_NAME = new Map(MAC_APP_TOOLS.map((tool) => [tool.name, tool]));
export const isMacAppTool = (name) => typeof name === "string" && TOOL_BY_NAME.has(name);
export const macAppOfTool = (name) => TOOL_BY_NAME.get(name)?.app ?? null;
export const macAppToolWrites = (name) => TOOL_BY_NAME.get(name)?.write === true;
export const macAppInfo = (id) => MAC_APPS.find((app) => app.id === id) ?? null;

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

/** The bounded arguments one call becomes. Throws on bad input. */
export function macAppOperation(name, args) {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  switch (name) {
    case "mac_messages_read":
      return { chat: str(a.chat, "chat", { max: 200 }), query: str(a.query, "query", { max: 200 }), limit: num(a.limit, 20, 100) };
    case "mac_messages_send": {
      const to = str(a.to, "to", { max: 320, required: true });
      if (!RECIPIENT.test(to)) bad("to must be one phone number or email");
      return { to, text: str(a.text, "text", { max: 4_000, required: true, multiline: true }) };
    }
    case "mac_mail_search":
      return { query: str(a.query, "query", { max: 200 }) ?? "", limit: num(a.limit, 10, 50) };
    case "mac_mail_read": {
      if (typeof a.id !== "number" || !Number.isInteger(a.id) || a.id < 0) bad("id must be a message id from mac_mail_search");
      return { id: a.id };
    }
    case "mac_mail_send":
      return {
        to: addresses(a.to, "to", true),
        cc: addresses(a.cc, "cc", false),
        subject: str(a.subject, "subject", { max: 500, required: true }),
        body: str(a.body, "body", { max: 100_000, required: true, multiline: true }),
      };
    case "mac_calendar_list": {
      const from = date(a.from, "from") ?? new Date().toISOString();
      const to = date(a.to, "to") ?? new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
      if (Date.parse(to) <= Date.parse(from)) bad("to must be after from");
      if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) bad("A range is at most one year");
      return { from, to, calendar: str(a.calendar, "calendar", { max: 200 }), limit: num(a.limit, 50, 200) };
    }
    case "mac_calendar_create": {
      const start = date(a.start, "start", true);
      const end = date(a.end, "end", true);
      if (Date.parse(end) < Date.parse(start)) bad("end must not be before start");
      return {
        title: str(a.title, "title", { max: 500, required: true }), start, end,
        calendar: str(a.calendar, "calendar", { max: 200 }), location: str(a.location, "location", { max: 500 }),
        notes: str(a.notes, "notes", { max: 20_000, multiline: true }), allDay: a.allDay === true,
      };
    }
    case "mac_contacts_search":
      return { query: str(a.query, "query", { max: 200, required: true }), limit: num(a.limit, 10, 50) };
    case "mac_reminders_list":
      return { list: str(a.list, "list", { max: 200 }), includeCompleted: a.includeCompleted === true, limit: num(a.limit, 50, 200) };
    case "mac_reminders_create":
      return { title: str(a.title, "title", { max: 500, required: true }), notes: str(a.notes, "notes", { max: 20_000, multiline: true }), due: date(a.due, "due"), list: str(a.list, "list", { max: 200 }) };
    case "mac_notes_search":
      return { query: str(a.query, "query", { max: 200, required: true }), limit: num(a.limit, 10, 50) };
    case "mac_notes_create":
      return { title: str(a.title, "title", { max: 500, required: true }), body: str(a.body, "body", { max: 100_000, required: true, multiline: true }), folder: str(a.folder, "folder", { max: 200 }) };
    default:
      return bad(`unknown tool ${name}`);
  }
}

/** One-line summary for an approval card or a log: the target, never the content. */
export function macAppTarget(name, args) {
  const a = args ?? {};
  switch (name) {
    case "mac_messages_send": return `Messages to ${a.to ?? ""}`;
    case "mac_mail_send": return `Mail to ${(a.to ?? []).join(", ")}`;
    case "mac_calendar_create": return `Calendar event "${a.title ?? ""}"`;
    case "mac_reminders_create": return `Reminder "${a.title ?? ""}"`;
    case "mac_notes_create": return `Note "${a.title ?? ""}"`;
    default: return name;
  }
}

// --- JXA. Constant text: the only input is argv[0], a JSON object. ---------
const PRELUDE = "function run(argv){var a=JSON.parse(argv[0]);var out=main(a);return JSON.stringify(out===undefined?null:out);}\n"
  + "function iso(d){try{return d?d.toISOString():null}catch(e){return null}}\n"
  + "function cut(s,n){s=s==null?'':String(s);return s.length>n?s.slice(0,n)+'...':s}\n";

export const MAC_APP_SCRIPTS = {
  mac_messages_send: PRELUDE + `function main(a){var M=Application('Messages');var svc=null;
try{svc=M.accounts.whose({serviceType:'iMessage'})()[0]||null}catch(e){}
if(!svc){try{svc=M.services.whose({serviceType:'iMessage'})()[0]||null}catch(e){}}
var who=null;if(svc){try{who=svc.participants.byName(a.to);who.name()}catch(e){who=null}
if(!who){try{who=svc.buddies.byName(a.to);who.name()}catch(e){who=null}}}
if(!who){try{who=M.participants.byName(a.to);who.name()}catch(e){who=null}}
if(!who)throw new Error('Messages does not know '+a.to);M.send(a.text,{to:who});return {sent:true,to:a.to};}`,
  mac_mail_search: PRELUDE + `function main(a){var Mail=Application('Mail');var box=Mail.inbox;
var list=a.query?box.messages.whose({_or:[{subject:{_contains:a.query}},{sender:{_contains:a.query}}]}):box.messages;
var n=Math.min(list.length,a.limit);var out=[];for(var i=0;i<n;i++){var m=list[i];
out.push({id:m.id(),subject:cut(m.subject(),300),sender:cut(m.sender(),300),date:iso(m.dateReceived()),read:m.readStatus()})}
return {messages:out};}`,
  mac_mail_read: PRELUDE + `function main(a){var Mail=Application('Mail');var found=Mail.inbox.messages.whose({id:a.id})();
if(!found.length){var accts=Mail.accounts();for(var i=0;i<accts.length&&!found.length;i++){var boxes=accts[i].mailboxes();
for(var j=0;j<boxes.length&&!found.length;j++){try{found=boxes[j].messages.whose({id:a.id})()}catch(e){}}}}
if(!found.length)throw new Error('No email with that id');var m=found[0];
var to=[];try{to=m.toRecipients().map(function(r){return r.address()})}catch(e){}
return {id:a.id,subject:m.subject(),sender:m.sender(),to:to,date:iso(m.dateReceived()),content:cut(m.content(),20000)};}`,
  mac_mail_send: PRELUDE + `function main(a){var Mail=Application('Mail');
var msg=Mail.OutgoingMessage({subject:a.subject,content:a.body,visible:false});Mail.outgoingMessages.push(msg);
a.to.forEach(function(x){msg.toRecipients.push(Mail.Recipient({address:x}))});
a.cc.forEach(function(x){msg.ccRecipients.push(Mail.CcRecipient({address:x}))});
msg.send();return {sent:true,to:a.to,cc:a.cc};}`,
  mac_calendar_list: PRELUDE + `function main(a){var Cal=Application('Calendar');var from=new Date(a.from),to=new Date(a.to);
var cals=a.calendar?Cal.calendars.whose({name:a.calendar})():Cal.calendars();var out=[];
for(var i=0;i<cals.length&&out.length<a.limit;i++){var ev=cals[i].events.whose({_and:[{startDate:{_greaterThan:from}},{startDate:{_lessThan:to}}]})();
for(var j=0;j<ev.length&&out.length<a.limit;j++){var e=ev[j];var loc=null;try{loc=e.location()}catch(x){}
out.push({id:e.uid(),calendar:cals[i].name(),title:cut(e.summary(),300),start:iso(e.startDate()),end:iso(e.endDate()),allDay:e.alldayEvent(),location:loc?cut(loc,300):null})}}
out.sort(function(x,y){return x.start<y.start?-1:1});return {events:out};}`,
  mac_calendar_create: PRELUDE + `function main(a){var Cal=Application('Calendar');var cal=null;
if(a.calendar){cal=Cal.calendars.whose({name:a.calendar})()[0]||null;if(!cal)throw new Error('No calendar named '+a.calendar)}
else{var all=Cal.calendars();for(var i=0;i<all.length&&!cal;i++){try{if(all[i].writable())cal=all[i]}catch(e){}}if(!cal)cal=all[0]}
var props={summary:a.title,startDate:new Date(a.start),endDate:new Date(a.end),alldayEvent:a.allDay};
if(a.location)props.location=a.location;if(a.notes)props.description=a.notes;
var e=Cal.Event(props);cal.events.push(e);return {created:true,id:e.uid(),calendar:cal.name()};}`,
  mac_contacts_search: PRELUDE + `function main(a){var C=Application('Contacts');var ppl=C.people.whose({name:{_contains:a.query}})();var out=[];
for(var i=0;i<ppl.length&&i<a.limit;i++){var p=ppl[i];var org=null;try{org=p.organization()}catch(e){}
out.push({name:p.name(),organization:org,emails:p.emails().map(function(x){return x.value()}),phones:p.phones().map(function(x){return x.value()})})}
return {people:out};}`,
  mac_reminders_list: PRELUDE + `function main(a){var R=Application('Reminders');var lists=a.list?R.lists.whose({name:a.list})():R.lists();var out=[];
for(var i=0;i<lists.length&&out.length<a.limit;i++){var rs=a.includeCompleted?lists[i].reminders():lists[i].reminders.whose({completed:false})();
for(var j=0;j<rs.length&&out.length<a.limit;j++){var r=rs[j];var due=null;try{due=r.dueDate()}catch(e){}
out.push({id:r.id(),list:lists[i].name(),title:cut(r.name(),300),due:iso(due),completed:r.completed()})}}
return {reminders:out};}`,
  mac_reminders_create: PRELUDE + `function main(a){var R=Application('Reminders');var list=null;
if(a.list){list=R.lists.whose({name:a.list})()[0]||null;if(!list)throw new Error('No list named '+a.list)}else{try{list=R.defaultList()}catch(e){list=R.lists()[0]}}
var props={name:a.title};if(a.notes)props.body=a.notes;if(a.due)props.dueDate=new Date(a.due);
var r=R.Reminder(props);list.reminders.push(r);return {created:true,id:r.id(),list:list.name()};}`,
  mac_notes_search: PRELUDE + `function main(a){var N=Application('Notes');var ns=N.notes.whose({_or:[{name:{_contains:a.query}},{plaintext:{_contains:a.query}}]})();var out=[];
for(var i=0;i<ns.length&&i<a.limit;i++){var n=ns[i];out.push({id:n.id(),title:cut(n.name(),300),modified:iso(n.modificationDate()),text:cut(n.plaintext(),2000)})}
return {notes:out};}`,
  mac_notes_create: PRELUDE + `function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function main(a){var N=Application('Notes');var folder=null;
if(a.folder){folder=N.folders.whose({name:a.folder})()[0]||null;if(!folder)throw new Error('No folder named '+a.folder)}
else{try{folder=N.defaultAccount().defaultFolder()}catch(e){folder=N.folders()[0]}}
var html='<h1>'+esc(a.title)+'</h1>'+esc(a.body).split('\\n').map(function(l){return '<div>'+(l||'<br>')+'</div>'}).join('');
var n=N.Note({body:html});folder.notes.push(n);return {created:true,id:n.id(),folder:folder.name()};}`,
};

/** Light reads the setup page's Test button runs (names and counts only). */
export const MAC_APP_TEST_SCRIPTS = {
  mail: PRELUDE + "function main(a){var M=Application('Mail');return {names:M.accounts().map(function(x){return x.name()})};}",
  calendar: PRELUDE + "function main(a){var C=Application('Calendar');return {names:C.calendars().map(function(x){return x.name()})};}",
  contacts: PRELUDE + "function main(a){var C=Application('Contacts');var g=C.groups().map(function(x){return x.name()});return {names:g,count:C.people.length};}",
  reminders: PRELUDE + "function main(a){var R=Application('Reminders');return {names:R.lists().map(function(x){return x.name()})};}",
  notes: PRELUDE + "function main(a){var N=Application('Notes');return {names:N.folders().map(function(x){return x.name()})};}",
  messages: PRELUDE + "function main(a){var M=Application('Messages');var n=0;try{n=M.chats.length}catch(e){}return {names:[],count:n};}",
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
  if (error?.killed || /ETIMEDOUT|timed out/i.test(raw)) return { denied: false, message: `${name} did not answer in time.` };
  const line = raw.split("\n").map((part) => part.replace(/^.*execution error:\s*/, "").trim()).find(Boolean) ?? "";
  return { denied: false, message: `${name} refused: ${line.slice(0, 300) || "unknown error"}` };
}

async function runScript(appId, script, args, { execFile = execFilePromise, signal, timeoutMs = 60_000 } = {}) {
  const { stdout } = await execFile("osascript", macAppArgv(script, args), { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) });
  const raw = String(stdout ?? "").trim();
  try { return raw ? JSON.parse(raw) : null; } catch { return raw; }
}

// --- Messages database (read only). ----------------------------------------
const APPLE_EPOCH = 978_307_200;
function appleDate(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const seconds = value > 1e14 ? value / 1e9 : value;
  return new Date((seconds + APPLE_EPOCH) * 1000).toISOString();
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

export async function readMessages(dir, op, { open = openDatabase } = {}) {
  const db = await open(path.join(dir, "chat.db"));
  try {
    const where = [];
    const params = [];
    if (op.chat) {
      where.push("(c.chat_identifier = ? OR c.guid = ? OR c.display_name LIKE ? OR h.id = ?)");
      params.push(op.chat, op.chat, `%${op.chat}%`, op.chat);
    }
    if (op.query) {
      where.push("m.text LIKE ?");
      params.push(`%${op.query}%`);
    }
    const sql = `SELECT m.guid AS guid, c.chat_identifier AS chat, c.display_name AS chat_name, m.date AS date,
        m.is_from_me AS from_me, m.text AS text, m.attributedBody AS body, m.service AS service, h.id AS handle
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.date DESC LIMIT ?`;
    params.push(op.limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map((row) => ({
      id: String(row.guid ?? ""),
      chat: String(row.chat_name || row.chat || ""),
      from: Number(row.from_me) === 1 ? "me" : String(row.handle ?? ""),
      date: appleDate(row.date),
      service: String(row.service || "iMessage"),
      text: String(row.text ?? "").trim().slice(0, 4_000) || attributedText(row.body),
    }));
  } finally {
    try { db.close(); } catch { /* read only */ }
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
  try {
    if (name === "mac_messages_read") {
      const dir = deps.messagesDir ?? messagesDir();
      if (probeMessagesAccess(dir) !== "granted") return failure("Messages could not be read. Sagax needs Full Disk Access on this Mac (System Settings > Privacy & Security > Full Disk Access).");
      return text({ messages: await (deps.readMessages ?? readMessages)(dir, op) });
    }
    return text(await runScript(tool.app, MAC_APP_SCRIPTS[name], op, deps));
  } catch (error) {
    return failure(macAppErrorText(tool.app, error).message);
  }
}

// --- Setup state (the On/Off switch and the last test), one JSON file. -----
const SETTINGS_FILE = "mac-apps.json";
export function readMacAppSettings(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8"));
    const apps = raw && typeof raw.apps === "object" && raw.apps ? raw.apps : {};
    return Object.fromEntries(MAC_APP_IDS.map((id) => {
      const row = apps[id] && typeof apps[id] === "object" ? apps[id] : {};
      return [id, { enabled: row.enabled === true, automation: ["granted", "denied"].includes(row.automation) ? row.automation : "notAsked" }];
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
    apps: MAC_APPS.map((app) => ({
      id: app.id,
      enabled: settings[app.id].enabled,
      permissions: {
        automation: onMac ? settings[app.id].automation : "unsupported",
        ...(app.fullDiskAccess ? { fullDiskAccess: fullDisk } : {}),
      },
    })),
  };
}

/** The Test button: a light read that also asks macOS for Automation. */
export async function testMacApp(dir, appId, deps = {}) {
  const app = macAppInfo(appId);
  if (!app) throw new Error("Unknown app");
  if ((deps.platform ?? process.platform) !== "darwin") return { ok: false, error: "The Apple apps run only on a Mac.", count: 0, names: [] };
  try {
    if (appId === "messages") {
      const rows = await (deps.readMessages ?? readMessages)(deps.messagesDir ?? messagesDir(), { limit: 50 });
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
