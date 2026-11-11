import { liveReplyText } from "@/components/LiveReply";
import { liveLineNote } from "@/lib/live-text-place";
import { lastNonReceipt } from "@/lib/receipts";
import type { Message } from "@/state/store";
import { useStreamSelector } from "@/state/store-selector";

/** The note the list leaves to the working line (#3696): none while the bot
 * writes its next text, which takes the line (or opens a bubble); the note is
 * then in the turn's row, so its words are never off screen. Reads only
 * whether the thread streams, so a new word does not render the list. */
export function useLiveLineNoteId(
  transcript: readonly Message[],
  liveTurns: ReadonlySet<string>,
  threadId: string | null | undefined,
): string | undefined {
  const writing = useStreamSelector((stream) =>
    Boolean(threadId && liveReplyText(stream.streaming[threadId]).trim()));
  if (writing || liveTurns.size === 0) return undefined;
  return liveLineNote(lastNonReceipt(transcript), liveTurns)?.id;
}
