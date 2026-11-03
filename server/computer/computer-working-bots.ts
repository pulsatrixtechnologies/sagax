// Settings > Computer: who is on the bot's computer right now, so a person
// can stop a bot's current task and let the update through, instead of only
// being told "a bot is working". Read-only list; the stop reuses the normal
// task stop (POST /api/bots/:id/interrupt). Server wiring in server/index.ts,
// the route in server/routes/computer-working-bots.ts, the UI in
// src/components/settings/ComputerRecoverRow.tsx.

/** A bot working on the computer, as the list endpoint answers it: a human
 * name for the row, the id for a tooltip / Copy and for the stop call, and
 * the thread its current task runs on. The id is never shown as the label. */
export interface WorkingBot {
  id: string;
  name: string;
  threadId: string;
}

/** A raw holder of the computer: the Local VM lease holder on a personal
 * server, or one of the signed-in person's bots with a live turn on an
 * organization server. */
export interface WorkingBotHold {
  botId: string;
  threadId: string;
}

export interface WorkingBotsSource {
  /** The holders of the computer now, in the order they should be shown. */
  holders(): WorkingBotHold[];
  /** The human name of a bot, or null when it is gone. */
  botName(botId: string): string | null;
}

/** The list the UI shows: deduplicated by bot and thread, names resolved,
 * holders whose bot has gone dropped (nothing to name or stop). */
export function workingBots(source: WorkingBotsSource): WorkingBot[] {
  const seen = new Set<string>();
  const out: WorkingBot[] = [];
  for (const { botId, threadId } of source.holders()) {
    const key = `${botId}\n${threadId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = source.botName(botId);
    if (name === null) continue;
    out.push({ id: botId, name, threadId });
  }
  return out;
}
