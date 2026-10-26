// How a phone reached this sidecar, from the connection itself, told to the
// harness in x-openmausbot-companion-transport (review of #960). Phone tools
// run only over "protected": the hosted HTTPS route (it arrives over the
// guardian's private socket, no peer address) or Tailscale (a tailnet
// address). Anything else, plain local Wi-Fi included, is "local". The
// harness side is shared/phone-transport.ts (same ranges): the companion is
// built on its own, so the few lines are repeated here.
import type { IncomingMessage } from "node:http";

export const COMPANION_TRANSPORT_HEADER = "x-openmausbot-companion-transport";

export function isTailnetAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  const parts = v4.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number) as [number, number];
    return a === 100 && b >= 64 && b <= 127;
  }
  return /^fd7a:115c:a1e0(?::|$)/i.test(address);
}

export function companionTransport(req: Pick<IncomingMessage, "socket">): "protected" | "local" {
  const socket = req.socket as { remoteAddress?: string; remoteFamily?: string; encrypted?: boolean } | undefined;
  if (!socket) return "local";
  // the hosted route: the guardian's private socket or pipe, never a LAN peer
  if (socket.remoteAddress === undefined && socket.remoteFamily === undefined) return "protected";
  if (socket.encrypted) return "protected";
  return isTailnetAddress(socket.remoteAddress) ? "protected" : "local";
}
