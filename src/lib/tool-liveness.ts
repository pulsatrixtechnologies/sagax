export interface LiveToolRun { busy?: boolean; turnStartedAt?: number | null }
export interface ToolRunMessage {
  id: string; at: number; turnId?: string; turnTerminal?: boolean; turnCompletedAt?: number;
  role: "bot" | "user"; kind: string;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

const ended = (message: ToolRunMessage) => Boolean(message.turnTerminal) || message.turnCompletedAt != null;

/** The one rule for which turn is the live one: the chat is busy, and the
 * turn wrote a row since the turn started (a step or only notes) and has no
 * terminal or completed row yet. A failed or stopped turn is marked terminal
 * too. The order of the rows does not matter: a message the person sends
 * while the turn runs (a steer) leaves it live. */
export function liveTurnIds(messages: readonly ToolRunMessage[], run?: LiveToolRun): ReadonlySet<string> {
  if (!run?.busy || !Number.isFinite(run.turnStartedAt) || run.turnStartedAt == null) return EMPTY_IDS;
  const completedTurns = new Set(messages.filter((message) => message.turnId && ended(message)).map((message) => message.turnId));
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.turnId && message.at >= run.turnStartedAt && !completedTurns.has(message.turnId)) ids.add(message.turnId);
  }
  return ids.size === 0 ? EMPTY_IDS : ids;
}

/** Whether the rows a chat's step row folds belong to a live turn. */
export function foldsLiveTurn(rows: readonly ToolRunMessage[], liveTurns: ReadonlySet<string>): boolean {
  return liveTurns.size > 0 && rows.some((message) => message.turnId !== undefined && liveTurns.has(message.turnId));
}

/** Tool activity ids that belong to the live turn. Historical incomplete
 * receipts (ok still unset after a restart) are never live. */
export function liveToolIds(messages: readonly ToolRunMessage[], run?: LiveToolRun): ReadonlySet<string> {
  const liveTurns = liveTurnIds(messages, run);
  if (!run?.busy || run.turnStartedAt == null || !Number.isFinite(run.turnStartedAt)) return EMPTY_IDS;
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === "activity" && message.at >= run.turnStartedAt && !ended(message) &&
      (!message.turnId || liveTurns.has(message.turnId))) ids.add(message.id);
  }
  return ids.size === 0 ? EMPTY_IDS : ids;
}
