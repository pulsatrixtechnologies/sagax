// How a phone reaches this server, read from the connection itself (review
// of #960: never from a field the client sends). Phone tools and the card
// scan run only over a protected transport (JC 2026-10-21): HTTPS (a TLS
// socket, a tunnel's IPC listener, a proxy that says https) or Tailscale
// (WireGuard, a tailnet address). Plain local Wi-Fi is "local": the answers
// would cross the network in clear. The companion sidecar classifies its own
// inbound connection the same way and tells the harness
// (x-openmausbot-companion-transport, companion/src/proxy.ts).
export type PhoneTransport = "protected" | "local";

/** Tailscale's ranges: 100.64.0.0/10 and fd7a:115c:a1e0::/48. */
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

export function phoneConnectionTransport(connection: {
  /** a TLS socket */
  encrypted?: boolean;
  /** an IPC listener: only a local gateway (a tunnel) reaches it */
  ipc?: boolean;
  remoteAddress?: string;
  /** x-forwarded-proto: counted only from a proxy on this machine (the
   * peer is loopback: Tailscale Serve, Caddy), never from a LAN client
   * that set the header itself. */
  forwardedProto?: string;
}): PhoneTransport {
  if (connection.encrypted || connection.ipc) return "protected";
  if (isTailnetAddress(connection.remoteAddress)) return "protected";
  const loopback = connection.remoteAddress === "127.0.0.1" || connection.remoteAddress === "::1" || connection.remoteAddress === "::ffff:127.0.0.1";
  if (loopback && connection.forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https") return "protected";
  return "local";
}
