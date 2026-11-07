// Messages tools for one turn. Reads and sends happen here, on the solo
// Mac process. A send to someone who is not on the bot's allowed list
// becomes a card and does not call the sender.
import { statSync } from "node:fs";
import { basename } from "node:path";

import { sendRecipientsAllowed } from "../../shared/allowed-recipients.ts";
import {
  MESSAGES_SEND_MCP_NAME,
  MESSAGES_SEND_TOOL,
  handleFromChatGuid,
  messageService,
  messagesOnBotMac,
  planImessageSend,
  type MessagesHost,
  type MessageService,
} from "../../shared/imessage.ts";
import { stageImessageSend, type PendingImessage } from "./imessage-cards.ts";
import { fileInsideRoots, messagesDbPresent, openMessagesReader, type MessageRow } from "./imessage-db.ts";
import { probeFullDiskAccess } from "./imessage-permissions.ts";
import type { ImessageSender } from "./imessage-send.ts";
import { MAC_APP_TOOLS, isMacAppTool, macAppOfTool, macAppOperation, macAppTarget, macAppToolWrites, type MacAppId, type MacAppToolResult } from "../../electron/mac-apps.mjs";

const SEND_FILE_MAX_BYTES = 8_000_000;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

const TOOLS = [
  {
    name: "check_permissions",
    description: "Whether this Mac can read Messages (Full Disk Access). Does not open System Settings and does not launch Messages.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "find_chats",
    description: "List recent Messages chats on this Mac. Optional displayName or handle, and a limit.",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string" },
        handle: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "read_messages",
    description: "Read recent messages in one chat. chatGuid comes from find_chats. An image attachment is named here; its bytes come from read_attachment.",
    inputSchema: {
      type: "object",
      properties: {
        chatGuid: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["chatGuid"],
    },
  },
  {
    name: "search_messages",
    description: "Search message text on this Mac.",
    inputSchema: {
      type: "object",
      properties: {
        needle: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["needle"],
    },
  },
  {
    name: "read_attachment",
    description: "Read one image attached to a message. messageGuid and attachmentId come from read_messages. Only an image inside the Messages folder, up to 1.5 MB. The path is not returned.",
    inputSchema: {
      type: "object",
      properties: {
        messageGuid: { type: "string" },
        attachmentId: { type: "integer" },
      },
      required: ["messageGuid", "attachmentId"],
    },
  },
  {
    name: MESSAGES_SEND_TOOL,
    description: "Send one iMessage or SMS to one person on this Mac. Someone who is not on this bot's allowed recipients is not contacted: a card is posted instead. Group chats are refused. A file is sent only from this bot's folder, by iMessage, and only after the same card when the recipient is not listed.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Phone number or email of one person." },
        chatId: { type: "string", description: "A 1:1 chat guid from find_chats. Groups are refused." },
        text: { type: "string" },
        file: { type: "string", description: "A file in this bot's folder. iMessage only." },
        service: { type: "string", enum: ["iMessage", "SMS", "auto"] },
      },
    },
  },
] as const;

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
  sender: ImessageSender;
  botId: string;
  threadId: string;
  openCard: (pending: PendingImessage) => void;
  /** The other Apple apps of this Mac (Mail, Calendar, Contacts, Reminders,
   * Notes) and mac_messages_read, run in this process (electron/mac-apps.mjs). */
  macApps?: {
    /** The app's On/Off switch on its setup page. */
    enabled: (app: MacAppId) => boolean;
    run: (tool: string, args: Record<string, unknown>) => Promise<MacAppToolResult>;
    /** The bot's approval mode acts without asking (auto, full). */
    unasked: boolean;
    /** Always allow kept a rule for this write: it acts unasked. */
    kept?: (tool: string) => boolean;
  };
};

function view(row: MessageRow) {
  return {
    guid: row.guid,
    chatGuid: row.chatGuid,
    date: row.date,
    fromMe: row.fromMe,
    ...(row.handle ? { handle: row.handle } : {}),
    service: row.service,
    text: row.text,
    ...(row.fallback ? { fallback: true } : {}),
    ...(row.attachments.length ? { attachments: row.attachments } : {}),
  };
}

