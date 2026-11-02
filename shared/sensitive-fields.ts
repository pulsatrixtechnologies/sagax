// Sensitive form fields: which ones they are, and the page scripts that keep
// their values out of what reaches a model (2026-10-26).
//
// One rule, used everywhere a field's value could leave the page toward a
// bot: the browser runtime's snapshots, page reads, eval answers and
// screenshots (server/browser/browser-runtime.ts), and Teach by demonstration
// (shared/teach-recording.ts, isSecretField). A field is sensitive when it is
//   - an <input type="password">;
//   - an input, textarea or select whose autocomplete has the token
//     current-password, new-password, one-time-code, or any cc-* token
//     (cc-number, cc-csc, cc-exp, cc-exp-month, cc-exp-year, cc-name...);
//   - any element marked data-sensitive (any value except "false"), the
//     attribute a page or a widget uses to mark one itself. It only adds:
//     data-sensitive="false" never makes a password field ordinary;
//   - an element the runtime already saw as sensitive (data-sagax-sensitive,
//     set by the collection script), so a "show password" toggle that turns
//     the field into type="text" keeps it hidden.
//
// The page keeps the real value: nothing here writes a field's value. The
// values read from the page are only handed to the redactor
// (SecretRedactor.rememberSensitive), which replaces them in every later
// result with SENSITIVE_FIELD_MARKER. Screenshots are taken with those
// fields drawn as discs (MASK_SENSITIVE_SCRIPT, then UNMASK_SENSITIVE_SCRIPT),
// a style only, never a value change.

/** What a model reads in place of a sensitive field's value. */
export const SENSITIVE_FIELD_MARKER = "[sensitive field]";

/** The attribute a page or widget sets to mark an element sensitive. */
export const SENSITIVE_ATTRIBUTE = "data-sensitive";

/** Set by the runtime on a field it found sensitive, so it stays so. */
export const SEEN_SENSITIVE_ATTRIBUTE = "data-sagax-sensitive";

/** Autocomplete tokens that make a field sensitive, besides every cc-*. */
export const SENSITIVE_AUTOCOMPLETE: ReadonlySet<string> = new Set(["current-password", "new-password", "one-time-code"]);

export interface SensitiveFieldInfo {
  tag?: string;
  type?: string;
  autocomplete?: string;
  /** The data-sensitive attribute's value, when the element has one. */
  sensitive?: string | null;
}

/** True when an autocomplete attribute names a sensitive field. */
export function sensitiveAutocomplete(autocomplete: string | null | undefined): boolean {
  return (autocomplete ?? "").toLowerCase().split(/\s+/).some((token) => SENSITIVE_AUTOCOMPLETE.has(token) || token.startsWith("cc-"));
}

/** The rule above, on a field's attributes. */
export function isSensitiveField(info: SensitiveFieldInfo | null | undefined): boolean {
  if (!info) return false;
  if (typeof info.sensitive === "string" && info.sensitive.trim().toLowerCase() !== "false") return true;
  if ((info.type ?? "").toLowerCase() === "password") return true;
  const tag = (info.tag ?? "").toLowerCase();
  if (tag && tag !== "input" && tag !== "textarea" && tag !== "select") return false;
  return sensitiveAutocomplete(info.autocomplete);
}

// The same rule inside the page. Self-contained: `sensitive(el)` and
// `sensitiveRoots()` (the document, its same-origin frames and open shadow
// roots, where a field can also live).
const PAGE_RULE = `
const AUTOCOMPLETE = ${JSON.stringify([...SENSITIVE_AUTOCOMPLETE])};
const sensitive = (el) => {
  if (!el || el.nodeType !== 1) return false;
  const marked = el.getAttribute(${JSON.stringify(SENSITIVE_ATTRIBUTE)});
  if (marked !== null && marked.trim().toLowerCase() !== 'false') return true;
  if (el.hasAttribute(${JSON.stringify(SEEN_SENSITIVE_ATTRIBUTE)})) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' && String(el.getAttribute('type') || '').toLowerCase() === 'password') return true;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  return String(el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/).some((token) => AUTOCOMPLETE.includes(token) || token.startsWith('cc-'));
};
const CANDIDATES = 'input, textarea, select, [' + ${JSON.stringify(SENSITIVE_ATTRIBUTE)} + '], [' + ${JSON.stringify(SEEN_SENSITIVE_ATTRIBUTE)} + ']';
const sensitiveRoots = () => {
  const roots = [];
  const seen = new Set();
  const visit = (root, depth) => {
    if (!root || seen.has(root) || depth > 4 || roots.length > 64) return;
    seen.add(root);
    roots.push(root);
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') { try { if (el.contentDocument) visit(el.contentDocument, depth + 1); } catch (error) { /* another origin */ } }
    }
  };
  visit(document, 0);
  return roots;
};
const sensitiveFields = () => {
  const out = [];
  for (const root of sensitiveRoots()) for (const el of root.querySelectorAll(CANDIDATES)) if (sensitive(el)) out.push(el);
  return out;
};
const sensitiveValue = (el) => {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return typeof el.value === 'string' && el.value.trim() !== '' ? el.value : '';
  return String(el.textContent || '').trim();
};`;

