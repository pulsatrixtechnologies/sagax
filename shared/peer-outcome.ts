// #4238: what a bot turn the person did not start (a teammate's request, a
// wake, a hand-off) concluded for the person.
//
// Production, 2026-11-13: a team bot sent the person's main bot a sweep of
// their day (time not logged, two slots booked on top of each other, ticket
// bodies refused for lack of a permission). The main bot checked it and
// answered the team bot in their side exchange ("nothing written; the real
// knot is these two overlapping slots; it stays on the day's list"), and
// that was the end: the person's chat showed "Asked by <bot> · 3 requests",
// nothing asked, nothing told, no card. Several points could only be
// settled by the person.
//
// The rule: every such turn ends with a declared outcome for the person,
// taken by the server, not left to the bot's prose:
// - nothing for the person;
// - told: something they should know (ask_choice tell, no answer needed);
// - asked: items that need them, each a keyed question card (ask_choice
//   with a key), raised in their own conversation with the bot.
// When the bot's own words say something waits on the person or was
// skipped for lack of them (a permission refused, a choice between two
// things, "to confirm", "stays on the list"), and it raised nothing, the
// server asks it once to raise the items properly; when it still raises
// nothing, the server raises them itself from those words.
//
// This file holds the shapes and the pure reading of the words; the relay
// is server/turns/peer-outcome-relay.ts.

/** What a turn concluded for the person. */
export type PeerOutcomeKind = "nothing" | "told" | "asked";

/** One item of an outcome: a keyed card in the person's conversation
 * (`ask`), a refusal for a missing permission or sign-in to fix (`fix`, a
 * keyed card too), or a fact the person should know (`tell`, no card). */
export interface PeerOutcomeItem {
  key: string;
  kind: "ask" | "fix" | "tell";
  /** The question or the fact, as the person reads it. */
  text: string;
  /** The card's row in the person's conversation (ask, fix). */
  messageId?: string;
  /** The same key's card was already there (replaced in place, or left as
   * it was): nothing new. */
  replaced?: true;
  /** The person already answered or put away this item's card: their
   * answer stands. */
  answered?: true;
  /** Carried on the attention card (`messageId`), which no keyed card
   * could carry. */
  onCard?: true;
}

/** What the server records on the rows that tell it (WireMessage.peerOutcome):
 * the "Asked by" receipt of the request, the one line in the person's
 * conversation, and the bot's last row of the exchange (the back-fill reads
 * it to know the exchange was settled). */
export interface PeerOutcome {
  kind: PeerOutcomeKind;
  items: PeerOutcomeItem[];
  /** The exchange the turn ran in. */
  threadId: string;
  /** The bot that asked (a teammate), when one did. */
  from?: { botId: string; name: string };
  /** The line in the person's conversation (the synthesized row). */
  line?: true;
  /** Raised by the start-up back-fill of older exchanges. */
  backfill?: true;
  /** The server raised the items itself from the bot's words. */
  fallback?: true;
  at: number;
}

/** A sign in the bot's words that something waits on the person. */
export type PersonWaitCueKind = "access" | "choice" | "confirm" | "pending";

export interface PersonWaitCue {
  kind: PersonWaitCueKind;
  /** The line it was read from, tidied (no bullet, no bold). */
  line: string;
}

