// @ts-nocheck
/** checkedTaskModelSwitch (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCheckedTaskModelSwitch(getHost: () => Host): any {
function checkedTaskModelSwitch(current: BotRecord, raw: unknown, updateBotDefault: boolean,   requireAvailableModel = false) {
  const host = getHost();

  if (current.approvalGrant) return { ok: false as const, status: 409, error: "Wait for the approval change to finish before switching models" };
  const checked = host.checkedModelSelection(raw, {
    selection: current.modelSelection, busy: host.threadBusy(current.id, current.threadId)
  }, requireAvailableModel, host.effectiveBotOwner(current));
  if (!checked.ok) return checked;
  const profile = host.store.bot(current.id)!;
  if (updateBotDefault) {
    const defaults = host.checkedModelSelection(checked.selection, {
      selection: profile.modelSelection, busy: Boolean(host.activeGroupTurnForBot(current.id))
    }, false, host.effectiveBotOwner(current));
    if (!defaults.ok) return defaults;
  }
  return checked;

}
  return checkedTaskModelSwitch;
}
