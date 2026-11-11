// #3480 quiet mode, retired by #3581: what it did is how every bot behaves
// (shared/chat-relevance.ts), with no switch. The server no longer stores a
// switch, counts runs or writes the line; its routes are gone.
//
// What stays: the reader of the line it wrote in a bot's chat when it went
// off (`quietSummary` on a stored row, drawn by src/components/QuietModeLine.tsx),
// and, until the screens that still call the old routes are removed with the
// next app release, the route paths and the shapes those screens import
// (a released app's call answers 404 and draws nothing).

/** GET the person's all-bots switch (retired: answers 404). */
export const QUIET_MODE_PERSON_PATH = "/api/me/quiet";

/** GET one bot's state (retired: answers 404). */
export function quietModeBotPath(botId: string): string {
  return `/api/bots/${encodeURIComponent(botId)}/quiet`;
}

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

type Language = "fr" | "en";

/** The person's language as these lines know it. */
export function quietModeLanguage(language: string | null | undefined): Language {
  return String(language ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** What quiet mode kept, as the start of its line: how many runs, how many
 * with problems (the chat's quiet line shows this beside its link). */
export function quietModeCounts(kept: Pick<QuietKept, "runs" | "problems">, language: Language): string {
  const runs = Math.max(0, Math.floor(kept.runs));
  const problems = Math.min(runs, Math.max(0, Math.floor(kept.problems)));
  if (language === "fr") {
    if (runs === 0) return "Mode silencieux terminé : aucune exécution n'a été gardée en silence";
    const counted = runs === 1 ? "1 exécution gardée en silence" : `${runs} exécutions gardées en silence`;
    const withProblems = problems === 0 ? ", aucune avec des problèmes" : problems === 1 ? (runs === 1 ? ", avec des problèmes" : ", dont 1 avec des problèmes") : `, dont ${problems} avec des problèmes`;
    return `Mode silencieux terminé : ${counted}${withProblems}`;
  }
  if (runs === 0) return "Quiet mode is off: no run was kept quiet";
  const counted = runs === 1 ? "1 run kept quiet" : `${runs} runs kept quiet`;
  const withProblems = problems === 0 ? ", none with problems" : problems === 1 ? (runs === 1 ? ", with problems" : ", 1 with problems") : `, ${problems} with problems`;
  return `Quiet mode is off: ${counted}${withProblems}`;
}
