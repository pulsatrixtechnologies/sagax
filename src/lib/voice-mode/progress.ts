// Short progress lines while the bot works on a call. Pure.
//
// A call turn that runs tools can leave the person in silence for half a
// minute. The call says a short line of its own then, but never a canned
// filler: every line comes from a real tool event of this turn (a tool that
// is still running, how many finished), worded by the app in the call's
// language, never the tool's name, its arguments or an identifier.
//
// Rules (`CallProgress.next`):
// - only while the bot works and nobody talks: the call is "thinking", the
//   bot is not audible, nothing else waits to be said, no approval or
//   question is waiting for the person;
// - the first line of a turn comes when a tool has run PROGRESS_FIRST_MS
//   with nothing said yet: the quick first sentence before a slow step, on
//   every engine (server/voice-first-sentence.ts says why the model's own
//   parallel opener stays with HTTP Grok);
// - later lines need PROGRESS_QUIET_MS of silence and PROGRESS_GAP_MS since
//   the last line, PROGRESS_MAX_LINES per turn;
// - a barge-in stops them until the next turn is sent.
//
// The iPhone has the same rules in Swift (`CallProgress`,
// ios/Sources/CompanionCore/VoiceCall/CallProgress.swift).

import { stripSpokenIdentifiers } from "../../../shared/spoken-identifiers";

export type ProgressKind = "check" | "search" | "web" | "command" | "change" | "screen" | "teammate" | "work";

/** A line to say: what the running tool does, or how far the turn is. */
export type ProgressLine =
  | { kind: ProgressKind }
  | { kind: "still" }
  | { kind: "steps"; count: number };

/** A tool still running this long, with nothing said: the first line. */
export const PROGRESS_FIRST_MS = 1_500;
/** Later lines: this much silence first. */
export const PROGRESS_QUIET_MS = 7_000;
/** At most one line in this window. */
export const PROGRESS_GAP_MS = 9_000;
/** A turn's lines, at most. */
export const PROGRESS_MAX_LINES = 5;

/** Tools that never get a line: their own card or answer is spoken. */
const SILENT_TOOLS = /^(end_call|ask_?user(_?question)?|askuserquestion|request_user_input|todo_?write|update_plan|think|exit_?plan_?mode)$/;

/** Exact names first (the built-in tools of each engine). */
const EXACT: Array<[RegExp, ProgressKind]> = [
  [/^(bash|shell|terminal|run_command|run_terminal_cmd|execute|exec_command|computer_exec|local_shell|powershell)$/, "command"],
  [/^(read|read_file|view|view_file|open_file|cat|ls|list_dir|list_directory|notebookread)$/, "check"],
  [/^(write|write_file|create_file|edit|edit_file|apply_patch|str_replace|str_replace_editor|multiedit|notebookedit)$/, "change"],
  [/^(grep|glob|find|search|codebase_search|file_search|grep_search)$/, "search"],
  [/^(web_?search|websearch|web_?fetch|webfetch|fetch|browse|open_url|navigate)$/, "web"],
  [/^(screenshot|screen|take_screenshot|computer_screenshot)$/, "screen"],
  [/^(click|type_text|press_key|scroll|computer|computer_batch|mouse_move|key)$/, "screen"],
  [/^(list_bots|ask_bot|send_prompt|delegate)$/, "teammate"],
];

/** Otherwise the first verb of a connector tool's name ("find_tickets",
 * "cw_psa__update_ticket", "tickets.list"). */
const VERBS: Array<[RegExp, ProgressKind]> = [
  [/^(search|find|lookup|grep|query)$/, "search"],
  [/^(get|list|read|fetch|describe|check|status|show|view|count|recall|load|download|export|inspect|preview|api)$/, "check"],
  [/^(create|update|write|log|delete|remove|set|add|post|patch|put|send|book|approve|assign|close|move|rename|upload|save|apply|merge|edit|cancel|archive|reply|forward|schedule)$/, "change"],
  [/^(run|exec|execute|invoke|start|restart|deploy|build|test)$/, "command"],
];

