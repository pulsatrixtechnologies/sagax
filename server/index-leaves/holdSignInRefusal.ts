// @ts-nocheck
/** holdSignInRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHoldSignInRefusal(getHost: () => Host): any {
function holdSignInRefusal(
  bot: BotRecord,
  instance: { driverKind: string; instanceId?: string },
  card: { payerPrincipalId: string },
  threadId: string,
  resendable: boolean,
  handlers: { show(afterHold: boolean): void; resend(): boolean; fail(): void }
): boolean {
  const host = getHost();

  const slot = typeof instance.instanceId === "string" ? host.turnSlotFor(bot, { instanceId: instance.instanceId }) : "primary";
  if (!resendable) {
    handlers.show(false);
    void host.signInRecheck?.refused(card.payerPrincipalId, instance.driverKind, slot).catch(() => false);
    return false;
  }
  let held = false;
  held = host.settleSignInRefusal(host.signInRecheck, {
    principalId: card.payerPrincipalId, driver: instance.driverKind, slot,
    show: () => {
      if (held) console.info(`[sign-in-recheck] ${threadId}: renew failed, sign-in card shown`);
      handlers.show(held);
    },
    retry: () => {
      if (host.signInRefusalResent.has(threadId) || !handlers.resend()) return false;
      host.signInRefusalResent.add(threadId);
      console.info(`[sign-in-recheck] ${threadId}: sign-in renewed, turn sent again`);
      return true;
    },
    fail: () => {
      console.info(`[sign-in-recheck] ${threadId}: sign-in renewed, refusal shown as an engine error`);
      handlers.fail();
    }
  });
  if (held) console.info(`[sign-in-recheck] ${threadId}: refusal held while the sign-in renews`);
  return held;
}
  return holdSignInRefusal;
}
