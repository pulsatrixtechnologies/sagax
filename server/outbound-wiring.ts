// R13 wiring (parité the reference design V4, 59, 83), kept out of server/index.ts: the
// phone call cards (server/outbound-calls.ts) and the purchase cards of the
// payment vault (server/vault/credential-vault.ts) in the conversation, the
// person's answer routes, the Primary Bot's pending list, and the wake-up
// that tells the bot what the person answered.
//
// A card row is an ordinary bot row with `outbound` (shared/wire.ts) and a
// plain `text` for clients that do not draw it. It never holds a card
// number, a security code, or an id in its words.
import { randomBytes } from "node:crypto";

import { formatPhone } from "../shared/outbound-call.ts";
import { PHONE_CALL_CONSENT_APPROVE, PHONE_CALL_CONSENT_DECLINE } from "../shared/phone-call-consent.ts";
import { purchaseContents } from "../shared/payment-vault.ts";
import { walletName } from "../shared/single-use-card.ts";
import { trackingLine } from "../shared/order-tracking.ts";
import type { OutboundCallResult, OutboundCard } from "../shared/wire.ts";
import type { PurchaseListing } from "./vault/credential-vault.ts";
import {
  applyResult, callAnswerNote, callCard, callCardText, callResultNote, OutboundCalls, placePhoneCall,
  type IncomingCallResult, type OutboundCallRecord, type PlaceCallDeps,
} from "./outbound-calls.ts";
import { hangUpLiveCall, sendDtmfLiveCall, transferLiveCall, type LiveCallPatch } from "./phone/phone-call-control.ts";
import { PhoneCallConsentStore } from "./phone/phone-call-consent.ts";
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
  /** Perspicax voice_call as the person who speaks in the turn (their own
   * line and key). Absent: no Perspicax on this server. */
  voice?(turn: { threadId: string; generation: string; botId: string }, args: Record<string, unknown>): ReturnType<PlaceCallDeps["twilio"]>;
  /** A conversation call is said to be made on behalf of the person who
   * asked for it: their name. Also a one-way message's when personName has
   * none. */
  principalName?(principalId: string): string | undefined;
  /** The person's Perspicax id (the `sub` Perspicax signs), or null. */
  principalSub?(principalId: string): string | null;
  /** Start the bot's next turn with this note (index.ts dispatchSecretResume). */
  wake(botId: string, threadId: string, messageId: string, prompt: string): void;
  now?: () => number;
  /** Person's approval level for this turn: Auto may skip the per-call card. */
  approvalMode?(botId: string, threadId: string): string | undefined;
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
    cardLabel: listing.wallet ? walletName(listing.wallet) : `${listing.cardBrand.charAt(0).toUpperCase()}${listing.cardBrand.slice(1)} •••• ${listing.cardLast4}`,
    ...(listing.items?.length ? { items: listing.items } : {}),
    ...(listing.flights?.length ? { flights: listing.flights } : {}),
    ...(listing.orderRef ? { orderRef: listing.orderRef } : {}),
    ...(listing.receipt ? { declared: true } : {}),
    ...(listing.mismatch && listing.receipt?.total ? { mismatchTotal: listing.receipt.total } : {}),
    ...(listing.via ? { via: listing.via } : {}),
    ...(listing.tracking ? { tracking: listing.tracking } : {}),
  };
}

export function purchaseCardFallback(listing: PurchaseListing): string {
  const contents = purchaseContents(listing);
  if (listing.doneAt) return `Purchased${contents ? ` ${contents}` : ""} at ${listing.merchant}, ${listing.amount} ${listing.currency}${listing.orderRef ? `, order ${listing.orderRef}` : ""}.${listing.tracking ? ` ${trackingLine(listing.tracking)}.` : ""}`;
  if (listing.status === "denied") return `Purchase at ${listing.merchant} declined.`;
  if (listing.status === "pending") return `${listing.title} ${listing.line}`;
  return `Purchase at ${listing.merchant}, ${listing.amount} ${listing.currency}: allowed.`;
}

