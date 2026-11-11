/** One slice of UTF-8 bytes by offset and limit that never cuts a
 * character: the start moves forward and the end backs up to a character
 * boundary, and a slice holds at least one character. Following `end` as the
 * next offset gives slices that concatenate to the whole exactly. Used by
 * workspace_read (server/workspace/workspace-files.ts) and a page source read
 * (#3488, server/pages/published-pages.ts). Pure. */
export function utf8Slice(bytes: Uint8Array, offset: number, limit: number): { start: number; end: number } {
  const continuation = (at: number) => (bytes[at]! & 0xc0) === 0x80;
  let start = Math.max(0, Math.min(Math.trunc(offset) || 0, bytes.length));
  while (start < bytes.length && continuation(start)) start += 1;
  const size = Math.max(1, Math.trunc(limit) || 1);
  let end = Math.min(bytes.length, start + size);
  while (end < bytes.length && end > start && continuation(end)) end -= 1;
  if (end === start && start < bytes.length) {
    end = start + 1;
    while (end < bytes.length && continuation(end)) end += 1;
  }
  return { start, end };
}
