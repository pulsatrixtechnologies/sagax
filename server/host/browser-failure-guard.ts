// Browser failure guard (QA 0.8.67 G4): a bot asked a general question
// (Tailscale vs Pangolin) spent 312 s and 34 steps on a broken sandbox
// browser: browse failed 3 times, fetch_url twice, tab_new, tab_switch and
// tab_wait once each, each call a different one, so the loop guard (same call
// failing the same way) never fired. This guard counts failed web page calls
// of any kind in a row in one turn. At 2 it steers one note: stop the
// browser, answer with what you have (from memory for general knowledge), or
// make one web search at most. At the ceiling it stops the turn and posts a
// clear message in the person's language. A web page call that works resets
// the count; other tools leave it as is.
//
// SAGAX_BROWSER_GUARD=0 turns it off. SAGAX_BROWSER_GUARD_STOP_AT sets the
// ceiling (at least 3; 0 never stops, the note still goes out).
import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import { reportBackgroundError } from "../background-error.ts";

/** Failed web page calls in a row before the note. */
export const BROWSER_STEER_AT = 2;
/** Failed web page calls in a row before the turn is stopped. */
export const BROWSER_STOP_AT = 4;
/** Failed web page calls in one turn, in a row or not, before the turn is stopped. */
export const BROWSER_TURN_FAILURES_MAX = 6;

export type BrowserGuardLanguage = "fr" | "en";

export interface BrowserGuardSettings {
  enabled: boolean;
  /** Undefined: never stops. */
  stopAt?: number;
}

export function browserGuardSettings(env: NodeJS.ProcessEnv = process.env): BrowserGuardSettings {
  if (env.SAGAX_BROWSER_GUARD === "0") return { enabled: false };
  const raw = env.SAGAX_BROWSER_GUARD_STOP_AT?.trim();
  if (raw === "0") return { enabled: true };
  const parsed = raw ? Number(raw) : NaN;
  const stopAt = Number.isInteger(parsed) && parsed > BROWSER_STEER_AT && parsed <= 100 ? parsed : BROWSER_STOP_AT;
  return { enabled: true, stopAt };
}

/** Web search is the fallback the note allows, not a page call. */
const WEB_PAGE_TOOLS = new Set([
  "browse", "fetch_url", "web_fetch", "webfetch", "fetch", "read_page", "web_extract", "open_url", "open_page",
]);