function sendFile(deps: MessagesMcpDeps, raw: unknown): { path: string; name: string } | { error: string } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
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
  if (size > SEND_FILE_MAX_BYTES) return { error: "That file is over 8 MB. Nothing was sent." };
  const name = basename(inside).slice(0, 200);
  if (!name || name === "." || name === "..") return { error: "That file has no name. Nothing was sent." };
  return { path: inside, name };
}

function withReader<T>(deps: MessagesMcpDeps, run: (reader: ReturnType<typeof openMessagesReader>["reader"]) => T): T | ToolResult {
  if (!deps.useMessages) return text("Messages is off. The person turns it on in Settings > Computer > Messages.", true);
  if (!messagesOnBotMac(deps.host).ok) return text("Messages runs only on the Mac where this Sagax app runs, not from a server and not through another Mac.", true);
  if (!deps.dbDir || !messagesDbPresent(deps.dbDir)) return text("Messages could not be read. Sagax needs Full Disk Access on this Mac.", true);
  const opened = openMessagesReader(deps.dbDir);
  try {
    return run(opened.reader);
  } catch (error) {
    return text(error instanceof Error ? error.message : "Messages could not be read.", true);
  } finally {
    opened.close();
  }
}

function listed(deps: MessagesMcpDeps, args: Record<string, unknown>): boolean {
  if (deps.grantsAllowed === false || deps.stepUp?.(args)) return false;
  // A chat guid is not a recipient the list can vouch for. A 1:1 guid
  // names one handle, and that handle is what the list is checked against.
  let to = typeof args.to === "string" ? args.to : "";
  if (!to.trim() && typeof args.chatId === "string") to = handleFromChatGuid(args.chatId)?.handle ?? "";
  if (!to.trim()) return false;
  return sendRecipientsAllowed(deps.allowedRecipients, MESSAGES_SEND_MCP_NAME, { to, text: args.text, service: args.service });
}

async function send(deps: MessagesMcpDeps, args: Record<string, unknown>): Promise<ToolResult> {
  const gate = messagesOnBotMac(deps.host);
  if (!gate.ok) return text("Messages runs only on the Mac where this Sagax app runs.", true);
  if (!deps.useMessages) return text("Messages is off. Nothing was sent.", true);
  const body = typeof args.text === "string" ? args.text : "";
  const file = sendFile(deps, args.file);
  if (file && "error" in file) return text(file.error, true);
  if (file && messageService(args.service) === "SMS") return text("A file goes by iMessage, not SMS. Nothing was sent.", true);
  if ((!body.trim() && !file) || body.length > 4_000 || body.includes("\u0000")) {
    return text("The message must be 1 to 4000 characters, or a file from this bot's folder.", true);
  }
  const plan = planImessageSend({
    to: typeof args.to === "string" ? args.to : undefined,
    chatId: typeof args.chatId === "string" ? args.chatId : undefined,
    service: messageService(args.service),
    listed: listed(deps, args),
  });
  if (plan.action === "refuse") {
    return text(plan.reason === "group"
      ? "That chat is a group. Name one phone number or email. Nothing was sent."
      : "Name one phone number or email. Nothing was sent.", true);
  }
  if (file && plan.service === "SMS") return text("A file goes by iMessage, not SMS. Nothing was sent.", true);
  if (plan.action === "card") {
    const pending = stageImessageSend({
      threadId: deps.threadId,
      botId: deps.botId,
      to: plan.to,
      text: body,
      service: file ? "iMessage" : plan.service,
      ...(file ? { file: file.path, fileName: file.name } : {}),
    });
    deps.openCard(pending);
    return text(`Not sent. An approval card is in the conversation for ${plan.to}. Wait for the person. Do not send it again.`);
  }
  const service: MessageService = file ? "iMessage" : plan.service;
  try {
    const sent = await deps.sender.send({ to: plan.to, text: body, service, ...(file ? { file: file.path } : {}) });
    return text({ sent: true, to: plan.to, service: sent.service, via: sent.via, ...(file ? { file: file.name } : {}) });
  } catch (error) {
    return text(error instanceof Error ? error.message : "Messages did not send.", true);
  }
}

function macAppOn(deps: MessagesMcpDeps, app: MacAppId): boolean {
  return app === "messages" ? deps.useMessages : deps.macApps?.enabled(app) === true;
}

