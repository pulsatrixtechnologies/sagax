// Adapted from pingdotgg/t3code@00cdceb1 apps/server/src/htmlRender/publicProxy.test.ts, MIT License, Copyright (c) 2026
// T3 Tools Inc. (full text in third_party/t3-code/LICENSE); modified: vitest in place of Effect, the policy is passed in,
// and refusals are reported.
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import type { NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectChecked, gateChromeFlags, openGate, resolveTarget, type EgressGate, type GateTarget } from "./gate.ts";
import { ownAddresses, refusalFor, type EgressRules, type Refusal } from "./policy.ts";

// A public IPv4 address this machine holds, which no private range covers.
const OWN_PUBLIC_IPV4 = "198.51.100.7";
const interfaces = (): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
  ...NodeOS.networkInterfaces(),
  "omb-test": [{ address: OWN_PUBLIC_IPV4, netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: `${OWN_PUBLIC_IPV4}/24` }],
});

const serverRules: EgressRules = { host: "server", ownPort: () => false, botPort: async () => false, localNetwork: false, allowed: () => false };

const gates: EgressGate[] = [];
afterEach(async () => {
  for (const gate of gates.splice(0)) await gate.close();
});

async function gate(rules: EgressRules = serverRules, refusals: Array<[GateTarget, string]> = [], resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>) {
  const opened = await openGate({
    decide: (target, addresses) => refusalFor(target, addresses, rules, ownAddresses(interfaces())),
    onRefusal: (target, reason) => refusals.push([target, reason]),
    ...(resolve ? { resolve } : {}),
  });
  gates.push(opened);
  return opened;
}

/** Sends a SOCKS5 greeting and CONNECT, and resolves with the reply code and the open socket. */
const connectThrough = (proxyPort: number, target: Buffer, version = 5) =>
  new Promise<{ code: number; socket: NodeNet.Socket }>((resolve) => {
    const socket = NodeNet.connect(proxyPort, "127.0.0.1", () => {
      socket.write(Buffer.from([5, 1, 0]));
      socket.write(Buffer.concat([Buffer.from([version, 1, 0]), target]));
    });
    // The proxy may reset a refused connection.
    socket.on("error", () => {});
    let received = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      // Method selection (2 bytes) then the 10-byte reply.
      if (received.length >= 12) { socket.off("data", onData); resolve({ code: received[3]!, socket }); }
    };
    socket.on("data", onData);
    socket.on("close", () => resolve({ code: received[3] ?? -1, socket }));
  });

const ipv4Target = (address: string, port: number) => {
  const target = Buffer.alloc(7);
  target[0] = 1;
  address.split(".").forEach((octet, index) => (target[1 + index] = Number(octet)));
  target.writeUInt16BE(port, 5);
  return target;
};

const ipv6Target = (address: string, port: number) => {
  const target = Buffer.alloc(19);
  target[0] = 4;
  const [head = "", tail = ""] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  groups.forEach((group, index) => target.writeUInt16BE(Number.parseInt(group, 16), 1 + index * 2));
  target.writeUInt16BE(port, 17);
  return target;
};

