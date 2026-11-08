// Bot replies keep the house style even when the model forgets it (QA c1
// D6, #2580): reports ended with a signature heart, a raw ConnectWise link
// stood in for the ticket number and cards were named by an id prefix
// ("Carte c16f208c"). The prompt states the rules; this cleans the final
// reply text after the fact, like voice-dashes.ts. Fenced code, inline code
// and markdown links are kept as they are: an id the person asked for goes in
// code.
//
// #2949: a two-column table whose second column is sentences ("Piece |
// State", one sentence per row) becomes a bulleted list with bold labels
// (shared/output-style.ts).
//
// QA 0.8.67 G9: "8 to 14 novembre" becomes "du 8 au 14 novembre"
// (shared/french-dates.ts).

import { frenchDateRanges } from "./french-dates.ts";
import { rewriteKeySentenceTables } from "./output-style.ts";

const PROTECTED = /```[\s\S]*?(?:```|$)|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+\)/g;
const HOLD = (index: number) => `${index}`;
const RESTORE = /(\d+)/g;

/** Hearts and other signature emoji (with their variation selector). */
const HEART = /[❤♥\u{1F494}-\u{1F49F}\u{1F5A4}\u{1F90D}\u{1F90E}\u{1F9E1}\u{1FA75}-\u{1FA77}]️?/gu;
/** Any emoji cluster (pictograph, keycap, flags, joiners, selectors). */
const EMOJI = "(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\u200D(?:\\p{Extended_Pictographic})|[\\u{1F3FB}-\\u{1F3FF}])*";
const TRAILING_EMOJI = new RegExp(`(?:[ \\t]*${EMOJI})+[ \\t]*(?:\\n[ \\t]*(?:${EMOJI}[ \\t]*)+)*\\s*$`, "u");
const ONLY_EMOJI = new RegExp(`^\\s*(?:${EMOJI}\\s*)+$`, "u");

/** A ConnectWise Manage link to a ticket (service or project). */
const CW_TICKET_URL = /https?:\/\/[^\s)]*connectwise\.(?:net|com)\/[^\s)]*?[?&](?:service_recid|recid|srRecID)=(\d+)[^\s)]*/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** "Carte c16f208c": a record word followed by a short hex id. */
const ID_PREFIX = /\b(cartes?|cards?|approbations?|approvals?|fils?|threads?|tâches?|tasks?|runs?|tours?|turns?|agents?|bots?)\s+(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,12}\b/giu;

export function cleanReplyStyle(text: string): string {
  if (!text || ONLY_EMOJI.test(text)) return text;
  const held: string[] = [];
  let out = rewriteKeySentenceTables(text).replace(PROTECTED, (piece) => HOLD(held.push(piece) - 1));
  const report = /\n/.test(out.trim());
  out = out.replace(CW_TICKET_URL, (_url, id: string) => `billet #${id}`);
  // "Billet #297048 (billet #297048)": the number once
  out = out.replace(/(#(\d+))\s*\(billet #\2\)/gi, "$1");
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(UUID, "");
  out = frenchDateRanges(out);
  out = out.replace(ID_PREFIX, "$1");
  if (report) out = out.replace(HEART, "");
  out = out.replace(TRAILING_EMOJI, "");
  // tidy what a removal left: "( )", doubled spaces, a space before a stop
  out = out.replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:!?])(?=\s|$)/g, (match, stop: string) => (stop === ":" || stop === ";" || stop === "!" || stop === "?" ? match : stop)).replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
  out = out.replace(RESTORE, (_match, index: string) => held[Number(index)] ?? "");
  return out.trim() ? out : text;
}
