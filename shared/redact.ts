// Keeping secrets out of text that crosses a trust boundary: the native
// protocol log, tool titles, activity chips. The log keeps the shape (the
// name, the length) and loses the values.
//
// Single home in shared/ so the client (task timeline) and the server
// (redact.ts deep scrub, native tee) redact identically; server/redact.ts
// re-exports redactSecretsInText under its historical path.

/** Keep repeated redaction byte-for-byte stable. Persisted payloads can pass
 * through both a content scrub and the store-wide scrub; re-masking our own
 * marker would change its reported length (and any hash over the payload). */
const REDACTION_MARKER = /^«redacted \d+ chars»$/;

export const mask = (value: string) => (REDACTION_MARKER.test(value) ? value : `«redacted ${value.length} chars»`);

// ── content-shaped secrets ────────────────────────────────────────────
// High precision on purpose: a generic "long hex/base64" heuristic would
// rewrite real code in the transcript, so only shapes that are unmistakably
// credentials match.

const KEY_PREFIXES: RegExp[] = [
  /\bom[dg]_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, // desktop device and model-only credentials
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, // anthropic / openai
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, // stripe secret and restricted keys (port de OpenMausBot #3037)
  /\bxai-[A-Za-z0-9_-]{20,}/g, // xai (grok)
  /\bgsk_[A-Za-z0-9]{40,}/g, // groq
  /\bcsk-[A-Za-z0-9]{32,}/g, // cerebras
  /\bhf_[A-Za-z0-9]{30,}/g, // hugging face
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // github classic
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // github fine-grained
  /\bxox[abposr]-[A-Za-z0-9-]{20,}/g, // slack
  /\bxapp-\d-[A-Za-z0-9-]{20,}/g, // slack app-level (socket mode) tokens
  /\bgl(?:pat|dt|rtr?)-[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)*/g, // gitlab personal, deploy and runner tokens (upstream #3926)
  /\bAKIA[0-9A-Z]{16}\b/g, // aws access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // google api key
  /\bnpm_[A-Za-z0-9]{20,}/g, // npm
  /\bwhsec_[A-Za-z0-9_-]{20,}/g, // webhook secrets, alone or in an automation's address (upstream tip)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // jwt
];
const KEY_PREFIX_TESTS = KEY_PREFIXES.map((re) => new RegExp(re.source));
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** Only shapes that are unmistakably a credential (a provider's key prefix, a private key block), never a name or a
 * placeholder: text holding one is a credential store, not instructions. */
export function holdsCredential(text: string): boolean {
  return PRIVATE_KEY_BLOCK.test(text) || KEY_PREFIX_TESTS.some((re) => re.test(text));
}

const BEARER = /(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})/g;
/** `Authorization: Basic dXNlcjpwYXNz`: the base64 is `user:password` in the clear. Only after an
 * Authorization header, so prose like "Basic configuration" stays (upstream #3985). */
