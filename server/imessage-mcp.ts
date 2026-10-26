// Messages tools for one turn. Reads and sends happen here, on the solo
// Mac process. A send to someone who is not on the bot's allowed list
// becomes a card and does not call the sender.
import { sendRecipientsAllowed } from "../shared/allowed-recipients.ts";
import {
  MESSAGES_SEND_MCP_NAME,
  MESSAGES_SEND_TOOL,
  handleFromChatGuid,
  messageService,
  messagesOnBotMac,
  planImessageSend,
  type MessagesHost,
  type MessageService,
} from "../shared/imessage.ts";
import { stageImessageSend, type PendingImessage } from "./imessage-cards.ts";
import { messagesDbPresent, openMessagesReader, type MessageRow } from "./imessage-db.ts";
import type { ImessageSender } from "./imessage-send.ts";

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
    description: "Read recent messages in one chat. chatGuid comes from find_chats.",
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
    name: MESSAGES_SEND_TOOL,
    description: "Send one iMessage or SMS to one person on this Mac. Someone who is not on this bot's allowed recipients is not contacted: a card is posted instead. Group chats are refused.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Phone number or email of one person." },
        chatId: { type: "string", description: "A 1:1 chat guid from find_chats. Groups are refused." },
        text: { type: "string" },
        service: { type: "string", enum: ["iMessage", "SMS", "auto"] },
      },
      required: ["text"],
    },
  },
] as const;

export type MessagesMcpDeps = {
  host: MessagesHost;
  /** The Use Messages switch. Off: the tools say so and read nothing. */
  useMessages: boolean;
  /** Directory that already holds chat.db (a snapshot, or a fixture). */
  dbDir: string | null;
  allowedRecipients?: readonly string[];
  /** Standing grants off (organization policy): the list does not skip the card. */
  grantsAllowed?: boolean;
  /** A class protected by a security key: keep the card even when listed. */
  stepUp?: (args: Record<string, unknown>) => boolean;
  sender: ImessageSender;
  botId: string;
  threadId: string;
  openCard: (pending: PendingImessage) => void;
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
  };
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
  if (!body.trim() || body.length > 4_000 || body.includes("\u0000")) return text("The message must be 1 to 4000 characters.", true);
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
  if (plan.action === "card") {
    const pending = stageImessageSend({
      threadId: deps.threadId,
      botId: deps.botId,
      to: plan.to,
      text: body,
      service: plan.service,
    });
    deps.openCard(pending);
    return text(`Not sent. An approval card is in the conversation for ${plan.to}. Wait for the person. Do not send it again.`);
  }
  const service: MessageService = plan.service;
  try {
    const sent = await deps.sender.send({ to: plan.to, text: body, service });
    return text({ sent: true, to: plan.to, service: sent.service, via: sent.via });
  } catch (error) {
    return text(error instanceof Error ? error.message : "Messages did not send.", true);
  }
}

export async function handleMessagesMcp(body: unknown, deps: MessagesMcpDeps): Promise<{ result: unknown }> {
  const message = body && typeof body === "object" ? body as { method?: unknown; params?: unknown } : {};
  const method = typeof message.method === "string" ? message.method : "";
  const params = message.params && typeof message.params === "object" ? message.params as { name?: unknown; arguments?: unknown } : {};
  if (method === "tools/list") return { result: { tools: TOOLS } };
  if (method !== "tools/call") return { result: text("Method not found.", true) };
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
    ? params.arguments as Record<string, unknown> : {};
  if (name === "check_permissions") {
    const gate = messagesOnBotMac(deps.host);
    return { result: text({
      useMessages: deps.useMessages,
      onThisMac: gate.ok,
      fullDiskAccess: Boolean(deps.useMessages && gate.ok && deps.dbDir && messagesDbPresent(deps.dbDir)),
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
  if (name === MESSAGES_SEND_TOOL) return { result: await send(deps, args) };
  return { result: text(`Unknown tool: ${name}`, true) };
}
