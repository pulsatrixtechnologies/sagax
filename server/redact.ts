// Keeping secrets out of the native protocol log.
//
// The native tee writes every provider message verbatim, which is what makes
// protocol drift diagnosable — but the messages that set a session up carry
// the credentials the agent is handed: the boat token and the comms token
// travel inside `session/new`'s mcpServers env, and a provider key can
// travel in an MCP header. Those logs sit in ~/.sagax/native as
// ordinary files, are read by anyone debugging, and get pasted into issues.
//
// So the log keeps the SHAPE and loses the VALUES: a redacted entry still
// tells you a token was passed, under which name, and how long it was —
// enough to debug "the proxy got no token" without the token being there.

/** Key names whose value is a credential. Matched case-insensitively as a
 * substring, so KEY catches ANTHROPIC_API_KEY and x-api-key. */
const SECRET_KEY_PARTS = ["token", "secret", "password", "passwd", "apikey", "api_key", "authorization", "auth_token"];

/** `key` alone is too broad — it matches `keyboard`, `keys`, `hotkey`. Only
 * treat it as a credential when it stands alone or is a suffix, which is how
 * every real one is spelled (API_KEY, consumer-key, xai_key). */
export function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  if (["sagax_gate_upstream", "sagax_remote_mcp_server", "omb_gate_upstream", "omb_remote_mcp_server"].includes(lower)) return true;
  if (lower.startsWith("sagax_remote_mcp_config_") || lower.startsWith("omb_remote_mcp_config_")) return true;
  if (SECRET_KEY_PARTS.some((part) => lower.includes(part))) return true;
  return /(^|[_.-])keys?$/.test(lower);
}

import {
  addHeldSecretScrubber,
  holdsCredential,
  HELD_SECRET_MASK,
  mask,
  redactCutSecrets,
  redactSecretsInText as redactSecretPatterns,
  scrubHeldSecrets,
} from "../shared/redact.ts";
// Side effect: registers the filled-vault scrubber on the shared held API
// (Lot A0). Import before any redactSecretsInText call on the server.
import "./vault/filled-secret-guard.ts";
import { redactFilledSecrets } from "./vault/filled-secret-guard.ts";

// Text-shaped secret redaction lives in shared/redact.ts so the client (task
// timeline) and the server scrub the same shapes without the client bundling
// server code. Held / filled vault values register through addHeldSecretScrubber
// and run inside the shared pass. `mask` stays the shared one.
export { addHeldSecretScrubber, holdsCredential, HELD_SECRET_MASK, mask, redactCutSecrets, scrubHeldSecrets };

export interface RedactTextOptions {
  /** Number each masked span (`«redacted #2, 49 chars»`) so a text read back
   * and sent again tells which secret each mask stood for
   * (restoreMaskedSecrets). For a bot reading text it may rewrite. */
  numbered?: boolean;
}

export function redactSecretsInText(text: string, options?: RedactTextOptions): string {
  // Shared pass already runs held scrubbers (filled-secret-guard). Keep an
  // explicit filled pass so a caller that imported shared/redact alone and
  // then this module still gets vault fills scrubbed if registration raced.
  const redacted = redactFilledSecrets(redactSecretPatterns(text));
  if (!options?.numbered || redacted === text) return redacted;
  return maskedSpans(text, redacted)?.numbered ?? redacted;
}

const PLAIN_MASK = /^«redacted (\d+) chars»$/;
/** Masks side by side form one span: their boundaries are not readable. */
const MASK_RUN = /(?:«redacted \d+ chars»|••••••|\[credential\])+/g;
const NUMBERED_MASK = /«redacted #(\d+)(?:, (\d+) chars)?»/g;
const ANY_PLAIN_MASK = /«redacted (\d+) chars»/g;

/** Each masked span of `redacted` (the redaction of `original`) with the
 * value it hides, read off the unchanged text around it, and the text with
 * each span numbered. Null when a span cannot be placed in `original`. */
