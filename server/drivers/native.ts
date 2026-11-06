// Native (un-normalized) protocol tee — the debugging trick from upstream's
// EventNdjsonLogger and agentcal's onRaw: every provider-native message is
// written verbatim next to the canonical stream, so protocol drift can be
// diagnosed by diffing the two. Lines are held per thread and appended
// together every FLUSH_MS, when a caller flushes, and at exit.
import { appendFileSync } from "node:fs";
import { basename, join } from "node:path";

import { NATIVE_DIR } from "../config.ts";
import { logAppended, registerSealedLog, sealLogLines } from "../encryption/content-at-rest.ts";
import { redactSecrets } from "../redact.ts";
import { threadLogsForgotten } from "../threads/forgotten-threads.ts";
import { capThreadLog, currentThreadLogCap } from "../threads/thread-log-rotation.ts";

// Port de OpenMausBot #3129 : screenshots and files that ride inline as
// base64 tell nothing about the protocol, only their size. Kept out of the
// tee, they no longer cost a redaction pass, a serialization and megabytes
// of log per frame.
const INLINE_DATA_CHARS = 1024;
const DATA_URL = /^data:[^,;]{0,100};base64,/;
const FLUSH_MS = 250;
const MAX_HELD_CHARS = 256 * 1024;

type HeldLine = { record: Record<string, unknown>; line: string };

const held = new Map<string, HeldLine[]>();
let heldChars = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function imageMedia(record: Record<string, unknown>): boolean {
  const media = record.media_type ?? record.mimeType ?? record.mime_type;
  return typeof media === "string" && media.startsWith("image/");
}

function carriesBase64(record: Record<string, unknown>): boolean {
  return record.type === "base64" || record.type === "image" || imageMedia(record);
}

/** A copy of `value` with long inline base64 replaced by its length; the
 * same object when nothing was long enough to replace. */
export function withoutInlineData(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > INLINE_DATA_CHARS && DATA_URL.test(value) ? `[data URL: ${value.length} chars]` : value;
  }
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = withoutInlineData(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  const record = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(record)) {
    const next = key === "data" && typeof child === "string" && child.length > INLINE_DATA_CHARS && carriesBase64(record)
      ? `[${record.type === "image" || imageMedia(record) ? "image" : "base64"} data: ${child.length} base64 chars]`
      : withoutInlineData(child, depth + 1);
    if (next !== child) (copy ??= { ...record })[key] = next;
  }
  return copy ?? value;
}

/** A fragment a later record of the same protocol carries whole: Claude Code's content_block_delta stream events (then
 * the assistant message), Codex app-server item deltas (then item/completed), Pi's message and tool updates (then
 * message_end and tool_execution_end). */
export function streamedFragment(source: string, msg: unknown): boolean {
  if (msg === null || typeof msg !== "object") return false;
  const record = msg as Record<string, unknown>;
  if (source === "claude.sdk.message") return record.type === "stream_event" && (record.event as { type?: unknown } | undefined)?.type === "content_block_delta";
  if (source === "codex.app-server") return typeof record.method === "string" && record.method.startsWith("item/") && /delta$/i.test(record.method);
  if (source === "pi.rpc") return record.type === "message_update" || record.type === "tool_execution_update";
  return false;
}

// The provider's own protocol messages: sealed line by line under the
// thread's key (docs/content-encryption.md), direction and time in the clear.
registerSealedLog({
  dir: NATIVE_DIR,
  scope: (_record, file) => ({ thread: basename(file, ".ndjson") }),
  projection: (record) => ({ at: record.at, dir: record.dir }),
  perFile: true,
});

export function appendNative(threadId: string, entry: { dir: "in" | "out"; source: string; msg: unknown }) {
  // a deleted confidential thread's log is never written again
  if (threadLogsForgotten(threadId)) return;
  if (streamedFragment(entry.source, entry.msg)) return;
  let record: Record<string, unknown>;
  let line: string;
  try {
    // The session-setup messages carry the credentials the agent is handed —
    // the boat and comms tokens ride inside session/new's mcpServers env, and
    // an MCP header can carry a provider key. These files are ordinary
    // 0644 files people paste into bug reports, so values are masked while
    // the shape stays intact.
    record = { at: new Date().toISOString(), ...entry, msg: redactSecrets(withoutInlineData(entry.msg)) };
    line = JSON.stringify(record);
  } catch {
    return;
  }
  const lines = held.get(threadId);
  if (lines) lines.push({ record, line });
  else held.set(threadId, [{ record, line }]);
  heldChars += line.length;
  // What OpenMausBot sent is a few lines a turn, and the line a bug report most needs: it lands at once.
  if (entry.dir === "out") flushNativeLog(threadId);
  else if (heldChars >= MAX_HELD_CHARS) flushNativeLogs();
  else if (!timer) {
    timer = setTimeout(flushNativeLogs, FLUSH_MS);
    timer.unref?.();
  }
}

export function flushNativeLog(threadId: string): void {
  const items = take(threadId);
  if (!items) return;
  const file = join(NATIVE_DIR, `${threadId}.ndjson`);
  try {
    // sealed at rest under the thread's key (server/encryption/content-at-rest.ts), on
    // disk when this returns, as before; the migration gathers the lines into
    // blocks once the log is quiet
    const originals = items.map((item) => item.line);
    const sealed = sealLogLines(file, items.map((item) => item.record), originals);
    const data = `${sealed.join("\n")}\n`;
    appendFileSync(file, data, { mode: 0o600 });
    logAppended(file, originals, data);
    // Best-effort size cap (#1280) — same rule as the write itself: never
    // let logging break the run it is observing.
    capThreadLog(file, currentThreadLogCap());
  } catch {
    /* never let logging break a run */
  }
}

export function flushNativeLogs(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const threadId of Array.from(held.keys())) flushNativeLog(threadId);
}

/** A deleted thread's held lines are dropped, so a later flush cannot recreate its log. */
export function discardNativeLog(threadId: string): void {
  take(threadId);
}

function take(threadId: string): HeldLine[] | undefined {
  const lines = held.get(threadId);
  if (!lines) return undefined;
  held.delete(threadId);
  for (const item of lines) heldChars -= item.line.length;
  return lines;
}

process.once("exit", flushNativeLogs);
