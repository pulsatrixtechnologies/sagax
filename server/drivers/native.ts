// Native (un-normalized) protocol tee — the debugging trick from upstream's
// EventNdjsonLogger and agentcal's onRaw: every provider-native message is
// written verbatim next to the canonical stream, so protocol drift can be
// diagnosed by diffing the two.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { NATIVE_DIR } from "../config.ts";
import { redactSecrets } from "../redact.ts";
import { threadLogsForgotten } from "../forgotten-threads.ts";
import { capThreadLog, currentThreadLogCap } from "../thread-log-rotation.ts";

// Port de OpenMausBot #3129 : screenshots and files that ride inline as
// base64 tell nothing about the protocol, only their size. Kept out of the
// tee, they no longer cost a redaction pass, a serialization and megabytes
// of log per frame.
const INLINE_DATA_CHARS = 1024;
const DATA_URL = /^data:[^,;]{0,100};base64,/;

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

export function appendNative(threadId: string, entry: { dir: "in" | "out"; source: string; msg: unknown }) {
  // a deleted confidential thread's log is never written again
  if (threadLogsForgotten(threadId)) return;
  const file = join(NATIVE_DIR, `${threadId}.ndjson`);
  try {
    // The session-setup messages carry the credentials the agent is handed —
    // the boat and comms tokens ride inside session/new's mcpServers env, and
    // an MCP header can carry a provider key. These files are ordinary
    // 0644 files people paste into bug reports, so values are masked while
    // the shape stays intact.
    appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), ...entry, msg: redactSecrets(withoutInlineData(entry.msg)) }) + "\n",
      { mode: 0o600 },
    );
    // Best-effort size cap (#1280) — same rule as the write itself: never
    // let logging break the run it is observing.
    capThreadLog(file, currentThreadLogCap());
  } catch {
    /* never let logging break a run */
  }
}
