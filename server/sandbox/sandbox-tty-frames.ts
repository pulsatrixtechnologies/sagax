// What the Sagax server sends the provisioner on an in-chat terminal's stream
// (sandboxd /tty upgrade): keystrokes and resizes in small frames, so one
// stream carries both. The answer back is the terminal's raw output.
//
//   [type: 1 byte][length: 4 bytes, big endian][payload]
//   type 0: keystrokes   type 1: resize, payload = cols (u16) + rows (u16)

export const TTY_FRAME_DATA = 0;
export const TTY_FRAME_RESIZE = 1;
/** One frame at most: a paste larger than this is split by the sender. */
export const TTY_FRAME_MAX = 64 * 1024;

export function ttyDataFrames(payload: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let offset = 0; offset < payload.length; offset += TTY_FRAME_MAX) {
    const part = payload.subarray(offset, offset + TTY_FRAME_MAX);
    const header = Buffer.alloc(5);
    header[0] = TTY_FRAME_DATA;
    header.writeUInt32BE(part.length, 1);
    out.push(Buffer.concat([header, part]));
  }
  return out;
}

export function ttyResizeFrame(cols: number, rows: number): Buffer {
  const frame = Buffer.alloc(9);
  frame[0] = TTY_FRAME_RESIZE;
  frame.writeUInt32BE(4, 1);
  frame.writeUInt16BE(Math.max(2, Math.min(1000, Math.floor(cols))), 5);
  frame.writeUInt16BE(Math.max(1, Math.min(500, Math.floor(rows))), 7);
  return frame;
}

export type TtyFrame = { type: "data"; payload: Buffer } | { type: "resize"; cols: number; rows: number };

/** Feed raw bytes, get whole frames; an error for a malformed stream. */
export function ttyFrameDecoder(): (chunk: Buffer) => TtyFrame[] | { error: string } {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const frames: TtyFrame[] = [];
    while (pending.length >= 5) {
      const type = pending[0]!;
      const length = pending.readUInt32BE(1);
      if (length > TTY_FRAME_MAX) return { error: "frame too large" };
      if (type !== TTY_FRAME_DATA && type !== TTY_FRAME_RESIZE) return { error: "unknown frame" };
      if (pending.length < 5 + length) break;
      const payload = Buffer.from(pending.subarray(5, 5 + length));
      pending = pending.subarray(5 + length);
      if (type === TTY_FRAME_DATA) frames.push({ type: "data", payload });
      else {
        if (length !== 4) return { error: "bad resize" };
        frames.push({ type: "resize", cols: payload.readUInt16BE(0), rows: payload.readUInt16BE(2) });
      }
    }
    return frames;
  };
}
