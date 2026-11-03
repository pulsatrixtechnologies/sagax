// A small message-level WebSocket server session (RFC 6455) over a socket the
// HTTP server already upgraded (101 written by the caller): text and binary
// messages in and out, ping, pong and close. Built on the frame codec of
// ws-bridge.ts, so there is one decoder for every WebSocket route.
import type { Duplex } from "node:stream";

import { encodeWebSocketFrame, webSocketFrameDecoder } from "./ws-bridge.ts";

export interface WebSocketSession {
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
  close(code?: number): void;
  readonly closed: boolean;
}

export interface WebSocketSessionHandlers {
  onText?(text: string): void;
  onBinary?(data: Buffer): void;
  onClose?(): void;
}

export function webSocketSession(socket: Duplex, handlers: WebSocketSessionHandlers, maxBytes = 256 * 1024): WebSocketSession {
  const decode = webSocketFrameDecoder(maxBytes);
  let closed = false;
  let fragments: { opcode: number; parts: Buffer[]; size: number } | null = null;
  const write = (opcode: number, payload: Buffer) => {
    if (closed || socket.destroyed) return;
    socket.write(encodeWebSocketFrame(opcode, payload));
  };
  const close = (code = 1000) => {
    if (closed) return;
    const status = Buffer.alloc(2);
    status.writeUInt16BE(code, 0);
    write(0x8, status);
    closed = true;
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref();
    handlers.onClose?.();
  };
  const deliver = (opcode: number, payload: Buffer) => {
    if (opcode === 0x1) handlers.onText?.(payload.toString("utf8"));
    else if (opcode === 0x2) handlers.onBinary?.(payload);
  };
  socket.on("data", (chunk: Buffer) => {
    if (closed) return;
    const frames = decode(chunk);
    if (!Array.isArray(frames)) return close(frames.error);
    for (const frame of frames) {
      if (frame.opcode === 0x8) return close(1000);
      if (frame.opcode === 0x9) { write(0xa, frame.payload); continue; }
      if (frame.opcode === 0xa) continue;
      if (frame.opcode === 0x0) {
        if (!fragments) return close(1002);
        fragments.parts.push(frame.payload);
        fragments.size += frame.payload.length;
        if (fragments.size > maxBytes) return close(1009);
        if (frame.fin) {
          const whole = Buffer.concat(fragments.parts);
          const opcode = fragments.opcode;
          fragments = null;
          deliver(opcode, whole);
        }
        continue;
      }
      if (frame.opcode !== 0x1 && frame.opcode !== 0x2) return close(1003);
      if (!frame.fin) { fragments = { opcode: frame.opcode, parts: [frame.payload], size: frame.payload.length }; continue; }
      deliver(frame.opcode, frame.payload);
    }
  });
  const ended = () => {
    if (closed) return;
    closed = true;
    handlers.onClose?.();
  };
  socket.on("close", ended);
  socket.on("end", ended);
  socket.on("error", () => { ended(); socket.destroy(); });
  return {
    sendText: (text) => write(0x1, Buffer.from(text, "utf8")),
    sendBinary: (data) => write(0x2, Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
    close,
    get closed() { return closed; },
  };
}
