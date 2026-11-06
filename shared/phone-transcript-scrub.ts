// Phone transcript scrubber (#2194 parity with the reference voice bridge).
// Pure: no disk, no clock. Redacts PIN-shaped digit runs from transcripts,
// drops sensitive-topic lines from level-1 snapshots and summary points, and
// keeps a strict "only what was said, no inference" filter on summary text.

/** Digit runs that look like a keypad PIN (4 to 8 digits, optional spaces
 * or dashes). Longer account numbers stay; the bridge never puts a PIN in
 * the model transcript, and this is the second pass on what lands in Sagax. */
const PIN_SHAPED = /(?<!\d)(?:\d[\s-]*){3,7}\d(?!\d)/g;

/** Topics that stay off the phone (level 2): money, billing, health,
 * credentials, family. Matched on accent-stripped lowercase text. */
const SENSITIVE_TOPIC = /\b(?:money|argent|billing|facture|facturation|payment|paiement|salary|salaire|health|sante|medical|credential|mot\s+de\s+passe|password|secret|ssn|nas|family|famille|enfant|child(?:ren)?|spouse|conjoint|maman|papa)\b/;

/** Inference markers a strict summary must not invent. */
const INFERENCE = /\b(?:probably|likely|seems?(?:\s+to)?|appears?(?:\s+to)?|i\s+think|je\s+pense|probablement|semble|on\s+dirait|maybe|peut-etre)\b/;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function redactPinDigits(text: string): string {
  return text.replace(PIN_SHAPED, () => "[PIN redacted]");
}

export function hasSensitiveTopic(text: string): boolean {
  return SENSITIVE_TOPIC.test(fold(text));
}

/** Drop or redact a transcript line: PIN digits go, sensitive lines become a
 * short placeholder so the card still shows turn count. */
export function scrubTranscriptLine(line: { speaker: string; text: string }): { speaker: string; text: string } {
  const text = redactPinDigits(line.text);
  if (hasSensitiveTopic(text)) {
    return { speaker: line.speaker, text: "[redacted: not for the phone]" };
  }
  return { speaker: line.speaker, text };
}

export function scrubTranscript<T extends { speaker: string; text: string }>(lines: readonly T[]): T[] {
  return lines.map((line) => ({ ...line, ...scrubTranscriptLine(line) }));
}

/** Keep summary points that only restate what was said: drop inference and
 * sensitive topics. Empty input stays empty. */
export function scrubSummaryPoints(points: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of points) {
    const text = redactPinDigits(raw.replace(/\s+/g, " ").trim());
    if (!text) continue;
    if (hasSensitiveTopic(text) || INFERENCE.test(fold(text))) continue;
    out.push(text);
  }
  return out;
}

/** Apply scrubber to a conversation call_result payload before it is stored
 * or shown. Commitments follow the same sensitive filter; PIN redaction
 * still runs on every string. */
export function scrubCallResult<T extends {
  points: string[];
  commitments: string[];
  transcript?: { speaker: "bot" | "callee"; text: string }[];
}>(result: T): T {
  return {
    ...result,
    points: scrubSummaryPoints(result.points),
    commitments: scrubSummaryPoints(result.commitments),
    ...(result.transcript?.length ? { transcript: scrubTranscript(result.transcript) } : {}),
  };
}
