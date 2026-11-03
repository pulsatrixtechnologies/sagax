// How much of an answer a call says aloud. Pure.
//
// The bot is told the voice output contract (server/voice/voice-call-prompt.ts:
// the verdict first, one to four short spoken sentences, at most one
// question and only for a real decision). A model still runs long or asks
// two things at once; on a phone that is a monologue the person cannot
// skim. This is the deterministic cap on the page's side:
//
// - At most SPOKEN_SENTENCES_MAX sentences are said. A line break after
//   words counts as a sentence end too (a list the bot slipped in is one
//   line per item). The words after the cap stay in the chat, and the call
//   says once that the rest is there (`voiceMode.restInChat`).
// - A question ends what is said: the person answers it. A second
//   question, or anything after the first one, stays in the chat. A quoted
//   question or a rhetorical one of one or two words ("Why? Because...")
//   is no such question. Code (fenced or inline) counts for nothing.
//
// The cap applies to the whole text so far and keeps a prefix of it: once
// the cut is reached nothing after it is ever kept, so an answer still being
// written is cut at the same place once it is complete.
// The written follow-up below `---` is never spoken (spokenPart).

import { isAbbreviationDot } from "./sentences";
import { speakableSentence, spokenPart } from "./spoken";

/** The most sentences a call says of one answer. */
export const SPOKEN_SENTENCES_MAX = 4;

/** Why the spoken answer stops before the written one: `length` (the
 * sentence cap: the call says the rest is in the chat), `question` (the
 * first question ends it: the person answers), or null (said whole). */
export type SpokenAnswerCut = "length" | "question" | null;

/** A sentence end: ., !, ?, … (closing quotes kept) before a space or the
 * end, or a line break. A match starts only at the first mark of a run, so
 * a long run of dots costs one pass. */
const END = /(?<![.!?…])([.!?…]+)["'»”)\]]*(?=\s|$)|\n/g;
/** A closing quote right after a question mark: a quoted question. */
const QUOTED = /^["'»”]|^[ \t\u00a0\u202f]+[»”]/;

/** The text with its code (a fenced block, even unfinished, and inline
 * code) blanked out, same length: code is never spoken, so its marks count
 * for nothing and its lines carry no words. */
function withoutCode(text: string): string {
  // "_" (not a space, not a letter): a mark next to code never becomes a
  // sentence end when the code closes later; line breaks stay
  const blank = (code: string) => code.replace(/[^\n]/g, "_");
  return text
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank);
}

/** The part of an answer a call says aloud, and why it stops early. */
export function spokenAnswer(text: string, max = SPOKEN_SENTENCES_MAX): { text: string; cut: SpokenAnswerCut } {
  const spoken = spokenPart(text);
  const scan = withoutCode(spoken);
  let count = 0;
  let from = 0;
  END.lastIndex = 0;
  for (let match = END.exec(scan); match; match = END.exec(scan)) {
    const marks = match[1];
    const end = match.index + match[0].length;
    // an abbreviation, an initial or a list number ("1.") ends nothing
    if (marks === "." && isAbbreviationDot(scan, match.index)) continue;
    // a sentence needs words: a lone "1." or an empty line is not one
    const sentence = scan.slice(from, match.index);
    if (!/\p{L}/u.test(sentence)) {
      from = end;
      continue;
    }
    from = end;
    count += 1;
    // a real question ends what is said; a quoted one ("is it done?") or a
    // short rhetorical one ("Pourquoi? Parce que…") does not
    const question = Boolean(marks?.includes("?"))
      && !/["'»”]$/.test(match[0])
      && !QUOTED.test(scan.slice(end))
      && (sentence.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0) > 2;
    if (!question && count < max) continue;
    // the cut keeps the space after it: the text so far only ever grows,
    // so a sentence stream fed with it never starts over
    const rest = spoken.slice(end);
    const kept = spoken.slice(0, end + (/^\s*/.exec(rest)?.[0].length ?? 0));
    return { text: kept, cut: speakableSentence(rest) ? (question ? "question" : "length") : null };
  }
  return { text: spoken, cut: null };
}

/** A settled answer said whole at once (the older call, a room): what
 * spokenAnswer keeps, then `restInChat` when the sentence cap cut it (null:
 * the call's language has no such words, so nothing is added). */
export function spokenReply(text: string, restInChat: string | null): string {
  const answer = spokenAnswer(text);
  const said = answer.text.trim();
  return answer.cut === "length" && said && restInChat ? `${said} ${restInChat}` : said;
}
