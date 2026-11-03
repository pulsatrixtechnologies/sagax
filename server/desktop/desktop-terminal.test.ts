// The in-chat terminal on a person's own computer (organization server): the
// server's rendezvous (desktop-terminal.ts), its upgrade route
// (desktop-bridge-routes.ts attachDesktopTerminal) and the desktop app's side
// (electron/desktop-terminal.mjs) over a real socket, with a fake shell.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openBridgeTerminal } from "../../electron/desktop-terminal.mjs";
import { attachDesktopTerminal, isDesktopTunnelPath } from "./desktop-bridge-routes.ts";
import type { DesktopBridgeOperation } from "./desktop-bridge.ts";
import { DesktopTerminals } from "./desktop-terminal.ts";

const BRIDGE = "11111111-2222-4333-8444-555555555555";
const SECRET = "f".repeat(64);

function fakePty(sizes: { cols: number; rows: number }[]) {
  return (argv: string[], options: { cols?: number; rows?: number } = {}) => {
    sizes.push({ cols: options.cols ?? 0, rows: options.rows ?? 0 });
    const input = new PassThrough();
    const output = new PassThrough();
    input.on("data", (chunk: Buffer) => output.write(`pty(${argv[0]}):${chunk.toString()}`));
    return {
      input, output, proc: undefined as never,
      resize(cols: number, rows: number) { sizes.push({ cols, rows }); },
      close() { output.end(); },
    };
  };
}

describe("desktop terminal rendezvous", () => {
  let server: Server;
  let port: number;
  let sizes: { cols: number; rows: number }[];
  let operations: DesktopBridgeOperation[];
  /** Which person the desktop's session cookie says it is. */
  let desktopPerson: string;
  let terminals: DesktopTerminals;

  beforeEach(async () => {
    sizes = [];
    operations = [];
    desktopPerson = "pr_alice";
    // The person's desktop app: it gets the operation through the bridge and
    // connects back with the ticket, as electron/desktop-bridge.mjs does.
    terminals = new DesktopTerminals(async (_person, operation) => {
      operations.push(operation);
      try {
        await openBridgeTerminal({
          url: `ws://127.0.0.1:${port}/api/desktop-bridge/${BRIDGE}/terminal`,
          headers: { cookie: `sid=${desktopPerson}`, origin: `http://127.0.0.1:${port}`, "x-sagax-bridge-secret": SECRET },
          ticket: String(operation.arguments?.ticket),
          cols: Number(operation.arguments?.cols),
          rows: Number(operation.arguments?.rows),
          command: () => ({ argv: [operation.action === "vm_terminal_open" ? "docker" : "zsh"] }),
          spawnPty: fakePty(sizes) as never,
        });
        return { content: [{ type: "text", text: "The terminal is open." }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: (error as Error).message }] };
      }
    });
    server = createServer((_req, res) => { res.writeHead(404); res.end(); });
    attachDesktopTerminal(server, {
      organization: () => true,
      session: (req) => {
        const person = /sid=(\w+)/.exec(String(req.headers.cookie ?? ""))?.[1];
        return person ? { id: `session-${person}`, person } : null;
      },
      sameOrigin: () => true,
      bridgeOwner: (id, _session, secret) => id === BRIDGE && secret === SECRET,
      terminals,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    terminals.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("is answered by the desktop bridge, not the main upgrade handler", () => {
    expect(isDesktopTunnelPath(`/api/desktop-bridge/${BRIDGE}/terminal/${"a".repeat(48)}`)).toBe(true);
    expect(isDesktopTunnelPath(`/api/desktop-bridge/${BRIDGE}/terminal/short`)).toBe(false);
  });

  it("opens a shell on the person's own computer and carries keystrokes and resizes", async () => {
    const attachment = await terminals.open("pr_alice", "desktop", { cols: 120, rows: 40 });
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ action: "terminal_open", arguments: { cols: 120, rows: 40 } });
    expect(String(operations[0]!.arguments!.ticket)).toMatch(/^[a-f0-9]{48}$/);
    const echoed = new Promise<string>((resolve) => attachment.output.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    attachment.input.write("ls -la\r");
    expect(await echoed).toBe("pty(zsh):ls -la\r");
    attachment.resize(90, 30);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sizes).toEqual([{ cols: 120, rows: 40 }, { cols: 90, rows: 30 }]);
    attachment.close();
  });

  it("asks for the Local VM with its own operation", async () => {
    const attachment = await terminals.open("pr_alice", "vm", { cols: 80, rows: 24 });
    expect(operations[0]!.action).toBe("vm_terminal_open");
    const echoed = new Promise<string>((resolve) => attachment.output.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    attachment.input.write("uname\r");
    expect(await echoed).toBe("pty(docker):uname\r");
    attachment.close();
  });

  it("refuses a callback from a desktop signed in as someone else", async () => {
    desktopPerson = "pr_mallory";
    await expect(terminals.open("pr_alice", "desktop", { cols: 80, rows: 24 })).rejects.toThrow(/refused/);
    expect(sizes).toEqual([]);
  });

  it("refuses a callback without the bridge secret, or for a ticket never issued", async () => {
    const status = (path: string, headers: Record<string, string>) => new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers } as never);
      ws.onopen = () => { ws.close(); resolve(101); };
      ws.onerror = () => resolve(0);
    });
    expect(await status(`/api/desktop-bridge/${BRIDGE}/terminal/${"a".repeat(48)}`, { cookie: "sid=pr_alice", "x-sagax-bridge-secret": SECRET })).toBe(0);
    expect(await status(`/api/desktop-bridge/${BRIDGE}/terminal/${"a".repeat(48)}`, { cookie: "sid=pr_alice" })).toBe(0);
  });
});
