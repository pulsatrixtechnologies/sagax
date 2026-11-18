// #4632: how a line names the files the server staged for it
// (agentPromptWithFiles, server/agent-api.ts), read back for one purpose only:
// whether a conversation that stays still names a staged file, so its
// deletion elsewhere keeps it (the stored attachments' rule). Never the list
// of files to erase: that is the server's own record on the conversation
// (TaskRecord.stagedFiles). A sealed row keeps an opaque ref of each name in
// its cleartext projection (server/encryption/message-sealing.ts), so
// threadsReferencing finds it without opening the row and without a file
// name in clear.
import { createHash } from "node:crypto";

export const FILES_NOTE = "\n\n[Files sent with this message, now in your Sagax workspace folder: ";
export const FILES_NOTE_END = ". Read them with workspace_read using those paths";

/** The workspace-relative paths a line's files note names (each under
 * inbox/<sender>/). A name never holds a "/", so ", inbox/" only ever starts
 * the next path. */
export function namedStagedPaths(text: string | undefined): string[] {
  if (!text) return [];
  const start = text.lastIndexOf(FILES_NOTE);
  if (start < 0) return [];
  const from = start + FILES_NOTE.length;
  const end = text.indexOf(FILES_NOTE_END, from);
  if (end < 0) return [];
  return text.slice(from, end).split(/, (?=inbox\/)/).filter((path) => /^inbox\/[^/]+\/[^/]+$/.test(path));
}

/** The opaque ref of a staged path a sealed row keeps. */
export function stagedFileRef(path: string): string {
  return `staged-${createHash("sha256").update(path).digest("hex").slice(0, 32)}`;
}
