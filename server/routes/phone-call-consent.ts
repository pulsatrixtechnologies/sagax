// One-time phone-call acceptable-use consent card resolve, kept out of
// server/index.ts (index split). Wired into bots-messages respond and the
// live-proposal path as a dep, same shape as resolveAndSendMeeting.
import type { ServerResponse } from "node:http";

import { isPrincipalId } from "../auth/principals.ts";
import type { RequestAuth } from "../auth/request-auth.ts";

export interface PhoneCallConsentResolveDeps {
  store: {
    messagesFor(threadId: string): Array<{ card?: {
      requestId?: string;
      answered?: string;
      phoneCallConsent?: { status: string; botId: string; acceptedAt?: number };
    }; }>;
    botByThread(threadId: string): { id: string; name?: string } | null | undefined;
  };
  outbound: {
    resolveConsent(input: {
      principalId: string;
      botId: string;
      threadId: string;
      requestId: string;
      allow: boolean;
    }): void;
  };
  actorPrincipalId(auth: RequestAuth): string;
  localPrincipalId(): string;
  isSolo(): boolean;
  appendDecision(input: {
    threadId: string;
    requestId: string;
    botId: string;
    botName?: string;
    tool: string;
    summary: string;
    decision: "user-approved" | "user-denied";
    source: "user";
  }): void;
  json(res: ServerResponse, status: number, body: unknown): void;
}

/** Settle Accept / Decline on the one-time consent card. Returns true when
 * this requestId was a phone-call consent card (handled). */
export function resolveAndSendPhoneCallConsent(
  deps: PhoneCallConsentResolveDeps,
  res: ServerResponse,
  auth: RequestAuth,
  threadId: string,
  requestId: string,
  behavior: "allow" | "deny" | "answer",
): boolean {
  const message = deps.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId && row.card.phoneCallConsent);
  if (!message?.card?.phoneCallConsent) return false;
  if (message.card.answered || message.card.phoneCallConsent.status !== "pending") {
    deps.json(res, 200, {
      ok: true,
      outcome: message.card.phoneCallConsent.status === "accepted" ? "allowed-once" : "denied",
      alreadySettled: true,
    });
    return true;
  }
  const principalId = deps.actorPrincipalId(auth) || (deps.isSolo() ? deps.localPrincipalId() : "");
  if (!principalId || !isPrincipalId(principalId)) {
    deps.json(res, 401, { error: "Sign in to answer this card.", code: "no_person" });
    return true;
  }
  const bot = deps.store.botByThread(threadId);
  const allow = behavior === "allow";
  deps.outbound.resolveConsent({
    principalId,
    botId: bot?.id ?? message.card.phoneCallConsent.botId,
    threadId,
    requestId,
    allow,
  });
  deps.appendDecision({
    threadId,
    requestId,
    botId: bot?.id ?? "",
    botName: bot?.name,
    tool: "place_phone_call",
    summary: "one-time phone call consent",
    decision: allow ? "user-approved" : "user-denied",
    source: "user",
  });
  deps.json(res, 200, { ok: true, outcome: allow ? "allowed-once" : "denied", alreadySettled: false });
  return true;
}
