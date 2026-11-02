// Secure form fill: a bot fills a saved login into its browser by reference.
//
// The bot calls fill_credential with an opaque handle (cred_...), a field
// and, optionally, the input's @eN ref or a CSS selector. The browser runtime
// (server/browser-runtime.ts) then, holding the browser session alone:
//
//   1. reads the page's URL through the engine (location.href, which a page
//      cannot redefine), never from a page script's own answer,
//   2. focuses the ref (a click) when one is given,
//   3. probes with a script that carries no secret and starts with an
//      origin and top-frame guard: a fillable input of the top document,
//      where its form posts; it marks the target with a one-time attribute,
//   4. asks the vault for the value (server/credential-vault.ts): only for a
//      granted bot and a URL on one of the item's sites,
//   5. writes with a strict-mode script whose first statement is the same
//      guard, then the marked element, focused, gets the value. The script
//      reaches the engine over stdin (agent_browser_eval), never argv.
//
// The bot's result names the item and the field, never the value; every
// later browser result of that session is redacted (SecretRedactor), as are
// the common encodings of the value; scripts are refused in that browser
// after a fill. Residual risks: SECURITY.md (Credential vault) and AGENTS.md.
import {
  VAULT_FILL_FIELDS,
  isVaultFillField,
  type VaultFillField,
} from "../shared/credential-vault.ts";
import { SENSITIVE_FIELD_MARKER } from "../shared/sensitive-fields.ts";

export const FILL_CREDENTIAL_TOOL = "fill_credential";
/** field "login": a whole sign-in, step by step (server/login-fill.ts). */
export const LOGIN_MODE = "login";
export const REDACTED_CREDENTIAL = "[credential]";

export const FILL_CREDENTIAL_TOOL_SPEC = {
  name: FILL_CREDENTIAL_TOOL,
  description:
    "Fill a login the person (or this team bot's managers) saved in Sagax into the current page, without ever seeing it. credential is the handle request_login gave you (cred_...). field login signs in: Sagax fills the user name, password and one-time code the page asks for, submits, and goes through each step of a multi-step sign-in (user name, Next, password, code) in this one call, never sending a field twice; submit false only fills. field username, password, totp (the current one-time code) or apiKey fills that one field; target is then the input's @eN ref from a snapshot or a CSS selector (omit it to let Sagax find the field; required for apiKey). The value is typed only when the page's top-level address is on the credential's sites over https, never into a frame. If a sign-in page you reach is on another address than the credential's sites, call request_login with that page's host. You never receive the value: later page reads show it as [credential], and page scripts are turned off in this browser until it restarts.",
  inputSchema: {
    type: "object",
    properties: {
      credential: { type: "string", description: "The handle request_login gave you, cred_..." },
      field: { type: "string", enum: [LOGIN_MODE, ...VAULT_FILL_FIELDS] },
      target: { type: "string", maxLength: 500, description: "The input's @eN ref or a CSS selector. Optional; not with login." },
      submit: { type: "boolean", description: "login only: false fills without submitting. Default true." },
    },
    required: ["credential", "field"],
    additionalProperties: false,
  },
} as const;

/** fill_credential with field "login": every step of a sign-in. */
export interface LoginRequest {
  credential: string;
  field: typeof LOGIN_MODE;
  submit: boolean;
}

export interface FillRequest {
  credential: string;
  field: VaultFillField;
  /** An @eN ref the runtime focuses first, or a CSS selector. */
  ref?: string;
  selector?: string;
}

/** Validate a fill_credential call's arguments. A string is the refusal. */
export function parseFillArguments(params: unknown): FillRequest | LoginRequest | string {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return "fill_credential needs credential and field.";
  const { credential, field, target, submit } = args as Record<string, unknown>;
  if (typeof credential !== "string" || !credential.trim()) return "fill_credential needs the credential handle request_login gave you.";
  if (field === LOGIN_MODE) {
    if (target !== undefined && target !== null && target !== "") return "field login finds the sign-in fields itself; leave target out, or fill one field at a time with its own field.";
    if (submit !== undefined && typeof submit !== "boolean") return "submit must be true or false.";
    return { credential: credential.trim(), field: LOGIN_MODE, submit: submit !== false };
  }
  if (submit !== undefined) return "submit applies to field login only.";
  if (!isVaultFillField(field)) return `field must be one of ${[LOGIN_MODE, ...VAULT_FILL_FIELDS].join(", ")}.`;
  if (target !== undefined && (typeof target !== "string" || target.length > 500)) return "target must be an @eN ref or a CSS selector.";
  const trimmed = typeof target === "string" ? target.trim() : "";
  if (field === "apiKey" && !trimmed) return "An apiKey fill needs a target: the input's @eN ref or a CSS selector.";
  if (/^@?e\d{1,6}$/.test(trimmed)) return { credential: credential.trim(), field, ref: trimmed.startsWith("@") ? trimmed : `@${trimmed}` };
  return { credential: credential.trim(), field, ...(trimmed ? { selector: trimmed } : {}) };
}

