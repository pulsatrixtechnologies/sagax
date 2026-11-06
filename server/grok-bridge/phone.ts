// Phone tasks on the Grok bridge (#2193 P3). Owner opt-ins skip the card
// for call_owner / sms_owner; third-party always needs a card (never "always
// allow"). Live-call context/question need no card. Results go back as
// phone.result envelopes via the service.

import {
  bridgePhoneNeedsCard,
  isBridgePhoneTask,
  type BridgeEnvelope,
} from "../../shared/grok-bridge.ts";
import type { GrokBridgeStore } from "./store.ts";

export interface BridgePhoneDeps {
  /** Owner's verified E.164 when known (Reach me / Perspicax Voice). */
  ownerNumber?(personId: string): string | null;
  /** Place or card an outbound call; returns a short status for phone.result. */
  placeCall?(input: {
    personId: string;
    botLabel: string;
    threadId: string;
    to: string;
    purpose: string;
    mode: "conversation" | "message";
    forceCard: boolean;
    payload: Record<string, unknown>;
  }): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; needsCard?: boolean }>;
  /** Send or card an SMS from the owner's line. */
  sendSms?(input: {
    personId: string;
    botLabel: string;
    threadId: string;
    to: string;
    text: string;
    forceCard: boolean;
    payload: Record<string, unknown>;
  }): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; needsCard?: boolean }>;
  /** Push context or a question into a live owner call. */
  liveCall?(input: {
    personId: string;
    kind: "context" | "question";
    callRef: string;
    text: string;
    payload: Record<string, unknown>;
  }): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }>;
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function handleBridgePhone(input: {
  personId: string;
  envelope: BridgeEnvelope;
  sagaxThreadId: string;
  store: GrokBridgeStore;
  deps: BridgePhoneDeps;
}): Promise<{ ok: true; result?: Record<string, unknown> } | { ok: false; status: number; error: string; needsCard?: boolean }> {
  const { personId, envelope, sagaxThreadId, store, deps } = input;
  if (!isBridgePhoneTask(envelope.task) || envelope.task === "phone.result") {
    return { ok: true };
  }
  const link = store.getLink(personId);
  if (!link) return { ok: false, status: 404, error: "Link missing." };
  const optIn = { mayCallOwner: link.mayCallOwner === true, mayTextOwner: link.mayTextOwner === true };
  const need = bridgePhoneNeedsCard(envelope.task, optIn);
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const forceCard = need === "always" || need === "unless_opt_in";

  if (envelope.task === "phone.context" || envelope.task === "phone.question") {
    const callRef = payloadString(payload, "call_ref") || payloadString(payload, "callRef");
    const text = payloadString(payload, "text") || payloadString(payload, "question");
    if (!callRef || !text) return { ok: false, status: 400, error: "call_ref and text/question are required." };
    if (!deps.liveCall) {
      return {
        ok: true,
        result: { status: "accepted", task: envelope.task, note: "Live-call handler not wired on this server yet." },
      };
    }
    const answer = await deps.liveCall({
      personId,
      kind: envelope.task === "phone.context" ? "context" : "question",
      callRef,
      text,
      payload,
    });
    if (!answer.ok) return { ok: false, status: 502, error: answer.error };
    return { ok: true, result: answer.result };
  }

  if (envelope.task === "phone.call_owner" || envelope.task === "phone.call_third_party") {
    const to = envelope.task === "phone.call_owner"
      ? (deps.ownerNumber?.(personId) || payloadString(payload, "to"))
      : payloadString(payload, "to");
    if (!to) return { ok: false, status: 400, error: "A destination number is required." };
    if (forceCard && !deps.placeCall) {
      return {
        ok: false,
        status: 202,
        error: "Approval card required before this call.",
        needsCard: true,
      };
    }
    if (!deps.placeCall) {
      return {
        ok: true,
        result: { status: "accepted", task: envelope.task, to, note: "Call handler not wired; card path available via place_phone_call in chat." },
      };
    }
    const answer = await deps.placeCall({
      personId,
      botLabel: envelope.to.bot,
      threadId: sagaxThreadId,
      to,
      purpose: payloadString(payload, "purpose") || payloadString(payload, "objective") || "Linked Grok request",
      mode: payload.mode === "message" ? "message" : "conversation",
      forceCard,
      payload,
    });
    if (!answer.ok) {
      return { ok: false, status: answer.needsCard ? 202 : 502, error: answer.error, needsCard: answer.needsCard };
    }
    return { ok: true, result: answer.result };
  }

  if (envelope.task === "phone.sms_owner" || envelope.task === "phone.sms_third_party") {
    const to = envelope.task === "phone.sms_owner"
      ? (deps.ownerNumber?.(personId) || payloadString(payload, "to"))
      : payloadString(payload, "to");
    const text = payloadString(payload, "text") || payloadString(payload, "message");
    if (!to || !text) return { ok: false, status: 400, error: "to and text are required." };
    if (forceCard && !deps.sendSms) {
      return { ok: false, status: 202, error: "Approval card required before this text.", needsCard: true };
    }
    if (!deps.sendSms) {
      return {
        ok: true,
        result: { status: "accepted", task: envelope.task, to, note: "SMS handler not wired; approval stays in the unified chat." },
      };
    }
    const answer = await deps.sendSms({
      personId,
      botLabel: envelope.to.bot,
      threadId: sagaxThreadId,
      to,
      text,
      forceCard,
      payload,
    });
    if (!answer.ok) {
      return { ok: false, status: answer.needsCard ? 202 : 502, error: answer.error, needsCard: answer.needsCard };
    }
    return { ok: true, result: answer.result };
  }

  return { ok: true };
}
