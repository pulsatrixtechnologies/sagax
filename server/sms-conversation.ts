import { reportBackgroundError } from "./background-error.ts";
// Own-line turns into the unified chat (2026-10-29 SMS; 2026-11-06 call
// requests, #2194). The person reaches their Perspicax Voice line from a
// verified number; the words become a turn of their single conversation
// with the bot, with the same memory, and the bot's answer is texted back
// to that number. Never a separate phone thread.
//
// Two inbound shapes:
//   - `sms`: Perspicax admits a text only from a number listed AND verified
//     on the line, inside an SMS session opened by the person's PIN. It
//     posts `authenticated: true` and `person.id`. Carrier keywords
//     (STOP, START, HELP and the French ones) are the carrier's: never a turn.
//   - `call_request`: the realtime voice sidecar asked the bot something
//     after a verified NIP on an inbound call (`authenticated: true`). Same
//     owner match. Marked `via: "call"` in the chat.
//
// Who counts as the person: `person.id` is the line owner's (the assertion's
// `sub`, already matched to the bot's owner by
// server/bots/bot-inbound-telephony.ts). Anyone else on the line keeps the
// phone triggers, as before.
//
// Where it lands: the bot's single conversation with that person, the one
// an AI client's send_prompt also lands in (conversationOrStart in
// server/index.ts), never a confidential, hidden, routine or parallel one.
// It is sent through the same route the app uses, as the person
// (performAsMember), so every check of a typed line applies.
//
// The answer: the bot's words after that line go back by text (voice_sms
// with the person's own access, to the number the request came from), cut
// to one text of at most SMS_REPLY_MAX characters. A line that starts a turn
// of its own is answered when that turn ends. A line that lands while a turn
// runs joins it through the chat's own mid-turn path (the send route steers
// it in), and its answer leaves as soon as the bot wrote it, while the turn
// carries on (#4046): only words finished after a model call took the line
// in (`steer.received`); an engine that never says so is answered when the
// turn ends. A line the running turn cannot take waits in the queue and is
// answered when its turn ends.
//
// Only the bot's own words go back (#4114): no text says the bot is busy, that
// a card waits on the person, or that the answer is late. Those events are
// logged only. When SMS_TURN_WAIT_MS passes with no answer, the wait ends and
// nothing is sent; the answer stays in the chat. Nothing retries a send: a
// text costs money.
//
// Logs carry the bot and a masked number only, never the words.

/** voice_sms takes at most 1200 characters. */
export const SMS_REPLY_MAX = 1_200;
/** How long the answer is awaited; past it, nothing is sent and it stays in the chat. */
export const SMS_TURN_WAIT_MS = 30 * 60_000;
const POLL_MS = 2_000;

const CARRIER_KEYWORDS = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit", "start", "unstop", "yes", "help", "info",
  "arret", "arrêt", "arreter", "arrêter", "aide", "desabonner", "désabonner",
]);

/** A carrier keyword alone (STOP, ARRÊT, HELP): the carrier's, never a turn. */
export function isCarrierKeyword(text: string): boolean {
  return CARRIER_KEYWORDS.has(text.trim().toLowerCase().replace(/[.!]+$/u, ""));
}

export type OwnLineVia = "sms" | "call";

export interface OwnTextInput {
  event: string;
  authenticated: boolean;
  personId?: string | null;
  /** The line owner (the assertion's sub). */
  sub: string;
  text?: string | null;
  /** SMS only: Perspicax's sender kind. Absent on call_request and older Perspicax. */
  sender?: "owner_mobile" | "allowlisted" | "verified_caller" | null;
}

/** Whether this event is the line owner speaking or texting from their own
 * verified number, and should land in their unified chat. */
export function isOwnText(input: OwnTextInput): boolean {
  if (!input.authenticated) return false;
  const person = input.personId?.trim();
  if (!person || person !== input.sub.trim()) return false;
  const text = input.text?.trim() ?? "";
  if (!text) return false;
  if (input.event === "call_request") return true;
  if (input.event !== "sms") return false;
  // When Perspicax names the sender, only the owner's own mobile is a turn.
  // Older Perspicax (no sender) keeps the authenticated+owner match.
  if (input.sender && input.sender !== "owner_mobile") return false;
  return !isCarrierKeyword(text);
}

/** How the chat line is stamped for an own-line turn. */
export function ownLineVia(event: string): OwnLineVia {
  return event === "call_request" ? "call" : "sms";
}

/** The text that goes back: the bot's words, cut to one SMS_REPLY_MAX text. */
export function smsReplyBody(reply: string, language: "fr" | "en"): string {
  const flat = reply.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (flat.length <= SMS_REPLY_MAX) return flat;
  const more = language === "fr" ? " … (suite dans Sagax)" : " … (more in Sagax)";
  return `${flat.slice(0, SMS_REPLY_MAX - more.length).trimEnd()}${more}`;
}

