// #3480 quiet mode, retired by #3581: what it did is how every bot behaves
// (shared/chat-relevance.ts), with no switch. The server no longer stores a
// switch, counts runs or writes the line; its routes are gone, and so are the
// screens that called them.
//
// What stays: the reader of the line it wrote in a bot's chat when it went
// off (`quietSummary` on a stored row, drawn by src/components/QuietModeLine.tsx).

/** What quiet mode kept out of the chat since it went on. */
export interface QuietKept {
  /** Runs that ended while quiet and would have posted in the chat. */
  runs: number;
  /** Of those, the ones that failed, were blocked or ended with problems. */
  problems: number;
  /** When quiet mode went on (ms), when it is on. */
  since?: number;
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
