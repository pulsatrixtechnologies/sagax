/**
 * #2808: a coordinate_bots reply relayed to the person as it is. The
 * teammate wrote it to the requesting bot, so it often opens or closes on a
 * line addressed to that bot ("@Gaston, voilà les trois propositions pour
 * l'utilisateur."). That line is plumbing between bots, not an answer: drop
 * it when the rest of the reply still says something.
 */

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The reply without its lines addressed "@<requester>" at the start or
 * the end. Anything else, mentions in the middle of a sentence included, is
 * kept as written. */
export function stripRequesterAddress(text: string, requesterName: string | undefined): string {
  const name = requesterName?.trim();
  if (!name) return text;
  const addressed = new RegExp(`^\\s*(?:\\*\\*|_)?@${escape(name)}(?![\\p{L}\\p{N}_])`, "iu");
  const lines = text.split("\n");
  const skip = (line: string | undefined) => line !== undefined && (!line.trim() || addressed.test(line));
  let start = 0;
  let end = lines.length;
  while (start < end && skip(lines[start])) start++;
  while (end > start && skip(lines[end - 1])) end--;
  if (!lines.slice(0, start).concat(lines.slice(end)).some((line) => addressed.test(line))) return text;
  const rest = lines.slice(start, end).join("\n").trim();
  return rest || text;
}
