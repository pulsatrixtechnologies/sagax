// The line the harness prints when a turn starts (stderr, which the desktop
// app keeps in server.log). Loi 25: never log incoming message text or a
// person's display name. Counts and ids only. Words spoken on a Live call
// show `text=(spoken)`. A confidential thread shows `text=(confidential)`.

export interface TurnStartLog {
  botId: string;
  text: string;
  images: number;
  depth: number;
  card: boolean;
  /** some of the turn's words were spoken on a Live call */
  spoken: boolean;
  /** the turn's thread is confidential */
  confidential?: boolean;
}

export function turnStartLogLine(turn: TurnStartLog): string {
  const text = turn.confidential
    ? "(confidential)"
    : turn.spoken
      ? "(spoken)"
      : `chars=${turn.text.length}`;
  return `[omb-turn] bot=${turn.botId} text=${text} images=${turn.images} depth=${turn.depth} card=${turn.card}`;
}

/** Loi 25: auto-recall progress with ids and counts only, never a display name. */
export function autoRecallLogLine(botId: string, notes: number, conversations: number, threadId: string): string {
  return `auto-recall: bot=${botId} notes=${notes} conversations=${conversations} thread=${threadId}`;
}
