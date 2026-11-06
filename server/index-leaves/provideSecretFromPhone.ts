// @ts-nocheck
/** provideSecretFromPhone (#1388). Pure move from server/index.ts. */
import { isCredentialTargetId, credentialIsConfigured } from "../../shared/credential-request.ts";
import { PhoneSecretError, assertPhoneSecretRequestMatches, phoneSecretOperationId } from "../phone/phone-secret.ts";
export type Host = Record<string, any>;

export function createProvideSecretFromPhone(getHost: () => Host): any {
async function provideSecretFromPhone(
  context: PhoneSecretContext,
  authenticatedDeviceId: string,
): Promise<{ provided: boolean; resumed: boolean }> {
  const host = getHost();
  const owner = host.connectorThread(context.botId, context.threadId);
  const message = host.secretMessage(context.botId, context.threadId, context.messageId);
  if (!owner || !message?.secret) throw new PhoneSecretError("No such credential request", 404);
  if (message.secret.dismissed) throw new PhoneSecretError("This credential request was dismissed", 409);
  if (message.secret.superseded) throw new PhoneSecretError("This credential request was superseded by a newer one", 409);
  assertPhoneSecretRequestMatches(context, authenticatedDeviceId, {
    target: message.secret.target,
    requestKey: message.secret.requestKey
  });
  const operationId = phoneSecretOperationId(context);
  if (message.secret.phoneOperationId && message.secret.phoneOperationId !== operationId) {
    throw new PhoneSecretError(
      "This credential request was already completed by another submission",
      409,
    );
  }
  // The encrypted store may have committed immediately before a process
  // interruption. Recording the winning operation precedes completing the
  // card, so the exact retry can repair that tiny window without writing the
  // credential again. A different randomized envelope was rejected above.
  if (message.secret.phoneOperationId === operationId && !message.secret.provided) {
    if (!(isCredentialTargetId(message.secret.target) && credentialIsConfigured(host.cfg, message.secret.target))) {
      throw new PhoneSecretError(`${message.secret.label} is no longer configured`, 409);
    }
    if (!host.resumeSecretCard(context.botId, context.threadId, context.messageId, "provided")) {
      throw new PhoneSecretError("This credential request is no longer available", 409);
    }
    const recovered = host.currentSecretState(context.botId, context.threadId, context.messageId);
    if (!recovered) throw new PhoneSecretError("This credential request is no longer available", 409);
    return recovered;
  }
  if (message.secret.provided) {
    if (message.secret.phoneOperationId !== operationId) {
      throw new PhoneSecretError(
        "This credential request was already completed by another submission",
        409,
      );
    }
    if (!(isCredentialTargetId(message.secret.target) && credentialIsConfigured(host.cfg, message.secret.target))) {
      throw new PhoneSecretError(`${message.secret.label} is no longer configured`, 409);
    }
    // A crash or older build may have committed the credential and marked
    // the card provided without dispatching its continuation. An exact phone
    // retry repairs that state instead of silently claiming it resumed.
    if (!message.secret.resumed && !host.resumeSecretCard(
      context.botId,
      context.threadId,
      context.messageId,
      "provided",
    )) {
      throw new PhoneSecretError("This credential request is no longer available", 409);
    }
    const recovered = host.currentSecretState(context.botId, context.threadId, context.messageId);
    if (!recovered) throw new PhoneSecretError("This credential request is no longer available", 409);
    return recovered;
  }

  const submissionKey = host.phoneSecretSubmissionKey(context.threadId, context.messageId, context.requestKey);
  await host.phoneSecretSubmissions.run({
    cardKey: submissionKey,
    botId: context.botId,
    threadId: context.threadId,
    ...(owner.group ? { groupId: owner.group.id } : {})
  }, operationId, async () => {
    await host.phoneSecrets.provide(context);
    const current = host.secretMessage(context.botId, context.threadId, context.messageId);
    if (!current?.secret || current.secret.requestKey !== context.requestKey) {
      throw new PhoneSecretError("This credential request is no longer available", 409);
    }
    if (current.secret.dismissed) {
      throw new PhoneSecretError("This credential request was dismissed", 409);
    }
    // The request route may have superseded this card while the encrypted
    // save was in flight. Completing the superseded card would mark it
    // provided and dispatch its continuation, leaving two cards resolved.
    if (current.secret.superseded) {
      throw new PhoneSecretError("This credential request was superseded by a newer one", 409);
    }
    // Electron acknowledges only after credentials.bin and the server's
    // external-secret config update both commit. Keep this assertion at the
    // boundary so a future parent handler cannot accidentally resume first.
    if (!(isCredentialTargetId(current.secret.target) && credentialIsConfigured(host.cfg, current.secret.target))) {
      throw new PhoneSecretError(`${current.secret.label} was not saved yet`, 409);
    }
    // Persist the winning randomized envelope id before completing the card.
    // A later exact retry can recover a lost response, while a newly sealed
    // value can never be reported as though it were the value already saved.
    host.store.patchMessage(context.threadId, current.id, {
      secret: { ...current.secret, phoneOperationId: operationId }
    });
    if (!host.resumeSecretCard(context.botId, context.threadId, context.messageId, "provided")) {
      throw new PhoneSecretError("This credential request is no longer available", 409);
    }
  });
  const settled = host.currentSecretState(context.botId, context.threadId, context.messageId);
  if (!settled) throw new PhoneSecretError("This credential request is no longer available", 409);
  return settled;
}
  return provideSecretFromPhone;
}
