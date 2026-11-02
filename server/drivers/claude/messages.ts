/** Claude stream-json user message builders and volatile-half notes (#1383). */
import { readAtRestSync } from "../../content-at-rest.ts";
import type { SendTurnInput } from "../../contracts.ts";
import { volatileSectionsUpdate } from "../prompt-split.ts";

export type ClaudeImage = NonNullable<SendTurnInput["images"]>[number];
export type ClaudeUserContent =
  | { type: "image"; source: { type: "base64"; media_type: ClaudeImage["mime"]; data: string } }
  | { type: "text"; text: string };
export type ClaudeUserMessage = {
  type: "user";
  /** echoed back with --replay-user-messages; set on steers */
  uuid?: string;
  message: { role: "user"; content: string | ClaudeUserContent[] };
};

/** Claude's stream-json input accepts the same image source blocks as the
 * Anthropic Messages API. Keep the old string form for text-only turns so a
 * CLI update cannot disturb the overwhelmingly common path. */
/** A value no real volatile half can equal: after the CLI compacts its
 * session, the next turn's volatile half always counts as changed. */
export const COMPACTED_VOLATILE = "\u0000compacted";
/** A process launched with the stable half only whose first message has not
 * gone out yet (a warm process): its next turn carries the whole volatile
 * half, in the launch wording. */
export const UNDELIVERED_VOLATILE = "\u0000undelivered";

/** How a mid-session change to the volatile half of the system prompt
 * reaches a model whose process was launched with the old copy. The CLI's
 * own out-of-band convention inside a user turn, and it costs one short
 * append rather than a relaunch that re-uploads the whole prompt cache. */
export function withVolatileNote(text: string, volatile: string, launch = false): string {
  const body = !volatile.trim()
    ? "The notes that were in your instructions when this session started have been cleared."
    : launch
      ? `This part of your instructions changes from turn to turn, so it arrives here instead of in the system prompt. It replaces any earlier copy:\n\n${volatile.trim()}`
      : `This part of your instructions changed since this session started. It replaces the earlier copy:\n\n${volatile.trim()}`;
  return withReminder(text, body);
}

export function withReminder(text: string, body: string): string {
  const note = `<system-reminder>\n${body}\n</system-reminder>`;
  return text ? `${note}\n\n${text}` : note;
}

/** The user message for a turn sent to a conversation that holds the
 * volatile half `held` (with those section fingerprints): the bare words
 * when nothing changed, only the changed sections when they can say it,
 * else the whole half. */
export function volatileTurnMessage(
  turn: Pick<SendTurnInput, "text" | "images" | "systemVolatile" | "systemVolatileSections" | "mentionTurn" | "harnessCommand">,
  held: string,
  heldSections: Record<string, string> | undefined,
): ClaudeUserMessage {
  // An engine slash command reaches the CLI verbatim: a note in front of
  // it would make it an ordinary message (server/harness-commands.ts). The
  // caller leaves the held copy as it was, so the next turn carries the note.
  if (turn.harnessCommand) return claudeUserMessage(turn.text, turn.images);
  const volatile = turn.systemVolatile ?? "";
  const notHeld = held === COMPACTED_VOLATILE || held === UNDELIVERED_VOLATILE;
  const unchanged = volatile === held || (notHeld && !volatile.trim());
  if (unchanged && !turn.mentionTurn) return claudeUserMessage(turn.text, turn.images);
  // Only the sections that changed ride (2026-10-19 perf parity, point 4):
  // one recent-work line moving no longer re-sends the whole memory
  // notebook into the session every turn.
  const sectionsNote = volatileSectionsUpdate(turn.systemVolatileSections, notHeld ? undefined : heldSections, Boolean(turn.mentionTurn));
  if (sectionsNote === null) return claudeUserMessage(withVolatileNote(turn.text, volatile, held === UNDELIVERED_VOLATILE), turn.images);
  return claudeUserMessage(sectionsNote ? withReminder(turn.text, sectionsNote) : turn.text, turn.images);
}

export function claudeUserMessage(
  text: string,
  images: readonly ClaudeImage[] | undefined,
): ClaudeUserMessage {
  if (!images?.length) return { type: "user", message: { role: "user", content: text } };
  const content: ClaudeUserContent[] = images.map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: image.mime,
      data: readAtRestSync(image.path).toString("base64"),
    },
  }));
  if (text) content.push({ type: "text", text });
  return { type: "user", message: { role: "user", content } };
}

/** Native traces are routinely attached to bug reports. Preserve the image
 * block's shape and size for debugging, but never persist its base64 bytes. */
export function diagnosticClaudeUserMessage(message: ClaudeUserMessage): ClaudeUserMessage {
  if (!Array.isArray(message.message.content)) return message;
  return {
    ...message,
    message: {
      ...message.message,
      content: message.message.content.map((block) =>
        block.type === "image"
          ? {
              ...block,
              source: {
                ...block.source,
                data: `[image data: ${block.source.data.length} base64 chars]`,
              },
            }
          : block,
      ),
    },
  };
}