/** A refusal for a missing permission, scope or sign-in. */
const ACCESS = /(?:\b(?:403|401|forbidden|unauthori[sz]ed|access denied|permission denied|signed out|not signed in|sign-?in (?:expired|required)|insufficient (?:permissions?|privileges?|scopes?|rights?)|missing (?:permissions?|access|scopes?|roles?|rights?)|no (?:permission|access) (?:to|for|on))\b|\b(?:permissions?|accès|acces|droits?|scopes?|rôles?)\s+(?:refusée?s?|manquante?s?|insuffisante?s?|requise?s?|absente?s?)|\brefusée?s?(?!\p{L})[^.\n]{0,40}\b(?:faute|manque|sans)\b[^.\n]{0,20}\b(?:permission|droit|accès|acces|scope)|\bfaute (?:de |d')\s*(?:permission|droit|accès|acces|connexion)|\b(?:refused|denied)\b[^.\n]{0,40}\b(?:permission|access|scope|sign-?in)|\bnon connectée?(?!\p{L})|\bsession expirée(?!\p{L}))/iu;
/** A choice the person makes between named things. */
const CHOICE = /\b(?:which (?:one|of the two|slot|wins)|choose between|pick (?:one|between)|either\b[^.\n]{0,60}\bor\b|lequel (?:des deux|garder|gagne|choisir)|laquelle (?:des deux|garder|gagne|choisir)|entre les deux|choisir entre|qui gagne)\b/iu;
/** Something left to confirm. */
const CONFIRM = /(?:\b(?:to confirm|to be confirmed|needs? (?:your |a )?(?:confirmation|go|approval)|awaiting (?:your |a )?(?:confirmation|answer|decision|go))\b|(?:^|[\s(])(?:à|a) (?:confirmer|valider|trancher|décider)\b|\battend (?:ta|votre|sa|une) (?:confirmation|réponse|décision)\b)/iu;
/** Something left on the person's plate, or skipped for lack of them. */
const PENDING = /(?:\b(?:stays? on (?:the|your|today's|the day's) (?:\w+ )?list|left (?:for|to) (?:you|the person)|waits? (?:on|for) (?:you|the person)|needs? (?:you|the person|a human|your (?:decision|input|answer|call))|only (?:you|the person) can|your call|up to you|skipped|not (?:done|written|logged|handled) (?:because|for lack|without))\b|\breste (?:sur|dans) (?:la|ta) (?:\w+ )?liste\b|\breste à (?:faire|décider|trancher|régler)\b|(?:^|[\s(])à toi de\b|\b(?:ta|votre) décision\b|\bbesoin de (?:toi|vous|ta|ton|votre)\b|\bseule? (?:toi|vous|la personne) peu|\ben attente de (?:toi|vous|la personne|ta|ton|votre)\b|\bsauté(?:e|s)?(?!\p{L})|\blaissée? de côté(?!\p{L}))/iu;

/** A line that names the person as the one something waits on (the strict
 * reading of the start-up back-fill, which runs without asking the bot: a
 * bare "skipped" or "to confirm" is not enough there). */
const ADDRESSED = /(?:\b(?:needs? (?:you|the person|your (?:decision|input|answer|call|confirmation|go|approval))|waits? (?:on|for) (?:you|the person)|left (?:for|to) (?:you|the person)|only (?:you|the person) can|your call|up to you|awaiting your)\b|(?:^|[\s(])à toi de\b|\b(?:ta|votre) (?:décision|confirmation|réponse)\b|\bbesoin de (?:toi|vous|ta|ton|votre)\b|\bseule? (?:toi|vous|la personne) peu|\ben attente de (?:toi|vous|la personne|ta|ton|votre)\b)/iu;

const CUES: ReadonlyArray<[PersonWaitCueKind, RegExp]> = [["access", ACCESS], ["choice", CHOICE], ["confirm", CONFIRM], ["pending", PENDING]];

const FENCE = /^\s*(?:```|~~~)/;
const BULLET = /^\s*(?:[-*+\u2022>]|\d{1,3}[.)])\s+/;

/** A line of the bot's words as an item reads it. */
export function cueLine(line: string): string {
  return line.replace(BULLET, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
}

/** The signs in a turn's words that something waits on the person or was
 * skipped for lack of them, one per line (the first kind that matches,
 * access first: a refusal is always its own item). Lines in code blocks are
 * what the bot quoted, never a sign. */
export function personWaitCues(text: string | undefined, options: { strict?: boolean } = {}): PersonWaitCue[] {
  if (!text?.trim()) return [];
  const out: PersonWaitCue[] = [];
  let fenced = false;
  const seen = new Set<string>();
  for (const raw of text.normalize("NFC").split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = cueLine(raw);
    if (!line) continue;
    // a line may hold several clauses ("nothing written; the knot is X; it
    // stays on the list"): the line is the item, read once
    const hit = CUES.find(([, pattern]) => pattern.test(line));
    if (!hit) continue;
    if (options.strict && hit[0] !== "access" && !ADDRESSED.test(line)) continue;
    const id = line.toLocaleLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: hit[0], line });
  }
  return out;
}

/** The words of an item the server raises from a line of the bot's words
 * (its own ask did not raise it): a question to the person in the line's
 * language (else the person's), the line as its context. The card answers
 * it with the choices of every item card (server/turns/person-item-cards.ts:
 * Done, Not for me, or free text). */
export function peerItemQuestion(cue: PersonWaitCue, botName: string, language: "fr" | "en"): string {
  const line = cue.line.replace(/[\s.;:,]+$/u, "");
  const who = botName.trim() || (language === "fr" ? "Ton bot" : "Your bot");
  if (language === "fr") {
    switch (cue.kind) {
      case "access": return `${who} a été bloqué faute de permission ou de connexion : ${line}. Peux-tu l'accorder ?`;
      case "choice": return `${who} a besoin que tu tranches : ${line}. C'est réglé ?`;
      case "confirm": return `${who} attend ta confirmation : ${line}. C'est confirmé ?`;
      default: return `${who} t'a laissé ce point : ${line}. C'est réglé ?`;
    }
  }
  switch (cue.kind) {
    case "access": return `${who} was blocked for a missing permission or sign-in: ${line}. Can you grant it?`;
    case "choice": return `${who} needs your call: ${line}. Is it settled?`;
    case "confirm": return `${who} needs your confirmation: ${line}. Is it confirmed?`;
    default: return `${who} left this for you: ${line}. Is it handled?`;
  }
}

/** The bot's answer to the server's ask says plainly that nothing waits on
 * the person ("Nothing for the person.", "Rien pour la personne."). */
const NOTHING_FOR_PERSON = /\b(?:nothing (?:waits on|for|needs) (?:the person|you|them)|no(?:thing| item)s? for the person|rien (?:pour|n'attend) (?:la personne|toi|vous))\b/i;

export function saysNothingForPerson(text: string | undefined): boolean {
  return Boolean(text && NOTHING_FOR_PERSON.test(text));
}

/** The server's one ask to the bot whose turn ended silently while its own
 * words say something waits on the person. A control-plane prompt: the bot
 * raises each item in the person's conversation, or says there is nothing. */
export function peerOutcomeNudge(cues: readonly PersonWaitCue[]): string {
  const lines = cues.slice(0, 8).map((cue) => `- (${cue.kind}) ${cue.line.slice(0, 300)}`).join("\n");
  return [
    "[Server check: this work was not started by the person, and your answer says something waits on them or was skipped for lack of them. Nothing reached them yet.]",
    lines,
    "Raise each such item for the person now, one call per item, in this same turn: ask_choice with a key (an item id such as ticket-1234 or slot-2026-11-13-0900), wait false, decision true, the question with its context and its choices. A refusal for a missing permission or sign-in is one item that names the exact thing to grant. Something they only need to know: ask_choice with a key, tell true and options []. The cards go to the person's own conversation with you; do not write to the other bot about it. If nothing actually waits on the person, reply with exactly: Nothing for the person.",
  ].join("\n");
}

/** The one synthesized line of an outcome in the person's conversation (the
 * app draws it from `peerOutcome`; this is its stored text, which an app
 * that does not know `peerOutcome` shows), in the person's language. */
export function peerOutcomeLineText(outcome: Pick<PeerOutcome, "items" | "from">, botName: string, language: "fr" | "en" = "en"): string {
  const who = outcome.from?.name || botName;
  const asks = outcome.items.filter((item) => item.kind !== "tell" && !item.answered).length;
  const tells = outcome.items.length - asks;
  const fr = language === "fr";
  const parts = [
    ...(asks ? [fr ? `${asks} ${asks === 1 ? "chose a" : "choses ont"} besoin de toi` : `${asks} ${asks === 1 ? "thing needs" : "things need"} you`] : []),
    ...(tells ? [fr ? `${tells} ${tells === 1 ? "chose" : "choses"} à savoir` : `${tells} ${tells === 1 ? "thing" : "things"} to know`] : []),
  ];
  const said = parts.length ? parts.join(", ") : fr ? "rien pour toi" : "nothing for you";
  return fr ? `${who} : ${said}` : `${who}: ${said}`;
}

/** The outcome's kind from its items. */
export function peerOutcomeKind(items: readonly Pick<PeerOutcomeItem, "kind">[]): PeerOutcomeKind {
  if (items.some((item) => item.kind !== "tell")) return "asked";
  return items.length ? "told" : "nothing";
}
