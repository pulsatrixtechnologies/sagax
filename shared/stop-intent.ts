/** A message that only asks the running turn to stop ("stop", "arrête",
 * "cancel"...). Whole-message intents only, at most a few words, so a
 * sentence that mentions stopping something ("stop the server when done",
 * "arrête de répondre en anglais") is an ordinary message. */

const STOP_PHRASES = new Set([
  "stop",
  "stop it",
  "stop now",
  "stop that",
  "arrete",
  "arrete ca",
  "arrete tout",
  "annule",
  "annuler",
  "cancel",
  "cancel it",
  "halt",
]);

const POLITE = new Set(["please", "pls", "svp", "stp", "ok", "okay"]);

const MAX_WORDS = 4;

export function normalizeStopText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[!.…?,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStopIntent(text: string): boolean {
  if (typeof text !== "string" || text.length > 64) return false;
  const words = normalizeStopText(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  // a polite word may lead or close, once each: "ok stop", "stop svp"
  let start = 0;
  let end = words.length;
  if (POLITE.has(words[start]!) && end - start > 1) start += 1;
  if (POLITE.has(words[end - 1]!) && end - start > 1) end -= 1;
  return STOP_PHRASES.has(words.slice(start, end).join(" "));
}