/** Which element a page script aims at: the focused one (after a ref was
 * clicked), a selector, or the best guess for the field. */
type Aim = { mode: "focused" } | { mode: "selector"; selector: string } | { mode: "auto" };

export function aimOf(request: FillRequest): Aim {
  if (request.ref) return { mode: "focused" };
  if (request.selector) return { mode: "selector", selector: request.selector };
  return { mode: "auto" };
}

// The in-page finder, shared by the probe and the fill so both judge the
// same element. It never crosses into a frame: a selector only searches the
// top document, and a focused iframe is reported as one.
const FINDER = String.raw`
const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
const usable = (el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.disabled && !el.readOnly && el.type !== 'hidden';
const textLike = (el) => el instanceof HTMLInputElement && ['text','email','tel','number','search',''].includes(el.type);
const hint = (el) => [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ');
function pick(aim, field) {
  if (aim.mode === 'focused') { const el = document.activeElement; if (el && el.tagName === 'IFRAME') return { frame: true }; return { el }; }
  if (aim.mode === 'selector') { let el = null; try { el = document.querySelector(aim.selector); } catch (e) { return { bad: true }; } if (el && el.tagName === 'IFRAME') return { frame: true }; return { el }; }
  const inputs = Array.from(document.querySelectorAll('input,textarea')).filter((el) => usable(el) && visible(el));
  if (field === 'password') return { el: inputs.find((el) => el.type === 'password') };
  if (field === 'totp') return { el: inputs.find((el) => el.autocomplete === 'one-time-code') || inputs.find((el) => textLike(el) && /otp|totp|2fa|mfa|one.?time|verification|security.?code|auth.?code/i.test(hint(el))) };
  if (field === 'username') {
    const named = inputs.find((el) => el.autocomplete === 'username' || el.autocomplete === 'email' || (el instanceof HTMLInputElement && el.type === 'email'));
    if (named) return { el: named };
    const password = inputs.findIndex((el) => el.type === 'password');
    const before = password > 0 ? inputs.slice(0, password).reverse().find(textLike) : undefined;
    return { el: before || inputs.find((el) => textLike(el) && /user|login|email|account|identifiant|courriel/i.test(hint(el))) };
  }
  if (field === 'cardNumber') return { el: inputs.find((el) => el.autocomplete === 'cc-number') || inputs.find((el) => textLike(el) && /card.?number|cc-number|num[eé]ro|carte/i.test(hint(el))) };
  if (field === 'cardExpiry') return { el: inputs.find((el) => el.autocomplete === 'cc-exp') || inputs.find((el) => textLike(el) && /expir|mm|yy|date/i.test(hint(el))) };
  if (field === 'cardCvc') return { el: inputs.find((el) => el.autocomplete === 'cc-csc') || inputs.find((el) => /cvc|cvv|csc|security.?code|code/i.test(hint(el))) };
  if (field === 'cardholder') return { el: inputs.find((el) => el.autocomplete === 'cc-name') || inputs.find((el) => textLike(el) && /cardholder|titulaire|name on card/i.test(hint(el))) };
  if (field === 'addressLine1') return { el: inputs.find((el) => el.autocomplete === 'address-line1' || el.autocomplete === 'street-address') };
  if (field === 'addressLine2') return { el: inputs.find((el) => el.autocomplete === 'address-line2') };
  if (field === 'addressCity') return { el: inputs.find((el) => el.autocomplete === 'address-level2') };
  if (field === 'addressRegion') return { el: inputs.find((el) => el.autocomplete === 'address-level1') };
  if (field === 'addressPostal') return { el: inputs.find((el) => el.autocomplete === 'postal-code') };
  if (field === 'addressCountry') return { el: inputs.find((el) => el.autocomplete === 'country' || el.autocomplete === 'country-name') };
  if (field === 'addressRecipient' || field === 'contactName') return { el: inputs.find((el) => el.autocomplete === 'name') };
  if (field === 'addressPhone' || field === 'contactPhone') return { el: inputs.find((el) => el.autocomplete === 'tel' || el.type === 'tel') };
  if (field === 'contactEmail') return { el: inputs.find((el) => el.autocomplete === 'email' || el.type === 'email') };
  if (field === 'contactCompany') return { el: inputs.find((el) => el.autocomplete === 'organization') };
  return {};
}
function judge(found, field) {
  if (found.bad) return 'selector';
  if (found.frame) return 'frame';
  const el = found.el;
  if (!el) return 'missing';
  if (el.ownerDocument !== document) return 'frame';
  if (!usable(el)) return 'not_input';
  if (field === 'password' && el.type !== 'password') return 'not_password';
  if (field !== 'password' && field !== 'cardCvc' && el.type === 'password' && field !== 'apiKey') return 'password_box';
  return null;
}`;