function maskedSpans(original: string, redacted: string): { values: string[]; numbered: string } | null {
  const literals = redacted.split(MASK_RUN);
  const masks = redacted.match(MASK_RUN) ?? [];
  if (!masks.length) return { values: [], numbered: redacted };
  const values: string[] = [];
  let numbered = literals[0]!;
  let pos = 0;
  for (let i = 0; i < masks.length; i++) {
    if (!original.startsWith(literals[i]!, pos)) return null;
    pos += literals[i]!.length;
    const next = literals[i + 1]!;
    const last = i === masks.length - 1;
    const plain = PLAIN_MASK.exec(masks[i]!);
    const end = plain ? pos + Number(plain[1]) : last ? original.length - next.length : original.indexOf(next, pos);
    if (end <= pos || !original.startsWith(next, end) || (last && end + next.length !== original.length)) return null;
    values.push(original.slice(pos, end));
    // A held secret's mask hides its length; keep it hidden.
    numbered += `«redacted #${i + 1}${plain ? `, ${plain[1]} chars` : ""}»${next}`;
    pos = end;
  }
  return { values, numbered };
}

/** A text read with `redactSecretsInText(original, { numbered: true })` that
 * a caller sends again: each `«redacted #k»` mask takes back the value it
 * stood for, wherever the bot moved it, so editing around a mask never saves
 * the mask over the secret (same idea as a `true` in resolveSecrets keeping
 * the stored value). A mask the bot removed is a secret it removed. A plain
 * `«redacted N chars»` (read elsewhere) takes the only unused value of N
 * characters. Any other mask (an unknown number, an ambiguous length) is
 * kept as received, never given another secret. */
export function restoreMaskedSecrets(original: string, received: string): string {
  if (!received.includes("«redacted")) return received;
  const redacted = redactSecretsInText(original);
  if (redacted === original) return received;
  const values = maskedSpans(original, redacted)?.values;
  if (!values?.length) return received;
  const used = new Set<number>();
  for (const match of received.matchAll(NUMBERED_MASK)) used.add(Number(match[1]) - 1);
  const restored = received.replace(NUMBERED_MASK, (mask, index: string, length?: string) => {
    const value = values[Number(index) - 1];
    return value !== undefined && (length === undefined || value.length === Number(length)) ? value : mask;
  });
  return restored.replace(ANY_PLAIN_MASK, (mask, length: string) => {
    const candidates = values.flatMap((value, index) => (!used.has(index) && value.length === Number(length) ? [index] : []));
    if (candidates.length !== 1) return mask;
    used.add(candidates[0]!);
    return values[candidates[0]!]!;
  });
}

// ── content-shaped secrets ────────────────────────────────────────────
// What a bot's own reply, a tool title, or a permission card can carry —
// and, since the rebuild replays activity into every handed-over context,
// what would otherwise become permanent. High precision on purpose: a
// generic "long hex/base64" heuristic would rewrite real code in the
// transcript, so only shapes that are unmistakably credentials match.

/** Deep copy with credential VALUES replaced. Handles the two shapes that
 * actually carry them: a plain object of env vars ({KEY: "v"}) and the ACP
 * wire shape (env: [{name, value}]). Anything unrecognised is copied as-is. */
export function redactSecrets(input: unknown, depth = 0): unknown {
  if (typeof input === "string") return redactSecretsInText(input);
  if (depth > 12 || input === null || typeof input !== "object") return input;

  if (Array.isArray(input)) {
    return input.map((item) => {
      // ACP env entries: {name: "SAGAX_COMMS_TOKEN", value: "…"}
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { value?: unknown }).value === "string"
      ) {
        const entry = item as { name: string; value: string };
        // A non-secret-shaped name (a custom env var, a feature flag) does
        // not clear the value of suspicion — the same content pass every
        // other string in this tree gets is what catches a credential
        // someone stashed under an ordinary-looking name.
        return isSecretName(entry.name)
          ? { ...entry, value: mask(entry.value) }
          : { ...entry, value: redactSecretsInText(entry.value) };
      }
      return redactSecrets(item, depth + 1);
    });
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && isSecretName(key)) {
      out[key] = mask(value);
      continue;
    }
    // any other string may still CONTAIN a credential (a command line, a
    // header value, a bot's reply) — the content pass catches those
    out[key] = redactSecrets(value, depth + 1);
  }
  return out;
}
