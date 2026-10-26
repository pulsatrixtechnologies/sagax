// Teach by demonstration on the bot's whole computer (parity R7, system 11,
// chat 71, iOS C12), next to the browser recorder (server/browser-teach.ts).
// While the person holds control of the bot's computer, the desktop viewer
// reports their clicks (where, as fractions of the screen), Enter, Tab and
// Escape, and that they type: never what. The server adds the focused
// window's title to a click. The steps come back once, as screen steps
// (shared/teach-recording.ts) the person edits and saves as a skill.
//
// In memory only, one recording per person and bot, dropped when stopped,
// discarded or left idle. Nothing here is logged or written.
import { randomUUID } from "node:crypto";

import { cleanPoint, cleanWindowName, TEACH_MAX_STEPS, type TeachStep } from "../shared/teach-recording.ts";

/** A recording no one touched for this long is dropped. */
export const COMPUTER_TEACH_IDLE_MS = 30 * 60_000;

/** The focused window is asked at most this often; a click sooner reuses the last title. */
export const WINDOW_LOOKUP_MS = 500;
/** More events than this in one second are refused (a script, not a person). */
export const TEACH_EVENTS_PER_SECOND = 20;

/** The one command a click runs on the bot's computer: the focused window's
 * title, a moment after the click lands. Fixed text, read only. */
export const FOCUSED_WINDOW_COMMAND = "sleep 0.2; xdotool getwindowfocus getwindowname 2>/dev/null | head -n 1";

export class ComputerTeachRecorder {
  readonly startedAt: string;
  touchedAt: number;
  private readonly steps: TeachStep[] = [];
  private typing: TeachStep | null = null;
  private window = "";
  private lastLookup = -Infinity;
  private recent: number[] = [];

  constructor(now = Date.now()) {
    this.startedAt = new Date(now).toISOString();
    this.touchedAt = now;
  }

  private push(step: Omit<TeachStep, "id">): void {
    if (this.steps.length >= TEACH_MAX_STEPS) return;
    this.steps.push({ id: randomUUID(), ...step });
  }

  private closeTyping(): void {
    if (this.typing && this.steps.length < TEACH_MAX_STEPS) this.steps.push(this.typing);
    this.typing = null;
  }

  /** No room for another step: nothing more is asked of the computer. */
  get full(): boolean {
    return this.steps.length + (this.typing ? 1 : 0) >= TEACH_MAX_STEPS;
  }

  /** Count one event; false past TEACH_EVENTS_PER_SECOND in the last second. */
  allowEvent(now = Date.now()): boolean {
    this.recent = this.recent.filter((at) => now - at < 1_000);
    if (this.recent.length >= TEACH_EVENTS_PER_SECOND) return false;
    this.recent.push(now);
    return true;
  }

  /** Whether this click may ask the computer for the focused window (and
   * counts as that lookup); otherwise it reuses the last title. */
  takeWindowLookup(now = Date.now()): boolean {
    if (now - this.lastLookup < WINDOW_LOOKUP_MS) return false;
    this.lastLookup = now;
    return true;
  }

  /** `window` null: not asked this time, the last title stands. */
  click(point: { x: number; y: number }, window: string | null, now = Date.now()): void {
    this.touchedAt = now;
    this.closeTyping();
    if (window !== null) this.window = cleanWindowName(window);
    const at = cleanPoint(point);
    this.push({ kind: "click", screen: true, ...(at ? { point: at } : {}), ...(this.window ? { window: this.window } : {}) });
  }

  /** The person types: one secret text step until the next click or key. */
  typed(now = Date.now()): void {
    this.touchedAt = now;
    if (this.typing) return;
    this.typing = { id: randomUUID(), kind: "type", screen: true, secret: true, ...(this.window ? { window: this.window } : {}) };
  }

  press(key: "Enter" | "Tab" | "Escape", now = Date.now()): void {
    this.touchedAt = now;
    this.closeTyping();
    this.push({ kind: "press", screen: true, key, ...(this.window ? { window: this.window } : {}) });
  }

  get count(): number {
    return this.steps.length + (this.typing ? 1 : 0);
  }

  finish(): TeachStep[] {
    this.closeTyping();
    return this.steps.map((step) => ({ ...step, ...(step.point ? { point: { ...step.point } } : {}) }));
  }
}

export class ComputerTeachRecordings {
  private readonly recordings = new Map<string, ComputerTeachRecorder>();
  private key(owner: string, botId: string): string { return `${owner}\n${botId}`; }

  get(owner: string, botId: string, now = Date.now()): ComputerTeachRecorder | undefined {
    const key = this.key(owner, botId);
    const recorder = this.recordings.get(key);
    if (recorder && now - recorder.touchedAt > COMPUTER_TEACH_IDLE_MS) {
      this.recordings.delete(key);
      return undefined;
    }
    return recorder;
  }

  start(owner: string, botId: string, now = Date.now()): ComputerTeachRecorder {
    const recorder = new ComputerTeachRecorder(now);
    this.recordings.set(this.key(owner, botId), recorder);
    return recorder;
  }

  stop(owner: string, botId: string, now = Date.now()): { steps: TeachStep[]; recordedAt: string } | null {
    const recorder = this.get(owner, botId, now);
    this.recordings.delete(this.key(owner, botId));
    return recorder ? { steps: recorder.finish(), recordedAt: recorder.startedAt } : null;
  }

  discard(owner: string, botId: string): void { this.recordings.delete(this.key(owner, botId)); }
  discardBot(botId: string): void { for (const key of this.recordings.keys()) if (key.endsWith(`\n${botId}`)) this.recordings.delete(key); }
  get size(): number { return this.recordings.size; }
}