/** The mac_* tools of the apps the person turned on. */
function macAppTools(deps: MessagesMcpDeps) {
  if (!deps.macApps || !messagesOnBotMac(deps.host).ok) return [];
  return MAC_APP_TOOLS.filter((tool) => macAppOn(deps, tool.app)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

async function macAppCall(deps: MessagesMcpDeps, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const app = macAppOfTool(name)!;
  if (!deps.macApps || !messagesOnBotMac(deps.host).ok) return text("The Apple apps run only on the Mac where this Sagax app runs.", true);
  if (!macAppOn(deps, app)) return text(`${app[0]!.toUpperCase()}${app.slice(1)} is off in Plugins > This Mac. Nothing was done.`, true);
  // The Messages send keeps its recipient list and card (send above).
  if (name === "mac_messages_send") return send(deps, { to: args.to, text: args.text });
  let op: Record<string, unknown>;
  try { op = macAppOperation(name, args); } catch (error) { return text(error instanceof Error ? error.message : String(error), true); }
  // A write follows the bot's approval mode: Ask shows a card, Auto and Full act.
  if (macAppToolWrites(name) && !deps.macApps.unasked && !deps.macApps.kept?.(name)) {
    const pending = stageImessageSend({
      threadId: deps.threadId,
      botId: deps.botId,
      to: macAppTarget(name, op),
      text: "",
      service: "iMessage",
      macApp: { tool: name, args: op },
    });
    deps.openCard(pending);
    return text(`Not done yet. An approval card is in the conversation for ${pending.to}. Wait for the person. Do not call it again.`);
  }
  return deps.macApps.run(name, op);
}

export async function handleMessagesMcp(body: unknown, deps: MessagesMcpDeps): Promise<{ result: unknown }> {
  const message = body && typeof body === "object" ? body as { method?: unknown; params?: unknown } : {};
  const method = typeof message.method === "string" ? message.method : "";
  const params = message.params && typeof message.params === "object" ? message.params as { name?: unknown; arguments?: unknown } : {};
  if (method === "tools/list") return { result: { tools: [...TOOLS, ...macAppTools(deps)] } };
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
  if (name === "find_chats" || name === "read_messages" || name === "search_messages") {
    const found = withReader(deps, (reader) => {
      if (name === "find_chats") {
        return {
          chats: reader.findChats({
            displayName: typeof args.displayName === "string" ? args.displayName : undefined,
            handle: typeof args.handle === "string" ? args.handle : undefined,
            limit: typeof args.limit === "number" ? args.limit : undefined,
          }),
        };
      }
      if (name === "search_messages") {
        const needle = typeof args.needle === "string" ? args.needle.trim() : "";
        if (needle.length < 1 || needle.length > 200) return text("Give a search of 1 to 200 characters.", true);
        return { messages: reader.search(needle, typeof args.limit === "number" ? args.limit : undefined).map(view) };
      }
      const chatGuid = typeof args.chatGuid === "string" ? args.chatGuid.trim() : "";
      if (!chatGuid || chatGuid.length > 300) return text("Give a chatGuid from find_chats.", true);
      return { messages: reader.items(chatGuid, typeof args.limit === "number" ? args.limit : undefined).map(view) };
    });
    return { result: found && typeof found === "object" && "content" in found ? found : text(found) };
  }
  if (name === "read_attachment") {
    const messageGuid = typeof args.messageGuid === "string" ? args.messageGuid : "";
    const attachmentId = typeof args.attachmentId === "number" ? args.attachmentId : Number.NaN;
    const found = withReader(deps, (reader) => reader.readAttachment(messageGuid, attachmentId));
    if (found && typeof found === "object" && "content" in found) return { result: found };
    if (!found) return { result: text("No such attachment.", true) };
    const payload = {
      attachment: found.attachment,
      ...(found.reason ? { reason: found.reason } : {}),
      ...(found.bytes ? { data: found.bytes.toString("base64") } : {}),
    };
    return { result: text(payload, Boolean(found.reason)) };
  }
  if (name === MESSAGES_SEND_TOOL) return { result: await send(deps, args) };
  if (isMacAppTool(name)) return { result: await macAppCall(deps, name, args) };
  return { result: text(`Unknown tool: ${name}`, true) };
}
