// Browser failure guard (QA 0.8.67 G4): a bot asked a general question
// (Tailscale vs Pangolin) spent 312 s and 34 steps on a broken sandbox
// browser: browse failed 3 times, fetch_url twice, tab_new, tab_switch and
// tab_wait once each, each call a different one, so the loop guard (same call
// failing the same way) never fired. This guard counts failed web page calls
// of any kind in a row in one turn. At 2 it steers one note: do not repeat
// the call, stop browsing when a site keeps the bot out and say so in the
// bot's own words, answer general knowledge from memory or with one web
// search at most. Only failures in a row count: a web page call
// that works resets the count; other tools leave it as is.
//
// #4394 (2026-11-15): the stop at 4 failures in a row is gone. It interrupted
// the turn and posted a message the server wrote in the bot's name, which no
// decision of the owner asked for (QA 0.8.67 G4, #2962); only the bot's own
// words reach the person. On an engine that takes no steered note (ACP), the
// note never arrived and the stop was all that ended the loop, after 41 steps.
// The built-in browser now says it in its own results and errors (a page that
// keeps the bot out, two failures in a row; server/browser/browser-runtime.ts),
// on every engine. The guard steers whenever no failed result of the turn
// carried the note: a failure before the browser runtime (an environment not
// up yet), an engine whose tool output leaves it out, any other page tool.
//
// Each failed web page step logs one line with its tool and its own error
// text (redacted, first line only, cut short, never the page), so the next
// long run can be explained from the log (#4394).
//
// SAGAX_BROWSER_GUARD=0 turns it off.
import type { RuntimeEvent, SteerOutcome } from "../contracts.ts";
import { reportBackgroundError } from "../background-error.ts";
import { isPageBlockNote } from "../browser/browser-tool-shape.ts";
import { redactSecretsInText } from "../../shared/redact.ts";

/** Failed web page calls in a row before the note. */
export const BROWSER_STEER_AT = 2;

export type BrowserGuardLanguage = "fr" | "en";

export interface BrowserGuardSettings {
  enabled: boolean;
}

export function browserGuardSettings(env: NodeJS.ProcessEnv = process.env): BrowserGuardSettings {
  return { enabled: env.SAGAX_BROWSER_GUARD !== "0" };
}

/** Web search is the fallback the note allows, not a page call. */
const WEB_PAGE_TOOLS = new Set([
  "browse", "fetch_url", "web_fetch", "webfetch", "fetch", "read_page", "web_extract", "open_url", "open_page",
]);
/** Generic names (navigate, computer, find…) are page calls only under a browser server prefix. */
const BROWSER_SERVER = /(^|[_-])(chrome|chromium|browser|playwright|puppeteer)([_-]|$)/;

/** The tool a step names, without an MCP server prefix (`mcp__server__tool`, `server__tool`) or call arguments. */
export function bareToolName(title: string | undefined): string {
  return splitToolName(title).name;
}

