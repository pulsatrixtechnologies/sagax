// Identifiers and file paths are never read aloud on a call. Pure.
//
// The bot is told on every call turn (server/voice/voice-call-prompt.ts) to name
// things instead of reading their ids, but a model still slips in a UUID, a
// commit hash, a ticket number or a home folder path. Read aloud, a UUID is
// thirty seconds of letters and digits, a token is a secret said into a car,
// and a path is "slash users slash ...". This is the belt and braces under
// that rule, run by every speech path: the page's sentence cleaner
// (src/lib/voice-mode/spoken.ts), the server's speakable text
// (server/tts/speech-text.ts) and, in Swift, the iPhone's
// (ios/Sources/CompanionCore/VoiceCall/SentenceStream.swift, same rules).
//
// What goes: JWTs, UUIDs, hex hashes of 8+ characters (with letters and
// digits), opaque tokens (a long segment mixing letters and digits, or a
// labelled run of 6+ digits such as "call-0123456789"), "#1234" numbers,
// "id: 42" labels. Absolute and home paths keep only their last name
// ("/Users/a/b/report.pdf" reads "report.pdf"). Amounts, dates, times,
// phone numbers and ordinary words are untouched. Nothing is said in place
// of what was removed: the sentence closes up around it.

const JWT = /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A hex run of 8+ characters; `hashLike` keeps those with at least two
 * letters and two digits. Linear: no nested quantifier (a reply can hold a
 * long run of digits). */
const HEX = /\b[0-9a-f]{8,128}\b/gi;
/** A run of word characters and dashes long enough to be an opaque id. */
const TOKEN_CANDIDATE = /(?<![\w/.-])[A-Za-z0-9][A-Za-z0-9_-]{9,}(?![\w-])/g;
const HASH_NUMBER = /(^|[^\w&])#\d{3,}\b/g;
const LABELLED_ID = /\b(?:id|uuid|guid)\b\s*[:=#]?\s*(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+/gi;
/** An absolute or home path: two segments at least. */
const UNIX_PATH = /(^|[\s("'«])~?(?:\/[\w.@+-]+){2,}\/?/g;
const WINDOWS_PATH = /(^|[\s("'«])[A-Za-z]:\\(?:[\w .@+-]+\\)*([\w.@+-]+)/g;

function opaque(token: string): boolean {
  const segments = token.split(/[_-]+/).filter(Boolean);
  // a long segment that mixes letters and digits: a key, a token, a hash
  if (segments.some((part) => part.length >= 10 && /\d/.test(part) && /[A-Za-z]/.test(part))) return true;
  // a labelled number: call-0123456789, inv_204871 (dates and phone numbers
  // have short segments)
  return segments.length > 1 && segments.some((part) => part.length >= 6 && /^\d+$/.test(part))
    && segments.some((part) => /[A-Za-z]/.test(part));
}

function hashLike(run: string): boolean {
  return (run.match(/[a-f]/gi)?.length ?? 0) >= 2 && (run.match(/\d/g)?.length ?? 0) >= 2;
}

function lastName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? "";
}

/** The text with identifiers removed and paths cut to their last name. */
export function stripSpokenIdentifiers(input: string): string {
  if (!input) return input;
  let text = input;
  text = text.replace(JWT, " ");
  // a label first, so "id: <uuid>" goes whole
  text = text.replace(LABELLED_ID, " ");
  text = text.replace(UUID, " ");
  text = text.replace(WINDOWS_PATH, (_m, lead: string, name: string) => `${lead}${name}`);
  text = text.replace(UNIX_PATH, (match, lead: string) => `${lead}${lastName(match.slice(lead.length))}`);
  text = text.replace(TOKEN_CANDIDATE, (token) => (opaque(token) ? " " : token));
  text = text.replace(HEX, (run) => (hashLike(run) ? " " : run));
  text = text.replace(HASH_NUMBER, "$1 ");
  // what is left around a removed id: empty brackets, a dangling label
  text = text.replace(/[([]\s*(?:[:#=,;-]\s*)*[)\]]/g, " ");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/[ \t]+([.,!?;:)\]])/g, "$1");
  text = text.replace(/([([])[ \t]+/g, "$1");
  return text;
}
