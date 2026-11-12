import { isQuietWorkspaceLine } from "../../shared/workspace-line";
import { isTechnicalNoticeName } from "../../shared/chat-notices";
import { routineRunRowOutOfChat } from "../../shared/routine-repeat";

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

/** The "On your computer" line and a technical notice (shared/chat-notices.ts):
 * stored, never drawn, so never the preview (isHiddenStatusActivity in
 * activity-runs.ts). */
function isHiddenWorkspaceLine(message: { kind: string }): boolean {
  if ((message.kind === "screen" || message.kind === "video") && !(message as { requested?: boolean }).requested) return true; // a view nobody asked for is not drawn (shared/requested-views.ts)
  if (message.kind !== "activity") return false;
  const name = (message as { tool?: { name?: string } }).tool?.name;
  return isQuietWorkspaceLine(name) || isTechnicalNoticeName(name);
}

/** The newest message that is not a receipt, or undefined. */
export function lastNonReceipt<T extends { kind: string }>(messages: readonly T[] | undefined): T | undefined {
  if (!messages) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isReceipt(messages[i]!) && !isStoppedNotice(messages[i]!) && !isHiddenWorkspaceLine(messages[i]!)) return messages[i];
  }
  return undefined;
}

type PreviewableRun = { kind: string; routineRun?: { summary?: string; status?: string } };

/** A routine run's receipt with no report (running, quiet, failed) is no
 * line a person would read as the bot's last words (#2081: "Routine ...
 * failed" was the sidebar's preview). A finished run with a report is the
 * bot's message, so it is one. */
function isSilentRunReceipt(message: PreviewableRun): boolean {
  if (message.kind !== "routine.run") return false;
  const run = message.routineRun;
  // #3990: a row the chat no longer draws is no preview either
  return !(run && run.status === "completed" && run.summary?.trim()) || routineRunRowOutOfChat(message);
}

/** What a bot's conversation reads as the bot's last words, for a preview
 * line: past receipts, stopped notices, hidden workspace lines and silent
 * run receipts. */
export function lastSpokenLine<T extends PreviewableRun>(messages: readonly T[] | undefined): T | undefined {
  if (!messages) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (isReceipt(message) || isStoppedNotice(message) || isHiddenWorkspaceLine(message) || isSilentRunReceipt(message)) continue;
    return message;
  }
  return undefined;
}