/** The guard every script of the fill starts with, before anything else
 * runs: the top frame of the expected origin. window.top and location are
 * unforgeable, so a page cannot answer for another one. */
function originGuard(origin: string, failure: string): string {
  return `if (window.top !== window || location.origin !== ${JSON.stringify(origin)}) return ${JSON.stringify(failure)};`;
}

/** The probe: carries no secret. It answers whether it runs in the top
 * frame of the expected origin, why the target would be refused, and where
 * the target's form posts; it marks the target with a one-time attribute so
 * the write reaches that exact element of the top document. */
export function probeScript(aim: Aim, field: VaultFillField, nonce: string, origin: string): string {
  return `(() => {'use strict';${originGuard(origin, '{"top":true,"problem":"moved","targets":[]}')}${FINDER}
const found = pick(${JSON.stringify(aim)}, ${JSON.stringify(field)});
const problem = judge(found, ${JSON.stringify(field)});
const targets = [];
const methods = [];
if (!problem) {
  const el = found.el;
  el.setAttribute('data-sagax-fill', ${JSON.stringify(nonce)});
  const form = el.form;
  if (form) {
    // Prototype methods, never the form's own properties: a field named
    // "action", "getAttribute" or "id" would shadow them (DOM clobbering).
    const attr = (node, name) => Element.prototype.getAttribute.call(node, name);
    const has = (node, name) => Element.prototype.hasAttribute.call(node, name);
    targets.push(new URL(attr(form, 'action') || location.href, location.href).href);
    methods.push((attr(form, 'method') || 'get').trim().toLowerCase());
    // Every control that belongs to this form, inside it or tied by form=.
    for (const button of Array.from(Document.prototype.querySelectorAll.call(document, 'button,input'))) {
      if (button.form !== form) continue;
      if (has(button, 'formaction')) targets.push(new URL(attr(button, 'formaction'), location.href).href);
      if (has(button, 'formmethod')) methods.push((attr(button, 'formmethod') || '').trim().toLowerCase());
    }
  }
}
return JSON.stringify({ top: true, problem, targets, methods });
})()`;
}

/** The write: strict mode, the origin guard first, then the marked element
 * of the top document, still the right kind, focused, gets the value. The
 * answer is a bare word, never the value. */
export function writeScript(nonce: string, field: VaultFillField, origin: string, value: string): string {
  return `(() => {'use strict';${originGuard(origin, "moved")}${FINDER}
const el = document.querySelector(${JSON.stringify(nonceSelector(nonce))});
if (!el || !el.isConnected || el.ownerDocument !== document) return 'moved';
const problem = judge({ el }, ${JSON.stringify(field)});
if (problem) return problem;
if (document.activeElement !== el) el.focus();
if (document.activeElement !== el) return 'focus';
el.setAttribute('autocomplete', 'off');
el.setAttribute('data-sagax-filled', '1');
const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
el.blur();
return 'ok';
})()`;
}

