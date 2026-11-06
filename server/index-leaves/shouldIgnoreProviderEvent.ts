// @ts-nocheck
/** shouldIgnoreProviderEvent (#1388). Pure move from server/index.ts. */
import { isTurnEventQuarantined } from "../turns/turn-dispatch-guard.ts";
export type Host = Record<string, any>;

export function createShouldIgnoreProviderEvent(getHost: () => Host): any {
function shouldIgnoreProviderEvent(event: RuntimeEvent): boolean {
  const host = getHost();
  // Some adapters publish completion/error synchronously just before their
  // sendTurn promise resolves. Stop can already have cancelled that handshake,
  // but its returned turn id is not available to retire yet. Quarantine the
  // narrow pre-id window and tombstone any id it reveals; the broad gate is
  // time-bounded so a broken promise cannot suppress a later turn forever.
  const owner = host.directRequestOwners.get(event.threadId);
  const currentTurnId = owner?.generation === host.directTurnGenerationByThread.get(event.threadId) ? owner?.turnId ?? undefined : undefined;
  if (isTurnEventQuarantined(host.pendingCancelledProviderHandshakes, host.retiredProviderTurns, event, currentTurnId)) return true;
  if (event.type !== "session.exited" || event.turnId !== undefined) return false;
  const bot = host.store.botByThread(event.threadId);
  return Boolean(bot && host.threadBusy(bot.id, event.threadId)) || host.groupSpeakers.has(event.threadId);
}
  return shouldIgnoreProviderEvent;
}
