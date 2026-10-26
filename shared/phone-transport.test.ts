import { describe, expect, it } from "vitest";

import { isTailnetAddress, phoneConnectionTransport } from "./phone-transport.ts";

describe("phone transport from the connection, never from the client (review of #960)", () => {
  it("knows a tailnet address", () => {
    expect(isTailnetAddress("100.101.102.103")).toBe(true);
    expect(isTailnetAddress("::ffff:100.64.0.1")).toBe(true);
    expect(isTailnetAddress("100.128.0.1")).toBe(false);
    expect(isTailnetAddress("fd7a:115c:a1e0:ab12::1")).toBe(true);
    expect(isTailnetAddress("192.168.1.20")).toBe(false);
    expect(isTailnetAddress(undefined)).toBe(false);
  });

  it("HTTPS, a tunnel or Tailscale is protected; plain local Wi-Fi is not", () => {
    expect(phoneConnectionTransport({ encrypted: true, remoteAddress: "192.168.1.20" })).toBe("protected");
    expect(phoneConnectionTransport({ ipc: true })).toBe("protected");
    expect(phoneConnectionTransport({ remoteAddress: "100.90.1.2" })).toBe("protected");
    expect(phoneConnectionTransport({ remoteAddress: "192.168.1.20" })).toBe("local");
    // a proxy on this machine (Tailscale Serve, Caddy) that says https
    expect(phoneConnectionTransport({ remoteAddress: "127.0.0.1", forwardedProto: "https" })).toBe("protected");
    // a LAN client that sets the header itself
    expect(phoneConnectionTransport({ remoteAddress: "192.168.1.20", forwardedProto: "https" })).toBe("local");
    expect(phoneConnectionTransport({ remoteAddress: "127.0.0.1" })).toBe("local");
  });
});