/** A JSON array of strings answered by an eval, or [] for anything else. */
export function parseEvalArray(result: unknown): string[] {
  const content = (result as { content?: unknown; isError?: unknown } | null);
  if (!content || content.isError === true || !Array.isArray(content.content)) return [];
  const part = (content.content as unknown[]).find((item) => typeof (item as { text?: unknown } | null)?.text === "string") as { text: string } | undefined;
  try {
    let value: unknown = JSON.parse(part?.text ?? "");
    if (typeof value === "string") value = JSON.parse(value);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 16_384) : [];
  } catch {
    return [];
  }
}

/** The write's bare answer, or null when the result is anything else. */
export function parseWrite(result: unknown): string | null {
  const content = (result as { content?: unknown; isError?: unknown } | null);
  if (!content || content.isError === true || !Array.isArray(content.content)) return null;
  const part = (content.content as unknown[]).find((item) => typeof (item as { text?: unknown } | null)?.text === "string") as { text: string } | undefined;
  try {
    const value: unknown = JSON.parse(part?.text ?? "");
    return typeof value === "string" && /^[a-z_]{1,20}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

const MAX_FORM_ROUTES = 20;

export interface ProbeResult { top: boolean; problem: string | null; targets: string[]; methods: string[] }

/** The selector of the element a probe marked. */
export function nonceSelector(nonce: string): string {
  return `[data-sagax-fill="${nonce}"]`;
}

/** An eval result's JSON object: agent-browser returns the script's string
 * as a JSON string inside the text part. Null when it is anything else. */
export function parseEvalObject(result: unknown): Record<string, unknown> | null {
  const content = (result as { content?: unknown; isError?: unknown } | null);
  if (!content || content.isError === true || !Array.isArray(content.content)) return null;
  const part = (content.content as unknown[]).find((item) => typeof (item as { text?: unknown } | null)?.text === "string") as { text: string } | undefined;
  if (!part) return null;
  try {
    let value: unknown = JSON.parse(part.text);
    if (typeof value === "string") value = JSON.parse(value);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function parseProbe(result: unknown): ProbeResult | null {
  const value = parseEvalObject(result);
  if (!value || typeof value.top !== "boolean") return null;
  // Fail closed: a form with more ways to send it than this is not read
  // partly and filled anyway.
  if ((Array.isArray(value.targets) && value.targets.length > MAX_FORM_ROUTES) || (Array.isArray(value.methods) && value.methods.length > MAX_FORM_ROUTES)) return null;
  const targets = Array.isArray(value.targets) ? value.targets.filter((target): target is string => typeof target === "string") : [];
  const methods = Array.isArray(value.methods) ? value.methods.filter((method): method is string => typeof method === "string") : [];
  return { top: value.top, problem: typeof value.problem === "string" ? value.problem : null, targets, methods };
}

/** Whether every way the form can be sent is a POST: a GET submission puts
 * the value in the URL (the address bar, the history, the next page). */
export function formPostsOnly(methods: readonly string[]): boolean {
  return methods.every((method) => method === "post");
}

/** Whether every place the form posts to stays on the page's own origin. A
 * javascript: or data: action, or another origin, refuses the fill. */
export function formStaysOnOrigin(targets: readonly string[], origin: string): boolean {
  return targets.every((target) => {
    try {
      return new URL(target).origin === origin;
    } catch {
      return false;
    }
  });
}

/** What the bot hears when the target is refused. Never a value. */
export function problemText(problem: string, field: VaultFillField): string {
  switch (problem) {
    case "frame": return "The target is inside a frame. Sagax only fills the page's own top-level form; nothing was filled. If the site signs in inside a frame, ask the person to sign in on the visible browser.";
    case "selector": return "target is not a valid CSS selector; nothing was filled.";
    case "missing": return `No ${field === "totp" ? "one-time code" : field} field was found on this page; nothing was filled. Pass target with the input's @eN ref.`;
    case "not_input": return "The target is not a text field that can be filled; nothing was filled.";
    case "not_password": return "A password is only typed into a password field (type=password); nothing was filled.";
    case "password_box": return "This is a password field; fill it with field password. Nothing was filled.";
    case "moved": return "The page changed before the value was typed; nothing was filled. Check the page and try again.";
    case "cross_origin_form": return "This form sends to another site than the page; Sagax does not fill a login into it. Nothing was filled.";
    case "get_form": return "This form sends its fields in the page address (method GET); Sagax only fills a form sent with POST. Nothing was filled.";
    case "scripted": return "You ran a script on this site in this browser, so Sagax will not fill a saved login here. Call restart_browser, open the page again, then fill without running scripts.";
    case "fill_failed": return "The browser could not type into the field; nothing was filled. Take a new snapshot and pass the input's current ref.";
    case "focus": return "Another part of the page took the focus from the field; nothing was filled. Try again.";
    default: return "The field could not be filled; nothing was typed.";
  }
}


// ---------------------------------------------------------------- redaction

const MIN_REDACT_LENGTH = 4;
const MIN_PIECE_LENGTH = 6;
const SHORT_LIVED_MS = 5 * 60_000;
/** A sensitive-field value this long is a secret whose pieces are hidden
 * too; a shorter one (a code, an expiry, a security code) only whole. */
const MIN_SENSITIVE_PIECES_LENGTH = 8;

function htmlEntities(value: string, hex: boolean): string {
  return [...value].map((char) => hex ? `&#x${char.codePointAt(0)!.toString(16)};` : `&#${char.codePointAt(0)};`).join("");
}

function htmlEscaped(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The base64 characters that depend on the value alone wherever it sits
 * in a longer base64 blob: at byte offsets 0, 1 and 2, standard and
 * url-safe. The characters it shares with unknown neighbours are dropped. */
function base64Alignments(bytes: Buffer): string[] {
  const out: string[] = [];
  for (const offset of [0, 1, 2]) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes, Buffer.alloc(3)]).toString("base64");
    const start = offset === 0 ? 0 : offset === 1 ? 2 : 3;
    // The last full character of the value: (offset + length) bytes in, floor.
    const end = Math.floor(((offset + bytes.length) * 8) / 6);
    const core = encoded.slice(start, end);
    if (core.length >= MIN_PIECE_LENGTH) {
      out.push(core);
      out.push(core.replace(/\+/g, "-").replace(/\//g, "_"));
    }
  }
  return out;
}

function unicodeEscaped(value: string): string {
  return [...value].map((char) => {
    const code = char.codePointAt(0)!;
    return code > 0xffff ? char : `\\u${code.toString(16).padStart(4, "0")}`;
  }).join("");
}

/** The value as a URL or a form submission carries it: encodeURIComponent,
 * strict RFC 3986 (also ! ' ( ) * and ~), and application/x-www-form-
 * urlencoded as a browser sends a GET form (URLSearchParams: space as +),
 * each with upper and lower case hex. */
export function urlEncodings(value: string): string[] {
  const component = encodeURIComponent(value);
  const strict = component.replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const form = new URLSearchParams([["v", value]]).toString().slice(2);
  const out = new Set<string>();
  for (const encoded of [component, component.replace(/%20/g, "+"), strict, strict.replace(/%20/g, "+"), form]) {
    out.add(encoded);
    out.add(encoded.replace(/%[0-9A-Fa-f]{2}/g, (escape) => escape.toLowerCase()));
    out.add(encoded.replace(/%[0-9A-Fa-f]{2}/g, (escape) => escape.toUpperCase()));
  }
  return [...out];
}

/** The value as a page, a log or a request could show it: itself, base64
 * (padded or not, url-safe, and as it reads at the two other byte
 * alignments inside a longer blob), hex in both cases, reversed, URL and form
 * encoded (also twice), JSON, HTML (named, decimal and hex entities) and
 * unicode escapes in both cases. */
export function variants(value: string): string[] {
  const out = new Set<string>([value]);
  const bytes = Buffer.from(value, "utf8");
  out.add(bytes.toString("base64"));
  out.add(bytes.toString("base64").replace(/=+$/, ""));
  out.add(bytes.toString("base64url"));
  out.add(bytes.toString("hex"));
  out.add(bytes.toString("hex").toUpperCase());
  out.add([...value].reverse().join(""));
  for (const encoded of urlEncodings(value)) {
    out.add(encoded);
    // Encoded twice (a URL inside a URL parameter).
    for (const twice of urlEncodings(encoded)) out.add(twice);
  }
  for (const aligned of base64Alignments(bytes)) out.add(aligned);
  out.add(JSON.stringify(value).slice(1, -1));
  out.add(htmlEscaped(value));
  out.add(htmlEntities(value, false));
  out.add(htmlEntities(value, true));
  out.add(unicodeEscaped(value));
  out.add(unicodeEscaped(value).replace(/\\u([0-9a-f]{4})/g, (_match, hex: string) => `\\u${hex.toUpperCase()}`));
  return [...out].filter((variant) => variant.length >= MIN_REDACT_LENGTH);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Values filled in each browser session, removed from every later result of
 * that session (and from anything else handed to redact): the value itself
 * and its common encodings. A one-time code is forgotten after a while. */
export class SecretRedactor {
  private readonly sessions = new Map<string, Map<string, number>>();
  private readonly tainted = new Map<string, Set<string>>();
  /** Values matched without regard to case (a user name: sites lower-case it). */
  private readonly caseless = new Map<string, Set<string>>();
  /** The values themselves, for the pairs (user:pass) a page may encode. */
  private readonly raw = new Map<string, string[]>();
  /** Origins where the bot ran its own script in this browser session. */
  private readonly scripted = new Map<string, Set<string>>();
  /** The marker a value is replaced with when it is not a vault value
   * (SENSITIVE_FIELD_MARKER for what a sensitive field held). */
  private readonly markers = new Map<string, Map<string, string>>();
  /** Long sensitive-field values already learned, so a read of the same
   * page does not rebuild their pieces. */
  private readonly sensitive = new Map<string, Set<string>>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** pieces: also every part of four characters or more (a secret such as
   * a password, an API key or a code; not a user name, whose parts are
   * ordinary words and domains). */
  remember(session: string, value: string, options: { shortLived?: boolean; pieces?: boolean; caseless?: boolean; marker?: string } = {}): void {
    if (!value) return;
    let stored = this.sessions.get(session);
    if (!stored) this.sessions.set(session, stored = new Map());
    let markers = this.markers.get(session);
    if (options.marker && !markers) this.markers.set(session, markers = new Map());
    const until = options.shortLived ? this.now() + SHORT_LIVED_MS : Number.POSITIVE_INFINITY;
    // A value keeps the longest life it was given, and a vault value keeps
    // its own marker when a sensitive field holds it too.
    const store = stored;
    const values = {
      set: (key: string, life: number) => {
        const known = store.get(key);
        if (options.marker && (known === undefined || markers!.has(key))) markers!.set(key, options.marker);
        else if (!options.marker) markers?.delete(key);
        store.set(key, Math.max(known ?? Number.NEGATIVE_INFINITY, life));
      },
    };
    let raw = this.raw.get(session);
    if (!raw) this.raw.set(session, raw = []);
    const known = raw.slice(-8);
    if (!options.shortLived && value.length >= MIN_REDACT_LENGTH && !raw.includes(value)) raw.push(value);
    for (const variant of value.length >= MIN_REDACT_LENGTH ? variants(value) : [value]) values.set(variant, until);
    // Every piece of six characters or more: an edited, partial or copied
    // part of the value is hidden too (up to 128 characters of it). Shorter
    // pieces would hide ordinary words of every page; what an edited field
    // holds now is also learned from the page itself (refreshFilledValues).
    // The same for each URL and form encoding of the value: a run between
    // two escapes of a GET submission is a piece too.
    const sources = options.pieces ? [value, ...urlEncodings(value).filter((encoded) => encoded !== value)] : [];
    for (const source of sources) {
      const head = [...source].slice(0, 192);
      for (let start = 0; start + MIN_PIECE_LENGTH <= head.length; start++) {
        for (let end = start + MIN_PIECE_LENGTH; end <= head.length; end++) {
          if (end - start === head.length) continue;
          values.set(head.slice(start, end).join(""), until);
        }
      }
    }
    if (options.caseless) {
      let caseless = this.caseless.get(session);
      if (!caseless) this.caseless.set(session, caseless = new Set());
      for (const variant of value.length >= MIN_REDACT_LENGTH ? variants(value) : [value]) caseless.add(variant);
    }
    // A pair such as user:pass, as HTTP Basic sends it in base64.
    if (value.length >= MIN_REDACT_LENGTH && !options.shortLived) {
      for (const other of known) {
        for (const pair of [`${other}:${value}`, `${value}:${other}`]) {
          const encoded = Buffer.from(pair, "utf8").toString("base64");
          values.set(encoded, until);
          values.set(encoded.replace(/=+$/, ""), until);
        }
      }
    }
  }

  /** An origin where a credential was filled: the bot's own eval is refused there. */
  taint(session: string, origin: string): void {
    let origins = this.tainted.get(session);
    if (!origins) this.tainted.set(session, origins = new Set());
    origins.add(origin);
  }

  isTainted(session: string, origin: string): boolean {
    return this.tainted.get(session)?.has(origin) === true;
  }

  hasTaint(session: string): boolean {
    return (this.tainted.get(session)?.size ?? 0) > 0;
  }

  /** The bot ran agent_browser_eval on this origin: it could have left a
   * listener or a planted field there, so no fill until a restart. */
  scriptedOn(session: string, origin: string): void {
    let origins = this.scripted.get(session);
    if (!origins) this.scripted.set(session, origins = new Set());
    origins.add(origin);
  }

  wasScripted(session: string, origin: string): boolean {
    return this.scripted.get(session)?.has(origin) === true;
  }

  /** The bot ran a script anywhere in this browser session. */
  everScripted(session: string): boolean {
    return (this.scripted.get(session)?.size ?? 0) > 0;
  }

  /** What a sensitive field of the page holds (shared/sensitive-fields.ts),
   * typed by the person, the bot or the site: hidden from every later result
   * as SENSITIVE_FIELD_MARKER. A long value (a password, a card number) is
   * kept with its pieces, like a filled secret; a short one (a code, an
   * expiry) only whole and for SHORT_LIVED_MS after it was last seen. */
  rememberSensitive(session: string, value: string): void {
    if (!value) return;
    const long = [...value].length >= MIN_SENSITIVE_PIECES_LENGTH;
    if (long) {
      let known = this.sensitive.get(session);
      if (!known) this.sensitive.set(session, known = new Set());
      if (known.has(value)) return;
      known.add(value);
    }
    this.remember(session, value, { pieces: long, shortLived: !long, marker: SENSITIVE_FIELD_MARKER });
  }

  forget(session: string): void {
    this.markers.delete(session);
    this.sensitive.delete(session);
    this.sessions.delete(session);
    this.tainted.delete(session);
    this.raw.delete(session);
    this.scripted.delete(session);
    this.caseless.delete(session);
  }

  private pattern(session: string): RegExp | null {
    const values = this.sessions.get(session);
    if (!values?.size) return null;
    const now = this.now();
    for (const [value, until] of values) if (until <= now) { values.delete(value); this.markers.get(session)?.delete(value); }
    if (!values.size) return null;
    const sorted = [...values.keys()].sort((left, right) => right.length - left.length);
    // A short value (a 3-letter user name) is hidden only as a whole word,
    // so it does not eat every word that contains it. Masked characters, the
    // way an accessibility tree shows a password, lose their count.
    const caseless = this.caseless.get(session);
    const parts = sorted.map((value) => {
      const body = caseless?.has(value) ? `(?i:${escapeRegExp(value)})` : escapeRegExp(value);
      return value.length < MIN_REDACT_LENGTH ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
    });
    return new RegExp([...parts, "[\u2022\u25CF]{2,}"].join("|"), "gu");
  }

  private replace(session: string, text: string, pattern: RegExp): string {
    const markers = this.markers.get(session);
    return text.replace(pattern, (match) => /^[\u2022\u25CF]+$/u.test(match) ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : markers?.get(match) ?? REDACTED_CREDENTIAL);
  }

  redactText(session: string, text: string): string {
    const pattern = this.pattern(session);
    return pattern ? this.replace(session, text, pattern) : text;
  }

  /** Every string inside a tool result (text parts, structured content). */
  redact<T>(session: string, value: T): T {
    const pattern = this.pattern(session);
    if (!pattern) return value;
    const walk = (node: unknown, depth: number): unknown => {
      if (typeof node === "string") return this.replace(session, node, pattern);
      if (depth > 32 || !node || typeof node !== "object") return node;
      if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, key === "data" && (node as { type?: unknown }).type === "image" ? item : walk(item, depth + 1)]));
    };
    return walk(value, 0) as T;
  }
}
