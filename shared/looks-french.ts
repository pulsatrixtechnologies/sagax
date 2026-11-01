/** French vs English from stopwords only (no model, no network). Short
 * texts (under four words) say nothing and count as French, so "ok" never
 * breaks a French thread. Code fences, inline code and URLs are stripped. */

const FRENCH_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "est", "pas", "que", "qui", "pour", "dans", "sur", "avec", "vous", "nous", "je", "tu", "il", "elle",
  "ce", "cette", "ces", "mais", "ou", "donc", "car", "sont", "être", "avoir", "fait", "faire", "peux", "peut", "merci", "bonjour", "oui", "non", "aussi", "très",
  "plus", "moins", "comme", "quand", "où", "leur", "leurs", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "au", "aux", "en", "y", "ça", "voici",
]);
const ENGLISH_WORDS = new Set([
  "the", "and", "is", "are", "was", "were", "you", "your", "we", "our", "it", "this", "that", "these", "with", "for", "from", "have", "has", "not", "but", "can",
  "will", "would", "should", "please", "thanks", "here", "there", "what", "which", "who", "when", "where", "how", "of", "to", "in", "on", "at", "be", "do",
]);

export function looksFrench(text: string): boolean {
  const words = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase()
    .split(/[^a-zà-ÿœæ']+/i)
    .flatMap((word) => word.split("'"))
    .filter(Boolean);
  if (words.length < 4) return true;
  let fr = 0;
  let en = 0;
  for (const word of words) {
    if (FRENCH_WORDS.has(word)) fr += 1;
    if (ENGLISH_WORDS.has(word)) en += 1;
  }
  if (fr === 0 && en === 0) return true;
  return fr >= en;
}
