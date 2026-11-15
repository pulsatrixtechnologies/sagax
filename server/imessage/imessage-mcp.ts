// Messages and the other Apple apps of the person's Mac (mac_* tools) for one
// turn. Solo: they run in this process, on this Mac. Organization server:
// they run on the person's own Mac through their desktop app (relay). Every
// Messages send takes one path (the Messages script) and one recipient
// check: a listed recipient, or a group whose every member is listed, sends;
// anyone else follows the bot's level like every other write.
//
// The older Messages names of the solo set (find_chats, read_messages,
// search_messages, read_attachment, send_message, check_permissions) are no
// longer listed: a call to one is answered by its mac_messages_ tool, so a
// routine that names it keeps working, and chat.db has one reader
// (electron/mac-apps.mjs).
import { statSync } from "node:fs";
import { basename } from "node:path";

import { sendRecipientsAllowed } from "../../shared/allowed-recipients.ts";
import {
  MESSAGES_SEND_MCP_NAME,
  MESSAGES_SEND_TOOL,
  handleFromChatGuid,
  messagesOnBotMac,
  type MessagesHost,
} from "../../shared/imessage.ts";
import { stageImessageSend, type PendingImessage } from "./imessage-cards.ts";
import { fileInsideRoots } from "./imessage-db.ts";
import { probeFullDiskAccess } from "./imessage-permissions.ts";
import {
  MAC_APP_TOOLS,
  MAC_APP_UPDATE_DESKTOP,
  isMacAppTool,
  listChats,
  macAppLegacyCall,
  macAppOfTool,
  macAppOperation,
  macAppTarget,
  macAppToolWrites,
  macAppToolsFor,
  type MacAppId,
  type MacAppToolResult,
} from "../../electron/mac-apps.mjs";

/** A file to attach, as every mac_* tool takes it (the design's ceiling). */
const FILE_MAX_BYTES = 25 * 1024 * 1024;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

export type MessagesMcpDeps = {
  host: MessagesHost;
  /** The Use Messages switch. Off: the tools say so and read nothing. */
  useMessages: boolean;
  /** Directory that already holds chat.db (a snapshot, or a fixture). */
  dbDir: string | null;
  /** Folders a sent file may come from. Anything else is refused. */
  filesRoots?: readonly string[];
  allowedRecipients?: readonly string[];
  /** Standing grants off (organization policy): the list does not skip the card. */
  grantsAllowed?: boolean;
  /** A class protected by a security key: keep the card even when listed. */
  stepUp?: (args: Record<string, unknown>) => boolean;
  /** The members (phone numbers or emails) of a conversation by its chat id.
   * Default: read from chat.db (solo) or from the person's Mac (relay). */
  chatMembers?: (chat: string) => Promise<string[]>;
  /** This conversation's folder: where a read_attachment tool saves a file. */
  saveDir?: string;
  botId: string;
  threadId: string;
  openCard: (pending: PendingImessage) => void;
  /** The Apple apps of the person's Mac (Messages, Mail, Calendar, Contacts,
   * Reminders, Notes), run by electron/mac-apps.mjs. */
  macApps?: {
    /** The app's On/Off switch on its setup page. */
    enabled: (app: MacAppId) => boolean;
    run: (tool: string, args: Record<string, unknown>, context?: { saveDir?: string }) => Promise<MacAppToolResult>;
    /** The bot's approval mode acts without asking (auto, full). */
    unasked: boolean;
    /** Always allow kept a rule for this write: it acts unasked. */
    kept?: (tool: string) => boolean;
    /** Organization server: the apps run on the person's own Mac through
     * their Sagax desktop app (desktop bridge), and `run` relays there.
     * `enabled` is what that Mac last reported, Messages included; an
     * offline Mac keeps the tools listed and `run` says it is offline. */
    relay?: { person: string };
    /** Relay: the mac_* tools the person's Mac said it runs; null for an
     * older desktop app, which runs its 12 tools only. */
    tools?: () => readonly string[] | null;
  };
};

/** A file from the bot's folders, as an absolute path, or why not. */
function botFile(deps: MessagesMcpDeps, raw: unknown): { path: string; name: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "Give a file's path in this bot's folder. Nothing was sent." };
  const roots = deps.filesRoots ?? [];
  if (!roots.length) return { error: "A file is sent only from this bot's folder. Nothing was sent." };
  const inside = fileInsideRoots(roots, raw);
  if (!inside) return { error: "That file is not in this bot's folder. Nothing was sent." };
  let size = 0;
  try {
    const info = statSync(inside);
    if (!info.isFile()) return { error: "That is not a file. Nothing was sent." };
    size = info.size;
  } catch {
    return { error: "That file could not be read. Nothing was sent." };
  }
  if (size > FILE_MAX_BYTES) return { error: "That file is over 25 MB. Nothing was sent." };
  const name = basename(inside).slice(0, 200);
  if (!name || name === "." || name === "..") return { error: "That file has no name. Nothing was sent." };
  return { path: inside, name };
}

