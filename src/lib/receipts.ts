import { isQuietWorkspaceLine } from "../../shared/workspace-line";

// The harness's receipts about a turn (Phase 0): the work digest written
// after every settled turn, and a compaction record. A finished Live call's
// record row is one too: it is appended when the call ends, wherever the
// chat is then, often right after a turn that failed or is still working.
// So is the "Disabled · 5 routines" line a turn leaves (kind "routines").
// They are the last rows of an idle chat, so anything that reads "the last
// message" as the reply a person sees — the sidebar preview, the mascot's
// mood, the row Retry belongs to, the working line — must look past them.
// Kept as one predicate so they agree.
export function isReceipt(message: { kind: string }): boolean {
  return message.kind === "digest" || message.kind === "compaction" || message.kind === "call" || message.kind === "routines";
}

/** A stop the person asked for, stored by an older build as an error row
 * ("turn stopped"). The chat hides it, so the preview and the mood must not
 * read it either. Same test as isTurnStoppedNotice in activity-runs.ts. */
function isStoppedNotice(message: { kind: string }): boolean {
  if (message.kind !== "activity") return false;
  const name = (message as { tool?: { name?: unknown } }).tool?.name;
  return typeof name === "string" && name.replace(/^error:\s*/, "").trim() === "turn stopped";
}

/** The "On your computer" line: stored, never drawn, so never the preview
 * (isHiddenStatusActivity in activity-runs.ts). */
function isHiddenWorkspaceLine(message: { kind: string }): boolean {
  if ((message.kind === "screen" || message.kind === "video") && !(message as { requested?: boolean }).requested) return true; // a view nobody asked for is not drawn (shared/requested-views.ts)
  return message.kind === "activity" && isQuietWorkspaceLine((message as { tool?: { name?: string } }).tool?.name);
}

/** The newest message that is not a receipt, or undefined. */
export function lastNonReceipt<T extends { kind: string }>(messages: readonly T[] | undefined): T | undefined {
  if (!messages) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isReceipt(messages[i]!) && !isStoppedNotice(messages[i]!) && !isHiddenWorkspaceLine(messages[i]!)) return messages[i];
  }
  return undefined;
}
