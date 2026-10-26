// The local "Use Messages" switch. A boolean on this Mac's data dir, never
// a route an organization server can use to point at someone's Messages.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export type MessagesSettings = { useMessages: boolean };

export function readMessagesSettings(dataDir: string): MessagesSettings {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, "messages.json"), "utf8")) as { useMessages?: unknown };
    return { useMessages: raw?.useMessages === true };
  } catch {
    return { useMessages: false };
  }
}

export function writeMessagesSettings(dataDir: string, useMessages: boolean): MessagesSettings {
  const next = { useMessages: useMessages === true };
  writeFileAtomic(join(dataDir, "messages.json"), `${JSON.stringify(next)}\n`, { mode: 0o600 });
  return next;
}
