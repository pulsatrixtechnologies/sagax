// The channel contract of "Me joindre" (2026-10-26): what every way out of
// the app does. A channel sends a question or an approval to the person,
// hands their reply back with the proof of who wrote it, and nothing else.
// The reply is matched to the exact card by its code (./store.ts), never to
// "any text from that number".
//
// Wired: sms (./sms.ts, Perspicax Voice), teams (./teams.ts, the person's
// own engine connector), telegram (./telegram.ts, the person's own bot),
// whatsapp (./whatsapp.ts, the person's own WhatsApp Business number).
// Push is the push hub's (server/push/).
import { markdownToPlainText } from "../../shared/plain-text.ts";
import type { ReachChannelId } from "../../shared/reach-me.ts";

/** One card going out, in the words the person reads. */
export interface ReachOutbound {
  person: string;
  botId: string;
  botName: string;
  /** The reply code; for a notice, a tag no reply uses. */
  code: string;
  /** A notice (2026-10-29, the background brief) asks nothing: no code to
   * answer, it only tells. */
  kind: "approval" | "question" | "notice";
  /** "Run a command?", the question itself */
  title: string;
  /** one line under it: the command, the file, the change */
  line: string;
  /** a card of a confidential conversation: no words of it leave the app */
  confidential: boolean;
  /** Allow needs the person's security key: only Deny works from outside */
  needsKey: boolean;
  language: "fr" | "en";
}

export type ReachSendResult = { ok: true; detail?: Record<string, unknown> } | { ok: false; reason: string };

export interface ReachChannelStatus {
  /** The person can use it for this bot right now. */
  ready: boolean;
  /** In plain words, when not ready (shown on the bot page). */
  reason?: string;
}

/** A way out of the app. `send` never throws; `status` is cheap (no
 * network unless the channel says so). */
export interface ReachChannel {
  id: ReachChannelId;
  status(person: string, botId: string): ReachChannelStatus;
  send(out: ReachOutbound): Promise<ReachSendResult>;
}

/** A reply as a channel heard it, with how it knows who wrote it. */
export interface ReachInbound {
  channel: ReachChannelId;
  /** The person the channel proved (their own number, their own chat). */
  person: string;
  text: string;
  /** sms, whatsapp: the number it came from (must be the one the code went to). */
  from?: string;
}

const MAX_TITLE = 300;
const MAX_LINE = 400;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A bot's words read on a text channel: SMS, WhatsApp and Telegram (no
 * parse mode) show Markdown as its syntax, so it leaves first. */
function words(text: string, max: number): string {
  return clip(markdownToPlainText(text), max);
}

/** A notice's lines as plain words: a Markdown table reads as one line of
 * pairs, never as its pipes and `| --- |` rule. */
function noticeLines(text: string): string[] {
  const out: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (table.length) out.push(markdownToPlainText(table.join("\n")));
    table = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*\|/.test(line)) { table.push(line); continue; }
    flush();
    out.push(markdownToPlainText(line));
  }
  flush();
  return out.filter((line) => line.trim());
}

/** The message every text channel sends (sms, Teams, Telegram, WhatsApp): the bot,
 * what it asks, and how to answer with the code. */
export function composeReachText(out: ReachOutbound): string {
  const fr = out.language === "fr";
  const bot = clip(out.botName || (fr ? "Ton bot" : "Your bot"), 60);
  const lines: string[] = [];
  if (out.kind === "notice") {
    lines.push(`${bot} : ${words(out.title, MAX_TITLE)}`);
    for (const line of noticeLines(out.line).slice(0, 3)) lines.push(`- ${clip(line, MAX_LINE)}`);
    return lines.join("\n").slice(0, 1_100);
  }
  if (out.confidential) {
    lines.push(fr
      ? `${bot} attend ta réponse dans une conversation confidentielle (son contenu reste dans Sagax).`
      : `${bot} is waiting on you in a confidential conversation (its content stays in Sagax).`);
  } else if (out.kind === "question") {
    lines.push(fr ? `${bot} te pose une question :` : `${bot} asks you:`);
    lines.push(words(out.title, MAX_TITLE));
    if (out.line) lines.push(words(out.line, MAX_LINE));
  } else {
    lines.push(fr ? `${bot} demande ton approbation :` : `${bot} needs your approval:`);
    lines.push(words(out.title, MAX_TITLE));
    // the line is what gets allowed (a command, a path): it reads exactly as
    // it will run, never with a `*` or `_` taken for emphasis
    if (out.line) lines.push(clip(out.line, MAX_LINE));
  }
  if (out.kind === "question") {
    lines.push(fr
      ? `Réponds « ${out.code} » suivi de ta réponse.`
      : `Reply "${out.code}" followed by your answer.`);
  } else if (out.needsKey) {
    lines.push(fr
      ? `Autoriser demande ta clé de sécurité : ouvre Sagax. Réponds « ${out.code} non » pour refuser.`
      : `Allowing needs your security key: open Sagax. Reply "${out.code} no" to deny.`);
  } else {
    lines.push(fr
      ? `Réponds « ${out.code} oui » pour autoriser ou « ${out.code} non » pour refuser.`
      : `Reply "${out.code} yes" to allow or "${out.code} no" to deny.`);
  }
  return lines.join("\n").slice(0, 1_100);
}

/** What the person hears back on a channel that answers for free (Telegram,
 * WhatsApp inside its 24 hour window). */
export function reachAckText(outcome: "allowed" | "denied" | "answered" | "needs_key" | "unclear" | "settled" | "unknown_code" | "refused" | "rate_limited", language: "fr" | "en"): string {
  const fr = language === "fr";
  switch (outcome) {
    case "allowed": return fr ? "Autorisé. Le bot reprend." : "Allowed. The bot continues.";
    case "denied": return fr ? "Refusé. Le bot est prévenu." : "Denied. The bot was told.";
    case "answered": return fr ? "Réponse transmise. Le bot reprend." : "Answer sent. The bot continues.";
    case "needs_key": return fr ? "Autoriser demande ta clé de sécurité : ouvre Sagax." : "Allowing needs your security key: open Sagax.";
    case "unclear": return fr ? "Je n'ai pas compris. Réponds le code suivi de oui ou non." : "I did not understand. Reply the code followed by yes or no.";
    case "settled": return fr ? "Cette carte est déjà réglée." : "This card is already settled.";
    case "unknown_code": return fr ? "Code inconnu ou expiré." : "Unknown or expired code.";
    case "rate_limited": return fr ? "Trop d'essais. Réessaie plus tard." : "Too many tries. Try again later.";
    default: return fr ? "Sagax n'a pas pu transmettre la réponse : ouvre Sagax." : "Sagax could not pass the answer on: open Sagax.";
  }
}
