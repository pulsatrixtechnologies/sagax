/** One slice of UTF-8 bytes by offset and limit that never cuts a
 * character: an offset inside a character moves forward to the next one, and
 * an end inside a character backs up to its start; a slice holds at least one
 * character. Following `end` as the next offset gives slices that concatenate
 * to the whole exactly. Used by workspace_read
 * (server/workspace/workspace-files.ts) and a page source read (#3488,
 * server/pages/published-pages.ts). Pure.
 *
 * #3584: on bytes that are not UTF-8 a byte is inside a character only when a
 * lead byte at most 3 bytes before it says so, so offset 0 skips nothing, a
 * stray byte is a unit of its own, and a slice is never larger than the limit
 * (or than one character, 4 bytes at most, when the limit is smaller). */
export function utf8Slice(bytes: Uint8Array, offset: number, limit: number): { start: number; end: number } {
  const start = boundaryAtOrAfter(bytes, Math.max(0, Math.min(Math.trunc(offset) || 0, bytes.length)));
  const size = Math.max(1, Math.trunc(limit) || 1);
  let end = Math.min(bytes.length, start + size);
  const lead = leadOf(bytes, end);
  if (lead !== null) end = lead.at > start ? lead.at : Math.min(bytes.length, lead.at + lead.length);
  return { start, end };
}

const continuation = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80;

/** The length a lead byte declares (2 to 4), or 0 when it is not one. */
function declared(byte: number): number {
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 0;
}

/** The character `at` is inside of (its lead byte and declared length), or
 * null when `at` starts a unit (a character or a stray byte) or is the end. */
function leadOf(bytes: Uint8Array, at: number): { at: number; length: number } | null {
  if (at <= 0 || at >= bytes.length || !continuation(bytes[at])) return null;
  for (let back = at - 1; back >= 0 && back >= at - 3; back -= 1) {
    const byte = bytes[back]!;
    if (continuation(byte)) continue;
    const length = declared(byte);
    return length && back + length > at ? { at: back, length } : null;
  }
  return null;
}

function boundaryAtOrAfter(bytes: Uint8Array, at: number): number {
  const lead = leadOf(bytes, at);
  return lead ? Math.min(bytes.length, lead.at + lead.length) : at;
}