type ChatInfo = { name: string | null; members: string[] };

/** A conversation's name and members by its chat id: from chat.db here
 * (solo), or from the person's Mac (relay). Null when it cannot be read. */
async function chatInfoOf(deps: MessagesMcpDeps, chat: string): Promise<ChatInfo | null> {
  if (deps.chatMembers) return { name: null, members: await deps.chatMembers(chat) };
  const ident = chat.split(";").pop() ?? chat;
  let rows: Array<{ chat: string; name: string | null; members: string[] }>;
  if (deps.macApps?.relay) {
    if (!macAppOffered(deps, "mac_messages_list_chats")) return null;
    const answer = await deps.macApps.run("mac_messages_list_chats", { query: ident, limit: 50 });
    if (answer.isError) return null;
    try { rows = (JSON.parse(answer.content[0]?.text ?? "{}") as { chats?: typeof rows }).chats ?? []; } catch { return null; }
  } else {
    if (!deps.dbDir) return null;
    rows = await listChats(deps.dbDir, { query: ident, limit: 50 }) as typeof rows;
  }
  const row = rows.find((item) => item.chat === chat);
  return row ? { name: row.name ?? null, members: Array.isArray(row.members) ? row.members : [] } : null;
}

/** The one recipient check of every Messages send: it is listed when each
 * person it reaches is on the bot's allowed recipients. A phone number or
 * email (to), a one-to-one conversation by its handle, a group by every
 * member (none read: not listed). */
function sendListed(deps: MessagesMcpDeps, op: Record<string, unknown>, info: ChatInfo | null): boolean {
  if (deps.grantsAllowed === false || deps.stepUp?.(op)) return false;
  let people: string[];
  if (typeof op.chat === "string") {
    // Messages marks a group guid with ";+;" and a one-to-one with ";-;".
    const single = /^[^;]+;\+;/.test(op.chat.trim()) ? null : handleFromChatGuid(op.chat);
    people = single ? [single.handle] : info?.members ?? [];
  } else {
    people = typeof op.to === "string" && op.to.trim() ? [op.to] : [];
  }
  return people.length > 0
    && people.every((to) => sendRecipientsAllowed(deps.allowedRecipients, MESSAGES_SEND_MCP_NAME, { to, text: op.text, service: op.service }));
}

/** The card line's name for a conversation: its name, else its members. */
const chatLabel = (info: ChatInfo | null): string | undefined => info?.name?.trim() || (info?.members.length ? info.members.join(", ") : undefined);

function macAppOn(deps: MessagesMcpDeps, app: MacAppId): boolean {
  if (deps.macApps?.relay) return deps.macApps.enabled(app);
  return app === "messages" ? deps.useMessages : deps.macApps?.enabled(app) === true;
}

/** The Apple apps reach this process: the solo Mac itself, or the person's
 * Mac through the desktop bridge (relay). */
function macAppsReachable(deps: MessagesMcpDeps): boolean {
  return Boolean(deps.macApps && (deps.macApps.relay || messagesOnBotMac(deps.host).ok));
}

/** Relay: what the person's Mac reported it runs (null: an older desktop app). */
const reportedTools = (deps: MessagesMcpDeps): readonly string[] | null => (deps.macApps?.relay ? deps.macApps.tools?.() ?? null : MAC_APP_TOOLS.map((tool) => tool.name));

/** Whether the person's Mac runs this tool (always, in solo). */
function macAppOffered(deps: MessagesMcpDeps, name: string, args?: Record<string, unknown>): boolean {
  const reported = reportedTools(deps);
  return reported ? reported.includes(name) : macAppLegacyCall(name, args ?? {});
}

