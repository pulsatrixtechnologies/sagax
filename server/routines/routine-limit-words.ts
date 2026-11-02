// What a routine run, a webhook run or a proactive wake says when a limit
// refused its turn (server/routines/routine-recovery.ts), in the language of the
// person it runs for (English or Quebec French). The same words are the
// run's status line, the notification and the Team incidents report a
// Primary Bot reads and relays, so they name the engine that really
// refused (with its model when the run was not on its conversation's own
// model, a wake's fast model for one), say where the run went on, and give
// the real reset time. They never say a run stays down while another
// engine runs it.
import type { ModelSelection } from "../../shared/wire.ts";

/** A limit as the limit failover host read it (server/limit-failover-host.ts routineLimit). */
export interface RoutineUsageLimit {
  /** "quota": a usage limit or a spent balance; "rate_limited": a 429 its driver gave up on. */
  kind: "quota" | "rate_limited";
  /** The engine that refused, in words; with its model when the run was not on its conversation's own model. */
  from: string;
  /** When that limit resets: the engine's own time, else an estimate. */
  resetsAt: number;
  /** The engine named no reset time: `resetsAt` is Sagax's estimate. */
  estimated: boolean;
  /** The refused model was a quick model Sagax picked for this turn (a proactive wake's fast model, #1694), not the
   * conversation's own: the run never goes back to it, Sagax only skips it for quick turns until it resets. */
  detour?: true;
  /** Who takes this run over now ("Auto" when Auto picks again); absent when nothing can. */
  to?: string;
  /** The model the run's next start runs on; absent for Auto. */
  selection?: ModelSelection;
  /** When the run's conversation goes back to its own model after `selection` took it off (the reset of the limit
   * that refused that model); absent when the run goes on on the conversation's own model. */
  returnsAt?: number;
  /** `selection` is the conversation's own model on the engine that refused (only Sagax's quick model of that engine
   * was refused): no other engine took the run over, so it is not one of ROUTINE_LIMIT_TAKEOVERS. */
  sameEngine?: true;
}

export interface RoutineLimitWordsOptions {
  /** The person's language: French when it starts with "fr", else English. */
  language?: string;
  /** The zone a time is written in (the person's, else the host's). */
  timeZone?: string;
}

const isFrench = (language?: string) => (language ?? "").toLowerCase().startsWith("fr");

