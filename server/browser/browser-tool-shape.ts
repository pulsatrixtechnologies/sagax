// What the built-in browser shows a model, and what its results put into the
// conversation. Pure: the runtime applies it on every MCP frame.
//
// Measured on agent-browser 0.37.0 (2026-09-15, main): the core profile
// advertises 29 tools at ~12.5k tokens of schema, of which ~440 tokens are the
// tool descriptions. The rest is fifteen launch/session parameters repeated on
// every tool. Every result also arrives twice — `content[].text` and a
// `structuredContent` object 3-5x larger — and Codex keeps the structured form
// in history: a product-page snapshot cost 10-17k tokens instead of 2-4k, and
// every later model call in the thread re-read it. This module fixes both at
// the boundary so the saving applies to every engine.
import { trimResultText } from "../mcp/mcp-trim.ts";

/** Launch, session and network settings Sagax owns through the
 * environment (see browser-engine.ts). A model has no business setting them
 * per call — `session` would reach another bot's browser, `extraArgs`,
 * `caCert` and `headed` change the launch — and each one cost more schema
 * than the tool's own description. `headed` in particular overrides
 * AGENT_BROWSER_HEADED and the managed config, so a single call can pin a
 * daemon to a launch mode this host cannot satisfy (#1383). */
export const HARNESS_OWNED_BROWSER_PARAMS: ReadonlySet<string> = new Set([
  "allowedDomains", "caCert", "clearCaCert", "extraArgs", "headed", "idleTimeout", "namespace",
  "restore", "restoreCheckFn", "restoreCheckText", "restoreCheckUrl", "restoreSave", "session", "timeoutMs",
]);

/** Characters of one browser result that may enter the model's context.
 * ~8k tokens: the interactive snapshot of a heavy encyclopedia article
 * (21k chars) fits; a whole product page read as markdown (79k) does not. */
export const DEFAULT_BROWSER_RESULT_BUDGET = 32_000;

const BROWSER_NARROWING_HINT =
  " For a snapshot, pass selector or depth, or set compact; for one value such as a price, use agent_browser_get_text with a selector instead of reading the whole page.";

type Tool = { inputSchema?: { properties?: Record<string, unknown>; required?: unknown } & Record<string, unknown> } & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Whether the snapshot taken after agent_browser_open shows the page loaded:
 * some text, and not a blank page when a website was asked for (upstream
 * #4633). A blank page asked for, or a redirect elsewhere, still counts. */
export function verifiedBrowserNavigation(url: string, observation: unknown): boolean {
  if (!isRecord(observation) || observation.isError === true || !Array.isArray(observation.content)) return false;
  const structured = observation.structuredContent;
  const response = isRecord(structured) ? structured.response : undefined;
  const data = isRecord(response) ? response.data : undefined;
  if (/^https?:\/\//i.test(url.trim()) && isRecord(data) && data.origin === "about:blank") return false;
  return observation.content.some((item) => isRecord(item) && item.type === "text" &&
    typeof item.text === "string" && item.text.trim().length > 0);
}

/** Remove harness-owned parameters from every advertised tool schema. */
/** agent-browser fetches a `url` given to agent_browser_read with its own
 * HTTP client, around the browser and its egress gate, and ignores every
 * proxy setting; without one it reads the open tab (OpenMausBot #2930 port). */
const READ_TOOL = "agent_browser_read";
export const READ_OPEN_PAGE_ONLY = "agent_browser_read reads the page open in this browser. Open the address with agent_browser_open first, then call agent_browser_read without url.";

export function readsAroundBrowser(params: unknown): boolean {
  return isRecord(params) && params.name === READ_TOOL && isRecord(params.arguments) && params.arguments.url !== undefined;
}

export function slimBrowserToolList(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.tools)) return result;
  const tools = (result.tools as unknown[]).map((tool) => {
    if (!isRecord(tool) || !isRecord(tool.inputSchema)) return tool;
    const schema = tool.inputSchema as NonNullable<Tool["inputSchema"]>;
    const hidden = (name: string) => HARNESS_OWNED_BROWSER_PARAMS.has(name) || (tool.name === READ_TOOL && name === "url");
    const properties = isRecord(schema.properties)
      ? Object.fromEntries(Object.entries(schema.properties).filter(([name]) => !hidden(name)))
      : schema.properties;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((name) => typeof name !== "string" || !hidden(name))
      : schema.required;
    return { ...tool, inputSchema: { ...schema, ...(properties === undefined ? {} : { properties }), ...(required === undefined ? {} : { required }) } };
  });
  return { ...result, tools };
}