const MAX_VALUES = 50;
const MAX_VALUE_LENGTH = 4096;

/** What sensitive fields hold now, as a JSON array of strings, the field
 * marked so a later type change keeps it sensitive. Never returned to a bot. */
export const SENSITIVE_VALUES_SCRIPT = `(() => {'use strict';${PAGE_RULE}
const out = [];
for (const el of sensitiveFields()) {
  try { el.setAttribute(${JSON.stringify(SEEN_SENSITIVE_ATTRIBUTE)}, ''); } catch (error) { /* read-only node */ }
  const value = sensitiveValue(el);
  if (value && out.length < ${MAX_VALUES}) out.push(value.slice(0, ${MAX_VALUE_LENGTH}));
}
return JSON.stringify(out);
})()`;

/** The page observation of a page action (OBSERVE_PAGE_SCRIPT, a JSON
 * string), with the sensitive values beside it under `sensitive`, so an
 * action costs no extra engine call. */
export function withSensitiveValues(observeScript: string): string {
  return `(() => {'use strict';
const state = JSON.parse(${observeScript});
state.sensitive = JSON.parse(${SENSITIVE_VALUES_SCRIPT});
return JSON.stringify(state);
})()`;
}

const MASK_KEY = "__sagaxSensitiveMask";
/** On a field while it is drawn masked for a screenshot. */
export const MASKED_ATTRIBUTE = "data-sagax-masked";

/** Draws every sensitive field as discs (and a select's text as clear)
 * for a screenshot. A style only: the value is never touched. The style
 * attribute it replaces is kept and put back by UNMASK_SENSITIVE_SCRIPT. */
export const MASK_SENSITIVE_SCRIPT = `(() => {'use strict';${PAGE_RULE}
const kept = window[${JSON.stringify(MASK_KEY)}] || (window[${JSON.stringify(MASK_KEY)}] = []);
let count = 0;
for (const el of sensitiveFields()) {
  if (kept.some((entry) => entry[0] === el)) continue;
  kept.push([el, el.getAttribute('style')]);
  el.setAttribute(${JSON.stringify(MASKED_ATTRIBUTE)}, '');
  el.style.setProperty('-webkit-text-security', 'disc', 'important');
  if (el.tagName === 'SELECT' || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    el.style.setProperty('color', 'transparent', 'important');
    el.style.setProperty('text-shadow', 'none', 'important');
  }
  count++;
}
return JSON.stringify(count);
})()`;

/** Puts back what MASK_SENSITIVE_SCRIPT changed. */
export const UNMASK_SENSITIVE_SCRIPT = `(() => {'use strict';
const kept = window[${JSON.stringify(MASK_KEY)}] || [];
for (const [el, style] of kept) {
  try {
    el.removeAttribute(${JSON.stringify(MASKED_ATTRIBUTE)});
    if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
  } catch (error) { /* node gone */ }
}
delete window[${JSON.stringify(MASK_KEY)}];
return JSON.stringify(kept.length);
})()`;

/** Tools whose answer never carries page text, so no read of the
 * sensitive fields is needed before redacting it. A page action reads them
 * in its own page observation (withSensitiveValues). Every other tool,
 * including an unknown one, is read around. */
export const NO_PAGE_TEXT_TOOLS: ReadonlySet<string> = new Set([
  "agent_browser_get_url", "agent_browser_get_title", "agent_browser_wait_ms", "agent_browser_wait_for_load",
  "agent_browser_close", "agent_browser_tab_new", "agent_browser_tab_close", "agent_browser_scroll",
  "agent_browser_screenshot",
]);

/** The values in an eval answer of SENSITIVE_VALUES_SCRIPT, or of a page
 * observation made with withSensitiveValues. Empty on anything else. */
export function parseSensitiveValues(result: unknown): string[] {
  const answer = result as { content?: unknown; isError?: unknown } | null;
  if (!answer || answer.isError === true || !Array.isArray(answer.content)) return [];
  const part = (answer.content as unknown[]).find((item) => typeof (item as { text?: unknown } | null)?.text === "string") as { text: string } | undefined;
  try {
    let value: unknown = JSON.parse(part?.text ?? "");
    if (typeof value === "string") value = JSON.parse(value);
    if (value && typeof value === "object" && !Array.isArray(value)) value = (value as { sensitive?: unknown }).sensitive;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, MAX_VALUES).map((item) => item.slice(0, MAX_VALUE_LENGTH)) : [];
  } catch {
    return [];
  }
}