/** What a Primary Bot's answer means on a phone call or a purchase card:
 * this once, or no. An Always allow is refused (2026-10-22: every call
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
  const consent = new PhoneCallConsentStore(deps.dataDir, deps.now);

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

  function callRow(row: OutboundCallRecord, messageId?: string, result?: OutboundCallResult, live?: Partial<OutboundCard>): string | undefined {
    const existing = rowOf(row.threadId, row.id, messageId);
    const prior = existing?.outbound;
    const mergedLive: Partial<OutboundCard> = {
      ...(prior?.phase ? { phase: prior.phase } : {}),
      ...(prior?.liveStartedAt ? { liveStartedAt: prior.liveStartedAt } : {}),
      ...(prior?.liveTranscript ? { liveTranscript: prior.liveTranscript } : {}),
      ...(prior?.liveEvents ? { liveEvents: prior.liveEvents } : {}),
      ...(prior?.calleeName ? { calleeName: prior.calleeName } : {}),
      ...(prior?.recordingUrl ? { recordingUrl: prior.recordingUrl } : {}),
      ...live,
    };
    const card = callCard(row, deps.botName(row.botId), calls.settings().callbackNumber, mergedLive);
    const withResult = result ? { ...card, result, phase: "ended" as const } : card;
    return upsert(row.threadId, withResult, callCardText(row), messageId);
  }

  function patchLive(row: OutboundCallRecord, change: LiveCallPatch): void {
    const existing = rowOf(row.threadId, row.id, row.messageId);
    if (!existing?.outbound) return;
    const outbound: OutboundCard = {
      ...existing.outbound,
      ...(change.phase ? { phase: change.phase } : {}),
      ...(change.liveStartedAt ? { liveStartedAt: change.liveStartedAt } : {}),
      ...(change.calleeName ? { calleeName: change.calleeName } : {}),
      ...(change.recordingUrl ? { recordingUrl: change.recordingUrl } : {}),
      ...(change.liveTranscript ? { liveTranscript: change.liveTranscript } : {}),
      ...(change.liveEvents ? { liveEvents: change.liveEvents } : {}),
    };
    deps.store.patchMessage(row.threadId, existing.id, { outbound, text: callCardText(row) });
  }

  function stageConsentCard(_principalId: string, botId: string, threadId: string): string {
    const requestId = `pcc_${randomBytes(8).toString("hex")}`;
    const data = consent.pendingCard({ requestId, botId, threadId });
    const fr = deps.language() === "fr";
    const approve = fr ? PHONE_CALL_CONSENT_APPROVE[1] : PHONE_CALL_CONSENT_APPROVE[0];
    const decline = fr ? PHONE_CALL_CONSENT_DECLINE[1] : PHONE_CALL_CONSENT_DECLINE[0];
    try {
      // a one-time consent that turns phone calls on for the person's bots:
      // a setting, never an approval of one call; full-access: exempt
      deps.store.appendMessage(threadId, {
        role: "bot",
        kind: "options",
        text: "Phone calls need your consent once before a bot may place them.",
        card: {
          requestId,
          title: fr ? "Autoriser les appels téléphoniques pour vos bots" : "Allow phone calls for your bots",
          subtitle: fr
            ? "Avant que vos bots puissent placer des appels pour vous, confirmez que vous acceptez ces règles."
            : "Before your bots can place calls for you, confirm you accept these rules.",
          options: [approve, decline],
          phoneCallConsent: data,
        },
      } as Omit<Message, "id" | "at">);
    } catch {
      // thread gone
    }
    return "Sagax showed the person a one-time consent card for phone calls (lawful use, people who agreed, no marketing or emergency lines, they stay responsible). End your turn now; when they Accept, call place_phone_call again with the same arguments.";
  }

  /** A conversation's transcript past its 30 days leaves the card; the
   * summary stays, with a line saying the transcript expired. */
  function dropTranscript(row: OutboundCallRecord): void {
    const message = rowOf(row.threadId, row.id, row.messageId);
    const result = message?.outbound?.result;
    if (!message || !result) return;
    const { transcript: _dropped, truncated: _cut, ...kept } = result;
    deps.store.patchMessage(row.threadId, message.id, { outbound: { ...message.outbound!, result: { ...kept, transcriptExpired: true } } });
  }

  const api = {
    calls,

    /** place_phone_call / place_call from the internal route. */
    async placeCall(context: { principalId: string | null; botId: string; threadId: string; generation: string; room: boolean }, args: unknown): Promise<{ text: string; isError?: boolean }> {
      if (context.room) return { text: "A phone call is placed from a direct conversation, not a room. Nothing was placed.", isError: true };
      if (!context.principalId) return { text: "This conversation has no person to approve a call. Nothing was placed.", isError: true };
      const turn = { threadId: context.threadId, generation: context.generation, botId: context.botId };
      const conversation = Boolean(args && typeof args === "object" && (args as { mode?: unknown }).mode === "conversation");
      const voice = deps.voice;
      const allows = consent.allows(context.principalId);
      const mode = deps.approvalMode?.(context.botId, context.threadId);
      return placePhoneCall({
        calls,
        twilio: (callArgs) => deps.twilio(turn, callArgs),
        ...(voice ? { voice: (callArgs: Record<string, unknown>) => voice(turn, callArgs) } : {}),
        names: {
          botName: deps.botName(context.botId),
          // a conversation is made on behalf of the person who asked for it
          // (their own line); a one-way message keeps its earlier wording,
          // else the person who speaks (a direct chat on a server with no
          // organization name and no bot that opened the thread, #1487)
          personName: (conversation ? deps.principalName?.(context.principalId) : undefined) || deps.personName(context.botId, context.threadId) || deps.principalName?.(context.principalId) || "",
        },
        language: deps.language(),
        card: (row, messageId, live) => callRow(row, messageId, undefined, live),
        consentAllows: allows,
        stageConsent: () => stageConsentCard(context.principalId!, context.botId, context.threadId),
        autoPlace: mode === "auto" || mode === "full",
        ...(deps.now ? { now: deps.now } : {}),
      }, { principalId: context.principalId, botId: context.botId, threadId: context.threadId }, args);
    },

    async sendDtmf(context: { principalId: string | null; botId: string; threadId: string; generation: string }, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
      if (!context.principalId) return { text: "No person on this conversation.", isError: true };
      const turn = { threadId: context.threadId, generation: context.generation, botId: context.botId };
      return sendDtmfLiveCall({
        calls,
        twilio: (callArgs) => deps.twilio(turn, callArgs),
        patchLive,
        now: deps.now,
      }, { principalId: context.principalId, botId: context.botId, threadId: context.threadId, digits: args.digits, callId: typeof args.call_id === "string" ? args.call_id : undefined });
    },

    async transfer(context: { principalId: string | null; botId: string; threadId: string; generation: string }, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
      if (!context.principalId) return { text: "No person on this conversation.", isError: true };
      const turn = { threadId: context.threadId, generation: context.generation, botId: context.botId };
      return transferLiveCall({
        calls,
        twilio: (callArgs) => deps.twilio(turn, callArgs),
        patchLive,
        now: deps.now,
      }, { principalId: context.principalId, botId: context.botId, threadId: context.threadId, to: args.to, callId: typeof args.call_id === "string" ? args.call_id : undefined });
    },

    async hangUp(context: { principalId: string | null; botId: string; threadId: string; generation: string }, args: Record<string, unknown> = {}): Promise<{ text: string; isError?: boolean }> {
      if (!context.principalId) return { text: "No person on this conversation.", isError: true };
      const turn = { threadId: context.threadId, generation: context.generation, botId: context.botId };
      return hangUpLiveCall({
        calls,
        twilio: (callArgs) => deps.twilio(turn, callArgs),
        patchLive,
        now: deps.now,
      }, { principalId: context.principalId, botId: context.botId, threadId: context.threadId, callId: typeof args.call_id === "string" ? args.call_id : undefined });
    },

    /** Person End call on the live card. */
    async personHangUp(principalId: string, callId: string): Promise<{ ok: true } | { error: string; status: number; code: string }> {
      const row = calls.get(callId);
      if (!row || row.principalId !== principalId) return { error: "No such call", status: 404, code: "unknown_call" };
      if (row.request.mode !== "conversation" || row.status !== "placed" || row.result) {
        return { error: "This call is not live.", status: 409, code: "not_live" };
      }
      const outcome = await hangUpLiveCall({
        calls,
        twilio: (callArgs) => deps.twilio({ threadId: row.threadId, generation: "person-hangup", botId: row.botId }, callArgs),
        patchLive,
        now: deps.now,
      }, { principalId, botId: row.botId, threadId: row.threadId, callId });
      if (outcome.isError) return { error: outcome.text, status: 502, code: "hangup_failed" };
      return { ok: true };
    },

    /** Accept or decline the one-time phone-call consent card. */
    resolveConsent(input: { principalId: string; botId: string; threadId: string; requestId: string; allow: boolean }): void {
      const rows = deps.store.messagesFor(input.threadId);
      const message = rows.find((row) => row.card?.requestId === input.requestId && row.card.phoneCallConsent);
      if (!message?.card?.phoneCallConsent) return;
      if (input.allow) {
        const record = consent.accept(input.principalId, input.botId);
        deps.store.patchMessage(input.threadId, message.id, {
          card: {
            ...message.card,
            answered: PHONE_CALL_CONSENT_APPROVE[0],
            phoneCallConsent: { ...message.card.phoneCallConsent, status: "accepted", acceptedAt: record.acceptedAt },
          },
        });
      } else {
        deps.store.patchMessage(input.threadId, message.id, {
          card: {
            ...message.card,
            answered: PHONE_CALL_CONSENT_DECLINE[0],
            phoneCallConsent: { ...message.card.phoneCallConsent, status: "declined" },
          },
        });
      }
    },

    consentStore: consent,

    /** POST /api/internal/phone-call (place_phone_call), behind the turn's
     * capability; the conversation must be the bot's own. Also mid-call
     * controls under /api/internal/phone-call/{dtmf,transfer,hangup}. */
    internalRoutes(context: {
      ownsThread(botId: string, threadId: string): boolean;
      principalForThread(threadId: string): string | null;
      inRoom(threadId: string): boolean;
    }): InternalRouteHandler {
      return async ({ res, path, method, json, capability, readBody }) => {
        const turn = {
          principalId: context.principalForThread(capability.threadId),
          botId: capability.botId,
          threadId: capability.threadId,
          generation: capability.generation,
        };
        if (path === "/api/internal/phone-call" || path === "/api/internal/place-call") {
          if (method !== "POST") return json(res, 405, { error: "POST only" });
          if (!context.ownsThread(capability.botId, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
          const body = await readBody();
          return json(res, 200, await api.placeCall({ ...turn, room: context.inRoom(capability.threadId) }, body));
        }
        if (path === "/api/internal/phone-call/dtmf" || path === "/api/internal/send-dtmf") {
          if (method !== "POST") return json(res, 405, { error: "POST only" });
          if (!context.ownsThread(capability.botId, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
          return json(res, 200, await api.sendDtmf(turn, await readBody() as Record<string, unknown>));
        }
        if (path === "/api/internal/phone-call/transfer" || path === "/api/internal/transfer") {
          if (method !== "POST") return json(res, 405, { error: "POST only" });
          if (!context.ownsThread(capability.botId, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
          return json(res, 200, await api.transfer(turn, await readBody() as Record<string, unknown>));
        }
        if (path === "/api/internal/phone-call/hangup" || path === "/api/internal/hang-up") {
          if (method !== "POST") return json(res, 405, { error: "POST only" });
          if (!context.ownsThread(capability.botId, capability.threadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
          return json(res, 200, await api.hangUp(turn, await readBody() as Record<string, unknown>));
        }
        return PASS;
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
        hangUp: async (principalId, callId) => api.personHangUp(principalId, callId),
      });
    },

    /** Perspicax's call_result for a conversation call (the telephony
     * route checked the signed assertion; `sub` is the line's owner). The
     * card becomes the result card and the bot gets the result. */
    callResult(input: { sub: string; result: IncomingCallResult }): "applied" | "unknown" | "not_yours" | "already" {
      const outcome = applyResult(calls, {
        result: input.result,
        sub: input.sub,
        subOf: (principalId) => deps.principalSub?.(principalId) ?? null,
        now: (deps.now ?? Date.now)(),
      });
      if (!outcome.applied) return outcome.reason;
      const botName = deps.botName(outcome.row.botId);
      const recordingUrl = `/api/me/phone-calls/${outcome.row.id}/recording`;
      const messageId = callRow(outcome.row, outcome.row.messageId, outcome.result, {
        phase: "ended",
        recordingUrl,
        ...(outcome.result.transcript?.length
          ? { liveTranscript: outcome.result.transcript.map((line) => ({ speaker: line.speaker, text: line.text })) }
          : {}),
      });
      deps.wake(outcome.row.botId, outcome.row.threadId, messageId ?? outcome.row.id, callResultNote(outcome.row, outcome.result, botName));
      return "applied";
    },

    /** Mid-call progress from Perspicax (event call_progress). */
    callProgress(input: {
      sub: string;
      ref: string;
      callSid?: string;
      phase?: LiveCallPatch["phase"];
      calleeName?: string;
      lines?: NonNullable<LiveCallPatch["liveTranscript"]>;
      events?: NonNullable<LiveCallPatch["liveEvents"]>;
    }): "applied" | "unknown" | "not_yours" {
      const row = calls.get(input.ref);
      if (!row || row.request.mode !== "conversation" || row.status !== "placed" || row.result) return "unknown";
      const sub = deps.principalSub?.(row.principalId) ?? null;
      if (!sub || sub !== input.sub) return "not_yours";
      if (input.callSid && row.callSid && row.callSid !== input.callSid) return "not_yours";
      const existing = rowOf(row.threadId, row.id, row.messageId)?.outbound;
      patchLive(row, {
        ...(input.phase ? { phase: input.phase } : {}),
        ...(input.calleeName ? { calleeName: input.calleeName } : {}),
        ...(input.lines?.length
          ? { liveTranscript: [...(existing?.liveTranscript ?? []), ...input.lines].slice(-200) }
          : {}),
        ...(input.events?.length
          ? { liveEvents: [...(existing?.liveEvents ?? []), ...input.events].slice(-50) }
          : {}),
        ...(!existing?.liveStartedAt ? { liveStartedAt: (deps.now ?? Date.now)() } : {}),
      });
      return "applied";
    },

    /** Drop the transcripts past their 30 days (run on a timer). */
    sweepTranscripts(): number {
      const due = calls.takeExpiredTranscripts();
      for (const row of due) dropTranscript(row);
      return due.length;
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
        line: (row.request.mode === "conversation"
          ? `Conversation, ${row.request.maxMinutes ?? 5} min max. Objective: ${row.request.purpose}`
          : `${row.request.purpose} It says: "${row.request.message}"`).slice(0, 240),
        kind: "permission" as const,
        needsKey,
        options: ["deny"],
      }));
    },

    /** request_purchase and record_purchase: the card in the conversation. */
    purchaseCard(listing: PurchaseListing): void {
      upsert(listing.threadId, purchaseOutboundCard(listing, deps.botName(listing.botId)), purchaseCardFallback(listing));
    },

    /** An order's follow-up is due (server/order-follow-ups.ts): the card is
     * brought up to date and the bot is asked to check the parcel. */
    orderFollowUp(listing: PurchaseListing, note: string): void {
      const messageId = upsert(listing.threadId, purchaseOutboundCard(listing, deps.botName(listing.botId)), purchaseCardFallback(listing));
      deps.wake(listing.botId, listing.threadId, messageId ?? listing.id, note);
    },

    /** The person answered a purchase: the card says so, the bot is told. */
    purchaseAnswered(listing: PurchaseListing, note: string): void {
      const messageId = upsert(listing.threadId, purchaseOutboundCard(listing, deps.botName(listing.botId)), purchaseCardFallback(listing));
      deps.wake(listing.botId, listing.threadId, messageId ?? listing.id, note);
    },
  };
  return api;
}
