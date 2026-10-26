import { describe, expect, it } from "vitest";

import { companionTransport, isTailnetAddress } from "../src/transport.ts";

const req = (socket: Record<string, unknown> | undefined) => ({ socket } as never);

describe("companion transport (review of #960)", () => {
  it("the hosted route and Tailscale are protected, the LAN is not", () => {
    expect(companionTransport(req({}))).toBe("protected");
    expect(companionTransport(req({ remoteAddress: "100.100.1.2", remoteFamily: "IPv4" }))).toBe("protected");
    expect(companionTransport(req({ remoteAddress: "fd7a:115c:a1e0::5", remoteFamily: "IPv6" }))).toBe("protected");
    expect(companionTransport(req({ remoteAddress: "192.168.1.30", remoteFamily: "IPv4" }))).toBe("local");
    expect(companionTransport(req({ remoteAddress: "127.0.0.1", remoteFamily: "IPv4" }))).toBe("local");
    expect(companionTransport(req(undefined))).toBe("local");
    expect(isTailnetAddress("100.63.255.255")).toBe(false);
  });
});
