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

export function redactSecretsInText(text: string): string {
  // Shared pass already runs held scrubbers (filled-secret-guard). Keep an
  // explicit filled pass so a caller that imported shared/redact alone and
  // then this module still gets vault fills scrubbed if registration raced.
  return redactFilledSecrets(redactSecretPatterns(text));
}

const MASK_SPAN = /«redacted \d+ chars»|••••••|\[credential\]/g;

/** The original value behind each mask of `redactSecretsInText(original)`, in
 * order, read off the gaps between the unchanged text around the masks.
 * Null when the alignment is ambiguous (two masks side by side). */
function maskedOriginals(original: string): string[] | null {
  const redacted = redactSecretsInText(original);
  const literals = redacted.split(MASK_SPAN);
  if (literals.length < 2) return [];
  const values: string[] = [];
  let pos = 0;
  for (let i = 0; i < literals.length - 1; i++) {
    if (!original.startsWith(literals[i]!, pos)) return null;
    pos += literals[i]!.length;
    const next = literals[i + 1]!;
    const last = i === literals.length - 2;
    if (!next && !last) return null;
    const end = last ? original.length - next.length : original.indexOf(next, pos);
    if (end < pos || (last && !original.endsWith(next))) return null;
    values.push(original.slice(pos, end));
    pos = end;
  }
  return values;
}

/** A text read back through `redactSecretsInText` that a caller sends again:
 * each mask takes the value it stood for in `original`, in order, so editing
 * around a mask never saves the mask over the secret (same idea as a `true`
 * in resolveSecrets keeping the stored value). Text without masks, or whose
 * masks cannot be matched to `original`, is returned as received. */
export function restoreMaskedSecrets(original: string, received: string): string {
  if (!received.match(MASK_SPAN)) return received;
  const values = maskedOriginals(original);
  if (!values?.length) return received;
  let index = 0;
  return received.replace(MASK_SPAN, (mask) => values[index++] ?? mask);
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
