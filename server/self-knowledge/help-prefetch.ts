// QA 0.8.66 speed (Today/HEARTBEAT/GitHub, 45,9 s): a question about Sagax
// itself made the engine call sagax_help, wait, read, call it again, then
// answer: three model rounds for a lookup the server answers in a few ms.
// The server now runs that lookup before the turn and hands the result in the
// prompt, so the engine answers in one round and calls sagax_help only for
// what the prefetched help does not cover.
import { excerpt, helpAnswer, searchKnowledge, type HelpContext, type KnowledgeIndex } from "./self-knowledge.ts";

/** A guide matching at least this score is a how-to question even when the
 * product is not named (the routine guide scores ~99 for "crée une routine",
 * an e-mail question ~17). */
export const HELP_PREFETCH_GUIDE_SCORE = 40;

const PRODUCT_NAME = /\b(sagax|perspicax)\b/i;

/** Whether this message asks about Sagax or Perspicax themselves. */
export function wantsHelpPrefetch(index: KnowledgeIndex, question: string, context: Pick<HelpContext, "organization">): boolean {
  const text = question.trim();
  if (!text) return false;
  if (PRODUCT_NAME.test(text)) return true;
  const top = searchKnowledge(index, text, 1, context)[0];
  return Boolean(top && top.section.kind === "guide" && top.score >= HELP_PREFETCH_GUIDE_SCORE);
}

export const HELP_PREFETCH_HEADER = "Sagax help for this message, already looked up by the server (the sagax_help result for it). Answer from it; call sagax_help only for a point it does not cover. Do not mention this lookup to the person.";

/** At most this many sections named in the message join the ranked ones. */
const NAMED_MAX = 2;

/** The words a person writes as a name in the sentence ("c'est quoi Today",
 * "HEARTBEAT"): capitalized but not first in their sentence, or all caps.
 * A compound question ranks the rare words of its other clauses first, and
 * "today" is a common word, so the page named "Today" lost (QA 0.8.66). */
export function namedTerms(question: string): string[] {
  const out = new Set<string>();
  for (const sentence of question.split(/[.!?\n]+/)) {
    const words = sentence.match(/[\p{L}][\p{L}\p{N}-]*/gu) ?? [];
    words.forEach((word, at) => {
      const caps = word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase();
      if (caps || (at > 0 && /^\p{Lu}/u.test(word))) out.add(word.toLowerCase());
    });
  }
  return [...out];
}

/** Sections whose own heading is a name the message uses. */
function namedSections(index: KnowledgeIndex, question: string, skip: Set<string>) {
  const names = new Set(namedTerms(question));
  if (!names.size) return [];
  return index.base.sections
    .filter((section) => !skip.has(section.id) && names.has(section.title.split(": ").pop()!.trim().toLowerCase()))
    .slice(0, NAMED_MAX);
}

/** The turn's text with the prefetched help appended, or the text unchanged
 * when the message is not about Sagax or the base has nothing for it. */
export function withHelpPrefetch(text: string, question: string, index: KnowledgeIndex | null, context: HelpContext): { text: string; ids: string[] } {
  if (!index || !wantsHelpPrefetch(index, question, context)) return { text, ids: [] };
  const help = helpAnswer(index, question, context);
  if (!help.ids.length) return { text, ids: [] };
  const named = namedSections(index, question, new Set(help.ids));
  const extra = named.map((section) => [`## ${section.title} [${section.kind}]`, section.where ? `Where: ${section.where}` : null, excerpt(section, question), `(${section.source})`].filter(Boolean).join("\n"));
  const body = [help.text, ...extra].join("\n\n");
  return { text: `${text}\n\n<sagax_help_prefetch>\n${HELP_PREFETCH_HEADER}\n\n${body}\n</sagax_help_prefetch>`, ids: [...help.ids, ...named.map((section) => section.id)] };
}
