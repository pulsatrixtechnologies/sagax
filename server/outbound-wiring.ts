// R13 wiring (parité Grok Bot V4, 59, 83), kept out of server/index.ts: the
// phone call cards (server/outbound-calls.ts) and the purchase cards of the
// payment vault (server/credential-vault.ts) in the conversation, the
// person's answer routes, the Primary Bot's pending list, and the wake-up
// that tells the bot what the person answered.
//
// A card row is an ordinary bot row with `outbound` (shared/wire.ts) and a
// plain `text` for clients that do not draw it. It never holds a card
// number, a security code, or an id in its words.
import { formatPhone } from "../shared/outbound-call.ts";
import { purchaseContents } from "../shared/payment-vault.ts";
import type { OutboundCard } from "../shared/wire.ts";
import type { PurchaseListing } from "./credential-vault.ts";
import { callAnswerNote, callCard, callCardText, OutboundCalls, placePhoneCall, type OutboundCallRecord, type PlaceCallDeps } from "./outbound-calls.ts";
import type { PrimaryCard } from "./primary-approvals.ts";
import { createOutboundCallRoutes, type OutboundCallRouteDeps } from "./routes/outbound-calls.ts";
import type { InternalRouteHandler } from "./routes/internal-route.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { Message } from "./store.ts";

export interface OutboundWiringDeps {
  dataDir: string;
  store: {
    messagesFor(threadId: string): Message[];
    appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
    patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
  };
  botName(botId: string): string;
  personName(botId: string, threadId: string): string;
  language(): "fr" | "en";
  twilio(turn: { threadId: string; generation: string; botId: string }, args: Record<string, unknown>): ReturnType<PlaceCallDeps["twilio"]>;
  /** Start the bot's next turn with this note (index.ts dispatchSecretResume). */
  wake(botId: string, threadId: string, messageId: string, prompt: string): void;
  now?: () => number;
}

/** The purchase card as the conversation draws it. */
export function purchaseOutboundCard(listing: PurchaseListing, botName: string): OutboundCard {
  const status: OutboundCard["status"] = listing.status === "pending" ? "pending"
    : listing.status === "denied" ? "denied"
      : listing.doneAt ? "done" : "approved";
  return {
    kind: "purchase",
    id: listing.id,
    status,
    botName,
    merchant: listing.merchant,
    amount: listing.amount,
    currency: listing.currency,
    cardLabel: `${listing.cardBrand.charAt(0).toUpperCase()}${listing.cardBrand.slice(1)} •••• ${listing.cardLast4}`,
    ...(listing.items?.length ? { items: listing.items } : {}),
    ...(listing.flights?.length ? { flights: listing.flights } : {}),
    ...(listing.orderRef ? { orderRef: listing.orderRef } : {}),
    ...(listing.receipt ? { declared: true } : {}),
    ...(listing.mismatch && listing.receipt?.total ? { mismatchTotal: listing.receipt.total } : {}),
    ...(listing.via ? { via: listing.via } : {}),
  };
}

export function purchaseCardFallback(listing: PurchaseListing): string {
  const contents = purchaseContents(listing);
  if (listing.doneAt) return `Purchased${contents ? ` ${contents}` : ""} at ${listing.merchant}, ${listing.amount} ${listing.currency}${listing.orderRef ? `, order ${listing.orderRef}` : ""}.`;
  if (listing.status === "denied") return `Purchase at ${listing.merchant} declined.`;
  if (listing.status === "pending") return `${listing.title} ${listing.line}`;
  return `Purchase at ${listing.merchant}, ${listing.amount} ${listing.currency}: allowed.`;
}

/** What a Primary Bot's answer means on a phone call or a purchase card:
 * this once, or no. An Always allow is refused (JC 2026-10-22: every call
 * and every purchase its own card), never read as a yes. */
export function primaryOutboundDecision(kind: "call" | "purchase", body: { behavior?: unknown; always?: unknown }): { decision: string } | { refused: string } {
  if (body.always === true) return { refused: "Always allow is not offered for a phone call or a purchase: each one needs its own approval. Answer allow (this once) or deny." };
  if (body.behavior === "deny") return { decision: "deny" };
  // ÉFVP 2026-10-22 (pilot): a call goes only to a number the person
  // confirms on the card themselves; their Primary Bot may decline it
  if (body.behavior === "allow" && kind === "call") return { refused: "A phone call is allowed only on its card, where the person confirms the number. Ask them to open the card in Sagax." };
  if (body.behavior === "allow") return { decision: "once" };
  return { refused: "Answer allow or deny." };
}

/** A purchase waiting on the person, in the Primary Bot's list: allow this
 * once or deny, never always. */