/** The mac_* tools of the apps the person turned on, as their Mac runs them. */
function macAppTools(deps: MessagesMcpDeps) {
  if (!macAppsReachable(deps)) return [];
  return macAppToolsFor(reportedTools(deps)).filter((tool) => macAppOn(deps, tool.app as MacAppId)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

async function macAppCall(deps: MessagesMcpDeps, name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<ToolResult> {
  const app = macAppOfTool(name)!;
  const relay = deps.macApps?.relay;
  // An older Sagax app on the person's Mac runs its 12 tools only, with their
  // fields: anything else is never sent to it.
  if (relay && !macAppOffered(deps, name, args)) return text(MAC_APP_UPDATE_DESKTOP, true);
  let op: Record<string, unknown>;
  try { op = macAppOperation(name, args); } catch (error) { return text(error instanceof Error ? error.message : String(error), true); }
  // Files come only from the bot's folders, checked here, before any card.
  if (Array.isArray(op.files)) {
    const paths: string[] = [];
    for (const raw of op.files) {
      const file = botFile(deps, raw);
      if ("error" in file) return text(file.error, true);
      paths.push(file.path);
    }
    op = { ...op, files: paths };
  }
  const intoChat = typeof op.chat === "string";
  if (!deps.macApps || !macAppsReachable(deps)) return text("The Apple apps run only on the Mac where this Sagax app runs.", true);
  if (!macAppOn(deps, app)) return text(`${app[0]!.toUpperCase()}${app.slice(1)} is off in Connect Apps > This Mac. Nothing was done.`, true);
  if (name.endsWith("_read_attachment")) {
    if (!deps.saveDir) return text("There is no folder to save the attachment in here.", true);
    return deps.macApps.run(name, { ...op, ...extra }, { saveDir: deps.saveDir });
  }
  const chat = name === "mac_messages_send" && intoChat ? await chatInfoOf(deps, String(op.chat)).catch(() => null) : null;
  const listedRecipient = name === "mac_messages_send" && sendListed(deps, op, chat);
  // A write follows the bot's approval mode: Ask shows a card, Auto and Full
  // act. A Messages send to listed recipients acts at every level.
  if (macAppToolWrites(name) && !listedRecipient && !deps.macApps.unasked && !deps.macApps.kept?.(name)) {
    const pending = stageImessageSend({
      threadId: deps.threadId,
      botId: deps.botId,
      to: macAppTarget(name, { ...op, ...(intoChat ? { chatLabel: chatLabel(chat) } : {}) }),
      macApp: { tool: name, args: op, ...(relay ? { person: relay.person } : {}) },
    });
    deps.openCard(pending);
    return text(`Not done yet. An approval card is in the conversation for ${pending.to}. Wait for the person. Do not call it again.`);
  }
  return deps.macApps.run(name, op);
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const word = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** An older Messages name, answered by its mac_messages_ tool. */
function olderMessagesCall(name: string, args: Record<string, unknown>): { tool: string; args: Record<string, unknown>; extra?: Record<string, unknown> } | null {
  switch (name) {
    case "find_chats": return { tool: "mac_messages_list_chats", args: { query: word(args.displayName) ?? word(args.handle), limit: num(args.limit) } };
    case "read_messages": return { tool: "mac_messages_read", args: { chat: word(args.chatGuid) ?? "", limit: num(args.limit) } };
    case "search_messages": return { tool: "mac_messages_read", args: { query: word(args.needle) ?? "", limit: num(args.limit) } };
    case "read_attachment": return { tool: "mac_messages_read_attachment", args: { id: args.messageGuid, index: 0 }, extra: { attachmentId: num(args.attachmentId) } };
    case MESSAGES_SEND_TOOL: return { tool: "mac_messages_send", args: { to: args.to, chat: args.chatId, text: args.text, files: word(args.file) ? [args.file] : undefined, service: args.service === "auto" ? undefined : args.service } };
    default: return null;
  }
}

export async function handleMessagesMcp(body: unknown, deps: MessagesMcpDeps): Promise<{ result: unknown }> {
  const message = body && typeof body === "object" ? body as { method?: unknown; params?: unknown } : {};
  const method = typeof message.method === "string" ? message.method : "";
  const params = message.params && typeof message.params === "object" ? message.params as { name?: unknown; arguments?: unknown } : {};
  if (method === "tools/list") return { result: { tools: macAppTools(deps) } };
  if (method !== "tools/call") return { result: text("Method not found.", true) };
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
    ? params.arguments as Record<string, unknown> : {};
  if (name === "check_permissions") {
    const gate = messagesOnBotMac(deps.host);
    const fullDisk = gate.ok ? probeFullDiskAccess() : "unsupported";
    return { result: text({
      useMessages: deps.useMessages,
      onThisMac: gate.ok,
      fullDiskAccess: fullDisk === "granted",
      fullDiskAccessState: fullDisk,
      automation: "notAsked",
    }) };
  }
  const older = olderMessagesCall(name, args);
  if (older) {
    const clean = Object.fromEntries(Object.entries(older.args).filter(([, value]) => value !== undefined));
    return { result: await macAppCall(deps, older.tool, clean, older.extra ? Object.fromEntries(Object.entries(older.extra).filter(([, value]) => value !== undefined)) : {}) };
  }
  if (isMacAppTool(name)) return { result: await macAppCall(deps, name, args) };
  return { result: text(`Unknown tool: ${name}`, true) };
}
