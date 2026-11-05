// Texting your own bot (2026-10-29). The person texts their Perspicax Voice
// line from their own verified number; the text becomes a turn of their
// conversation with the bot, with the same memory, and the bot's answer is
// texted back to that number.
//
// Who counts as the person: Perspicax already admits a text only from a
// number listed AND verified on the line, inside an SMS session opened by
// the person's PIN (crates/gateway/src/voice/webhook.rs `sms`). It then
// posts `authenticated: true` and `person.id`, the Perspicax user the
// number belongs to. A text is the person's own when that id is the line
// owner's (the assertion's `sub`, already matched to the bot's owner by
// server/bots/bot-inbound-telephony.ts). Anyone else on the line (a teammate's
// verified number) keeps the phone triggers, as before.
//
// Where it lands: the bot's single conversation with that person, the
// one an AI client's send_prompt also lands in (conversationOrStart in
// server/index.ts), never a confidential, hidden, routine or parallel one.
// It is sent through the same route the app uses, as the person
// (performAsMember), so every check of a typed line applies. The line is
// marked `via: "sms"`.
//
// The answer: when the turn ends, the bot's words after that line go back
// by text (voice_sms with the person's own access, to the number the text
// came from), cut to one text of at most SMS_REPLY_MAX characters. A card
// that waits on the person is said in one text (the card itself reaches
// them the way "Me joindre" says). Nothing retries a send: a text costs
// money. Carrier keywords (STOP, START, HELP and the French ones) are the
// carrier's: never a turn.
//
// Logs carry the bot and a masked number only, never the words.

/** voice_sms takes at most 1200 characters. */
export const SMS_REPLY_MAX = 1_200;
/** How long the answer is awaited before the person is told it stays in Sagax. */
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

export interface OwnTextInput {
  event: string;
  authenticated: boolean;
  personId?: string | null;
  /** The line owner (the assertion's sub). */
  sub: string;
  text?: string | null;
}

/** Whether this event is the line owner texting from their own verified number. */
export function isOwnText(input: OwnTextInput): boolean {
  if (input.event !== "sms" || !input.authenticated) return false;
  const person = input.personId?.trim();
  if (!person || person !== input.sub.trim()) return false;
  const text = input.text?.trim() ?? "";
  return text.length > 0 && !isCarrierKeyword(text);
}

/** The text that goes back: the bot's words, cut to one SMS_REPLY_MAX text. */
export function smsReplyBody(reply: string, language: "fr" | "en"): string {
  const flat = reply.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (flat.length <= SMS_REPLY_MAX) return flat;
  const more = language === "fr" ? " … (suite dans Sagax)" : " … (more in Sagax)";
  return `${flat.slice(0, SMS_REPLY_MAX - more.length).trimEnd()}${more}`;
}

export function smsWaitingBody(botName: string, language: "fr" | "en"): string {
  return language === "fr"
    ? `${botName} attend ta réponse à une carte dans Sagax.`
    : `${botName} is waiting for you to answer a card in Sagax.`;
}

export function smsLateBody(botName: string, language: "fr" | "en"): string {
  return language === "fr"
    ? `${botName} travaille encore. La réponse sera dans Sagax.`
    : `${botName} is still working. The answer will be in Sagax.`;
}

export type SmsTurnState = "running" | "queued" | "waiting" | "idle";

export interface SmsConversationDeps {
  /** Send the words as the person into their conversation with the bot.
   * `label` is the human caller label stamped on the message (never a raw id). */
  send(input: { person: string; sub: string; botId: string; text: string; label: string }): Promise<{ ok: true; threadId: string; messageId: string } | { ok: false; error: string }>;
  state(botId: string, threadId: string): SmsTurnState;
  /** The bot's words after `messageId` (text replies), or "" when none. */
  replyAfter(threadId: string, messageId: string): string;
  /** One text to the person's number, with their own access. */
  textBack(input: { person: string; botId: string; to: string; body: string }): Promise<boolean>;
  botName(botId: string): string;
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
    const sent = await this.deps.send({ person: event.person, sub: event.sub, botId: event.botId, text: event.text, label: event.label });
    if (!sent.ok) {
      this.log(`sms-conversation: ${event.botId} could not start (${sent.error.slice(0, 120)})`);
      return false;
    }
    const work = this.answer(event, sent.threadId, sent.messageId)
      .catch((error: unknown) => this.log(`sms-conversation: ${event.botId} reply to ${mask(event.from)} failed (${error instanceof Error ? error.message.slice(0, 80) : "error"})`));
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work));
    return true;
  }

  /** Waits for every answer started so far (tests, shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled(this.inflight);
  }

  private async answer(event: OwnTextEvent, threadId: string, messageId: string): Promise<void> {
    const language = this.deps.language(event.person);
    const botName = this.deps.botName(event.botId);
    const text = (body: string) => this.deps.textBack({ person: event.person, botId: event.botId, to: event.from, body });
    const until = this.now() + SMS_TURN_WAIT_MS;
    let toldWaiting = false;
    // the turn may not have registered as running yet: idle only counts once
    // the bot said something, or after a first look
    let looked = false;
    while (this.now() < until) {
      const state = this.deps.state(event.botId, threadId);
      if (state === "waiting" && !toldWaiting) {
        toldWaiting = true;
        await text(smsWaitingBody(botName, language));
      }
      if (state === "idle") {
        const reply = this.deps.replyAfter(threadId, messageId).trim();
        if (reply) {
          await text(smsReplyBody(reply, language));
          return;
        }
        if (looked) return;
      }
      looked = true;
      await this.sleep(POLL_MS);
    }
    await text(smsLateBody(botName, language));
  }
}
