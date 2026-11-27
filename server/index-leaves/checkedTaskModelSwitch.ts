// @ts-nocheck
/** checkedTaskModelSwitch (#1388). Pure move from server/index.ts. */
import { modelChangeCurrent } from "./modelChangeCurrent.ts";
export type Host = Record<string, any>;

export function createCheckedTaskModelSwitch(getHost: () => Host): any {
/** `settling`: the thread's running turn is ending and the switch is for the
 * turn sent after it (a refused turn sent again to its backup, turn-completed.ts),
 * so that running turn does not count as the bot working. `returning`: the
 * conversation goes back to the engine it left (a limit failover's return). */
function checkedTaskModelSwitch(current: BotRecord, raw: unknown, updateBotDefault: boolean,   requireAvailableModel = false, options: { settling?: boolean; returning?: boolean } = {}) {
  const host = getHost();

  if (current.approvalGrant) return { ok: false as const, status: 409, error: "Wait for the approval change to finish before switching models" };
  const profile = host.store.bot(current.id)!;
  // D-20261126-018: the bot's own engine, and the one a conversation goes
  // back to, are what it is already on, never a new choice of a hidden one
  const target = (raw as { instanceId?: unknown } | null)?.instanceId;
  const checked = host.checkedModelSelection(raw, modelChangeCurrent(host, current, {
    busy: options.settling === true ? false : undefined,
    returning: options.returning === true,
    ...(typeof target === "string" ? { target } : {}),
  }), requireAvailableModel, host.effectiveBotOwner(current));
  if (!checked.ok) return checked;
  if (updateBotDefault) {
    const defaults = host.checkedModelSelection(checked.selection, {
      selection: profile.modelSelection, busy: Boolean(host.activeGroupTurnForBot(current.id)), alsoOn: [current.modelSelection.instanceId]
    }, false, host.effectiveBotOwner(current));
    if (!defaults.ok) return defaults;
  }
  return checked;

}
  return checkedTaskModelSwitch;
}