/** `a.b.c.d` as the two hex groups of an IPv4-mapped IPv6 address. */
const toHexPair = (address: string) => {
  const [a = 0, b = 0, c = 0, d = 0] = address.split(".").map(Number);
  return `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
};

const domainTarget = (host: string, port: number) => {
  const name = Buffer.from(host, "latin1");
  const target = Buffer.alloc(4 + name.length);
  target[0] = 3;
  target[1] = name.length;
  name.copy(target, 2);
  target.writeUInt16BE(port, 2 + name.length);
  return target;
};

describe("egress gate", () => {
  it("refuses loopback and private targets, by address or by name, and reports each", async () => {
    const refusals: Array<[GateTarget, string]> = [];
    const { port } = await gate(serverRules, refusals);
    const targets = [
      ipv4Target("127.0.0.1", 80),
      ipv4Target("10.1.2.3", 80),
      ipv4Target("169.254.169.254", 80),
      ipv4Target("198.18.0.1", 80),
      domainTarget("localhost", 80),
      // Chrome sends every host as a name, address literals included.
      domainTarget("127.0.0.1", 8799),
      domainTarget("::ffff:7f00:1", 8799),
      domainTarget("0.0.0.0", 8799),
      // IPv6 forms that carry a local IPv4 address: NAT64, 6to4, Teredo, and IPv4-compatible.
      ipv6Target("64:ff9b::7f00:1", 80),
      ipv6Target("64:ff9b::a00:1", 80),
      ipv6Target("2002:7f00:1::1", 80),
      ipv6Target("2001::1", 80),
      ipv6Target("::7f00:1", 80),
    ];
    for (const target of targets) {
      const { code, socket } = await connectThrough(port, target);
      socket.destroy();
      expect(code).toBe(2);
    }
    expect(refusals).toHaveLength(targets.length);
    expect(refusals[0]).toEqual([{ host: "127.0.0.1", port: 80 }, "this-computer"]);
    expect(refusals[2]).toEqual([{ host: "169.254.169.254", port: 80 }, "metadata"]);
    expect(refusals[6]).toEqual([{ host: "::ffff:7f00:1", port: 8799 }, "this-computer"]);
    // Port 0 is not a connection target.
    const { code, socket } = await connectThrough(port, ipv4Target("1.1.1.1", 0));
    socket.destroy();
    expect(code).toBe(7);
  });

  it("refuses every address this machine holds, even a public one", async () => {
    const { port } = await gate();
    const own = Object.values(interfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => !entry.internal && !entry.address.startsWith("fe80"));
    // IPv4 also as IPv4-mapped IPv6, which names the same host.
    const targets = own.flatMap((entry) => entry.family === "IPv6"
      ? [ipv6Target(entry.address, 80)]
      : [ipv4Target(entry.address, 80), ipv6Target(`::ffff:${toHexPair(entry.address)}`, 80), ipv6Target(`64:ff9b::${toHexPair(entry.address)}`, 80)]);
    expect(targets.length).toBeGreaterThanOrEqual(3);
    for (const target of targets) {
      const { code, socket } = await connectThrough(port, target);
      socket.destroy();
      expect(code).toBe(2);
    }
  });

  it("refuses a request with a wrong version byte", async () => {
    const { port } = await gate();
    const { code, socket } = await connectThrough(port, ipv4Target("1.1.1.1", 443), 4);
    socket.destroy();
    expect(code).toBe(7);
  });

  it("answers host-unreachable for a name that does not resolve", async () => {
    const refusals: Array<[GateTarget, string]> = [];
    const { port } = await gate(serverRules, refusals, async () => []);
    const { code, socket } = await connectThrough(port, domainTarget("nowhere.invalid", 443));
    socket.destroy();
    expect(code).toBe(4);
    expect(refusals).toEqual([]);
  });

  it("connects an allowed destination, passes the bytes sent early, and pipes both ways", async () => {
    const echo = NodeNet.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
    const echoPort = (echo.address() as NodeNet.AddressInfo).port;
    try {
      const { port } = await gate({ ...serverRules, host: "desktop" });
      const socket = NodeNet.connect(port, "127.0.0.1");
      socket.on("error", () => {});
      const reply = new Promise<Buffer>((resolve) => {
        let received = Buffer.alloc(0);
        socket.on("data", (chunk: Buffer) => {
          received = Buffer.concat([received, chunk]);
          if (received.length >= 2 + 10 + 10) resolve(received);
        });
      });
      await new Promise<void>((resolve) => socket.once("connect", resolve));
      // Greeting, request and the first bytes in one write, as a TLS client does.
      socket.write(Buffer.concat([Buffer.from([5, 1, 0, 5, 1, 0]), domainTarget("localhost", echoPort), Buffer.from("hello-gate")]));
      const received = await reply;
      expect(received[3]).toBe(0);
      expect(received.subarray(12).toString()).toBe("hello-gate");
      socket.destroy();
    } finally {
      await new Promise<void>((resolve) => echo.close(() => resolve()));
    }
  });

  it("connects only to the addresses it checked, so a name that resolves elsewhere later changes nothing", async () => {
    let lookups = 0;
    // First answer public, then loopback: a rebinding name. The gate resolves once and checks what it connects to.
    const resolve = async () => (++lookups === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "93.184.215.14", family: 4 }]);
    const refusals: Array<[GateTarget, string]> = [];
    const { port } = await gate({ ...serverRules, host: "desktop" }, refusals, resolve);
    const { code, socket } = await connectThrough(port, domainTarget("rebind.example", 8799));
    socket.destroy();
    expect(code).toBe(2);
    expect(lookups).toBe(1);
    expect(refusals).toEqual([[{ host: "rebind.example", port: 8799 }, "rebinding" satisfies Refusal]]);
  });

  it("answers connection-refused when the allowed destination is not listening", async () => {
    const closed = NodeNet.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as NodeNet.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const { port } = await gate({ ...serverRules, host: "desktop" });
    const { code, socket } = await connectThrough(port, ipv4Target("127.0.0.1", closedPort));
    socket.destroy();
    expect(code).toBe(5);
  });

  // upstream #4608: a public name usually resolves to IPv6 and IPv4; a host
  // with no IPv6 route must still reach the IPv4 answer.
  it("reaches the next address when the first family cannot route", async () => {
    const reachable = NodeNet.createServer((socket) => {
      socket.on("error", () => {});
      socket.end("reached");
    });
    await new Promise<void>((resolve) => reachable.listen(0, "127.0.0.1", resolve));
    const reachablePort = (reachable.address() as NodeNet.AddressInfo).port;
    // The name is this machine's own, as in the test above, so the loopback answer is a place to connect to.
    const resolve = async () => [
      { address: "2a00:1450:4009:c0f::54", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ];
    const { port } = await gate({ ...serverRules, host: "desktop" }, [], resolve);
    const { code, socket } = await connectThrough(port, domainTarget("localhost", reachablePort));
    const answer = await new Promise<Buffer>((resolveAnswer, decline) => {
      socket.once("data", resolveAnswer);
      socket.once("close", () => decline(new Error("closed before an answer")));
      socket.once("error", decline);
    }).catch(() => Buffer.alloc(0));
    socket.destroy();
    await new Promise<void>((resolve) => reachable.close(() => resolve()));
    expect(code).toBe(0);
    expect(answer.length === 0 || answer.toString() === "reached").toBe(true);
  });

  it("tries each checked address in turn: one that never answers does not hold up the next", async () => {
    // Own accepted-socket errors: a client that destroys mid-close can RST (#5473).
    const reachable = NodeNet.createServer((socket) => {
      socket.on("error", () => {});
      socket.end("reached");
    });
    await new Promise<void>((resolve) => reachable.listen(0, "127.0.0.1", resolve));
    const reachablePort = (reachable.address() as NodeNet.AddressInfo).port;
    const started = Date.now();
    // 192.0.2.1 is a documentation address: no answer ever comes back.
    const socket = await connectChecked(reachablePort, [{ address: "192.0.2.1", family: 4 }, { address: "127.0.0.1", family: 4 }], 50);
    expect(socket.remoteAddress).toBe("127.0.0.1");
    expect(Date.now() - started).toBeLessThan(2_000);
    socket.on("error", () => {});
    socket.destroy();
    await new Promise<void>((resolve) => reachable.close(() => resolve()));
  });

  it("fails with the last error when no checked address answers", async () => {
    const closed = NodeNet.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as NodeNet.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expect(connectChecked(closedPort, [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }], 10)).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("fails instead of crashing when it cannot listen", async () => {
    const exhausted = Object.assign(new Error("too many open files"), { code: "EMFILE" });
    const listen = vi.spyOn(NodeNet.Server.prototype, "listen").mockImplementationOnce(function (this: NodeNet.Server) {
      process.nextTick(() => this.emit("error", exhausted));
      return this;
    });
    await expect(openGate({ decide: async () => null })).rejects.toBe(exhausted);
    listen.mockRestore();
  });

  it("closes every connection when it closes", async () => {
    const opened = await openGate({ decide: async () => null });
    const client = await new Promise<NodeNet.Socket>((resolve) => {
      // A client mid-handshake, which the gate must not wait on; closing resets it.
      const socket = NodeNet.connect(opened.port, "127.0.0.1", () => {
        socket.write(Buffer.from([5, 1, 0]));
        resolve(socket);
      });
      socket.on("error", () => {});
    });
    await opened.close();
    if (!client.closed) await new Promise<void>((resolve) => client.once("close", () => resolve()));
    expect(client.closed).toBe(true);
  });

  it("resolves localhost names as Chrome does, and literals as themselves", async () => {
    expect(await resolveTarget("localhost")).toEqual([{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }]);
    expect(await resolveTarget("app.localhost.")).toEqual([{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }]);
    expect(await resolveTarget("::ffff:7f00:1")).toEqual([{ address: "::ffff:7f00:1", family: 6 }]);
    expect(await resolveTarget("bad host name")).toEqual([]);
  });

  it("sends a whole Chrome through it, loopback and WebRTC included, and keeps it off the credential store", () => {
    expect(gateChromeFlags(4321, "darwin")).toEqual([
      "--proxy-server=socks5://127.0.0.1:4321",
      "--proxy-bypass-list=<-loopback>",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--use-mock-keychain",
    ]);
    expect(gateChromeFlags(4321, "linux").at(-1)).toBe("--password-store=basic");
    expect(gateChromeFlags(4321, "win32")).toHaveLength(4);
  });
});
