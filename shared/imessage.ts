// Messages on the Mac where this Sagax process runs (parity #28, JC
// 2026-10-21: desktop app only, allowed recipients, send cards).
//
// Not a desktop-bridge action. An organization server must not reach the
// person's Messages database through the signed-in Mac. The tools exist
// only when this process is the solo server on darwin.

export type MessagesIdentity = "solo" | "perspicax" | string;

export type MessagesHost = {
  platform: string;
  identityKind: MessagesIdentity;
  /** True when the call arrived as a desktop-bridge operation. Always refused. */
  bridgeAction?: boolean;
};

export type MessagesRefusal = "not_darwin" | "organization_server" | "bridge_refused";

/** Where Messages may run. Anything else is refused before a database open. */
export function messagesOnBotMac(host: MessagesHost): { ok: true } | { ok: false; reason: MessagesRefusal } {
  if (host.bridgeAction === true) return { ok: false, reason: "bridge_refused" };
  if (host.identityKind === "perspicax") return { ok: false, reason: "organization_server" };
  if (host.platform !== "darwin") return { ok: false, reason: "not_darwin" };
  return { ok: true };
}

export const MESSAGES_MCP_SERVER = "messages";
export const MESSAGES_SEND_TOOL = "send_message";
/** The name the allowed-recipient matcher already understands. */
export const MESSAGES_SEND_MCP_NAME = `mcp__${MESSAGES_MCP_SERVER}__${MESSAGES_SEND_TOOL}`;

export const IMESSAGE_REQUEST_PREFIX = "imsg-";

export type MessageService = "iMessage" | "SMS" | "auto";

const SERVICES = new Set<MessageService>(["iMessage", "SMS", "auto"]);

export function messageService(value: unknown): MessageService {
  return typeof value === "string" && SERVICES.has(value as MessageService) ? value as MessageService : "auto";
}

/** A 1:1 chat guid (`iMessage;-;+15145551234`). A group guid is null. */
export function handleFromChatGuid(chatId: string): { service: "iMessage" | "SMS"; handle: string } | null {
  const match = /^(iMessage|SMS);[-+];([^;]+)$/.exec(chatId.trim());
  if (!match) return null;
  const handle = match[2]!.trim();
  if (!handle || handle.includes(",") || handle.length > 200) return null;
  return { service: match[1] as "iMessage" | "SMS", handle };
}

export type SendPlan =
  | { action: "send"; to: string; service: "iMessage" | "SMS" | "auto" }
  | { action: "card"; to: string; service: "iMessage" | "SMS" | "auto" }
  | { action: "refuse"; reason: "group" | "empty" | "invalid" };

/** Listed recipients send. Everyone else is a card. A group chat is refused. */
export function planImessageSend(input: {
  to?: string;
  chatId?: string;
  service?: MessageService;
  listed: boolean;
}): SendPlan {
  if (input.chatId?.trim()) {
    const parsed = handleFromChatGuid(input.chatId);
    if (!parsed) return { action: "refuse", reason: "group" };
    return input.listed
      ? { action: "send", to: parsed.handle, service: parsed.service }
      : { action: "card", to: parsed.handle, service: parsed.service };
  }
  const to = input.to?.trim() ?? "";
  if (!to || to.length > 200) return { action: "refuse", reason: "invalid" };
  const service = input.service && input.service !== "auto" ? input.service : "auto";
  return input.listed ? { action: "send", to, service } : { action: "card", to, service };
}
