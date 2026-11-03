// Vocabulary biasing for a live call's speech to text.
//
// xAI's grok-voice-transcribe-2.0 takes up to 100 `keyterm` values (50
// characters each) on both the streaming socket and POST /v1/stt
// (https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
// Without them a bot called "Nova" is heard as "critique", a client's
// name as two common words and "AcmeGuard" as "acme guard". The terms
// come from what the call is about: the bot, the person, the other bots,
// the organization's own list (SAGAX_VOICE_KEYTERMS) and the proper nouns
// of the thread's recent messages. Names only, and nothing is stored: a
// token that looks like a secret (a known key prefix such as AKIA, sk-, ghp_
// or xai-, a long or random mix of letters and digits, a word followed by a
// year such as "Summer2024") is never a term, since the terms travel in
// xAI's socket URL and the iPhone's call start.

export const VOICE_KEYTERM_MAX = 100;
export const VOICE_KEYTERM_CHARS = 50;
/** Messages of the thread read for proper nouns. */
export const VOICE_KEYTERM_RECENT_MESSAGES = 40;

/** Product names a recognizer has never seen. */
const PRODUCT_TERMS = ["Sagax", "Perspicax", "Pulsatrix"];

/** Capitalized words that are only capitalized because they start a
 * sentence, in English and French. A word on this list is never a term on
 * its own, wherever it appears. */
const COMMON = new Set(
  (
    "a an and are as at be but by can could did do does for from had has have he her his how i if in is it its just let me my no not now of " +
    "ok okay on or our please she so that the their them then there these they this to up us was we were what when where which who why will " +
    "with would yes you your hello hi hey thanks thank sure well also here today tomorrow yesterday monday tuesday wednesday thursday friday " +
    "saturday sunday january february march april may june july august september october november december " +
    "à au aux avec bonjour bonsoir ça ce ces cette c'est dans de des donc du elle elles en est et être faut il ils je la le les leur lui ma " +
    "mais me merci mes moi mon ne non nous on ou où oui par pas peux pour quand que quel quelle qui sa salut se ses si son sur ta te tes toi " +
    "ton tu un une vos votre vous voici voilà ok ben bon alors puis pis faque aussi aujourd'hui demain hier lundi mardi mercredi jeudi " +
    "vendredi samedi dimanche janvier février mars avril mai juin juillet août septembre octobre novembre décembre " +
    "the note notes step steps done error"
  ).split(" "),
);

/** A run of capitalized words ("Marie Tremblay", "Microsoft 365"), a mixed
 * case word ("AcmeGuard", "iCloud", "macOS"), or an acronym ("ACME", "CW"). */
