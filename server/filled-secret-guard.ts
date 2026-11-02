// A vault value used to fill a page is not key-shaped, so the pattern scrub
// leaves it in a prompt or a journal. This list is memory of the process
// only: it is never written down, and it is gone when the process stops.
// The browser session redactor still covers that session's own results.
//
// Wired into shared/redact.ts via addHeldSecretScrubber (Lot A0 / upstream tip)
// so every redactSecretsInText pass scrubs filled values without a second
// parallel list of scrubbers.
import { addHeldSecretScrubber } from "../shared/redact.ts";
import { REDACTED_CREDENTIAL, variants } from "./credential-fill.ts";

// A value is kept while it was used within the last day, whoever filled it:
// the list is shared by every person and bot of a server, so a count bound of
// a few values would lose one still in use. The count bound is only a memory
// ceiling, far above any real use, and drops the least recently used value.
const RETAIN_MS = 24 * 60 * 60 * 1000;
const MAX_SECRETS = 4096;
const noted = new Map<string, number>();
let clock: () => number = Date.now;

function expire(now: number): void {
  for (const [value, at] of noted) {
    if (now - at > RETAIN_MS) noted.delete(value);
    else break; // insertion order is last-use order
  }
}

/** Remember a value that was just used to fill. Short values are skipped:
 * they are ordinary words, and the session redactor already hides a code. */
export function noteFilledSecret(value: string): void {
  if (typeof value !== "string" || value.length < 4) return;
  const now = clock();
  noted.delete(value);
  noted.set(value, now);
  expire(now);
  while (noted.size > MAX_SECRETS) noted.delete(noted.keys().next().value as string);
}

/** Tests only: a fake clock. */
export function setFilledSecretClock(now: (() => number) | null): void {
  clock = now ?? Date.now;
}

/** Replace a filled value, and the encodings a page or a log would show, with
 * the same marker the browser result uses. */
export function redactFilledSecrets(text: string): string {
  if (!text) return text;
  expire(clock());
  if (noted.size === 0) return text;
  let out = text;
  for (const value of noted.keys()) {
    for (const variant of variants(value)) {
      if (!variant || !out.includes(variant)) continue;
      out = out.split(variant).join(REDACTED_CREDENTIAL);
    }
  }
  return out;
}

/** Tests only. */
export function resetFilledSecrets(): void {
  noted.clear();
  clock = Date.now;
}

// One registration for the process: shared redactSecretsInText runs this first.
addHeldSecretScrubber(redactFilledSecrets);
