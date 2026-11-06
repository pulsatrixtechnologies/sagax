// Phone call language tracker (#2194): Quebec French and English, follow
// the caller's last turn, ignore one-word fillers. Pure: no disk, no clock.

export type PhoneLanguage = "fr" | "en";

/** One-word fillers that must not flip the call language. */
const FILLERS = new Set([
  "oui", "non", "ok", "okay", "ouais", "yeah", "yep", "yup", "no", "nah",
  "allo", "allo?", "hello", "hi", "hey", "bonjour", "salut", "thanks",
  "merci", "svp", "please", "hm", "hmm", "uh", "um", "euh", "ah", "oh",
]);

const FR_HINT = /\b(?:je|tu|vous|nous|le|la|les|des|une|est|suis|avec|pour|dans|pas|c'est|qu'est|aujourd'hui|rendez-vous|appel|texto)\b|[àâäéèêëïîôùûüç]/i;
const EN_HINT = /\b(?:the|and|you|are|is|have|with|for|this|that|what|when|please|today|meeting|call|text)\b/i;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9àâäéèêëïîôùûüç'?]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Whether the utterance is only a filler (or empty): keep the current language. */
export function isPhoneFiller(text: string): boolean {
  const words = tokens(text);
  if (!words.length) return true;
  if (words.length === 1) return FILLERS.has(words[0]!.replace(/\?+$/, ""));
  return words.length <= 2 && words.every((w) => FILLERS.has(w.replace(/\?+$/, "")));
}

/** Detect fr or en from one turn. null when unknown or filler-only. */
export function detectPhoneLanguage(text: string): PhoneLanguage | null {
  if (isPhoneFiller(text)) return null;
  const fr = FR_HINT.test(text) ? 1 : 0;
  const en = EN_HINT.test(text) ? 1 : 0;
  if (fr === en) {
    // Accented letters tip Quebec French even without a keyword hit.
    if (/[àâäéèêëïîôùûüç]/i.test(text)) return "fr";
    return null;
  }
  return fr > en ? "fr" : "en";
}

/** Next language for the call: follow the last turn, else keep current.
 * A filler never flips it. */
export function nextPhoneLanguage(current: PhoneLanguage, lastTurn: string): PhoneLanguage {
  return detectPhoneLanguage(lastTurn) ?? current;
}

/** Bilingual keypad / unknown-language prompt pair (fr-CA first). */
export function bilingualPhonePrompt(kind: "pin" | "opening"): { fr: string; en: string } {
  if (kind === "pin") {
    return {
      fr: "Entrez votre NIP sur le clavier, puis le carré.",
      en: "Enter your PIN on the keypad, then the pound key.",
    };
  }
  return {
    fr: "Petite question pour toi.",
    en: "Quick question for you.",
  };
}
