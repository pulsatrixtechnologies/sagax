// The recorder behind Teach by demonstration (shared/teach-recording.ts).
// It sees only what the person does through the live browser view
// (server/browser/browser-live.ts): their clicks, keys and toolbar commands, never
// the bot's own tool calls. It lives in memory only, belongs to one person
// and one browser session, and is dropped when it is stopped, discarded,
// left idle, or the person signs out. Nothing here is logged or written.

import { randomUUID } from "node:crypto";
import {
  cleanTarget,
  isSecretField,
  looksLikeSecret,
  sanitizeTeachUrl,
  TEACH_MAX_STEPS,
  TEACH_TEXT_MAX,
  type TeachFieldInfo,
  type TeachStep,
  type TeachTarget,
} from "../../shared/teach-recording.ts";

/** A recording no one touched for this long is dropped. */
export const TEACH_IDLE_MS = 30 * 60_000;
/** A recording whose person closed every view of that browser is dropped
 * after this grace, which covers a reconnect but not a closed window. */
export const TEACH_ORPHAN_MS = 2 * 60_000;

/** A page function (as source) that describes one element the way the
 * recorders keep it: role, accessible name, tag and the field facts that
 * decide whether typed text may be kept. It never reads a field's value.
 * Shared by the live view's recorder (teachDescribeScript) and the My Chrome
 * recorder (server/browser/my-chrome/recorder.ts). */
export const TEACH_DESCRIBE_ELEMENT = `function (el) {
  const pick = 'a[href],button,input,select,textarea,summary,label,option,[role],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]';
  el = (el.closest && el.closest(pick)) || el;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const text = (node) => (node && (node.innerText || node.textContent) || '').replace(/\\s+/g, ' ').trim();
  let role = el.getAttribute('role') || '';
  if (!role) {
    if (tag === 'a') role = 'link';
    else if (tag === 'button' || tag === 'summary') role = 'button';
    else if (tag === 'select') role = 'combobox';
    else if (tag === 'textarea' || el.isContentEditable) role = 'textbox';
    else if (tag === 'option') role = 'option';
    else if (/^h[1-6]$/.test(tag)) role = 'heading';
    else if (tag === 'img') role = 'img';
    else if (tag === 'input') role = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox' }[type] || 'textbox';
  }
  let name = el.getAttribute('aria-label') || '';
  if (!name && el.getAttribute('aria-labelledby')) name = el.getAttribute('aria-labelledby').split(/\\s+/).map((id) => text(document.getElementById(id))).join(' ');
  if (!name && el.id && window.CSS && CSS.escape) name = text(document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
  if (!name && el.closest) { const label = el.closest('label'); if (label && label !== el) name = text(label); }
  if (!name) name = el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
  if (!name && (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' || role === 'option' || role === 'heading' || tag === 'label')) name = text(el);
  if (!name && tag === 'input' && (type === 'submit' || type === 'button' || type === 'reset')) name = el.getAttribute('value') || '';
  return { el, tag, role, name: String(name).slice(0, 300), type, autocomplete: el.getAttribute('autocomplete') || '', fieldName: el.getAttribute('name') || '', fieldId: el.id || '', sensitive: el.getAttribute('data-sensitive') };
}`;

/** What the page says about the element under a point (or the focused one).
 * Runs in the page through the engine's eval. It reads roles, names and the
 * field's kind, never a field's value. */
export function teachDescribeScript(point?: { x: number; y: number }): string {
  const at = point ? `[${Math.round(point.x)}, ${Math.round(point.y)}]` : "null";
  return `(() => {
  const at = ${at};
  let el = at ? document.elementFromPoint(at[0], at[1]) : document.activeElement;
  const base = { url: location.href };
  if (!el || el === document.body || el === document.documentElement) return JSON.stringify(base);
  const { el: _el, ...described } = (${TEACH_DESCRIBE_ELEMENT})(el);
  return JSON.stringify({ ...base, ...described });
})()`;
}

/** The element as the recorder keeps it, plus the field facts that decide
 * whether typed text may be kept. Null for anything malformed. */
export interface DescribedElement { url: string; target?: TeachTarget; field: TeachFieldInfo | null }

export function parseDescribedElement(result: unknown): DescribedElement | null {
  let value = result;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const str = (key: string, max: number) => typeof record[key] === "string" ? (record[key] as string).slice(0, max) : undefined;
  const target = cleanTarget(record);
  return {
    url: sanitizeTeachUrl(record.url),
    ...(target ? { target } : {}),
    field: target ? { tag: str("tag", 20), type: str("type", 40), autocomplete: str("autocomplete", 200), fieldName: str("fieldName", 200), fieldId: str("fieldId", 200), name: target.name, ...(typeof record.sensitive === "string" ? { sensitive: record.sensitive.slice(0, 40) } : {}) } : null,
  };
}

/** One person's recording in one browser session. */
export class TeachRecorder {
  readonly startedAt = new Date().toISOString();
  touchedAt = Date.now();
  /** When the person's last view of this browser closed, if it did. */
  orphanedAt: number | null = null;
  private readonly steps: TeachStep[] = [];
  /** The text step being typed, closed by a click, a key or a command. */
  private typing: { step: Omit<TeachStep, "id">; nowhere: boolean; secret: boolean; unknown: boolean; text: string; typed: boolean } | null = null;
  private lastUrl = "";

