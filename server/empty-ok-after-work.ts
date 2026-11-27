/** #5360: a turn that settles ok with no final text after tools or an
 * announcement looks finished to the person while nothing more will come.
 * Detect that shape so the harness can retry once or fail visibly. */

export interface TurnRow {
  role?: string;
  kind?: string;
  text?: string;
  turnId?: string;
  tool?: unknown;
  card?: { requestId?: unknown; answered?: unknown; dismissed?: unknown; expired?: unknown } | null;
}

/** True when this completed turn left no final words after it already ran
 * tools. A silent reaction-only turn and a turn that ended on a waiting card
 * are fine. An announcement-only turn with stored text is not empty here
 * (the person already sees that line); tools then silence is. */
export function emptyOkAfterWork(input: {
  ok: boolean;
  stopped: boolean;
  reply: string;
  silent: boolean;
  turnId: string | undefined;
  rows: readonly TurnRow[];
}): boolean {
  if (!input.ok || input.stopped || input.silent) return false;
  if (input.reply.trim()) return false;
  const turnId = input.turnId;
  if (!turnId) return false;
  const ofTurn = input.rows.filter((row) => row.turnId === turnId);
  if (!ofTurn.length) return false;
  if (ofTurn.some((row) => {
    const card = row.card;
    return Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired);
  })) return false;
  return ofTurn.some((row) => row.tool || row.kind === "tool" || row.kind === "tool_call" || row.kind === "tool_result");
}

/** Announcement then close with nothing recorded as the reply: surface a
 * notice so the person is not left waiting for more. */
export function emptyOkAfterAnnouncement(input: {
  ok: boolean;
  stopped: boolean;
  reply: string;
  silent: boolean;
  turnId: string | undefined;
  rows: readonly TurnRow[];
}): boolean {
  if (!input.ok || input.stopped || input.silent || input.reply.trim() || !input.turnId) return false;
  if (emptyOkAfterWork(input)) return false;
  const ofTurn = input.rows.filter((row) => row.turnId === input.turnId);
  return ofTurn.some((row) => row.role === "bot" && row.kind === "text" && (row.text ?? "").trim());
}