function splitToolName(title: string | undefined): { server: string; name: string } {
  const first = (title ?? "").trim().split(/[\s(:]/, 1)[0] ?? "";
  const cut = first.includes("__") ? first.lastIndexOf("__") : first.includes(".") ? first.lastIndexOf(".") : -1;
  if (cut < 0) return { server: "", name: first.toLowerCase() };
  const width = first.startsWith("__", cut) ? 2 : 1;
  return { server: first.slice(0, cut).toLowerCase(), name: first.slice(cut + width).toLowerCase() };
}

/** Page tools the chat engine still names when it joins the server with one `_`
 * (chatToolName: `sagax_environment_browse`, `sagax_computer_fetch_url`).
 * Generic words (fetch) stay exact names only: `git_fetch` is no page call. */
const WEB_PAGE_SUFFIXES = ["browse", "fetch_url", "web_fetch", "read_page", "web_extract", "open_url", "open_page"].map((tool) => `_${tool}`);

/** A call that opens, reads or drives a web page: browse, fetch_url, the browser's tab and page tools, any tool of a browser MCP server (claude-in-chrome, playwright, puppeteer).
 * Titles come as a bare name, `mcp__server__tool` (Claude, Codex), `server.tool`, or the chat engine's
 * `server_tool` with one underscore (Grok and every chat-completions engine). */
export function isWebPageTool(title: string | undefined): boolean {
  const { server, name } = splitToolName(title);
  if (!name) return false;
  if (WEB_PAGE_TOOLS.has(name)) return true;
  // Web search is the fallback, whatever server serves it (`browser_search_web_search`).
  if (name.includes("search")) return false;
  if (name.startsWith("tab_") || name.startsWith("tabs_") || name.startsWith("browser_") || name.includes("agent_browser_")) return true;
  if (WEB_PAGE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  // No server cut: a chat engine title carries its server inside the name (`claude_in_chrome_navigate`).
  return BROWSER_SERVER.test(server ? server.replace(/^mcp__/, "") : name);
}

/** Opened as `[Sagax: …]`, which model-written text cannot open. The same
 * words whether the built-in browser puts them in a result or the guard
 * steers them (isBrowserStopNote finds both). */
export function browserStopNote(input: { language?: BrowserGuardLanguage; failures: number; tools: readonly string[] }): string {
  const tools = input.tools.join(", ");
  if (input.language === "fr") {
    return `[Sagax : ${input.failures} appels de page web ont échoué de suite (${tools}). Ne refais pas le même appel. Lis l'erreur : si un site te bloque ou si le navigateur ne marche pas, arrête de naviguer pour ce tour et dis à la personne, dans tes mots, ce qui te bloque et ce qu'elle peut faire. Si c'est une question de culture générale, réponds de mémoire, sans outil, ou fais au plus une seule recherche web.]`;
  }
  return `[Sagax: ${input.failures} web page calls failed in a row (${tools}). Do not repeat the same call. Read the error: if a site keeps you out or the browser does not work, stop browsing for this turn and tell the person in your own words what blocks you and what they can do. If this is general knowledge, answer from memory with no tool, or make one web search at most.]`;
}

/** A tool result or error that already carries a browser note: the stop note
 * above, or a page block note of the built-in browser. */
export function carriesBrowserNote(text: string | undefined): boolean {
  if (!text) return false;
  return /\[Sagax ?: \d+ (?:web page calls failed in a row|appels de page web ont échoué de suite)/.test(text) ||
    text.split("\n").some((line) => isPageBlockNote(line.trim()));
}

const ERROR_TEXT_MAX = 160;

/** A failed step's own error for the log: the first line that is not a
 * browser note, secrets masked (held values and key shapes), one line, cut
 * short. The rest of the output (a page's text) never reaches the log. */
export function failedStepErrorText(output: string | undefined): string {
  const lines = (output ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines.find((line) => !carriesBrowserNote(line)) ?? "";
  const text = redactSecretsInText(first).replace(/\s+/g, " ");
  return text.length > ERROR_TEXT_MAX ? `${text.slice(0, ERROR_TEXT_MAX)}…` : text || "(no error text)";
}

export interface BrowserGuardDeps {
  settings(threadId: string): BrowserGuardSettings;
  /** The conversation is working now: the guard never speaks into an idle one. */
  live(threadId: string): boolean;
  canSteer(threadId: string): boolean;
  steer(threadId: string, note: string): Promise<SteerOutcome>;
  language(threadId: string): BrowserGuardLanguage;
  log?(line: string): void;
}

export interface BrowserGuard {
  onEvent(event: RuntimeEvent): void;
  settle(threadId: string): void;
}

const MAX_ITEMS = 256;
const TOOLS_NAMED = 6;

interface TurnState {
  turnId?: string;
  /** Running web page calls, by item id, with their bare tool name. */
  items: Map<string, string>;
  inRow: number;
  failedTools: string[];
  /** A failed result of this turn already carried the note (the built-in
   * browser puts it in its own results, on every engine). */
  noted: boolean;
  steered: boolean;
}

export function createBrowserFailureGuard(deps: BrowserGuardDeps): BrowserGuard {
  const turns = new Map<string, TurnState>();
  const log = (line: string) => (deps.log ?? console.info)(`[browser-guard] ${line}`);

  const settle = (threadId: string) => {
    turns.delete(threadId);
  };

  const fresh = (turnId?: string): TurnState => ({
    ...(turnId === undefined ? {} : { turnId }),
    items: new Map(), inRow: 0, failedTools: [], noted: false, steered: false,
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
    if (!turn) return;
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
    if (carriesBrowserNote(event.output)) turn.noted = true;
    log(`step failed: thread=${threadId} tool=${tool} failures-in-a-row=${turn.inRow} error=${JSON.stringify(failedStepErrorText(event.output))}`);
    if (!turn.failedTools.includes(tool) && turn.failedTools.length < TOOLS_NAMED) turn.failedTools.push(tool);
    const settings = deps.settings(threadId);
    if (!settings.enabled || !deps.live(threadId)) return;
    if (!turn.steered && !turn.noted && turn.inRow >= BROWSER_STEER_AT) steer(threadId, turn);
  };

  return { onEvent, settle };
}