export function primaryPurchaseCard(purchase: PurchaseListing, botName: string, needsKey: boolean): PrimaryCard {
  return {
    threadId: purchase.threadId,
    requestId: purchase.id,
    botId: purchase.botId,
    botName,
    at: purchase.createdAt,
    title: purchase.title,
    line: purchase.line,
    kind: "permission",
    needsKey,
    options: ["allow", "deny"],
  };
}

export function outboundWiring(deps: OutboundWiringDeps) {
  const calls = new OutboundCalls(deps.dataDir, deps.now);

  function rowOf(threadId: string, id: string, messageId?: string): Message | undefined {
    const rows = deps.store.messagesFor(threadId);
    return (messageId ? rows.find((row) => row.id === messageId && row.outbound?.id === id) : undefined)
      ?? rows.find((row) => row.outbound?.id === id);
  }

  /** Write or update the card row; its id. */
  function upsert(threadId: string, card: OutboundCard, text: string, messageId?: string): string | undefined {
    const existing = rowOf(threadId, card.id, messageId);
    if (existing) {
      deps.store.patchMessage(threadId, existing.id, { outbound: card, text });
      return existing.id;
    }
    try {
      return deps.store.appendMessage(threadId, { role: "bot", kind: "text", text, outbound: card }).id;
    } catch {
      // the thread is gone: the record stands, Settings and the Primary Bot still see it
      return undefined;
    }
  }

  function callRow(row: OutboundCallRecord, messageId?: string): string | undefined {
    return upsert(row.threadId, callCard(row, deps.botName(row.botId), calls.settings().callbackNumber), callCardText(row), messageId);
  }

  const api = {
    calls,

    /** place_phone_call from the internal route. */
    async placeCall(context: { principalId: string | null; botId: string; threadId: string; generation: string; room: boolean }, args: unknown): Promise<{ text: string; isError?: boolean }> {
      if (context.room) return { text: "A phone call is placed from a direct conversation, not a room. Nothing was placed.", isError: true };
      if (!context.principalId) return { text: "This conversation has no person to approve a call. Nothing was placed.", isError: true };
      return placePhoneCall({
        calls,
        twilio: (callArgs) => deps.twilio({ threadId: context.threadId, generation: context.generation, botId: context.botId }, callArgs),
        names: { botName: deps.botName(context.botId), personName: deps.personName(context.botId, context.threadId) },
        language: deps.language(),
        card: callRow,
      }, { principalId: context.principalId, botId: context.botId, threadId: context.threadId }, args);
    },

    /** POST /api/internal/phone-call (place_phone_call), behind the turn's
     * capability; the conversation must be the bot's own. */
    internalRoutes(context: {
      ownsThread(botId: string, threadId: string): boolean;
      principalForThread(threadId: string): string | null;
      inRoom(threadId: string): boolean;
    }): InternalRouteHandler {
      return async ({ res, path, method, json, capability, readBody }) => {
        if (path !== "/api/internal/phone-call") return PASS;
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        if (!context.ownsThread(capability.botId, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
        const body = await readBody();
        return json(res, 200, await api.placeCall({
          principalId: context.principalForThread(capability.threadId),
          botId: capability.botId, threadId: capability.threadId, generation: capability.generation,
          room: context.inRoom(capability.threadId),
        }, body));
      };
    },

    routes(routeDeps: Omit<OutboundCallRouteDeps, "calls" | "answered">): RouteHandler {
      return createOutboundCallRoutes({
        ...routeDeps,
        calls,
        answered: (row) => {
          const messageId = callRow(row, row.messageId);
          deps.wake(row.botId, row.threadId, messageId ?? row.id, callAnswerNote(row));
        },
      });
    },

    /** The Primary Bot's list: Call or Do not call, never an Always allow. */
    primaryPending(principalId: string, needsKey: boolean): PrimaryCard[] {
      return calls.pending(principalId).map((row) => ({
        threadId: row.threadId,
        requestId: row.id,
        botId: row.botId,
        botName: deps.botName(row.botId),
        at: row.createdAt,
        title: `Call ${formatPhone(row.request.to)}?`,
        line: `${row.request.purpose} It says: "${row.request.message}"`.slice(0, 240),
        kind: "permission" as const,
        needsKey,
        options: ["deny"],
      }));
    },

    /** request_purchase and record_purchase: the card in the conversation. */
    purchaseCard(listing: PurchaseListing): void {
      upsert(listing.threadId, purchaseOutboundCard(listing, deps.botName(listing.botId)), purchaseCardFallback(listing));
    },

    /** The person answered a purchase: the card says so, the bot is told. */
    purchaseAnswered(listing: PurchaseListing, note: string): void {
      const messageId = upsert(listing.threadId, purchaseOutboundCard(listing, deps.botName(listing.botId)), purchaseCardFallback(listing));
      deps.wake(listing.botId, listing.threadId, messageId ?? listing.id, note);
    },
  };
  return api;
}