/** How the send route took the line: the start of a turn of its own, steered
 * into the running turn, or queued behind a turn that could not take it. */
export type OwnLineDelivery = "started" | "steered" | "queued";

export type SmsTurnState = "running" | "queued" | "waiting" | "idle";

export interface SmsConversationDeps {
  /** Send the words as the person into their conversation with the bot.
   * `label` is the human caller label stamped on the message (never a raw id).
   * `via` is `"sms"` or `"call"` for the chat stamp. */
  send(input: { person: string; sub: string; botId: string; text: string; label: string; via: OwnLineVia }): Promise<{ ok: true; threadId: string; messageId: string; delivery?: OwnLineDelivery } | { ok: false; error: string }>;
  state(botId: string, threadId: string): SmsTurnState;
  /** The bot's words after `messageId` (text replies), or "" when none.
   * With `since`, only words finished after that time. */
  replyAfter(threadId: string, messageId: string, since?: number): string;
  /** When a model call of the running turn took in the steered line, or
   * undefined while it has not (or for an engine that never says). */
  receivedAt?(messageId: string): number | undefined;
  /** One text to the person's number, with their own access. */
  textBack(input: { person: string; botId: string; to: string; body: string }): Promise<boolean>;
  language(person: string): "fr" | "en";
  sleep?(ms: number): Promise<void>;
  now?(): number;
  log?(line: string): void;
}

export interface OwnTextEvent {
  person: string;
  sub: string;
  botId: string;
  from: string;
  text: string;
  /** Human label for who texted (person name or formatted number). */
  label: string;
  /** How the chat stamps the line. Defaults to `"sms"`. */
  via?: OwnLineVia;
}

const mask = (number: string) => {
  const digits = number.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
};

export class SmsConversation {
  private readonly deps: SmsConversationDeps;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly inflight = new Set<Promise<void>>();

  constructor(deps: SmsConversationDeps) {
    this.deps = deps;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()));
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((line) => console.log(line));
  }

  /** The text becomes a turn; the answer goes back on its own. False when
   * the turn could not start (the caller then keeps its usual way). */
  async start(event: OwnTextEvent): Promise<boolean> {
    const textedAt = this.now();
    const via = event.via ?? "sms";
    const sent = await this.deps.send({ person: event.person, sub: event.sub, botId: event.botId, text: event.text, label: event.label, via });
    if (!sent.ok) {
      this.log(`sms-conversation: ${event.botId} could not start (${sent.error.slice(0, 120)})`);
      return false;
    }
    const work = this.answer(event, sent.threadId, sent.messageId, sent.delivery ?? "started", textedAt)
      .catch((error: unknown) => this.log(`sms-conversation: ${event.botId} reply to ${mask(event.from)} failed (${error instanceof Error ? error.message.slice(0, 80) : "error"})`));
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work)).catch(reportBackgroundError);
    return true;
  }

  /** Waits for every answer started so far (tests, shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled(this.inflight);
  }

  private async answer(event: OwnTextEvent, threadId: string, messageId: string, delivery: OwnLineDelivery, textedAt: number): Promise<void> {
    const language = this.deps.language(event.person);
    const to = mask(event.from);
    const after = () => `${Math.round((this.now() - textedAt) / 1_000)}s`;
    const until = this.now() + SMS_TURN_WAIT_MS;
    // #4114: what happened is logged once per event, never texted
    const logged = new Set<string>();
    const note = (what: string) => {
      if (logged.has(what)) return;
      logged.add(what);
      this.log(`sms-conversation: ${event.botId} ${what} for ${to} after ${after()} (${delivery})`);
    };
    // #4046: words steered into the running turn are answered as soon as the
    // bot wrote its reply to them, without waiting for the turn to end. Only
    // words finished after a model call took the line in count: text the
    // call already running was writing is not the answer. An engine that
    // never says it took the line in is answered when the turn ends.
    const steered = delivery === "steered" && Boolean(messageId);
    let takenIn: number | undefined;
    // the turn may not have registered as running yet: idle only counts once
    // the bot said something, or after a first look
    let looked = false;
    while (this.now() < until) {
      const state = this.deps.state(event.botId, threadId);
      if (state === "waiting") note("waiting on a card");
      if (delivery === "queued" && (state === "running" || state === "queued")) note("queued");
      if (steered && takenIn === undefined) takenIn = this.deps.receivedAt?.(messageId);
      if (state === "idle" || takenIn !== undefined) {
        const reply = this.deps.replyAfter(threadId, messageId, takenIn).trim();
        if (reply) {
          await this.deps.textBack({ person: event.person, botId: event.botId, to: event.from, body: smsReplyBody(reply, language) });
          this.log(`sms-conversation: ${event.botId} answered ${to} after ${after()} (${delivery})`);
          return;
        }
        if (state === "idle" && looked) return;
      }
      looked = true;
      await this.sleep(POLL_MS);
    }
    note("wait limit reached");
  }
}
