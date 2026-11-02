// Delivery receipts for bot-to-bot messages: what actually happened to a
// send the moment the coordination/delegation tool returned, one receipt
// per recipient. The outcomes are the bot-facing half of the same honesty
// discipline SteerOutcome applies to steering — a tri-state that can always
// be answered truthfully, where an indeterminate send reads "queued", never
// "delivered":
//
//   queued   — accepted into a durable lane; the recipient's turn has not
//              started, so nothing has been delivered yet
//   injected — the recipient's turn started with this message (it may still
//              be running, or it may have run and failed)
//   failed   — not delivered; the detail says why
//
// The rule that overrides every other consideration: never report delivery
// that did not happen. A failed live hand-off may stay buffered for a later
// drain, but its receipt stays failed.

import { canReachPeer, clip, peerName, type RosterMember } from "./peer-roster.ts";

export type PeerDeliveryOutcome = "queued" | "injected" | "failed";

/** The recipient's name a receipt, a notice or an answer may carry, as its
 * sender may read it now: the current name while the sender can still reach
 * the recipient (canReachPeer, the rule list_bots and the roster read), and
 * nothing once it cannot. Isolation between people: a teammate hidden,
 * unshared, moved out of the sender's scope or renamed while a card or a
 * wait was open is another person's private bot now, so its new name never
 * reaches the sender. The receipt then keeps only the id the caller
 * addressed, and renderPeerDeliveryReceipts falls back to it.
 *
 * Pass the records as the store holds them now. A bot record is patched in
 * place (Store.patchBot), so one read before an approval card already
 * carries the new name after it: the check, not the read, is what makes it
 * safe. */
export function receiptName(
  from: RosterMember | null | undefined,
  to: RosterMember | null | undefined,
): string | undefined {
  return from && to && canReachPeer(from, to) ? to.name : undefined;
}

export interface PeerDeliveryReceipt {
  /** The recipient's bot id — the address the caller actually used. */
  botId: string;
  /** The recipient's name, when the server knows it. */
  botName?: string;
  outcome: PeerDeliveryOutcome;
  /** One plain line saying why. Composed by the endpoint that produced the
   * receipt; flattened and clipped here before it reaches a model. */
  detail: string;
  /** Claim ticket for the lane that provides one (delegations). */
  taskId?: string;
  /** The coordination node, for coordinate_bots sends. */
  requestId?: string;
  /** The recipient's thread the work went into, for direct coordinate_bots sends. */
  threadId?: string;
}

// Detail lines are built from harness error text that can carry
// peer- or provider-authored content, so they are flattened and clipped like
// a roster entry (peer-roster.ts) rather than trust the sender of the failure.
const DETAIL_MAX = 200;

/** Build a receipt with the detail flattened onto one clipped line. */
export function peerDeliveryReceipt(receipt: PeerDeliveryReceipt): PeerDeliveryReceipt {
  return {
    botId: receipt.botId,
    ...(receipt.botName ? { botName: receipt.botName } : {}),
    outcome: receipt.outcome,
    detail: clip(receipt.detail, DETAIL_MAX) || "no detail recorded",
    ...(receipt.taskId ? { taskId: receipt.taskId } : {}),
    ...(receipt.requestId ? { requestId: receipt.requestId } : {}),
    ...(receipt.threadId ? { threadId: receipt.threadId } : {}),
  };
}

const named = (receipt: PeerDeliveryReceipt): string =>
  peerName(receipt.botName ?? "") || peerName(receipt.botId) || "teammate";

/** Render receipts as the tool-result prose a sender reads. One receipt
 * becomes a single "Delivery to …" line; several become a fenced list with
 * one line per recipient, in the order the caller addressed them. An empty
 * list renders nothing, so callers can append unconditionally. */
export function renderPeerDeliveryReceipts(receipts: readonly PeerDeliveryReceipt[]): string {
  if (!receipts.length) return "";
  const line = (receipt: PeerDeliveryReceipt) => `${named(receipt)}: ${receipt.outcome} — ${receipt.detail}`;
  if (receipts.length === 1) return `Delivery to ${line(receipts[0]!)}`;
  return ["Delivery receipts:", ...receipts.map(receipt => `- ${line(receipt)}`)].join("\n");
}