/** The tool a step names, without an MCP server prefix (`mcp__server__tool`, `server__tool`) or call arguments. */
export function bareToolName(title: string | undefined): string {
  const first = (title ?? "").trim().split(/[\s(:]/, 1)[0] ?? "";
  const name = first.includes("__") ? first.slice(first.lastIndexOf("__") + 2) : first.includes(".") ? first.slice(first.lastIndexOf(".") + 1) : first;
  return name.toLowerCase();
}

/** A call that opens, reads or drives a web page: browse, fetch_url, the browser's tab and page tools. */
export function isWebPageTool(title: string | undefined): boolean {
  const name = bareToolName(title);
  if (!name) return false;
  return WEB_PAGE_TOOLS.has(name) || name.startsWith("tab_") || name.startsWith("agent_browser_") || name.startsWith("browser_");
}

/** Opened as `[Sagax: …]`, which model-written text cannot open. */
export function browserStopNote(input: { language?: BrowserGuardLanguage; failures: number; tools: readonly string[] }): string {
  const tools = input.tools.join(", ");
  if (input.language === "fr") {
    return `[Sagax : le navigateur a échoué ${input.failures} fois de suite (${tools}). Arrête d'utiliser le navigateur et fetch_url pour ce tour. Si c'est une question de culture générale, réponds tout de suite de mémoire, sans outil. Sinon, fais au plus une seule recherche web, puis réponds avec ce que tu as et dis en une ligne que le navigateur n'a pas répondu.]`;
  }
  return `[Sagax: the browser failed ${input.failures} times in a row (${tools}). Stop using the browser and fetch_url for this turn. If this is general knowledge, answer now from memory, with no tool. Otherwise make one web search at most, then answer with what you have and say in one line that the browser did not respond.]`;
}

/** The message posted when the ceiling stops the turn. */
export function browserStopMessage(input: { language: BrowserGuardLanguage; failures: number; tools: readonly string[]; notes: readonly string[] }): string {
  const fr = input.language === "fr";
  const tools = input.tools.join(", ");
  const head = fr
    ? `J'ai arrêté ce tour : le navigateur a échoué ${input.failures} fois (${tools}) et je ne relance pas une boucle d'essais.`
    : `I stopped this turn: the browser failed ${input.failures} times (${tools}) and I do not keep retrying it in a loop.`;
  const body = input.notes.length
    ? `${fr ? "Ce que j'avais déjà :" : "What I already had:"}\n\n${input.notes.map((note) => `> ${note.replace(/\n+/g, "\n> ")}`).join("\n\n")}`
    : "";
  const next = fr
    ? "Réponds « réponds sans navigateur » et je te donne une réponse de mémoire ou avec une seule recherche web, ou réessaie plus tard."
    : "Answer \"answer without the browser\" and I reply from memory or with one web search, or try again later.";
  return [head, body, next].filter(Boolean).join("\n\n");
}

export function browserStopCause(input: { language?: BrowserGuardLanguage; failures: number }): string {
  return input.language === "fr"
    ? `le navigateur a échoué ${input.failures} fois ; le tour a été arrêté au lieu de boucler`
    : `the browser failed ${input.failures} times - the turn was stopped instead of looping`;
}

export interface BrowserGuardDeps {
  settings(threadId: string): BrowserGuardSettings;
  /** The conversation is working now: the guard never speaks into an idle one. */
  live(threadId: string): boolean;
  canSteer(threadId: string): boolean;
  steer(threadId: string, note: string): Promise<SteerOutcome>;
  interrupt(threadId: string, cause: string): Promise<unknown>;
  post(threadId: string, text: string): void;
  language(threadId: string): BrowserGuardLanguage;
  log?(line: string): void;
}

export interface BrowserGuard {
  onEvent(event: RuntimeEvent): void;
  settle(threadId: string): void;
}

const NOTES_KEPT = 2;
const NOTE_MAX = 700;
const MAX_ITEMS = 256;
const TOOLS_NAMED = 6;

interface TurnState {
  turnId?: string;
  /** Running web page calls, by item id, with their bare tool name. */
  items: Map<string, string>;
  inRow: number;
  total: number;
  failedTools: string[];
  notes: string[];
  steered: boolean;
  stopped: boolean;
}

export function createBrowserFailureGuard(deps: BrowserGuardDeps): BrowserGuard {
  const turns = new Map<string, TurnState>();
  const log = (line: string) => (deps.log ?? console.info)(`[browser-guard] ${line}`);

  const settle = (threadId: string) => {
    turns.delete(threadId);
  };

  const fresh = (turnId?: string): TurnState => ({
    ...(turnId === undefined ? {} : { turnId }),
    items: new Map(), inRow: 0, total: 0, failedTools: [], notes: [], steered: false, stopped: false,
  });

  const steer = (threadId: string, turn: TurnState) => {
    turn.steered = true;
    if (!deps.canSteer(threadId)) return;
    const note = browserStopNote({ language: deps.language(threadId), failures: turn.inRow, tools: turn.failedTools });
    try {
      void Promise.resolve(deps.steer(threadId, note)).then(
        (outcome) => log(`note ${outcome}: thread=${threadId} failures-in-a-row=${turn.inRow}`),
        () => log(`note rejected: thread=${threadId}`),
      ).catch(reportBackgroundError);
    } catch {
      log(`note rejected: thread=${threadId}`);
    }
  };

  const stop = (threadId: string, turn: TurnState, failures: number) => {
    turn.stopped = true;
    const language = deps.language(threadId);
    let stopping: Promise<unknown>;
    try {
      stopping = Promise.resolve(deps.interrupt(threadId, browserStopCause({ language, failures })));
    } catch {
      return log(`stop not sent: thread=${threadId}`);
    }
    log(`stop sent: thread=${threadId} failures=${failures}`);
    void stopping.then(
      () => deps.post(threadId, browserStopMessage({ language, failures, tools: turn.failedTools, notes: turn.notes })),
      () => log(`stop rejected: thread=${threadId}`),
    ).catch(reportBackgroundError);
  };

  const onEvent = (event: RuntimeEvent) => {
    const { threadId } = event;
    if (event.type === "turn.completed" || event.type === "session.exited") return settle(threadId);
    if (event.type === "turn.started") {
      turns.set(threadId, fresh(event.turnId));
      return;
    }
    let turn = turns.get(threadId);
    if ("turnId" in event && event.turnId !== undefined) {
      if (!turn || (turn.turnId !== undefined && turn.turnId !== event.turnId)) {
        if (event.type !== "item.started") return;
        turns.set(threadId, (turn = fresh(event.turnId)));
      }
    }
    if (!turn || turn.stopped) return;
    if (event.type === "item.completed" && event.itemType === "assistant_text") {
      const text = event.text.trim();
      if (text) {
        turn.notes.push(text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX)}…` : text);
        if (turn.notes.length > NOTES_KEPT) turn.notes.shift();
      }
      return;
    }
    if (event.type === "item.started" && event.itemType === "tool") {
      if (!event.itemId || !isWebPageTool(event.title)) return;
      if (turn.items.size >= MAX_ITEMS) turn.items.delete(turn.items.keys().next().value!);
      turn.items.set(event.itemId, bareToolName(event.title));
      return;
    }
    if (event.type !== "item.completed" || event.itemType !== "tool" || !event.itemId) return;
    const tool = turn.items.get(event.itemId);
    if (tool === undefined) return;
    turn.items.delete(event.itemId);
    if (event.ok) {
      turn.inRow = 0;
      return;
    }
    turn.inRow += 1;
    turn.total += 1;
    if (!turn.failedTools.includes(tool) && turn.failedTools.length < TOOLS_NAMED) turn.failedTools.push(tool);
    const settings = deps.settings(threadId);
    if (!settings.enabled || !deps.live(threadId)) return;
    const overRow = settings.stopAt !== undefined && turn.inRow >= settings.stopAt;
    const overTurn = settings.stopAt !== undefined && turn.total >= Math.max(settings.stopAt, BROWSER_TURN_FAILURES_MAX);
    if (overRow || overTurn) return stop(threadId, turn, overRow ? turn.inRow : turn.total);
    if (!turn.steered && turn.inRow >= BROWSER_STEER_AT) steer(threadId, turn);
  };

  return { onEvent, settle };
}
