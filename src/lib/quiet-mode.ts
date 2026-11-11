// #3480: quiet mode on the screens (the contract is shared/quiet-mode.ts).
// One copy of the person's view (GET /api/me/quiet: the switch for all
// their bots and each of their bots' state) for every surface that draws
// it: the bot page's switch and mark, and Settings, Notifications. A bot
// that is not in that view is not the person's: no switch is drawn for it.
// Every switch acts at once, with no confirmation.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/state/store";
import {
  QUIET_MODE_PERSON_PATH, quietModeBotPath,
  type BotQuietState, type BotQuietView, type PersonQuietView,
} from "../../shared/quiet-mode";

let view: PersonQuietView | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: PersonQuietView | null): void {
  view = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const json = { "content-type": "application/json" };

/** Read the person's view again (a bot may have changed its own mode). */
export function loadQuietMode(): Promise<void> {
  loading ??= api<PersonQuietView>(QUIET_MODE_PERSON_PATH)
    .then((answer) => publish(answer && Array.isArray(answer.bots) ? answer : null))
    // an older server has no quiet mode: nothing is drawn
    .catch(() => publish(null))
    .finally(() => { loading = null; });
  return loading;
}

/** The switch for all the person's bots. */
export async function setQuietAll(on: boolean): Promise<void> {
  if (view) publish({ ...view, all: on, bots: view.bots.map((bot) => ({ ...bot, all: on, quiet: bot.bot || on })) });
  try {
    const answer = await api<PersonQuietView>(QUIET_MODE_PERSON_PATH, { method: "PUT", headers: json, body: JSON.stringify({ on }) });
    if (answer && Array.isArray(answer.bots)) publish(answer);
  } catch {
    await loadQuietMode();
  }
}

/** One bot's own switch. */
export async function setQuietBot(botId: string, on: boolean): Promise<void> {
  const patchRow = (row: BotQuietState) => (row.botId === botId ? { ...row, bot: on, quiet: on || row.all } : row);
  if (view) publish({ ...view, bots: view.bots.map(patchRow) });
  try {
    const answer = await api<BotQuietView>(quietModeBotPath(botId), { method: "PUT", headers: json, body: JSON.stringify({ on }) });
    if (answer && view) {
      const { said: _said, summary: _summary, ...state } = answer;
      publish({ ...view, bots: view.bots.map((row) => (row.botId === botId ? state : row)) });
    }
  } catch {
    await loadQuietMode();
  }
}

/** The person's view, read when a surface that draws it opens. */
export function useQuietMode(): PersonQuietView | null {
  const current = useSyncExternalStore(subscribe, () => view, () => view);
  useEffect(() => { void loadQuietMode(); }, []);
  return current;
}

/** One bot's state, or undefined when the bot is not the person's (or the
 * server has no quiet mode). */
export function useBotQuiet(botId: string): BotQuietState | undefined {
  return useQuietMode()?.bots.find((row) => row.botId === botId);
}

/** Tests: start from nothing. */
export function resetQuietModeForTests(next: PersonQuietView | null = null): void {
  loading = null;
  publish(next);
}
