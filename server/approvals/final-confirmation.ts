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
  const request = sentences.find((sentence) => !MISSING_FACT.test(sentence) && !ALTERNATIVE.test(sentence) && ((ASK.test(sentence) && CONSENT.test(sentence)) || WAIT.test(sentence)));
  return request ? input.text.trim().slice(-4_000) : null;
}