/** Drop harness-owned arguments a model sent anyway. */
export function stripHarnessOwnedArguments(params: unknown): unknown {
  if (!isRecord(params) || !isRecord(params.arguments)) return params;
  const kept = Object.entries(params.arguments).filter(([name]) => !HARNESS_OWNED_BROWSER_PARAMS.has(name));
  return kept.length === Object.keys(params.arguments).length ? params : { ...params, arguments: Object.fromEntries(kept) };
}

/** agent-browser's action results carry a `lifecycle` block about the
 * daemon (launch hash, restore status...): about 330 of a click's 420
 * characters. Keep only the fact a model can act on, a relaunched browser,
 * whose pages and refs are gone. Text that is not such a result is unchanged. */
export function withoutLifecycle(text: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return text; }
  if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.data.lifecycle)) return text;
  const { lifecycle, ...data } = parsed.data;
  if (lifecycle.relaunchedBrowser === true) data.browserRelaunched = true;
  return JSON.stringify({ ...parsed, data });
}

/** The URL, title and visible text the runtime reads around an action, and
 * (#4394) whether the page shows a password field or a challenge to solve. */
export interface PageState { url: string; title: string; text: string; password?: boolean; challenge?: boolean }

/** #4394: the elements of a challenge the visitor must solve now: a
 * Cloudflare interstitial, the image challenge of reCAPTCHA (its bframe) or
 * hCaptcha. Never the reCAPTCHA badge or checkbox anchor, an invisible widget
 * or a Turnstile box inside a form: many sites load those on every page and
 * most pass on their own. Counted only when shown at a size a person sees. */
const CHALLENGE_SELECTOR = [
  "#challenge-form", "#cf-challenge-running", "#challenge-stage",
  'iframe[src*="/recaptcha/api2/bframe"]', 'iframe[src*="/recaptcha/enterprise/bframe"]',
  'iframe[src*="hcaptcha.com"][src*="frame=challenge"]',
].join(", ");

/** In-page script for PageState. agent-browser renumbers every @eN ref on
 * each snapshot, so the runtime reads the page with eval, never a snapshot:
 * the refs a model holds keep pointing at the same elements. */
export const OBSERVE_PAGE_SCRIPT =
  "(() => { const shown = (el) => { const box = el.getBoundingClientRect(); const style = getComputedStyle(el); " +
  "return box.width >= 100 && box.height >= 60 && box.bottom > 0 && box.right > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.1; }; " +
  "return JSON.stringify({ url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 200000), " +
  "password: Array.from(document.querySelectorAll('input[type=password]')).some((field) => field.getClientRects().length > 0), " +
  `challenge: Array.from(document.querySelectorAll(${JSON.stringify(CHALLENGE_SELECTOR)})).some(shown) }); })()`;

/** Parse an eval result of OBSERVE_PAGE_SCRIPT: a JSON string inside the
 * result text. Null when the result is anything else. */
export function parsePageState(result: unknown): PageState | null {
  if (!isRecord(result) || result.isError === true || !Array.isArray(result.content)) return null;
  const text = (result.content as unknown[]).find((part) => isRecord(part) && part.type === "text" && typeof part.text === "string") as { text: string } | undefined;
  try {
    let value: unknown = JSON.parse(text?.text ?? "");
    if (typeof value === "string") value = JSON.parse(value);
    if (isRecord(value) && typeof value.url === "string" && typeof value.title === "string" && typeof value.text === "string") {
      return {
        url: value.url, title: value.title, text: value.text,
        ...(value.password === true ? { password: true } : {}),
        ...(value.challenge === true ? { challenge: true } : {}),
      };
    }
  } catch { /* not a page state */ }
  return null;
}

/** #4394: what keeps the bot out of a page. sign-in: the page it opened asks
 * to sign in; challenge: the site tests for a person (CAPTCHA, a "checking
 * your browser" page, unusual traffic); refused: the site refuses the visit. */
