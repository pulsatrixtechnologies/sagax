// A message that asks for no action (JC 2026-10-20): a greeting, thanks, a
// goodbye or "how are you", alone. Such a turn never resumes unfinished
// work and never wakes a sleeping cloud computer (server/index.ts).
//
// Deliberately narrow: the whole message must be small talk, in French or
// English, with at most the bot's name and punctuation or emoji around it.
// A confirmation ("ok", "oui", "vas-y", "go", "ça va") is NOT small talk: it may be
// the answer to "Shall I pick it back up?". Anything else is a request.

const PHRASES = [
  // greetings
  "hello", "hi", "hey", "hiya", "yo", "salut", "bonjour", "bonsoir", "allo", "allô", "coucou", "re", "rebonjour", "rebonsoir",
  "good morning", "good afternoon", "good evening", "morning", "bon matin", "bon après-midi", "bon apres-midi",
  // thanks
  "merci", "merci beaucoup", "merci bien", "mille mercis", "thanks", "thank you", "thanks a lot", "thank you so much", "thx", "ty",
  // goodbyes
  "bye", "goodbye", "bye bye", "bonne nuit", "bonne soirée", "bonne soiree", "bonne journée", "bonne journee", "bonne fin de journée",
  "bonne fin de journee", "à demain", "a demain", "à plus", "a plus", "à plus tard", "a plus tard", "à bientôt", "a bientot",
  "good night", "see you", "see you later", "see you tomorrow", "have a good night", "have a good day",
  // how are you
  // never "ça va" alone (a consent in Québec: "ça va si je relance ?") nor
  // "quoi de neuf" / "what's up" (a real status question)
  "comment ça va", "comment ca va", "comment vas-tu", "comment allez-vous",
  "how are you", "how are you doing", "how's it going", "hows it going",
];

const SET = new Set(PHRASES);
const MAX_CHARS = 80;

/** The text with emoji, punctuation and spacing reduced to single spaces. */
function normalize(text: string): string {
  return text.toLowerCase().normalize("NFC").replace(/[’‘]/g, "'")
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, " ")
    .replace(/[!?.,;:…~*_()"«»“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the whole message is small talk: one or two phrases of the list
 * (with "et"/"and" or nothing between), optionally the bot's name or "tout
 * le monde"/"there"/"everyone" after a greeting. */
export function isSmallTalk(text: string | undefined, botName?: string): boolean {
  if (typeof text !== "string") return false;
  const raw = text.trim();
  if (!raw || raw.length > MAX_CHARS || raw.includes("\n") || /[`/\\@#=<>{}[\]|$%&+]/.test(raw)) return false;
  const words = normalize(raw).split(" ").filter(Boolean);
  // The bot's name, or "everyone", may follow a phrase; never stand alone.
  const extras = [botName ? normalize(botName) : "", "tout le monde", "everyone", "there", "all", "toi", "à toi", "a toi", "to you"]
    .filter(Boolean).map((extra) => extra.split(" "));
  const at = (i: number, parts: string[]) => parts.every((part, k) => words[i + k] === part);
  let matched = 0;
  for (let i = 0; i < words.length;) {
    if (matched > 0 && (words[i] === "et" || words[i] === "and")) { i++; continue; }
    // Longest phrase first, so "merci beaucoup" is one phrase.
    let found = 0;
    for (let n = Math.min(5, words.length - i); n > 0; n--) {
      if (SET.has(words.slice(i, i + n).join(" "))) { found = n; break; }
    }
    if (!found && matched > 0) found = extras.find((extra) => at(i, extra))?.length ?? 0;
    else if (found) matched++;
    if (!found) return false;
    i += found;
    if (matched > 3) return false;
  }
  return matched > 0;
}

/** The note a small-talk turn's words carry to the engine (provider text
 * only, never shown). Short: the standing rule is in the system prompt. */
export const SMALL_TALK_TURN_NOTE = "\n\n[Sagax: this message asks for no action. Reply briefly, without tools.]";

/** What a cloud computer tool answers during a small-talk turn: the
 * computer is not woken for it. */
export const SMALL_TALK_CLOUD_REFUSAL =
  "Not run: the person's message asks for no action, so the cloud computer stays asleep. Answer them; if earlier work is unfinished, ask in one line whether to pick it back up.";
