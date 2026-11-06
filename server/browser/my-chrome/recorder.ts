// Show a task in my Chrome (#10 of the gap analysis, 2026-10-29): the person
// shows a task once in their own Chrome, Sagax records it as a shown path
// (shared/shown-path.ts), and a bot replays it later.
//
// No extension: the recorder uses My Chrome's own connection (gate.ts
// openRecorderTab). Sagax opens one new tab in front, and only that tab is
// recorded. A script in an isolated world of that tab (the page's own
// scripts cannot reach it) reports the person's trusted clicks, the text
// they typed in fields, Enter and Escape, and the pages they opened. A
// banner in the tab says Sagax records, with Stop.
//
// Privacy, the rules of Teach by demonstration (shared/teach-recording.ts)
// and one more:
// - in a password or secret field the page never sends the value, only that
//   a secret goes there (and, on a secure page, a SHA-256 digest of it);
// - the server checks every field and every text again (isSecretField,
//   looksLikeSecret), and a text whose digest matches a secret typed earlier
//   in the recording (a password pasted into an ordinary field later) is
//   masked too;
// - addresses keep their page, never their credentials (sanitizeTeachUrl);
// - the recording lives in memory only, is dropped when idle, and nothing is
//   logged or written until the person saves the path.
import { createHash, randomUUID } from "node:crypto";

import { TEACH_DESCRIBE_ELEMENT } from "../browser-teach.ts";
import {
  cleanPageText,
  cleanTarget,
  isSecretField,
  looksLikeSecret,
  sanitizeTeachUrl,
  TEACH_MAX_STEPS,
  TEACH_TEXT_MAX,
  type TeachFieldInfo,
  type TeachStep,
} from "../../../shared/teach-recording.ts";
import type { MyChromeRecorderTab } from "./gate.ts";

export const RECORDER_WORLD = "sagax-recorder";
export const RECORDER_BINDING = "__sagaxRecord";
export const RECORDER_BANNER_ID = "sagax-recorder-banner";
/** A recording no one touched for this long is dropped. */
export const MY_CHROME_RECORDING_IDLE_MS = 30 * 60_000;
/** A navigation this soon after a click or a key is that action's result,
 * not a step of its own. */
const FOLLOWS_ACTION_MS = 10_000;

// The field words of shared/teach-recording.ts isSecretField, for the page.
const SECRET_FIELD_SOURCE = "pass(?:word|wd|code|phrase)?|pwd|secret|token|otp|one[\\s_-]?time|2fa|mfa|totp|\\bpin\\b|\\bnip\\b|cvv|cvc|csc|card[\\s_-]?num|cc[\\s_-]?num|\\bssn\\b|\\bnas\\b|api[\\s_-]?key|private[\\s_-]?key|mot[\\s_-]?de[\\s_-]?passe|code[\\s_-]?de[\\s_-]?s[ée]curit[ée]";

/** The script of the recorded tab, in its isolated world. It never sends the
 * value of a secret field. */