/** "Nov 5, 3:20 PM (America/Toronto)" or "5 nov., 15 h 20 (America/Toronto)". */
export function limitWhen(at: number, options: RoutineLimitWordsOptions = {}): string {
  const fr = isFrench(options.language);
  const timeZone = options.timeZone;
  try {
    const text = new Date(at).toLocaleString(fr ? "fr-CA" : "en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}),
    });
    return timeZone ? `${text} (${timeZone})` : text;
  } catch {
    return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

function whatReached(kind: RoutineUsageLimit["kind"], fr: boolean): string {
  if (fr) return kind === "rate_limited" ? "Limite de débit atteinte" : "Limite d'utilisation atteinte";
  return kind === "rate_limited" ? "Rate limit reached" : "Usage limit reached";
}

/** Sagax's quick pick a limit refused: Sagax skips it until it resets (or until its estimate, named as one). */
function detourSkipText(limit: Pick<RoutineUsageLimit, "from" | "estimated">, when: string, fr: boolean): string {
  if (fr) {
    return limit.estimated
      ? `${limit.from} n'a pas donné d'heure de réinitialisation : Sagax l'évite pour les tours rapides jusque vers le ${when}.`
      : `Sagax évite ${limit.from} pour les tours rapides jusqu'à sa réinitialisation, vers le ${when}.`;
  }
  return limit.estimated
    ? `${limit.from} gave no reset time: Sagax skips it for quick turns until around ${when}.`
    : `Sagax skips ${limit.from} for quick turns until it resets, around ${when}.`;
}

/** The run goes on now on another engine (or on Auto's next pick). */
export function routineLimitSwitchedText(limit: Omit<RoutineUsageLimit, "to"> & { to: string }, options: RoutineLimitWordsOptions = {}): string {
  const when = limitWhen(limit.resetsAt, options);
  const fr = isFrench(options.language);
  const what = whatReached(limit.kind, fr);
  if (fr) {
    const next = limit.to === "Auto" ? "Auto poursuit cette exécution sur un autre modèle" : `cette exécution continue sur ${limit.to}`;
    // A quick model Sagax picked: the run never goes back to it.
    const back = limit.detour ? detourSkipText(limit, when, true)
      : limit.estimated
        ? `${limit.from} n'a pas donné d'heure de réinitialisation : il sera réessayé vers le ${when}.`
        : `Retour sur ${limit.from} à sa réinitialisation, vers le ${when}.`;
    return `${what} sur ${limit.from} : ${next}. ${back}`;
  }
  const next = limit.to === "Auto" ? "Auto continues it on another model" : `this run continues on ${limit.to}`;
  const back = limit.detour ? detourSkipText(limit, when, false)
    : limit.estimated
      ? `${limit.from} gave no reset time: it is tried again around ${when}.`
      : `Back on ${limit.from} once it resets, around ${when}.`;
  return `${what} on ${limit.from}: ${next}. ${back}`;
}

/** No other engine can take the run: it starts again at the reset. */
export function routineLimitWaitingText(limit: Pick<RoutineUsageLimit, "from" | "kind">, startsAt: number, options: RoutineLimitWordsOptions = {}): string {
  const when = limitWhen(startsAt, options);
  const fr = isFrench(options.language);
  const what = whatReached(limit.kind, fr);
  return fr
    ? `${what} sur ${limit.from} et aucun autre moteur ne peut prendre en charge cette exécution : elle repart à la réinitialisation, le ${when}.`
    : `${what} on ${limit.from} and no other engine can take this run: it starts again at the reset, ${when}.`;
}

/** No other engine could take the run and it does not wait: when the
 * engine comes back (its reset, or that it named none), and what to do. A
 * quick model Sagax picked is not the bot's engine: Sagax skips it until it
 * resets, and choosing another engine for the bot would not change that. */
export function routineLimitStoppedText(limit: Pick<RoutineUsageLimit, "from" | "kind" | "resetsAt" | "estimated" | "detour">, options: RoutineLimitWordsOptions = {}): string {
  const when = limitWhen(limit.resetsAt, options);
  const fr = isFrench(options.language);
  const what = whatReached(limit.kind, fr);
  if (limit.detour) {
    return fr
      ? `${what} sur ${limit.from} et aucun autre moteur n'a pu prendre en charge cette exécution. ${detourSkipText(limit, when, true)}`
      : `${what} on ${limit.from} and no other engine could take this run. ${detourSkipText(limit, when, false)}`;
  }
  if (fr) {
    const reset = limit.estimated
      ? `${limit.from} n'a pas donné d'heure de réinitialisation ; les exécutions sur ce moteur reprendront à sa réinitialisation.`
      : `${limit.from} se réinitialise vers le ${when} ; les exécutions sur ce moteur reprendront alors.`;
    return `${what} sur ${limit.from} et aucun autre moteur n'a pu prendre en charge cette exécution. ${reset} Ou choisissez dès maintenant un autre moteur pour ce bot.`;
  }
  const reset = limit.estimated
    ? `${limit.from} gave no reset time; runs on it work again once it resets.`
    : `${limit.from} resets around ${when}; runs on it work again then.`;
  return `${what} on ${limit.from} and no other engine could take this run. ${reset} Or choose another engine for this bot now.`;
}

/** A usage limit read from the run's words alone, with no engine known
 * (its turn was never dispatched): it names no engine it cannot know. */
export function routineLimitUnknownEngineText(options: RoutineLimitWordsOptions = {}, startsAt?: number): string {
  if (isFrench(options.language)) {
    return startsAt === undefined
      ? "Le moteur de cette exécution a atteint sa limite d'utilisation. Les exécutions sur ce moteur reprendront à sa réinitialisation. Ou choisissez dès maintenant un autre moteur pour ce bot."
      : `Le moteur de cette exécution a atteint sa limite d'utilisation. Elle repart à la réinitialisation, le ${limitWhen(startsAt, options)}.`;
  }
  return startsAt === undefined
    ? "This run's engine reached its usage limit. Runs on it work again once it resets. Or choose another engine for this bot now."
    : `This run's engine reached its usage limit. It starts again at the reset, ${limitWhen(startsAt, options)}.`;
}
