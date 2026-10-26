// Protocol for live control of a Tailcat remote session (stage 2): the
// technician's mouse and keyboard travel to a small user-mode helper over the
// existing tailcat tunnel, and the helper streams the screen back. Everything
// here is pure: the browser, the server route and the helper all agree on
// these shapes, and nothing the person types ever becomes a command. Only
// these fixed events, with bounded integer fields, reach the helper.

/** Normalized coordinate space: the pointer is sent as integers 0..10000 of
 * the remote virtual screen, so the wire never carries the host's real
 * resolution and a resized window needs no renegotiation. */
export const NORM_MAX = 10000;

export type ControlEvent =
  | { t: "m"; x: number; y: number }
  | { t: "d"; b: 0 | 1 | 2 }
  | { t: "u"; b: 0 | 1 | 2 }
  | { t: "w"; d: number }
  | { t: "k"; k: number; d: 0 | 1 }
  | { t: "x"; s: string };

const BUTTON = new Set([0, 1, 2]);
/** A short run of characters typed at once (KEYEVENTF_UNICODE on Windows). */
const TEXT_MAX = 256;
const WHEEL_MAX = 50;
// oxlint-disable-next-line no-control-regex -- typed text keeps no control characters
const CONTROL = /[\u0000-\u001f\u007f]/g;

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

function clampNorm(value: number): number {
  if (value < 0) return 0;
  if (value > NORM_MAX) return NORM_MAX;
  return value;
}

/** Validate one event as it arrives from the browser. Returns a canonical
 * event or null; the server forwards only what this accepts. */
export function parseControlEvent(raw: unknown): ControlEvent | null {
  const obj = typeof raw === "string" ? safeJson(raw) : raw;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  switch (record.t) {
    case "m": {
      const x = int(record.x);
      const y = int(record.y);
      if (x === null || y === null) return null;
      return { t: "m", x: clampNorm(x), y: clampNorm(y) };
    }
    case "d":
    case "u": {
      const b = int(record.b);
      if (b === null || !BUTTON.has(b)) return null;
      return { t: record.t, b: b as 0 | 1 | 2 };
    }
    case "w": {
      const d = int(record.d);
      if (d === null) return null;
      return { t: "w", d: Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, d)) };
    }
    case "k": {
      const k = int(record.k);
      const d = int(record.d);
      if (k === null || k < 1 || k > 254 || (d !== 0 && d !== 1)) return null;
      return { t: "k", k, d: d as 0 | 1 };
    }
    case "x": {
      if (typeof record.s !== "string") return null;
      const s = record.s.replace(CONTROL, "").slice(0, TEXT_MAX);
      if (!s) return null;
      return { t: "x", s };
    }
    default:
      return null;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The single line the helper reads from stdin for one event. Fixed shape,
 * only digits, a sign, and (for typed text) an escaped JSON string: the helper
 * parses fields, it never evals. */
export function encodeControlEvent(ev: ControlEvent): string {
  switch (ev.t) {
    case "m": return `m ${ev.x} ${ev.y}`;
    case "d": return `d ${ev.b}`;
    case "u": return `u ${ev.b}`;
    case "w": return `w ${ev.d}`;
    case "k": return `k ${ev.k} ${ev.d}`;
    case "x": return `x ${JSON.stringify(ev.s)}`;
  }
}

/** Collapse a burst of events before a flush: only the last pointer move
 * matters, and the order of clicks and keys is kept. Keeps latency down
 * without dropping a button or a keystroke. */
export function coalesceEvents(events: readonly ControlEvent[]): ControlEvent[] {
  const out: ControlEvent[] = [];
  let pendingMove: ControlEvent | null = null;
  for (const ev of events) {
    if (ev.t === "m") {
      pendingMove = ev;
      continue;
    }
    if (pendingMove) {
      out.push(pendingMove);
      pendingMove = null;
    }
    out.push(ev);
  }
  if (pendingMove) out.push(pendingMove);
  return out;
}

/** Frames the helper writes to stdout: a type byte, a 4-byte big-endian
 * length, then the payload. 'M' is a small JSON metadata object (the remote
 * screen size), 'F' is a JPEG frame. */
export const HELPER_FRAME_META = 0x4d; // 'M'
export const HELPER_FRAME_JPEG = 0x46; // 'F'
export const HELPER_FRAME_MAX = 8 * 1024 * 1024;

export interface HelperMeta {
  /** Remote virtual screen size in pixels, for the viewer's aspect ratio. */
  w: number;
  h: number;
}

export type HelperMessage =
  | { kind: "meta"; meta: HelperMeta }
  | { kind: "frame"; bytes: Uint8Array };

/** Incremental decoder of the helper's stdout byte stream. Returns the
 * messages complete so far, or an error code to tear the session down with
 * (the helper must never make the server buffer without bound). */
export function createHelperFrameDecoder(maxBytes = HELPER_FRAME_MAX): (chunk: Uint8Array) => HelperMessage[] | { error: "oversize" | "protocol" } {
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  return (chunk) => {
    pending = concat(pending, chunk);
    const out: HelperMessage[] = [];
    let offset = 0;
    while (pending.length - offset >= 5) {
      const type = pending[offset]!;
      if (type !== HELPER_FRAME_META && type !== HELPER_FRAME_JPEG) return { error: "protocol" };
      const length = readUint32(pending, offset + 1);
      if (length > maxBytes) return { error: "oversize" };
      if (pending.length - offset - 5 < length) break;
      const payload = pending.subarray(offset + 5, offset + 5 + length);
      offset += 5 + length;
      if (type === HELPER_FRAME_META) {
        const meta = parseMeta(payload);
        if (!meta) return { error: "protocol" };
        out.push({ kind: "meta", meta });
      } else {
        out.push({ kind: "frame", bytes: payload.slice() });
      }
    }
    pending = offset > 0 ? pending.subarray(offset).slice() : pending;
    return out;
  };
}

function parseMeta(payload: Uint8Array): HelperMeta | null {
  try {
    const obj = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const record = obj as Record<string, unknown>;
    const w = record.w;
    const h = record.h;
    if (typeof w !== "number" || typeof h !== "number" || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > 1_000_000 || h > 1_000_000) {
      return null;
    }
    return { w: Math.round(w), h: Math.round(h) };
  } catch {
    return null;
  }
}

function concat(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function readUint32(buf: Uint8Array, at: number): number {
  return (buf[at]! * 0x1000000) + (buf[at + 1]! << 16) + (buf[at + 2]! << 8) + buf[at + 3]!;
}