/** The kind of work a tool name stands for, or null when the tool never
 * gets a line. Only the category is ever spoken, never the name. */
export function progressKind(toolName: string): ProgressKind | null {
  const name = (toolName ?? "").trim();
  if (!name) return null;
  // chips the harness writes for other things: their own words are spoken
  if (/^(auto-approved|error)\s*:/i.test(name)) return null;
  // mcp__server__tool, server__tool, server.tool: the tool's own part
  const own = name.split(/__|\.|\//).filter(Boolean).at(-1) ?? name;
  const bare = own.toLowerCase();
  if (SILENT_TOOLS.test(bare.replace(/[-\s]/g, "_"))) return null;
  for (const [pattern, kind] of EXACT) if (pattern.test(bare)) return kind;
  const words = own.split(/[_\-\s]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean).map((word) => word.toLowerCase());
  for (const word of words.slice(0, 2)) {
    for (const [pattern, kind] of VERBS) if (pattern.test(word)) return kind;
  }
  return "work";
}

/** One activity row of the call's turn: its id, tool name and outcome
 * (undefined while it runs). */
export interface ProgressTool {
  id: string;
  name: string;
  ok?: boolean;
}

export interface ProgressInput {
  now: number;
  /** The call is in its thinking phase (nobody talks, nothing audible). */
  thinking: boolean;
  botBusy: boolean;
  /** Anything audible or queued on the player (the bot's words, a prompt). */
  botSpeaking: boolean;
  /** An approval or a question waits for the person's answer. */
  awaitingAnswer: boolean;
  /** Something else waits to be said (a settled answer, a notice). */
  queued: boolean;
  /** The activity rows of this turn, oldest first. */
  tools: readonly ProgressTool[];
}

/** One call's progress lines. Feed it the turn's events; ask it on a tick. */
export class CallProgress {
  private turnAt = 0;
  private quietSince = 0;
  private lastLineAt = -Infinity;
  private lines = 0;
  private lastKind: ProgressKind | null = null;
  private lastSteps = 0;
  private said = false;
  private stopped = true;
  private seen = new Map<string, number>();

  /** A new turn was sent: lines may start again. */
  turnSent(now: number): void {
    this.turnAt = now;
    this.quietSince = now;
    this.lastLineAt = -Infinity;
    this.lines = 0;
    this.lastKind = null;
    this.lastSteps = 0;
    this.said = false;
    this.stopped = false;
  }

  /** The bot was heard or wrote words to say: the silence starts over, and
   * the quick first line is no longer needed. */
  heard(now: number): void {
    this.quietSince = now;
    this.said = true;
  }

  /** Barge-in, hang-up, hold: nothing more for this turn. */
  stop(): void {
    this.stopped = true;
  }

  get active(): boolean {
    return !this.stopped;
  }

  /** The line to say now, or null. A returned line counts as said. */
  next(input: ProgressInput): ProgressLine | null {
    const { now } = input;
    for (const tool of input.tools) if (!this.seen.has(tool.id)) this.seen.set(tool.id, now);
    if (input.botSpeaking) {
      this.quietSince = now;
      return null;
    }
    if (this.stopped || !input.botBusy || !input.thinking || input.awaitingAnswer || input.queued) return null;
    if (this.lines >= PROGRESS_MAX_LINES || now - this.lastLineAt < PROGRESS_GAP_MS) return null;
    let running: ProgressTool | undefined;
    let done = 0;
    for (const tool of input.tools) {
      if (tool.ok === undefined) running = tool;
      else done += 1;
    }
    if (!running) return null;
    const kind = progressKind(running.name);
    if (!kind) return null;
    const runningFor = now - (this.seen.get(running.id) ?? now);
    let line: ProgressLine;
    if (this.lines === 0 && !this.said) {
      if (runningFor < PROGRESS_FIRST_MS) return null;
      line = { kind };
    } else {
      if (now - Math.max(this.quietSince, this.turnAt) < PROGRESS_QUIET_MS) return null;
      if (kind !== this.lastKind) line = { kind };
      else if (done >= 2 && done > this.lastSteps) line = { kind: "steps", count: done };
      else line = { kind: "still" };
    }
    this.lines += 1;
    this.lastLineAt = now;
    this.quietSince = now;
    if (line.kind === "steps") this.lastSteps = line.count;
    else if (line.kind !== "still") this.lastKind = line.kind;
    return line;
  }
}

/** The catalog key of a line (src/locales, `voiceMode.progress.*`). */
export function progressKey(line: ProgressLine): `voiceMode.progress.${ProgressLine["kind"]}` {
  return `voiceMode.progress.${line.kind}`;
}

/** The words of a line, through the call language's catalog. A language
 * without these words says nothing (silence beats the wrong language). */
export function progressText(
  line: ProgressLine,
  translate: (key: ReturnType<typeof progressKey>, params?: Record<string, string | number>) => string | null,
): string | null {
  const text = translate(progressKey(line), line.kind === "steps" ? { count: line.count } : undefined);
  if (!text) return null;
  // the words are the app's own, but a pack is still text: never an id
  const clean = stripSpokenIdentifiers(text).replace(/\s+/g, " ").trim();
  return clean || null;
}

/** The call's language for the app's own words: the one chosen for the
 * call; on auto, a page in English or French follows the person's last
 * words (French or not), any other page language is kept (the French guess
 * only tells French from English). On auto, `sticky` (the locale already
 * settled on this call) is kept so the spoken lines do not flip French and
 * English turn to turn; a language picked in the panel always wins. */
export function progressLocale(opts: { callLanguage?: string; lastUserText?: string; pageLocale: string; looksFrench: (text: string) => boolean; sticky?: string }): string {
  const chosen = opts.callLanguage?.trim();
  if (chosen && chosen !== "auto") return chosen.toLowerCase();
  if (opts.sticky === "fr" || opts.sticky === "en") return opts.sticky;
  const page = opts.pageLocale.toLowerCase();
  const enOrFr = /^(en|fr)(?:-|$)/.test(page);
  const last = opts.lastUserText?.trim();
  if (!enOrFr || !last) return page;
  return opts.looksFrench(last) ? "fr" : "en";
}

type TurnMessage = {
  id: string;
  role?: string;
  kind?: string;
  tool?: { name?: string; ok?: boolean };
  parallelTask?: unknown;
  from?: { botId?: string };
};

/** The current turn's activity rows, newest first: those after the person's
 * last own line (a parallel task's rows are another topic's work). */
function turnRows<M extends TurnMessage>(messages: ReadonlyArray<M>): M[] {
  const out: M[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && !message.parallelTask) break;
    if (message.kind !== "activity" || !message.tool?.name || message.parallelTask) continue;
    out.push(message);
  }
  return out;
}

/** The activity rows of the call's current turn: those after the person's
 * last own line (a parallel task's rows are another topic's work). */
export function turnTools(messages: ReadonlyArray<TurnMessage>): ProgressTool[] {
  return turnRows(messages)
    .map((message) => ({ id: message.id, name: message.tool!.name!, ...(typeof message.tool!.ok === "boolean" ? { ok: message.tool!.ok } : {}) }))
    .reverse();
}

/** A room turn may reach several bots: the one bot whose tools are all of
 * this turn's rows, or null when they are several (or none is named). A
 * progress line is only said in a bot's voice when it is that bot's work;
 * otherwise it is said in the call's own voice, never another bot's. */
export function turnToolAuthor(messages: ReadonlyArray<TurnMessage>): string | null {
  const bots = new Set<string | undefined>(turnRows(messages).map((message) => message.from?.botId));
  if (bots.size !== 1) return null;
  return [...bots][0] ?? null;
}