  private push(step: Omit<TeachStep, "id">): void {
    this.touchedAt = Date.now();
    if (step.url) this.lastUrl = step.url;
    if (this.steps.length >= TEACH_MAX_STEPS) return;
    this.steps.push({ id: randomUUID(), ...step });
  }

  /** Close the text step being typed: its text is kept only when the field
   * is not a secret one and the text does not read as a credential. */
  private closeTyping(): void {
    const typing = this.typing;
    this.typing = null;
    if (!typing || typing.nowhere) return;
    const { step, text } = typing;
    // a field the page could not describe never keeps its text
    if (typing.secret || typing.unknown || looksLikeSecret(text)) {
      if (!typing.typed) return;
      this.push({ ...step, secret: true });
      return;
    }
    if (!text) return;
    this.push({ ...step, text });
  }

  get typingOpen(): boolean { return this.typing !== null; }

  click(element: DescribedElement | null): void {
    this.closeTyping();
    this.push({ kind: "click", url: element?.url || this.lastUrl || undefined, ...(element?.target ? { target: element.target } : {}) });
  }

  /** The person starts typing in the focused field. */
  beginTyping(element: DescribedElement | null): void {
    this.closeTyping();
    this.touchedAt = Date.now();
    const url = element?.url || this.lastUrl;
    if (url) this.lastUrl = url;
    this.typing = {
      step: { kind: "type", ...(url ? { url } : {}), ...(element?.target ? { target: element.target } : {}) },
      // keys pressed on the page itself (no field focused) are no text step;
      // a page that could not be asked counts as a secret field
      nowhere: element !== null && !element.target,
      secret: isSecretField(element?.field), unknown: element === null, text: "", typed: false,
    };
  }

  /** Typed characters. In a secret field nothing is kept, not even a length. */
  type(text: string): void {
    this.touchedAt = Date.now();
    const typing = this.typing;
    if (!typing) return;
    typing.typed = true;
    if (typing.nowhere || typing.secret || typing.unknown) return;
    typing.text = (typing.text + text).slice(0, TEACH_TEXT_MAX);
  }

  backspace(): void {
    this.touchedAt = Date.now();
    if (this.typing && !this.typing.secret && !this.typing.unknown) this.typing.text = this.typing.text.slice(0, -1);
  }

  /** Enter, Tab or Escape: ends the text and is a step of its own. */
  press(key: string): void {
    this.closeTyping();
    this.push({ kind: "press", key, ...(this.lastUrl ? { url: this.lastUrl } : {}) });
  }

  /** A toolbar command: an address, back, forward, reload or a new tab. */
  command(kind: "open" | "back" | "forward" | "reload" | "tab", url?: string): void {
    this.closeTyping();
    const clean = url ? sanitizeTeachUrl(url) : "";
    this.push({ kind, ...(clean ? { url: clean } : {}) });
  }

  /** The page moved (a stream URL event): later steps happen there. */
  observeUrl(url: string): void {
    const clean = sanitizeTeachUrl(url);
    if (clean) this.lastUrl = clean;
  }

  finish(): TeachStep[] {
    this.closeTyping();
    return this.steps.map((step) => ({ ...step, ...(step.target ? { target: { ...step.target } } : {}) }));
  }
}

/** Recordings by person and browser session, with the idle sweep. */
export class TeachRecordings {
  private readonly recordings = new Map<string, TeachRecorder>();
  private key(owner: string, session: string): string { return `${owner}\n${session}`; }

  get(owner: string, session: string, now = Date.now()): TeachRecorder | undefined {
    const key = this.key(owner, session);
    const recorder = this.recordings.get(key);
    if (recorder && (now - recorder.touchedAt > TEACH_IDLE_MS || (recorder.orphanedAt !== null && now - recorder.orphanedAt > TEACH_ORPHAN_MS))) {
      this.recordings.delete(key);
      return undefined;
    }
    return recorder;
  }

  start(owner: string, session: string): TeachRecorder {
    const recorder = new TeachRecorder();
    this.recordings.set(this.key(owner, session), recorder);
    return recorder;
  }

  /** Stop: the steps once, and the recording is gone. */
  stop(owner: string, session: string): TeachStep[] | null {
    const recorder = this.get(owner, session);
    this.recordings.delete(this.key(owner, session));
    return recorder ? recorder.finish() : null;
  }

  discard(owner: string, session: string): void { this.recordings.delete(this.key(owner, session)); }
  /** The person has no view of this browser left (or has one again). */
  orphan(owner: string, session: string, orphaned: boolean, now = Date.now()): void {
    const recorder = this.get(owner, session, now);
    if (recorder) recorder.orphanedAt = orphaned ? now : null;
  }
  discardOwner(owner: string): void { for (const key of this.recordings.keys()) if (key.startsWith(`${owner}\n`)) this.recordings.delete(key); }
  discardSession(session: string): void { for (const key of this.recordings.keys()) if (key.endsWith(`\n${session}`)) this.recordings.delete(key); }
  get size(): number { return this.recordings.size; }
}
