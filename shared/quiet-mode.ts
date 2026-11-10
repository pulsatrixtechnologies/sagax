// #3480: quiet mode. A person tells a bot, or all their bots at once, to be
// quiet: the bot works out of the main chat and reaches the person only when
// it needs their answer.
//
// While it is on, a bot's routines, wakes and background work post nothing
// in the main conversation (no result row, no problem row, no trace row),
// ring nothing and mark nothing unread. What needs the person's answer (a
// question, an approval, an item only they can do) still shows, as the card
// pinned at the bottom of the chat, without a sound. Every run stays listed
// in its routine's runs with its outcome. When quiet mode goes off, one line
// in the bot's chat says how many runs were kept quiet, how many of them had
// problems, and where to see them. Turning it off gives each routine its own
// "Post results in the conversation" back: quiet mode never rewrites it.
//
// One notion of quiet, not a third one. Sagax already had two:
// - quiet hours (shared/signal-levels.ts): a time window of the person in
//   which card-level pushes wait for the next brief. Rows still post; only
//   the push waits.
// - a wake kind's feedback level (server/proactive/background-brief.ts,
//   wakeLevel): "muted" posts nothing, "quiet" posts the card without ringing
//   or marking it unread, "normal" posts and rings.
// Quiet mode is the person's word for those same levels over a whole bot:
// a background report is "muted" (nothing posts), what needs the person is
// at most "quiet" (the card shows, never rings), whatever the wake feedback
// says (quietModeLevel). Its pushes are silenced through the existing
// `notify: false` of shared/notification.ts, not a new flag. Quiet hours stay
// as they are and still apply to the bots that are not in quiet mode.
//
// The setting: per bot (`bot`), and once for all the person's bots (`all`).
// A bot is in quiet mode when either is on. A person sets it for their own
// bots: no admin gate, no confirmation, no limit.

import type { Notification, NotifyKind } from "./notification.ts";

/** GET the person's all-bots switch and each of their bots' state; PUT
 * `QuietModeWrite` sets the all-bots switch. */
export const QUIET_MODE_PERSON_PATH = "/api/me/quiet";

/** GET one bot's state; PUT `QuietModeWrite` sets that bot's own switch. */
export function quietModeBotPath(botId: string): string {
  return `/api/bots/${encodeURIComponent(botId)}/quiet`;
}

/** The bot route, matched on the request path (the id is URL-encoded). */
export const QUIET_MODE_BOT_ROUTE = /^\/api\/bots\/([^/]+)\/quiet$/;

/** What quiet mode kept out of the chat since it went on. */
export interface QuietKept {
  /** Runs that ended while quiet and would have posted in the chat. */
  runs: number;
  /** Of those, the ones that failed, were blocked or ended with problems. */
  problems: number;
  /** When quiet mode went on (ms), when it is on. */
  since?: number;
}

/** One bot's quiet mode, as the bot's page reads it. */
export interface BotQuietState {
  botId: string;
  /** The bot's own switch. */
  bot: boolean;
  /** The person's switch for all their bots. */
  all: boolean;
  /** Whether the bot is quiet now: `bot` or `all`. */
  quiet: boolean;
  kept: QuietKept;
}

/** The answer of the bot route (GET and PUT). */
export interface BotQuietView extends BotQuietState {
  /** PUT: the one line the bot says when it changed its own mode. */
  said?: string;
  /** PUT that turned quiet mode off: the line written in the bot's chat. */
  summary?: string;
}

/** The answer of the person route (GET and PUT). */
export interface PersonQuietView {
  /** The person's switch for all their bots. */
  all: boolean;
  /** Each of the person's bots. */
  bots: BotQuietState[];
  /** PUT: the one line the bot says when it changed the mode. */
  said?: string;
}

/** The body of a PUT on either route. `via` is "words" when a bot set it
 * because its person told it to, "switch" (the default) from a screen. */
export interface QuietModeWrite {
  on: boolean;
  via?: "switch" | "words";
}

/** The PUT body, or why it is not one. */
export function parseQuietModeWrite(body: unknown): QuietModeWrite | string {
  const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const on = input?.on === true || input?.on === "true" ? true : input?.on === false || input?.on === "false" ? false : undefined;
  if (on === undefined) return "send { on: true | false }";
  return { on, ...(input?.via === "words" ? { via: "words" as const } : {}) };
}

export type QuietLevel = "muted" | "quiet" | "normal";

