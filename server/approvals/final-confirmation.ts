// A safety net for unattended replies, not an authorization parser (#1984).
// Only the bot's own final words are examined. Code, quotations and ordinary
// reports must never manufacture a decision, let alone approve a write.
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };

/** Existing, translated answer labels, shared with the Approvals UI. */
export function finalConfirmationOptions(language: string): string[] {
  const catalog = /^fr(?:-|$)/i.test(language) ? fr : en;
  return [catalog["approvals.yes"], catalog["approvals.no"]];
}

const ASK = /^(?:(?:so|then|before (?:i|we)\b[^?!.\n]*[,,:]|please|alors|donc|avant (?:de|d')\b[^?!.\n]*[,,:])\s*)?(?:(?:may|can|could|shall|should|do)\s+(?:i|we)\b|(?:do|would)\s+you\s+(?:want|like)\s+(?:me|us)\s+to\b|(?:can|could|would)\s+you\s+(?:please\s+)?confirm\b|please\s+confirm\b|confirm\b|(?:puis-je|peux-tu|pouvez-vous|dois-je|veux-tu|voulez-vous|souhaites-tu|souhaitez-vous)\b|(?:est-ce que\s+)?(?:tu|vous)\s+(?:confirmes?|confirmez|veux|voulez|peux|pouvez)\b|(?:merci de\s+)?confirme(?:r|z)?\b)/i;
const WAIT = /^(?:i(?:'m| am)?\s+(?:waiting|awaiting)|i\s+need|j['’]attends|je\s+(?:reste en attente|dois attendre)|j['’]ai besoin)\b[\s\S]*\b(?:your\s+(?:explicit\s+)?(?:go|approval|confirmation|consent)|(?:ton|ta|votre)\s+(?:go|accord|approbation|confirmation|feu vert))\b/i;
const CONSENT = /(?<![\p{L}\p{N}_])(?:confirm|confirmation|approve|approval|authori[sz]e|consent|proceed|continue|go[- ]ahead|write|send|apply|execute|run|create|update|delete|merge|publish|deploy|save|start|confirme[rz]?|confirmation|approuv|autorise[rz]?|accord|proc[eé]d|continu|poursuiv|[eé]cri|saisir|envoy|appliqu|ex[eé]cut|cr[eé]|modifi|supprim|publi|d[eé]ploy|go|feu vert)[\p{L}]*\b/iu;
// "A, or B?" offers two paths: Yes/No answers neither (#2793). "... or not?"
// stays a yes/no question.
const ALTERNATIVE = /(?:,\s*|\s)(?:ou|or)\s+(?!non\b|pas\b|not\b)(?:bien\s+|plut[oô]t\s+|rather\s+|else\s+)?(?:qu['’]|que\b|si\b|on\b|je\b|j['’]|tu\b|nous\b|vous\b|est-ce\b|should\b|shall\b|do\b|would\b|i\b|we\b|you\b|to\b|just\b|wait\b|attendre\b|avancer\b|continuer\b|garder\b)/i;
const MISSING_FACT = /\b(?:what|which|who|where|when|how|quel(?:le)?s?|lequel|laquelle|qui|quand|combien|comment)\b/i;
// #3001: "Peux-tu confirmer le bon numéro ?", "give me the right name"
// ask the person to supply or correct a value: Yes/No answers neither.
// "Peux-tu confirmer l'envoi ?" names an action, not a value, and stays.
const VALUE_NOUN = String.raw`(?:num[eé]ro|no\.?|#|nom|pr[eé]nom|date|heure|adresse|courriel|e-?mail|t[eé]l[eé]phone|identifiant|id|code|montant|prix|valeur|number|name|time|address|phone|amount|price|value)`;
const VALUE_REQUEST = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:confirm(?:e[rz]?)?|v[eé]rifi(?:e[rz]?)?|verify|donne[rz]?|fourni[rs]?|fournissez|indique[rz]?|pr[eé]cise[rz]?|dire|give|provide|tell)\s+(?:(?:moi|me|nous|us)\s+)?(?:(?:le|la|les|l['’]|ton|ta|tes|votre|vos|the|your)\s*)?(?:\p{L}+\s+)?(?:(?:bon(?:ne)?s?|vrai(?:e)?s?|exact(?:e)?s?|correct(?:e)?s?|right|exact|actual)\b|${VALUE_NOUN}(?![\p{L}\p{N}_]))`, "iu");

export function finalConfirmation(input: {
  text: string;
  routineRun: boolean;
  mcpStarted: boolean;
  ok: boolean;
  stopped: boolean;
  hasCard: boolean;
}): string | null {
  if (!input.ok || input.stopped || input.hasCard || (!input.routineRun && !input.mcpStarted)) return null;
  // Quoted material and fenced examples are data, not the bot asking.
  const own = input.text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "")
    .split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join("\n").trim();
  const paragraphs = own.split(/\n\s*\n/);
  const tail = paragraphs.at(-1)?.trim().slice(-4_000).replace(/^[*_]+|[*_]+$/g, "") ?? "";
  if (!tail) return null;
  // Look at direct questions in the final paragraph, not a report quoting
  // someone else's question. A period can precede the final request.
  const sentences = tail.split(/(?<=[.!?])\s+/);
  const request = sentences.find((sentence) => !MISSING_FACT.test(sentence) && !VALUE_REQUEST.test(sentence) && !ALTERNATIVE.test(sentence) && ((ASK.test(sentence) && CONSENT.test(sentence)) || WAIT.test(sentence)));
  return request ? input.text.trim().slice(-4_000) : null;
}

// #2911: every may-I and you-want form ASK accepts is stripped too ("Puis-je",
// "Peux-tu", "Pouvez-vous", "Est-ce qu'on peut", "Tu veux", "Can/Do I"), so
// the first path reads as an instruction, not a question.
const LEAD = /^(?:(?:so|then|alors|donc)\s*,?\s*)?(?:(?:do|would)\s+you\s+(?:want|like|prefer)\s+(?:me|us)?\s*(?:to\s+)?|(?:can|could|would)\s+you\s+(?:please\s+)?|(?:shall|should|can|could|may|do)\s+(?:i|we)\s+|(?:puis|dois)-je\s+|(?:peux|peut|dois|doit)-(?:tu|on)\s+|(?:pouvons|devons)-nous\s+|(?:pouvez|devez)-vous\s+|est-ce\s+qu(?:e\s+|['’]\s*)(?:je|j['’]|on|nous|tu|vous)\s*(?:peux|dois|peut|doit|pouvons|devons|pouvez|devez)\s+|(?:veux|voulez|souhaites|souhaitez|pr[eé]f[eè]res|pr[eé]f[eé]rez)-(?:tu|vous)\s+|(?:est-ce\s+que\s+)?(?:tu|vous)\s+(?:veux|voulez|souhaites|souhaitez|pr[eé]f[eè]res|pr[eé]f[eé]rez)\s+)/i;
const ALTERNATIVE_LABEL_MAX = 80;

function label(clause: string): string {
  const text = clause.replace(/^[\s,;:]+|[\s,;:?!.]+$/g, "").replace(/\s+/g, " ");
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : "";
}

// What may follow the final question without being a new statement: an
// emoji, a closing parenthesis "(Réponds avec le bouton.)", or a short
// courtesy or answer-with-the-button line. Anything else (a report, a
// quoted question followed by the bot's own words) ends the text instead.
const TRAILER_MAX = 60;
const TRAILER = /^(?:merci|thanks|thank you|r[eé]ponds|r[eé]pondez|choisis|choisissez|clique|cliquez|utilise|utilisez|reply|answer|pick|choose|click|use)\b/i;

function stripTrailing(text: string): string {
  let rest = text.trim();
  for (;;) {
    const next = rest.replace(/\s*\([^()]*\)\s*$/u, "").replace(/[^\p{L}\p{N}?.!»"”)\]]+$/u, "").trim();
    if (next === rest) return rest;
    rest = next;
  }
}

/** The final sentence when it is a question, past an emoji, a closing
 * parenthesis or one short courtesy line; otherwise null. */
function finalQuestion(text: string): string | null {
  const sentences = stripTrailing(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  let last = sentences.at(-1);
  if (last && !/\?\s*$/.test(last) && sentences.length > 1 && last.length <= TRAILER_MAX && TRAILER.test(last)) {
    last = stripTrailing(sentences.at(-2) ?? "");
  }
  return last && /\?\s*$/.test(last) ? last : null;
}

/** "A, or B?" -> ["A", "B"] (#2901): an either/or question is answered by
 * one of its two paths, never by Yes/No. Null when the sentence is not a
 * clean two-way choice or a path is too long to be a button. */
export function alternativeChoices(question: string): [string, string] | null {
  // #2911: only the question itself, the final sentence. An earlier "A, or
  // B?" (a quoted client question, a passing remark) never stands in for a
  // final "Shall I create the quote?" that has no alternative.
  const sentence = finalQuestion(question);
  if (!sentence || !ALTERNATIVE.test(sentence) || MISSING_FACT.test(sentence)) return null;
  const match = ALTERNATIVE.exec(sentence);
  if (!match) return null;
  const head = sentence.slice(0, match.index);
  const split = match.index + match[0].search(/(?:ou|or)\s/i) ;
  const tail = sentence.slice(split).replace(/^(?:ou|or)\s+(?:bien\s+|plut[oô]t\s+|rather\s+|else\s+)?/i, "");
  const first = label(head.replace(LEAD, ""));
  const second = label(tail);
  if (!first || !second || first === second) return null;
  if (first.length > ALTERNATIVE_LABEL_MAX || second.length > ALTERNATIVE_LABEL_MAX) return null;
  if (ALTERNATIVE.test(` ${second}`) && /\s(?:ou|or)\s/i.test(second)) return null;
  return [first, second];
}

/** A routine or MCP turn that ends on "A, or B?" (#2901): the question
 * card offers the two paths instead of staying silent or showing Yes/No. */
export function finalAlternative(input: Parameters<typeof finalConfirmation>[0]): { question: string; options: [string, string] } | null {
  if (!input.ok || input.stopped || input.hasCard || (!input.routineRun && !input.mcpStarted)) return null;
  const own = input.text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "")
    .split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join("\n").trim();
  const tail = own.split(/\n\s*\n/).at(-1)?.trim().slice(-4_000).replace(/^[*_]+|[*_]+$/g, "") ?? "";
  const last = finalQuestion(tail) ?? "";
  if (!ASK.test(last) && !LEAD.test(last)) return null;
  const options = alternativeChoices(last);
  return options ? { question: input.text.trim().slice(-4_000), options } : null;
}

const YES_NO = /^(?:oui|non|yes|no)$/i;

/** ask_choice with Yes/No on an "A, or B?" question (#2901): the two paths
 * become the options so the card answers the question it asks. */
export function choiceOptionsFor<T extends readonly string[]>(question: string, options: T): T | [string, string] {
  if (options.length !== 2 || !options.every((option) => YES_NO.test(option.trim().replace(/[.!]$/, "")))) return options;
  return alternativeChoices(question) ?? options;
}