const BASIC_AUTH = /(\bAuthorization["']?\s*[:=]\s*["']?Basic\s+)([A-Za-z0-9+/]{4,}={0,2})(?![A-Za-z0-9._~+/=-])/gi;
const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/g;

/** Mask the body of every PEM private key block. Each BEGIN is paired with
 * the first END after it by two forward scans, never one pattern that
 * spans the body, so a text of many unclosed BEGIN lines stays linear. */
function maskPemBlocks(text: string): string {
  if (!text.includes("PRIVATE KEY-----")) return text;
  let out = "";
  let from = 0;
  PEM_BEGIN.lastIndex = 0;
  for (let begin = PEM_BEGIN.exec(text); begin; begin = PEM_BEGIN.exec(text)) {
    const bodyStart = begin.index + begin[0].length;
    PEM_END.lastIndex = bodyStart;
    const end = PEM_END.exec(text);
    // No END after this BEGIN: none after any later BEGIN either.
    if (!end) break;
    out += `${text.slice(from, begin.index)}${begin[0]}\n${mask(text.slice(bodyStart, end.index).trim())}\n${end[0]}`;
    from = end.index + end[0].length;
    PEM_BEGIN.lastIndex = from;
  }
  return out + text.slice(from);
}
/** key=value / key: value / key="value" where the key is secret-shaped.
 * The value must be a single token of some length; prose after a colon
 * ("password: leave blank…") has spaces and does not match. */
const KEY_VALUE =
  /\b((?:[A-Za-z0-9_-]*_)?(?:api[_-]?key|apikey|secret|token|password|passwd|authorization|auth[_-]?token|access[_-]?key|private[_-]?key)s?)(["']?\s*[=:]\s*)(["']?)([A-Za-z0-9._~+/=-]{8,})\3/gi;
/** `X_KEY=value`, `xai-key=value`: an assignment to a name that ENDS in key
 * is a credential whatever the value looks like, so no length floor. The
 * separator before `key` is what keeps `hotkey=` and `keyboard=` out. */
const KEY_SUFFIX_ASSIGNMENT = /\b([A-Za-z][A-Za-z0-9_-]*[_-]key)s?(=)(["']?)([A-Za-z0-9._~+/=-]+)\3/gi;
/** `--token abc`, `--password=abc`: the flag names a secret; the value is
 * whatever single token follows, never another flag. */
const SECRET_FLAG = /(--(?:token|password|passwd|api-key|apikey|secret|access-key|auth-token)(?:=|\s+))(["']?)(?!-)([A-Za-z0-9._~+/=-]+)\2/gi;
/** `scheme://user:secret@host`: the password in a URL's userinfo. */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:)([^\s/@'"«»]+)(@)/gi;

/** A key shape cut by a "…": what a title or a preview kept of a key once
 * it was shortened. Too short for KEY_PREFIXES, still part of the key.
 * Includes xapp-, glpat- family and whsec_ (Lot A0). */
const CUT_KEY = /\b(?:om[dg]_|sk-|[sr]k_(?:live|test)_|xai-|gsk_|csk-|hf_|gh[pousr]_|github_pat_|xox[abposr]-|xapp-|gl(?:pat|dt|rtr?)-|AKIA|AIza|npm_|whsec_|eyJ)[A-Za-z0-9_.-]*(?=…)/g;

/** Mask the start of a key left in front of an ellipsis by a cut made
 * before any redaction (an older automatic task title, say). */
export function redactCutSecrets(text: string): string {
  return text && text.includes("…") ? text.replace(CUT_KEY, (m) => mask(m)) : text;
}

// A saved website password or a vault fill has no shape: it is known by value.
// The server registers a scrubber for the values it holds (filled-secret-guard),
// and every redaction below runs it first. Nothing registers one in a client,
// where this is a no-op.

/** What a held secret becomes wherever it would have appeared (upstream tip). */
export const HELD_SECRET_MASK = "••••••";

const heldSecretScrubbers = new Set<(text: string) => string>();

/** Register a scrubber for held secret values; returns its removal. */
export function addHeldSecretScrubber(scrub: (text: string) => string): () => void {
  heldSecretScrubbers.add(scrub);
  return () => { heldSecretScrubbers.delete(scrub); };
}

export function scrubHeldSecrets(text: string): string {
  if (!text || heldSecretScrubbers.size === 0) return text;
  let out = text;
  for (const scrub of heldSecretScrubbers) out = scrub(out);
  return out;
}

export function redactSecretsInText(text: string): string {
  if (!text) return text;
  // Held values first: a short one-time code is still a secret.
  const held = scrubHeldSecrets(text);
  if (held.length < 8) return held;
  let out = held;
  out = maskPemBlocks(out);
  for (const re of KEY_PREFIXES) out = out.replace(re, (m) => mask(m));
  out = out.replace(BEARER, (_m, lead: string, tok: string) => `${lead}${mask(tok)}`);
  out = out.replace(BASIC_AUTH, (_m, lead: string, creds: string) => `${lead}${mask(creds)}`);
  out = out.replace(KEY_VALUE, (_m, key: string, sep: string, quote: string, value: string) => `${key}${sep}${quote}${mask(value)}${quote}`);
  out = out.replace(KEY_SUFFIX_ASSIGNMENT, (_m, key: string, sep: string, quote: string, value: string) => `${key}${sep}${quote}${mask(value)}${quote}`);
  out = out.replace(SECRET_FLAG, (_m, flag: string, quote: string, value: string) => `${flag}${quote}${mask(value)}${quote}`);
  out = out.replace(URL_USERINFO, (_m, lead: string, secret: string, at: string) => `${lead}${mask(secret)}${at}`);
  return out;
}
