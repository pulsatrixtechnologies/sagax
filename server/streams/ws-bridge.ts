// A minimal WebSocket server side (RFC 6455) over an already upgraded socket,
// bridged to a raw byte stream: the browser's noVNC speaks binary WebSocket
// frames, the server environment's desktop speaks plain RFB through the
// provisioner (server/sandboxd.ts). Only what that needs: binary and text
// frames (payload passed on), fragmentation, ping, pong and close. Frames
// from the browser must be masked; oversized frames close the connection.
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const WS_MAX_FRAME_BYTES = 1024 * 1024;

export function websocketAccept(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

/** One unmasked server frame. */
export function encodeWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

export interface DecodedFrame { fin: boolean; opcode: number; payload: Buffer }

/** Incremental decoder of client frames. Returns the frames complete so far,
 * or an error code (1002 protocol, 1009 too big) to close with. */
export function webSocketFrameDecoder(maxBytes = WS_MAX_FRAME_BYTES): (chunk: Buffer) => DecodedFrame[] | { error: 1002 | 1009 } {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const frames: DecodedFrame[] = [];
    while (pending.length >= 2) {
      const first = pending[0]!;
      const second = pending[1]!;
      if (first & 0x70) return { error: 1002 };
      if (!(second & 0x80)) return { error: 1002 };
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) break;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) break;
        const big = pending.readBigUInt64BE(2);
        if (big > BigInt(maxBytes)) return { error: 1009 };
        length = Number(big);
        offset = 10;
      }
      if (length > maxBytes) return { error: 1009 };
      if (pending.length < offset + 4 + length) break;
      const mask = pending.subarray(offset, offset + 4);
      const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index] = payload[index]! ^ mask[index & 3]!;
      frames.push({ fin: Boolean(first & 0x80), opcode: first & 0x0f, payload });
      pending = pending.subarray(offset + 4 + length);
    }
    return frames;
  };
}

/** Splice a browser WebSocket (already answered 101) to a byte stream.
 * Returns a function that closes both. */
export function bridgeWebSocketToStream(socket: Duplex, stream: Duplex, onClose: () => void = () => {}): () => void {
  let closed = false;
  const close = (code = 1000) => {
    if (closed) return;
    closed = true;
    const reason = Buffer.alloc(2);
    reason.writeUInt16BE(code, 0);
    try { if (!socket.destroyed) socket.end(encodeWebSocketFrame(8, reason)); } catch { /* gone */ }
    setTimeout(() => socket.destroy(), 1000).unref?.();
    stream.destroy();
    onClose();
  };
  const decode = webSocketFrameDecoder();
  socket.on("data", (chunk: Buffer) => {
    const frames = decode(chunk);
    if ("error" in frames) { close(frames.error); return; }
    for (const frame of frames) {
      if (frame.opcode === 0 || frame.opcode === 1 || frame.opcode === 2) {
        if (frame.payload.length && !stream.destroyed && !stream.write(frame.payload)) {
          socket.pause();
          stream.once("drain", () => socket.resume());
        }
      } else if (frame.opcode === 8) {
        close(1000);
        return;
      } else if (frame.opcode === 9) {
        if (!socket.destroyed) socket.write(encodeWebSocketFrame(10, frame.payload.subarray(0, 125)));
      } else if (frame.opcode !== 10) {
        close(1002);
        return;
      }
    }
  });
  stream.on("data", (chunk: Buffer) => {
    if (socket.destroyed) return;
    if (!socket.write(encodeWebSocketFrame(2, chunk))) {
      stream.pause();
      socket.once("drain", () => stream.resume());
    }
  });
  stream.on("end", () => close(1000));
  stream.on("close", () => close(1000));
  stream.on("error", () => close(1011));
  socket.on("close", () => close(1001));
  socket.on("error", () => close(1011));
  return () => close(1000);
}
