// One turn saying the same thing twice (2026-11-01, reported: "it repeats itself
// several times"). A model that writes the same text before each step of
// one turn ("Let me check the ticket.") put one identical bubble in the
// chat per step. Within one turn of one thread, text equal to what that
// turn already wrote (whitespace aside) is not written again: the person
// loses nothing, and the chat stops reading as a loop. A next turn starts
// clean and may say it again.

/** How many distinct replies one turn remembers; past this, the oldest go. */
const MAX_TEXTS_PER_TURN = 64;

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export class TurnReplyRepeats {
  private readonly turns = new Map<string, { turnId: string; texts: Set<string> }>();

  /** True when this turn of this thread already wrote this text; otherwise
   * remembers it and returns false. With no turn id nothing is compared. */
  repeated(threadId: string, turnId: string | undefined, text: string): boolean {
    if (!turnId) return false;
    const key = normalized(text);
    if (!key) return false;
    let turn = this.turns.get(threadId);
    if (!turn || turn.turnId !== turnId) {
      turn = { turnId, texts: new Set() };
      this.turns.set(threadId, turn);
    }
    if (turn.texts.has(key)) return true;
    if (turn.texts.size >= MAX_TEXTS_PER_TURN) turn.texts.delete(turn.texts.values().next().value!);
    turn.texts.add(key);
    return false;
  }

  /** The thread's turn ended. A late event of that turn compares again
   * from nothing, which can only write, never hide. */
  settle(threadId: string, turnId: string | undefined): void {
    const turn = this.turns.get(threadId);
    if (turn && (!turnId || turn.turnId === turnId)) this.turns.delete(threadId);
  }
}