const NAME = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}'’&-]*(?:[ \t]+(?:\p{Lu}[\p{L}\p{N}'’&-]*|\p{N}+))*/gu;
const MIXED = /\b\p{Ll}+\p{Lu}[\p{L}\p{N}]*\b/gu;
const SENTENCE_START = /(?:^|[.!?:;\n]\s*|["«(]\s*)$/u;

function clean(term: string): string {
  return term
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefixes of API keys and tokens (AWS, Google, GitHub, OpenAI and
 * Stripe style, xAI, Slack, GitLab, SendGrid, a JWT). */
const SECRET_PREFIX = /^(?:AKIA|ASIA|AGPA|AIDA|AIza|ghp|gho|ghs|ghu|ghr|github|glpat|sk|pk|rk|xai|xox[abprs]|SG\.|eyJ)[-_.]?[\p{L}\p{N}]/iu;

/** Shannon entropy per character. */
function entropy(word: string): number {
  const counts = new Map<string, number>();
  for (const ch of word) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / word.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A word that could be a key, a token or a password, never a name a
 * person says: a key prefix, 16 characters or more of letters and digits
 * together, letters and digits interleaved ("a1B2c3"), a random looking mix
 * of 12 or more with three digits, or a word glued to a year
 * ("Summer2024"). Product names stay ("Microsoft 365", "Office365",
 * "SRV-01", "Windows11", "GPT4", "X360Recover"). */
export function looksSecret(word: string): boolean {
  const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (SECRET_PREFIX.test(bare) && (bare.length >= 12 || /^(?:AKIA|ASIA|sk-|xai-|ghp_|glpat-)/i.test(bare))) return true;
  for (const part of bare.split(/[-'’&.]/)) {
    const letters = /\p{L}/u.test(part);
    const digits = /\p{N}/u.test(part);
    if (!letters || !digits) continue;
    if (part.length >= 16) return true;
    // letters and digits switching back and forth ("a1B2c3"; "X360Recover" is a name)
    const switches = (part.match(/\p{L}(?=\p{N})|\p{N}(?=\p{L})/gu) ?? []).length;
    if (switches >= 3) return true;
    if (part.length >= 12 && (part.match(/\p{N}/gu) ?? []).length >= 3 && entropy(part) >= 3.2) return true;
    if (/^\p{L}{3,}(?:19|20)\d{2}$/u.test(part)) return true;
  }
  return false;
}

function acceptable(term: string): boolean {
  if (term.length < 2 || term.length > VOICE_KEYTERM_CHARS) return false;
  if (!/\p{L}/u.test(term)) return false;
  if (term.split(" ").some(looksSecret)) return false;
  // a URL, a path, an e-mail or an id is never said as written
  if (/[/\\@:_=<>{}[\]|`$]/.test(term) || /\.\p{L}{2,4}$/u.test(term) && !/\s/.test(term)) return false;
  return true;
}

/** Proper nouns of some text, each with the number of times it appears.
 * A capitalized word that starts a sentence counts only when it is not a
 * common word; inside a sentence any capitalized run counts. */
export function properNouns(text: string): Map<string, number> {
  const found = new Map<string, number>();
  const add = (raw: string) => {
    const term = clean(raw);
    if (!acceptable(term)) return;
    const words = term.split(" ");
    if (words.every((word) => COMMON.has(word.toLowerCase()))) return;
    // "The Hub" -> "Hub": a leading common word is the sentence, not the name
    let start = 0;
    while (start < words.length - 1 && COMMON.has(words[start]!.toLowerCase())) start += 1;
    const name = words.slice(start).join(" ");
    if (!acceptable(name)) return;
    found.set(name, (found.get(name) ?? 0) + 1);
  };
  for (const match of text.matchAll(NAME)) {
    const before = text.slice(0, match.index);
    const words = match[0].trim().split(/\s+/);
    const first = words[0]!;
    const acronym = /^\p{Lu}{2,}[\p{Lu}\p{N}]*$/u.test(first);
    if (SENTENCE_START.test(before) && words.length === 1 && !acronym && !/\p{Lu}/u.test(first.slice(1))) {
      // one capitalized word at the start of a sentence: a name only when
      // it is not a common word (checked in add)
      if (COMMON.has(first.toLowerCase())) continue;
    }
    add(match[0]);
  }
  for (const match of text.matchAll(MIXED)) add(match[0]);
  return found;
}

export interface VoiceKeytermInput {
  botName: string;
  /** the person who speaks */
  personName?: string;
  /** the other bots this person may call by name */
  otherBotNames?: readonly string[];
  /** the organization's own vocabulary (SAGAX_VOICE_KEYTERMS) */
  configured?: readonly string[];
  /** the thread's recent message texts, oldest first */
  recentTexts?: readonly string[];
}

/** The `keyterm` list of one call, most important first, deduplicated
 * (case and accents aside) and capped at xAI's limits. */
export function voiceKeyterms(input: VoiceKeytermInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const key = (term: string) => term.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const push = (raw: string | undefined) => {
    if (!raw || out.length >= VOICE_KEYTERM_MAX) return;
    const term = clean(raw).slice(0, VOICE_KEYTERM_CHARS).trim();
    if (!acceptable(term)) return;
    const k = key(term);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(term);
  };
  push(input.botName);
  if (input.personName) {
    push(input.personName);
    // people say a first name more often than a full one
    const first = clean(input.personName).split(" ")[0];
    if (first && first.length >= 3) push(first);
  }
  for (const term of input.configured ?? []) push(term);
  for (const term of PRODUCT_TERMS) push(term);
  for (const name of input.otherBotNames ?? []) push(name);
  if (input.recentTexts?.length) {
    // newer messages weigh more: a name said a minute ago is the one the
    // person is about to say again
    const scores = new Map<string, number>();
    input.recentTexts.forEach((text, index) => {
      const weight = 1 + index / Math.max(1, input.recentTexts!.length);
      for (const [term, count] of properNouns(text)) scores.set(term, (scores.get(term) ?? 0) + count * weight);
    });
    [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([term]) => push(term));
  }
  return out;
}

/** SAGAX_VOICE_KEYTERMS: comma or newline separated. */
export function configuredKeyterms(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\n]/).map((term) => term.trim()).filter(Boolean);
}