/** The feedback level of a card (background-brief wakeLevel) under quiet
 * mode: never louder than "quiet" (shown, no sound, no unread). A muted kind
 * stays muted. */
export function quietModeLevel(level: QuietLevel | undefined, quiet: boolean): QuietLevel {
  const own = level ?? "normal";
  return quiet && own === "normal" ? "quiet" : own;
}

/** What only the person can answer: shown as its card, never rung. */
export const QUIET_MODE_ASK_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["approval", "question", "needs-you", "sign-in", "takeover", "wait"]);

/** A bot's background news: a run's result or problem, a wake, a hand-off
 * that settled, a suggestion. Nothing reaches the person while quiet. */
export const QUIET_MODE_BACKGROUND_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>([
  "routine-failed", "routine-deferred", "incident", "delegation-settled", "proposal",
]);

/** A notification of a bot in quiet mode: background news is dropped, an
 * ask keeps its frame (the card, Updates) with `notify: false` (no banner,
 * no push, no sound), anything else (the person's own conversation, a
 * person's message, a workspace notice) is left as it is. */
export function quietModeNotification<T extends Pick<Notification, "kind" | "routineRunId"> & { notify?: boolean }>(note: T | null, quiet: boolean): T | null {
  if (!note || !quiet) return note;
  if (QUIET_MODE_BACKGROUND_KINDS.has(note.kind)) return null;
  // a routine run's "finished" is background news; a reply to the person is not
  if (note.kind === "done" && note.routineRunId) return null;
  if (QUIET_MODE_ASK_KINDS.has(note.kind)) return { ...note, notify: false };
  return note;
}

/** The facts of a finished run quiet mode counts (routine-report.ts). */
export interface QuietRunFacts {
  status: string;
  problems?: string;
  declared?: unknown;
}

/** Whether a run counts as one with problems in the summary. */
export function quietRunHadProblems(run: QuietRunFacts): boolean {
  return run.status === "failed" || run.status === "blocked" || Boolean(run.problems?.trim()) || Boolean(run.declared);
}

type Language = "fr" | "en";

/** The person's language as these lines know it. */
export function quietModeLanguage(language: string | null | undefined): Language {
  return String(language ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The one line the bot says when it changed its own mode. */
export function quietModeSaid(on: boolean, scope: "bot" | "all", language: Language): string {
  if (language === "fr") {
    if (on) return scope === "all"
      ? "C'est fait : tous tes bots restent silencieux et te joignent seulement quand ils ont besoin de ta réponse."
      : "C'est fait : je reste silencieux et je te joins seulement quand j'ai besoin de ta réponse.";
    return scope === "all" ? "C'est fait : tes bots te tiennent au courant de nouveau." : "C'est fait : je te tiens au courant de nouveau.";
  }
  if (on) return scope === "all"
    ? "Done: all your bots stay quiet and reach you only when they need your answer."
    : "Done: I am staying quiet and will reach you only when I need your answer.";
  return scope === "all" ? "Done: your bots keep you posted again." : "Done: I will keep you posted again.";
}

/** The one line written in the bot's chat when quiet mode goes off. */
export function quietModeSummary(kept: QuietKept, language: Language): string {
  const runs = Math.max(0, Math.floor(kept.runs));
  const problems = Math.min(runs, Math.max(0, Math.floor(kept.problems)));
  if (language === "fr") {
    if (runs === 0) return "Mode silencieux terminé : aucune exécution n'a été gardée en silence.";
    const counted = runs === 1 ? "1 exécution gardée en silence" : `${runs} exécutions gardées en silence`;
    const withProblems = problems === 0 ? ", aucune avec des problèmes" : problems === 1 ? (runs === 1 ? ", avec des problèmes" : ", dont 1 avec des problèmes") : `, dont ${problems} avec des problèmes`;
    return `Mode silencieux terminé : ${counted}${withProblems}. Tu les retrouves dans Automatisations, sous Exécutions de chaque routine.`;
  }
  if (runs === 0) return "Quiet mode is off: no run was kept quiet.";
  const counted = runs === 1 ? "1 run kept quiet" : `${runs} runs kept quiet`;
  const withProblems = problems === 0 ? ", none with problems" : problems === 1 ? (runs === 1 ? ", with problems" : ", 1 with problems") : `, ${problems} with problems`;
  return `Quiet mode is off: ${counted}${withProblems}. See them in Automations, under each routine's Runs.`;
}
