// A small CBOR reader, enough for App Attest objects (RFC 8949, definite
// lengths only: Apple's attestation and assertion use nothing else).

export type CborValue = number | bigint | string | Uint8Array | CborValue[] | { [key: string]: CborValue } | boolean | null;

export function decodeCbor(input: Uint8Array): CborValue {
  const cursor = { at: 0 };
  const value = read(input, cursor, 0);
  if (cursor.at !== input.length) throw new Error("cbor: trailing bytes");
  return value;
}

function read(buf: Uint8Array, cursor: { at: number }, depth: number): CborValue {
  if (depth > 16) throw new Error("cbor: too deep");
  if (cursor.at >= buf.length) throw new Error("cbor: truncated");
  const head = buf[cursor.at++]!;
  const major = head >> 5;
  const info = head & 0x1f;
  if (major === 7) {
    if (info === 20) return false;
    if (info === 21) return true;
    if (info === 22 || info === 23) return null;
    throw new Error("cbor: unsupported simple value");
  }
  const length = readLength(buf, cursor, info);
  switch (major) {
    case 0: return typeof length === "bigint" && length > BigInt(Number.MAX_SAFE_INTEGER) ? length : Number(length);
    case 1: return -1 - Number(length);
    case 2: case 3: {
      const size = Number(length);
      if (cursor.at + size > buf.length) throw new Error("cbor: truncated");
      const bytes = buf.subarray(cursor.at, cursor.at + size);
      cursor.at += size;
      return major === 2 ? new Uint8Array(bytes) : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    case 4: {
      const size = Number(length);
      if (size > buf.length) throw new Error("cbor: bad array length");
      const items: CborValue[] = [];
      for (let i = 0; i < size; i += 1) items.push(read(buf, cursor, depth + 1));
      return items;
    }
    case 5: {
      const size = Number(length);
      if (size > buf.length) throw new Error("cbor: bad map length");
      const map: { [key: string]: CborValue } = {};
      for (let i = 0; i < size; i += 1) {
        const key = read(buf, cursor, depth + 1);
        map[String(key)] = read(buf, cursor, depth + 1);
      }
      return map;
    }
    default: throw new Error("cbor: unsupported type");
  }
}

function readLength(buf: Uint8Array, cursor: { at: number }, info: number): number | bigint {
  if (info < 24) return info;
  const widths: Record<number, number> = { 24: 1, 25: 2, 26: 4, 27: 8 };
  const width = widths[info];
  if (!width) throw new Error("cbor: indefinite length is not supported");
  if (cursor.at + width > buf.length) throw new Error("cbor: truncated");
  let value = 0n;
  for (let i = 0; i < width; i += 1) value = (value << 8n) | BigInt(buf[cursor.at++]!);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}
