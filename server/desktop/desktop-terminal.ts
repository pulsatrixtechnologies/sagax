// The in-chat terminal on a person's own computer, or on the Local VM of
// that computer, on an organization server (the desktop bridge,
// server/desktop/desktop-bridge.ts). The server never reaches into the PC: it asks
// the person's own connected Sagax app (a bridge operation, terminal_open
// or vm_terminal_open, carrying a one-time ticket), and that app connects
// OUT with a WebSocket (GET /api/desktop-bridge/<id>/terminal/<ticket>),
// signed in as that same person with its private bridge secret, then runs
// the shell itself (electron/desktop-terminal.mjs).
//
// Frames on that socket: binary = terminal bytes, both ways; text from the
// server = a resize ({"type":"resize","cols":..,"rows":..}).
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";
import { PassThrough } from "node:stream";

import type { DesktopBridgeOperation } from "./desktop-bridge.ts";
import type { TerminalAttachment } from "../terminal-resources/types.ts";
import { encodeWebSocketFrame, websocketAccept, webSocketFrameDecoder } from "../ws-bridge.ts";

export type DesktopTerminalTarget = "desktop" | "vm";

/** How long the person's app has to call back after the operation. */
const RENDEZVOUS_MS = 30_000;
const MAX_PENDING = 64;

interface Pending {
  person: string;
  resolve(socket: Socket, head: Buffer, key: string): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() || "";

export class DesktopTerminals {
  private readonly pending = new Map<string, Pending>();
  private readonly request: (person: string, operation: DesktopBridgeOperation) => Promise<unknown>;

  /** `request`: one desktop bridge operation on this person's own desktop
   * (DesktopBridges.request bound to a turn-independent "active"). */
  constructor(request: (person: string, operation: DesktopBridgeOperation) => Promise<unknown>) {
    this.request = request;
  }

  /** Open a terminal on `person`'s own connected computer (or its Local VM).
   * Resolves once their app called back; rejects when it refused, is not
   * connected, or did not call back in time. */
  open(person: string, target: DesktopTerminalTarget, size: { cols: number; rows: number }): Promise<TerminalAttachment> {
    const owner = normalize(person);
    if (!owner) return Promise.reject(new Error("No person is signed in."));
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error("Too many terminals are opening; try again."));
    const ticket = randomBytes(24).toString("hex");
    return new Promise<TerminalAttachment>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(entry.timer);
        this.pending.delete(ticket);
        reject(error);
      };
      const entry: Pending = {
        person: owner,
        timer: setTimeout(() => fail(new Error("Your computer did not open the terminal in time.")), RENDEZVOUS_MS),
        resolve: (socket, head, key) => {
          if (settled) { socket.destroy(); return; }
          settled = true;
          clearTimeout(entry.timer);
          this.pending.delete(ticket);
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(key)}\r\n\r\n`);
          resolve(desktopTerminalAttachment(socket, head));
        },
        reject: fail,
      };
      entry.timer.unref?.();
      this.pending.set(ticket, entry);
      const operation: DesktopBridgeOperation = {
        action: target === "vm" ? "vm_terminal_open" : "terminal_open",
        arguments: { ticket, cols: size.cols, rows: size.rows },
      };
      // The app answers after its socket is up, or with the reason it could
      // not open one. An error answer fails the wait at once.
      this.request(owner, operation).then((result) => {
        const answer = result as { isError?: boolean; content?: { text?: string }[] } | null;
        if (answer?.isError) fail(new Error(answer.content?.[0]?.text?.slice(0, 300) || "Your computer could not open the terminal."));
      }, (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
    });
  }

  /** The app's callback: the ticket must be one this server is waiting on,
   * for the same person the session is signed in as. False: refuse it. */
  accept(socket: Socket, head: Buffer, key: string, who: { person: string; ticket: string }): boolean {
    if (!/^[a-f0-9]{48}$/.test(who.ticket)) return false;
    let found: Pending | undefined;
    for (const [ticket, entry] of this.pending) {
      if (ticket.length === who.ticket.length && timingSafeEqual(Buffer.from(ticket), Buffer.from(who.ticket))) found = entry;
    }
    if (!found || found.person !== normalize(who.person)) return false;
    found.resolve(socket, head, key);
    return true;
  }

  close(): void {
    for (const entry of this.pending.values()) entry.reject(new Error("The server is stopping."));
    this.pending.clear();
  }
}

/** The server's side of the app's socket as a terminal attachment. */
export function desktopTerminalAttachment(socket: Socket, head: Buffer): TerminalAttachment {
  const input = new PassThrough();
  const output = new PassThrough();
  const decode = webSocketFrameDecoder();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { socket.end(encodeWebSocketFrame(8, Buffer.alloc(0))); } catch { /* gone */ }
    socket.destroy();
    output.end();
    input.destroy();
  };
  const onData = (chunk: Buffer) => {
    const frames = decode(chunk);
    if (!Array.isArray(frames)) { close(); return; }
    for (const frame of frames) {
      if (frame.opcode === 2 || frame.opcode === 1 || frame.opcode === 0) output.write(frame.payload);
      else if (frame.opcode === 9) socket.write(encodeWebSocketFrame(10, frame.payload));
      else if (frame.opcode === 8) close();
    }
  };
  if (head.length) onData(head);
  socket.on("data", onData);
  socket.on("close", close);
  socket.on("error", close);
  input.on("data", (chunk: Buffer) => { if (!closed) socket.write(encodeWebSocketFrame(2, chunk)); });
  return {
    input,
    output,
    resize(cols, rows) {
      if (!closed) socket.write(encodeWebSocketFrame(1, Buffer.from(JSON.stringify({ type: "resize", cols, rows }))));
    },
    close,
  };
}
