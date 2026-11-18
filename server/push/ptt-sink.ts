// Where a finished turn hands the bot's words to Push to Talk (the leaf
// server/index-leaves/notify.ts calls it; server/index.ts sets it once).
export type PttReplySink = (input: { botId: string; threadId: string; text: string }) => Promise<boolean>;

let sink: PttReplySink | null = null;

export function setPttReplySink(next: PttReplySink | null): void {
  sink = next;
}

/** Never throws; false when nothing is set or nothing went out. */
export async function sendToPttSink(input: { botId: string; threadId: string; text: string }): Promise<boolean> {
  try {
    return sink ? await sink(input) : false;
  } catch {
    return false;
  }
}
