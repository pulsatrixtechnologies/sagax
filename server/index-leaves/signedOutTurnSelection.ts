// @ts-nocheck
/** #3315: a turn whose engine is known to be signed out for its payer starts
 * on a backup the person chose, for this turn only (server/engines/signed-out-carry-on.ts).
 * Each such turn writes one quiet row (the Events lens); the person hears the
 * sign-out once a stretch, in this bot's chat and as a notification. */
import { activeEngineRefusal, firstSignedOut, noteEngineRefusal, signedOutHeld } from "../engines/engine-refusals.ts";
import { signedOutCarryOn } from "../engines/signed-out-carry-on.ts";
import { buildNoticeNotification } from "../notify.ts";
import { limitFailoverText } from "../../shared/limit-failover.ts";

export type Host = Record<string, any>;

export function createSignedOutTurnSelection(getHost: () => Host): any {
function signedOutTurnSelection(bot: BotRecord, threadId: string, speaker: TurnSpeaker) {
  const host = getHost();
  const now = Date.now();
  const from = host.registry.get(bot.modelSelection.instanceId);
  if (!from || bot.modelSelection.auto === true) return null;
  const engineOf = (instanceId: string) => host.routineEngineForBot(bot, speaker, instanceId);
  const held = (instanceId: string) => {
    const engine = engineOf(instanceId);
    if (!engine) return false;
    // A verified sign-in newer than the refusal ends it first (routine-readiness.ts).
    host.routineEngineRefusal(engine, now);
    return signedOutHeld(engine.engine, engine.account, now, engine.signedIn === false);
  };
  const payer = host.autoPayerKey(bot, speaker);
  const current = host.store.projectBotForTask(bot.id, threadId) ?? bot;
  const selection = signedOutCarryOn({
    selection: bot.modelSelection,
    backups: host.botRecoveryBackups(current, host.cfg),
    held,
    usable: (backup) => {
      const target = host.registry.get(backup.instanceId);
      if (!target?.enabled) return null;
      if (host.policyModelRefusal(target) || host.orgEngineTurnRefusal(bot, target, speaker)) return null;
      // The backup's own limit or credit: it would refuse this turn too.
      if (host.limitFailoverStore.blockedUntil(payer, backup.instanceId) !== null) return null;
      const account = engineOf(backup.instanceId);
      const refusal = account ? activeEngineRefusal(account.engine, account.account, now) : undefined;
      if (refusal) return null;
      if (host.recoveryCapabilityError({ driverKind: from.driverKind, capabilities: from.adapter.capabilities },
        { driverKind: target.driverKind, capabilities: target.adapter.capabilities })) return null;
      // The same rules as a switch by hand (the approval level included), without saving it.
      const checked = host.checkedTaskModelSwitch(current, backup, false, true);
      return checked.ok ? checked.selection : null;
    },
  });
  if (!selection) return null;
  const to = host.registry.get(selection.instanceId);
  const words = { from: host.engineDisplayName(from), to: to ? host.engineDisplayName(to) : selection.instanceId };
  host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: host.limitFailoverRow(threadId, { kind: "signedOut", ...words }) });
  const engine = engineOf(from.instanceId);
  if (engine && firstSignedOut(engine.engine, engine.account, `notice:${bot.id}`)) {
    const line = { kind: "signedOutNotice" as const, ...words };
    host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: host.limitFailoverRow(threadId, line) });
    host.notify(buildNoticeNotification(bot, threadId, limitFailoverText(line, host.limitClockText)));
  }
  return selection;
}
  return signedOutTurnSelection;
}

/** #3315: a turn refused before it started because its engine is signed out
 * (TurnAuthenticationRefusedError) holds that engine for its payer, as a
 * refusal during the turn does (runtime-lifecycle.ts, turn-completed.ts). */
export function createNoteSignedOutTurn(getHost: () => Host): any {
  return function noteSignedOutTurn(bot: BotRecord, speaker: TurnSpeaker, instanceId: string): void {
    const engine = getHost().routineEngineForBot(bot, speaker, instanceId);
    if (engine) noteEngineRefusal({ engine: engine.engine, account: engine.account, cause: "signed_out", at: Date.now() });
  };
}