export function recorderPageScript(): string {
  return `(() => {
  if (window.__sagaxRecorder) return;
  window.__sagaxRecorder = true;
  const describe = ${TEACH_DESCRIBE_ELEMENT};
  const SECRET = new RegExp(${JSON.stringify(SECRET_FIELD_SOURCE)}, "i");
  const send = (message) => { try { ${RECORDER_BINDING}(JSON.stringify(message)); } catch {} };
  const fr = String(navigator.language || "").toLowerCase().startsWith("fr");
  let host = null;
  const mount = () => {
    const root = document.documentElement;
    if (!root) { setTimeout(mount, 30); return; }
    if (document.getElementById(${JSON.stringify(RECORDER_BANNER_ID)})) return;
    host = document.createElement("sagax-recorder");
    host.id = ${JSON.stringify(RECORDER_BANNER_ID)};
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "all:initial !important;position:fixed !important;z-index:2147483647 !important;right:12px !important;bottom:12px !important;display:block !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;";
    const shadow = host.attachShadow({ mode: "closed" });
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:8px;align-items:center;font:13px/18px -apple-system,system-ui,sans-serif;background:#7f1d1d;color:#fff;padding:6px 8px 6px 12px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.35);";
    const dot = document.createElement("span");
    dot.style.cssText = "width:8px;height:8px;border-radius:999px;background:#f87171;";
    const label = document.createElement("span");
    label.textContent = fr ? "Sagax enregistre ta démarche" : "Sagax is recording what you show";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = fr ? "Arrêter" : "Stop";
    button.style.cssText = "font:inherit;font-weight:600;background:#fff;color:#7f1d1d;border:0;border-radius:999px;padding:2px 12px;cursor:pointer;";
    button.addEventListener("click", (event) => { if (event.isTrusted) send({ t: "stop" }); });
    bar.append(dot, label, button);
    shadow.append(bar);
    root.appendChild(host);
  };
  mount();
  const ours = (event) => Boolean(host) && event.composedPath().includes(host);
  const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1 ? selector : ""; } catch { return ""; } };
  const stableId = (id) => Boolean(id) && id.length <= 60 && !/\\d{3,}|^[0-9]|[:]/.test(id);
  const selectorOf = (el) => {
    const esc = (value) => (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/["\\\\]/g, "\\\\$&");
    const tag = el.tagName.toLowerCase();
    if (stableId(el.id)) { const found = unique("#" + esc(el.id)); if (found) return found; }
    for (const attr of ["data-testid", "data-test", "data-qa", "data-cy"]) {
      const value = el.getAttribute(attr);
      if (value && value.length <= 60) { const found = unique("[" + attr + '="' + esc(value) + '"]'); if (found) return found; }
    }
    const name = el.getAttribute("name");
    if (name && name.length <= 60) { const found = unique(tag + '[name="' + esc(name) + '"]'); if (found) return found; }
    const aria = el.getAttribute("aria-label");
    if (aria && aria.length <= 60) { const found = unique(tag + '[aria-label="' + esc(aria) + '"]'); if (found) return found; }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 5) {
      if (node !== el && stableId(node.id)) { parts.unshift("#" + esc(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return unique(parts.join(" > "));
  };
  const facts = (el) => {
    const described = describe(el);
    const target = { role: described.role, name: described.name, tag: described.tag, selector: selectorOf(described.el) };
    const field = { tag: described.tag, type: described.type, autocomplete: described.autocomplete, fieldName: described.fieldName, fieldId: described.fieldId, name: described.name, sensitive: described.sensitive };
    return { el: described.el, target, field };
  };
  const secretField = (el, field) => {
    const sensitive = el.getAttribute("data-sensitive");
    if (sensitive !== null && sensitive.trim().toLowerCase() !== "false") return true;
    if (el.hasAttribute("data-sagax-sensitive")) return true;
    if ((field.type || "") === "password") return true;
    if ((field.autocomplete || "").toLowerCase().split(/\\s+/).some((token) => token === "current-password" || token === "new-password" || token === "one-time-code" || token.startsWith("cc-"))) return true;
    return [field.fieldName, field.fieldId, field.name].some((value) => value && SECRET.test(value));
  };
  const TEXTUAL = new Set(["", "text", "search", "email", "url", "tel", "number", "password", "date", "time", "datetime-local", "month", "week"]);
  const isField = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") return TEXTUAL.has((el.getAttribute("type") || "").toLowerCase());
    return Boolean(el.isContentEditable);
  };
  const valueOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") { const option = el.selectedOptions && el.selectedOptions[0]; return option ? (option.label || option.text || option.value || "") : ""; }
    if (tag === "input" || tag === "textarea") return el.value || "";
    return el.innerText || "";
  };
  const sent = new WeakMap();
  const digest = async (value) => {
    try {
      if (!window.crypto || !crypto.subtle || value.trim().length < 4) return;
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim()));
      send({ t: "digest", digest: Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("") });
    } catch {}
  };
  const flush = (el) => {
    if (!isField(el)) return;
    const value = valueOf(el);
    if ((sent.get(el) ?? "") === value) return;
    sent.set(el, value);
    const { target, field } = facts(el);
    if (secretField(el, field)) {
      send({ t: "type", url: location.href, target, field, secret: true });
      void digest(value);
      return;
    }
    send({ t: "type", url: location.href, target, field, value: value.slice(0, ${TEACH_TEXT_MAX}) });
  };
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || ours(event) || event.button !== 0) return;
    const el = event.target && event.target.nodeType === 1 ? event.target : null;
    if (!el || el === document.body || el === document.documentElement) return;
    const { el: picked, target } = facts(el);
    // a click that only puts the caret in a field is no step: the typing is
    if (isField(picked) && picked.tagName.toLowerCase() !== "select") return;
    if (picked.tagName.toLowerCase() === "select") return;
    send({ t: "click", url: location.href, target });
  }, true);
  document.addEventListener("change", (event) => {
    if (!event.isTrusted) return;
    flush(event.target);
  }, true);
  document.addEventListener("focusout", (event) => {
    if (!event.isTrusted) return;
    const el = event.target;
    if (el && el.nodeType === 1 && el.isContentEditable) flush(el);
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted || ours(event)) return;
    if (event.key !== "Enter" && event.key !== "Escape" && event.key !== "Tab") return;
    const el = document.activeElement;
    if (el && el !== document.body) flush(el);
    if (event.key === "Tab") return;
    if (event.key === "Enter" && el && (el.tagName === "TEXTAREA" || el.isContentEditable) && !event.metaKey && !event.ctrlKey) return;
    send({ t: "press", key: event.key, url: location.href });
  }, true);
})()`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

export type RecordingEnd = "person" | "tab" | "closed" | "stopped" | "idle";

export interface MyChromeRecordingStatus {
  recording: boolean;
  startedAt: string;
  steps: number;
  /** The last few steps, for the live list in Sagax. */
  recent: TeachStep[];
  /** Why the recording ended, when it did on its own. */
  ended: RecordingEnd | null;
}

interface PageMessage {
  t?: unknown;
  url?: unknown;
  target?: unknown;
  field?: unknown;
  value?: unknown;
  secret?: unknown;
  digest?: unknown;
  key?: unknown;
}

/** One recording in one tab of the person's Chrome. */
export class MyChromeRecording {
  readonly id = randomUUID();
  readonly startedAt = new Date().toISOString();
  touchedAt = Date.now();
  private readonly steps: TeachStep[] = [];
  private readonly digests = new Set<string>();
  private tab: MyChromeRecorderTab | null = null;
  private scriptId = "";
  private endedBy: RecordingEnd | null = null;
  private lastUrl = "";
  private lastActionAt = 0;
  private history: { index: number; length: number } | null = null;
  private readonly onChange: () => void;
  private readonly now: () => number;

  constructor(options: { onChange?: () => void; now?: () => number } = {}) {
    this.onChange = options.onChange ?? (() => undefined);
    this.now = options.now ?? Date.now;
  }

  get ended(): RecordingEnd | null { return this.endedBy; }
  get targetId(): string { return this.tab?.targetId ?? ""; }

  /** Set the tab up, then open the first page (or leave it blank). */
  async start(open: (onEvent: (method: string, params: Record<string, unknown>) => void) => Promise<MyChromeRecorderTab>, url: string): Promise<void> {
    const tab = await open((method, params) => this.onEvent(method, params));
    this.tab = tab;
    try {
      await tab.send("Runtime.addBinding", { name: RECORDER_BINDING, executionContextName: RECORDER_WORLD });
      await tab.send("Runtime.enable");
      await tab.send("Page.enable");
      const script = await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: recorderPageScript(), worldName: RECORDER_WORLD });
      this.scriptId = typeof script.identifier === "string" ? script.identifier : "";
      await tab.send("Page.bringToFront").catch(() => undefined);
      const start = sanitizeTeachUrl(url) ? url : "";
      if (start) await tab.send("Page.navigate", { url: start });
      else await tab.send("Page.createIsolatedWorld", { frameId: tab.targetId, worldName: RECORDER_WORLD }).then((world) => tab.send("Runtime.evaluate", { expression: recorderPageScript(), contextId: world.executionContextId }));
    } catch (error) {
      this.release();
      throw error;
    }
  }

  private push(step: Omit<TeachStep, "id">): void {
    this.touchedAt = this.now();
    if (step.url) this.lastUrl = step.url;
    if (this.steps.length >= TEACH_MAX_STEPS) return;
    this.steps.push({ id: randomUUID(), ...step });
    this.onChange();
  }

  /** A note of the person's narration (typed, or dictated in Sagax). */
  note(text: unknown): boolean {
    const clean = cleanPageText(text, TEACH_TEXT_MAX);
    if (!clean || this.endedBy) return false;
    // a narration line that reads as a credential is not kept
    if (looksLikeSecret(clean) || this.digests.has(sha256(clean))) return false;
    this.push({ kind: "note", text: clean, ...(this.lastUrl ? { url: this.lastUrl } : {}) });
    return true;
  }

  /** What the page reported. Exposed for tests; the binding calls it. */
  fromPage(raw: string): void {
    if (this.endedBy || raw.length > 64 * 1024) return;
    let message: PageMessage;
    try { message = JSON.parse(raw) as PageMessage; } catch { return; }
    if (!message || typeof message !== "object") return;
    const url = sanitizeTeachUrl(message.url);
    switch (message.t) {
      case "stop": void this.stop("tab").catch(() => {}); return;
      case "digest":
        if (typeof message.digest === "string" && /^[0-9a-f]{64}$/.test(message.digest) && this.digests.size < 200) this.digests.add(message.digest);
        return;
      case "click": {
        const target = cleanTarget(message.target);
        this.lastActionAt = this.now();
        this.push({ kind: "click", ...(url ? { url } : this.lastUrl ? { url: this.lastUrl } : {}), ...(target ? { target } : {}) });
        return;
      }
      case "press": {
        const key = message.key === "Escape" ? "Escape" : message.key === "Enter" ? "Enter" : "";
        if (!key) return;
        this.lastActionAt = this.now();
        this.push({ kind: "press", key, ...(url || this.lastUrl ? { url: url || this.lastUrl } : {}) });
        return;
      }
      case "type": {
        const target = cleanTarget(message.target);
        if (!target) return;
        const field = fieldInfo(message.field);
        const text = typeof message.value === "string" ? message.value.slice(0, TEACH_TEXT_MAX) : "";
        const at = url || this.lastUrl;
        const secret = message.secret === true || isSecretField(field) || looksLikeSecret(text) || (text.trim().length >= 4 && this.digests.has(sha256(text)));
        if (secret) { this.push({ kind: "type", ...(at ? { url: at } : {}), target, secret: true }); return; }
        if (!text.trim()) return;
        this.push({ kind: "type", ...(at ? { url: at } : {}), target, text });
        return;
      }
      default:
    }
  }

  private onEvent(method: string, params: Record<string, unknown>): void {
    if (this.endedBy) return;
    if (method === "Runtime.bindingCalled" && params.name === RECORDER_BINDING && typeof params.payload === "string") {
      this.fromPage(params.payload);
      return;
    }
    if (method === "Page.frameNavigated") {
      const frame = (params.frame ?? {}) as { parentId?: unknown; url?: unknown; urlFragment?: unknown };
      if (frame.parentId) return;
      void this.navigated(`${String(frame.url ?? "")}${typeof frame.urlFragment === "string" ? frame.urlFragment : ""}`).catch(() => {});
      return;
    }
    if (method === "Page.navigatedWithinDocument") {
      const clean = sanitizeTeachUrl(params.url);
      if (clean) this.lastUrl = clean;
      return;
    }
    if (method === "Target.targetDestroyed" || method === "Sagax.closed") {
      this.finish(method === "Sagax.closed" ? "stopped" : "closed");
    }
  }

  /** A page of the tab's top frame loaded: an address the person opened, a
   * back, a forward or a reload is a step; the page a click or a key led to
   * is not (the click is). */
  private async navigated(raw: string): Promise<void> {
    const url = sanitizeTeachUrl(raw);
    const tab = this.tab;
    let transition = "";
    let entry: { index: number; length: number } | null = null;
    if (tab) {
      try {
        const history = await tab.send("Page.getNavigationHistory") as { currentIndex?: number; entries?: Array<{ transitionType?: string }> };
        const index = Number(history.currentIndex ?? -1);
        const entries = Array.isArray(history.entries) ? history.entries : [];
        entry = { index, length: entries.length };
        transition = String(entries[index]?.transitionType ?? "");
      } catch { /* the step below still names the page */ }
    }
    const previous = this.history;
    if (entry) this.history = entry;
    if (this.endedBy || !url) return;
    if (previous && entry && entry.length === previous.length && entry.index === previous.index - 1) { this.push({ kind: "back", url }); return; }
    if (previous && entry && entry.length === previous.length && entry.index === previous.index + 1) { this.push({ kind: "forward", url }); return; }
    if (transition === "reload") { this.push({ kind: "reload", url }); return; }
    const followsAction = this.now() - this.lastActionAt < FOLLOWS_ACTION_MS;
    if (this.steps.length && followsAction && transition !== "typed" && transition !== "auto_bookmark") {
      this.lastUrl = url;
      return;
    }
    this.push({ kind: "open", url });
  }

  status(): MyChromeRecordingStatus {
    return {
      recording: this.endedBy === null,
      startedAt: this.startedAt,
      steps: this.steps.length,
      recent: this.steps.slice(-5).map((step) => ({ ...step })),
      ended: this.endedBy,
    };
  }

  private finish(reason: RecordingEnd): void {
    if (this.endedBy) return;
    this.endedBy = reason;
    this.release();
    this.onChange();
  }

  /** Take the banner and the script out of the tab and let it go. The tab
   * stays open: it is the person's. */
  private release(): void {
    const tab = this.tab;
    this.tab = null;
    if (!tab) return;
    const scriptId = this.scriptId;
    void (async () => {
      if (scriptId) await tab.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }).catch(() => undefined);
      await tab.send("Runtime.evaluate", { expression: `(() => { const host = document.getElementById(${JSON.stringify(RECORDER_BANNER_ID)}); if (host) host.remove(); window.__sagaxRecorder = false; })()` }).catch(() => undefined);
      await tab.send("Runtime.removeBinding", { name: RECORDER_BINDING }).catch(() => undefined);
      tab.release();
    })().catch(() => {});
  }

  /** Stop recording (the person, the tab's Stop, idle). */
  async stop(reason: RecordingEnd = "person"): Promise<void> {
    this.finish(reason);
  }

  /** The steps, copied. */
  result(): TeachStep[] {
    return this.steps.map((step) => ({ ...step, ...(step.target ? { target: { ...step.target } } : {}) }));
  }
}

function fieldInfo(value: unknown): TeachFieldInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const str = (key: string, max: number) => typeof record[key] === "string" ? (record[key] as string).slice(0, max) : undefined;
  return {
    tag: str("tag", 20), type: str("type", 40), autocomplete: str("autocomplete", 200),
    fieldName: str("fieldName", 200), fieldId: str("fieldId", 200), name: str("name", 300),
    ...(typeof record.sensitive === "string" ? { sensitive: record.sensitive.slice(0, 40) } : {}),
  };
}
