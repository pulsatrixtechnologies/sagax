// The files a person pinned in a conversation's Library tab. A pin is the
// file's opaque id (server/threads/thread-files.ts) under its thread, kept in one
// JSON file written whole and atomically with mode 0600, so the same pins
// show on the desktop and on iOS. Nothing here reads or widens file access.
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "../atomic.ts";

/** Bounds one conversation's pins. */
export const MAX_PINS_PER_THREAD = 200;
const FILE_ID = /^[a-f0-9]{24}$/;

export interface ThreadFilePins {
  /** The pinned file ids of a conversation. */
  ids(threadId: string): ReadonlySet<string>;
  /** Pin or unpin; false when the conversation is at its limit. */
  set(threadId: string, fileId: string, pinned: boolean): boolean;
}

export function createThreadFilePins(options: { file: string }): ThreadFilePins {
  const pins = new Map<string, string[]>();
  try {
    const parsed = JSON.parse(readFileSync(options.file, "utf8")) as { threads?: Record<string, unknown> };
    for (const [threadId, list] of Object.entries(parsed.threads ?? {})) {
      const ids = Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && FILE_ID.test(id)) : [];
      if (ids.length) pins.set(threadId, Array.from(new Set(ids)).slice(0, MAX_PINS_PER_THREAD));
    }
  } catch {
    // no file yet, or unreadable: start empty
  }
  const save = () => {
    writeFileAtomic(options.file, JSON.stringify({ version: 1, threads: Object.fromEntries(pins) }), { mode: 0o600 });
  };
  return {
    ids: (threadId) => new Set(pins.get(threadId) ?? []),
    set: (threadId, fileId, pinned) => {
      if (!FILE_ID.test(fileId)) return false;
      const current = pins.get(threadId) ?? [];
      const has = current.includes(fileId);
      if (pinned === has) return true;
      if (pinned && current.length >= MAX_PINS_PER_THREAD) return false;
      const next = pinned ? [...current, fileId] : current.filter((id) => id !== fileId);
      if (next.length) pins.set(threadId, next);
      else pins.delete(threadId);
      save();
      return true;
    },
  };
}