export type PageBlockKind = "sign-in" | "challenge" | "refused";
export interface PageBlock { kind: PageBlockKind; host: string }

/** A wall is a short page; a long one is a page to read, whatever it mentions. */
const WALL_TEXT_MAX = 3_000;
/** A title that is the whole wall, with at most a " | site" tail: "One more
 * step to finish your order" or "Verify your email address" is no wall. */
const wholeTitle = (body: string) => new RegExp(`^(?:${body})[\\s.!\u2026]*(?:[|:\u2013\u2014-].*)?$`, "i");
const CHALLENGE_TITLE = wholeTitle("just a moment|attention required!?|security check|verify(?:ing)? (?:that )?you(?:'re| are) (?:a )?human|are you a robot\\??|checking your browser|one more step");
const CHALLENGE_TEXT = /\b(?:verify (?:that )?you(?:'re| are) (?:a )?human|are you a robot|not a robot|unusual traffic|automated (?:queries|requests|access|traffic)|checking your browser|press (?:&|and) hold|complete the security check|enable javascript and cookies to continue)\b/i;
const REFUSED_TITLE = wholeTitle("(?:error )?(?:401(?: unauthorized)?|403(?: forbidden)?|429(?: too many requests)?)|access denied|forbidden|too many requests|request blocked|error 1020");
const REFUSED_TEXT = /\b(?:access denied|you don't have permission to access|request (?:was )?blocked|too many requests|403 forbidden|429 too many requests)\b/i;
const SIGN_IN_PLACE = /(?:log-?in|sign-?in|signin|auth|session|checkpoint|account)/i;
const SIGN_IN_TITLE = /\b(?:log ?in|sign ?in|connexion|se connecter|connecte-toi)\b/i;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") || url; } catch { return url; }
}

/** What blocks the page the runtime just observed, or null. `landing`: the
 * page an open (navigation) reached; a sign-in form met during an action is
 * the bot's own sign-in under way, never a wall. */
export function pageBlock(state: PageState, options: { landing: boolean }): PageBlock | null {
  const host = hostOf(state.url);
  const short = state.text.length <= WALL_TEXT_MAX;
  const title = state.title.trim();
  // A challenge shown at a visible size is one; a title or a sentence only on a short page.
  if (state.challenge || (short && (CHALLENGE_TITLE.test(title) || CHALLENGE_TEXT.test(state.text)))) return { kind: "challenge", host };
  if (short && (REFUSED_TITLE.test(title) || REFUSED_TEXT.test(state.text))) return { kind: "refused", host };
  if (options.landing && state.password && short) {
    let place = "";
    try { place = new URL(state.url).pathname; } catch { /* the title decides */ }
    if (SIGN_IN_PLACE.test(place) || SIGN_IN_TITLE.test(title) || SIGN_IN_TITLE.test(state.text)) return { kind: "sign-in", host };
  }
  return null;
}

/** A result line pageBlockNote wrote. */
export function isPageBlockNote(text: unknown): boolean {
  return typeof text === "string" && /^Sagax: \S+ (?:asks to sign in|is checking for a person|refused the bot's browser)/.test(text);
}

/** The line a blocked page's result opens with: model-facing, so the bot
 * stops at the first wall and tells the person itself what blocks it. */
export function pageBlockNote(block: PageBlock): string {
  if (block.kind === "sign-in") {
    return `Sagax: ${block.host} asks to sign in before this page. If the Sagax vault may hold a login for it, call request_login, then fill_credential. Otherwise call request_sign_in with the site and a short reason, or tell the person in your own words that ${block.host} needs them to sign in, and end your turn. Do not look for a way around the sign-in.`;
  }
  const what = block.kind === "challenge"
    ? `${block.host} is checking for a person (a CAPTCHA or an automation check) and will not let the bot's browser in`
    : `${block.host} refused the bot's browser (access denied)`;
  return `Sagax: ${what}. This is a hard stop for this page: do not try other addresses, reloads, clicks or scripts to get around it. Stop browsing it now and tell the person in your own words what blocks you and what they can do (do it themselves, or sign in and solve the check: request_sign_in with the site and a short reason asks them), then end your turn.`;
}

const CHANGE_LINES = 20;
const CHANGE_CHARS = 1_500;

function visibleLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Lines of `next` that `previous` does not have, counting repeats. */
function linesOnlyIn(next: string[], previous: string[]): string[] {
  const left = new Map<string, number>();
  for (const line of previous) left.set(line, (left.get(line) ?? 0) + 1);
  return next.filter((line) => {
    const count = left.get(line) ?? 0;
    if (count) left.set(line, count - 1);
    return !count;
  });
}

function listLines(lines: string[]): string {
  const shown: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (shown.length === CHANGE_LINES || chars + line.length > CHANGE_CHARS) break;
    shown.push(JSON.stringify(line));
    chars += line.length;
  }
  return shown.join(", ") + (shown.length < lines.length ? ` and ${lines.length - shown.length} more lines` : "");
}

/** What a model needs after an action so it does not read the page back:
 * where the page is now, or which lines of visible text the action added or
 * removed. Text only: it does not prove the action did what was meant. */
export function describePageChange(before: PageState, after: PageState): string {
  if (after.url !== before.url) {
    return `The page is now ${after.url}${after.title ? ` (${JSON.stringify(after.title)})` : ""}. Refs from earlier snapshots do not apply to it; take a snapshot before acting on refs.`;
  }
  const previous = visibleLines(before.text);
  const next = visibleLines(after.text);
  const added = linesOnlyIn(next, previous);
  const removed = linesOnlyIn(previous, next);
  const title = after.title !== before.title ? ` The title is now ${JSON.stringify(after.title)}.` : "";
  if (!added.length && !removed.length) return `The visible text of the page did not change.${title}`;
  return [
    added.length ? `Text that appeared on the page: ${listLines(added)}.` : "",
    removed.length ? `Text that disappeared: ${listLines(removed)}.` : "",
  ].filter(Boolean).join(" ") + title;
}

/** Keep the text form of a result, drop its structured duplicate, and cut
 * oversized text with a marker that says how to ask for less next time. */
export function shapeBrowserToolResult(result: unknown, options: { toolName?: string; budget?: number } = {}): unknown {
  if (!isRecord(result) || !Array.isArray(result.content)) return result;
  const budget = options.budget ?? DEFAULT_BROWSER_RESULT_BUDGET;
  let textParts = 0;
  const content = (result.content as unknown[]).map((part) => {
    if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return part;
    textParts++;
    const outcome = trimResultText({ text: withoutLifecycle(part.text), budget, toolName: options.toolName });
    return { ...part, text: outcome.trimmed ? outcome.text + BROWSER_NARROWING_HINT : outcome.text };
  });
  if (!textParts) return { ...result, content };
  const shaped = { ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== "structuredContent")), content };
  if (result.isError !== true) return shaped;
  const joined = content.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("\n");
  const library = /error while loading shared libraries: ([^:\s]+)/.exec(joined)?.[1];
  if (!library || !joined.startsWith("Chrome exited early (exit code:")) return shaped;
  return {
    ...shaped,
    content: [...content, { type: "text", text: `Chrome is missing the system library ${library}. On Linux, run \`sudo openmausbot browser install --with-deps\`, then retry the browser install as the user running the server.` }],
  };
}

/** Replace held secrets (shared/redact.ts scrubHeldSecrets: saved login
 * passwords, recent one-time codes) in every string of a tool result — its
 * text, a structured copy, an error — so a snapshot, an eval, page text,
 * console or network output never hands a filled password back to the
 * model. Images and binary data are passed through: a screenshot cannot be
 * scrubbed (docs: security/permissions-and-secrets). */
export function scrubBrowserResult(result: unknown, scrub: (text: string) => string, depth = 0): unknown {
  if (typeof result === "string") return scrub(result);
  if (depth > 32 || result === null || typeof result !== "object") return result;
  if (Array.isArray(result)) return result.map((item) => scrubBrowserResult(item, scrub, depth + 1));
  const record = result as Record<string, unknown>;
  const binary = record.type === "image" || record.type === "audio";
  return Object.fromEntries(Object.entries(record).map(([key, value]) =>
    [key, (binary && key === "data") || key === "blob" ? value : scrubBrowserResult(value, scrub, depth + 1)]));
}
