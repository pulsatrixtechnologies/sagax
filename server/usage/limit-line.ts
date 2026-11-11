// The one line a conversation keeps for a usage limit (#3552). The engine's
// own error row for the turn becomes the line; a line of the same state that
// still stands (no answer since) is retired into a quiet notice, so a second
// limit event in the conversation moves the one line instead of adding one.
// The line is that row alone: it carries the state, in the reader's language,
// and a failed turn's cause for the readers of the conversation (#1942).
import { failedTurnCause } from "../../shared/failed-turn.ts";
import { limitFailoverText, limitFailoverWords, limitLinePlainWords, limitLineRetiredName, resetClockText, standingLimitLines, type LimitFailoverLine } from "../../shared/limit-failover.ts";
import type { WireMessage } from "../../shared/wire.ts";
import { personWord, type PersonLanguage } from "../people/person-words.ts";

/** Who reads a conversation's plain limit line: the person who owns it, in
 * their language and their time zone (#3530). */
export interface LimitLineReader {
  language: PersonLanguage;
  /** IANA zone; absent: the server process's own. */
  timeZone?: string;
}

/** #3530: the plain words of a limit line (what a connector, the thread API
 * and a notification read) in the reader's language, the reset in the
 * reader's clock, from the locale keys the app draws the same line with
 * (limitFailoverWords). Auto's own switch keeps its fuller words. */
export function limitLineText(line: LimitFailoverLine, reader: LimitLineReader, now = Date.now()): string {
  const clock = (at: number) => resetClockText(at, reader.language === "fr" ? "fr-CA" : "en-US", reader.timeZone, now);
  if (line.kind === "switched" && line.to === "Auto" && line.reason !== "model") {
    return personWord(reader.language, line.estimated ? "limitFailover.autoContinuedNoReset" : "limitFailover.autoContinued", { from: line.from, time: clock(line.resetsAt) });
  }
  const words = limitFailoverWords(line);
  if (!words) return limitFailoverText(line, clock);
  return personWord(reader.language, words.key, words.at !== undefined ? { ...words.vars, time: clock(words.at) } : words.vars);
}

type Tool = NonNullable<WireMessage["tool"]>;

export interface LimitLineStore {
  messagesFor(threadId: string): readonly WireMessage[];
  patchMessage(threadId: string, messageId: string, patch: Partial<WireMessage>): unknown;
  appendMessage(threadId: string, message: Omit<WireMessage, "id" | "at"> & { at?: number }): unknown;
}

/** Writes `line` in place of the turn's failure row (`turnId`, else the last
 * one written since `since`), or after the conversation's last message. */
export function writeLimitLine(store: LimitLineStore, threadId: string, turnId: string | undefined, line: LimitFailoverLine, since: number,
  words: { row: (line: LimitFailoverLine) => Tool }): void {
  const tool = words.row(line);
  // #1942: exhausted failover is a failed turn (readers must not treat empty as done).
  const failed = line.kind === "exhausted";
  const messages = store.messagesFor(threadId);
  // The engine's own error row for this turn becomes the line: one row,
  // not two. A runtime.error row may carry no turn id: then the last one
  // written since the turn was dispatched.
  const failure = messages.findLast((message) => message.kind === "activity" && message.tool !== undefined &&
    failedTurnCause(message.tool.name) !== null && (turnId && message.turnId ? message.turnId === turnId : message.at >= since));
  // A nothing-held line written before #3552 left its words as a bot text
  // too: those words step aside with it (read before the rows retire).
  const repeats = limitTextsToRetire(messages);
  // The line already standing for this state steps aside for the new one.
  for (const standing of standingLimitLines(messages)) {
    if (standing.id === failure?.id || !standing.tool) continue;
    store.patchMessage(threadId, standing.id, { tool: { name: limitLineRetiredName(standing.tool.name), ok: true } });
  }
  for (const repeat of repeats) {
    store.patchMessage(threadId, repeat.id, { kind: "activity", text: undefined, tool: { name: limitLineRetiredName(repeat.text ?? ""), ok: true } });
  }
  if (failure) store.patchMessage(threadId, failure.id, { tool, ...(failed ? { turnSucceeded: false } : {}) });
  else store.appendMessage(threadId, { role: "bot", kind: "activity", tool, ...(failed ? { turnSucceeded: false } : {}) });
}

/** The bot texts that repeat a nothing-held limit row's words after it. */
function limitTextsToRetire(messages: readonly WireMessage[]): WireMessage[] {
  const said = new Set<string>();
  const repeats: WireMessage[] = [];
  for (const message of messages) {
    if (message.kind === "activity" && message.tool?.limitFailover?.kind === "exhausted") {
      said.add(limitLinePlainWords(message.tool.name));
    } else if (message.role === "bot" && message.kind === "text" && message.turnSucceeded === false && message.text && said.has(message.text)) {
      repeats.push(message);
    }
  }
  return repeats;
}
