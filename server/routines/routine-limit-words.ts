// What a routine run, a webhook run or a proactive wake says when a limit
// refused its turn (server/routines/routine-recovery.ts), in the language of the
// person it runs for (English or Quebec French). The same words are the
// run's status line, its error, the notification and the Team incidents
// report a Primary Bot reads and relays, so they name the engine that really
// refused (with its model when the run was not on its conversation's own
// model, a wake's fast model for one), the bot's own engine when the one that
// refused was standing in for it, say where the run went on and why nothing
// took it over, and give the real reset time. They never say a run stays down
// while another engine runs it.
import type { ModelSelection } from "../../shared/wire.ts";

/** Why no engine took the run over: none this person may use is free ("none"), the run already moved
 * ROUTINE_LIMIT_TAKEOVERS times ("cap"), or automatic switching is off on this server (SAGAX_LIMIT_FAILOVER=0, "off"). */
export type RoutineNoTaker = "none" | "cap" | "off";

/** The bot's own engine when the engine that refused was standing in for it (a takeover had moved the run's
 * conversation there): the run goes back to this engine, never to the backup that refused. */
export interface RoutineLimitHome {
  /** The engine, in words. */
  name: string;
  /** When its own limit resets: its hold, else the reset its takeover was recorded with. */
  resetsAt: number;
  /** That time is Sagax's estimate: the engine named none. */
  estimated: boolean;
}

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
  /** The engine that refused was standing in for the bot's own engine (an earlier takeover). */
  home?: RoutineLimitHome;
  /** Who takes this run over now ("Auto" when Auto picks again); absent when nothing can. */
  to?: string;
  /** Why nothing takes it over; set when `to` is absent. */
  noTaker?: RoutineNoTaker;
  /** `to` is the bot's own engine (`home`), whose limit has reset: the run goes back there. */
  backHome?: true;
  /** The model the run's next start runs on; absent for Auto. */
  selection?: ModelSelection;
  /** When the run's conversation goes back to its own model after `selection` took it off (the reset of the limit
   * that refused that model); absent when the run goes on on the conversation's own model. */
  returnsAt?: number;
  /** `returnsAt` is Sagax's estimate: the engine that refused named no reset. */
  returnsEstimated?: true;
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

/** "Nov 5, 3:20 PM (America/Toronto)" or "5 nov. à 15 h 20 (America/Toronto)". */
export function limitWhen(at: number, options: RoutineLimitWordsOptions = {}): string {
  const fr = isFrench(options.language);
  const timeZone = options.timeZone;
  const zone = timeZone ? { timeZone } : {};
  try {
    // Quebec French joins the date and the time with "à": "2 nov. à 15 h 16".
    const text = fr
      ? `${new Date(at).toLocaleDateString("fr-CA", { month: "short", day: "numeric", ...zone })} à ${new Date(at).toLocaleTimeString("fr-CA", { hour: "numeric", minute: "2-digit", ...zone })}`
      : new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...zone });
    return timeZone ? `${text} (${timeZone})` : text;
  } catch {
    return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

function whatReached(kind: RoutineUsageLimit["kind"], fr: boolean): string {
  if (fr) return kind === "rate_limited" ? "Limite de débit atteinte" : "Limite d'utilisation atteinte";
  return kind === "rate_limited" ? "Rate limit reached" : "Usage limit reached";
}

/** "Usage limit reached on Codex", and the bot's own engine when Codex was standing in for it. */
function reachedOn(limit: Pick<RoutineUsageLimit, "kind" | "from" | "home">, fr: boolean): string {
  const what = whatReached(limit.kind, fr);
  if (!limit.home) return fr ? `${what} sur ${limit.from}` : `${what} on ${limit.from}`;
  return fr ? `${what} sur ${limit.from}, qui remplaçait ${limit.home.name}` : `${what} on ${limit.from}, which was standing in for ${limit.home.name}`;
}

/** Why no engine took the run over, as one sentence. */
function noTakerText(noTaker: RoutineNoTaker | undefined, fr: boolean): string {
  if (noTaker === "off") {
    return fr ? "Le passage automatique à un autre moteur est désactivé sur ce serveur." : "Automatic switching to another engine is off on this server.";
  }
  if (noTaker === "cap") {
    return fr ? "Sagax a déjà déplacé cette exécution deux fois, ce qui est le maximum." : "Sagax already moved this run twice, the most it does for one run.";
  }
  return fr ? "Aucun autre moteur ne peut prendre le relais." : "No other engine can take over.";
}

/** When an engine comes back: its reset, or that it named none. */
function resetText(name: string, resetsAt: number, estimated: boolean, options: RoutineLimitWordsOptions, fr: boolean): string {
  if (fr) {
    return estimated
      ? `${name} n'a pas donné d'heure de réinitialisation ; les exécutions sur ce moteur reprendront à sa réinitialisation.`
      : `${name} se réinitialise vers le ${limitWhen(resetsAt, options)} ; les exécutions sur ce moteur reprendront alors.`;
  }
  return estimated
    ? `${name} gave no reset time; runs on it work again once it resets.`
    : `${name} resets around ${limitWhen(resetsAt, options)}; runs on it work again then.`;
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

/** The run goes back to an engine at its reset, or that engine named none and is tried again then. */
function backOnText(name: string, resetsAt: number, estimated: boolean, options: RoutineLimitWordsOptions, fr: boolean): string {
  const when = limitWhen(resetsAt, options);
  if (fr) {
    return estimated
      ? `${name} n'a pas donné d'heure de réinitialisation : il sera réessayé vers le ${when}.`
      : `Retour sur ${name} à sa réinitialisation, vers le ${when}.`;
  }
  return estimated ? `${name} gave no reset time: it is tried again around ${when}.` : `Back on ${name} once it resets, around ${when}.`;
}

/** The run goes on now on another engine (or on Auto's next pick), or back on the bot's own engine whose limit reset. */
export function routineLimitSwitchedText(limit: Omit<RoutineUsageLimit, "to"> & { to: string }, options: RoutineLimitWordsOptions = {}): string {
  const fr = isFrench(options.language);
  const what = whatReached(limit.kind, fr);
  if (limit.backHome) {
    return fr
      ? `${what} sur ${limit.from} : cette exécution revient sur ${limit.to}, dont la limite s'est réinitialisée.`
      : `${what} on ${limit.from}: this run goes back to ${limit.to}, whose limit has reset.`;
  }
  // A quick model Sagax picked: the run never goes back to it. A backup standing in for the bot's own engine: the run
  // goes back to that engine, at its own reset, never to the backup.
  const back = limit.detour ? detourSkipText(limit, limitWhen(limit.resetsAt, options), fr)
    : limit.home ? backOnText(limit.home.name, limit.home.resetsAt, limit.home.estimated, options, fr)
      : backOnText(limit.from, limit.resetsAt, limit.estimated, options, fr);
  if (fr) {
    const next = limit.to === "Auto" ? "Auto poursuit cette exécution sur un autre modèle" : `cette exécution continue sur ${limit.to}`;
    return `${what} sur ${limit.from} : ${next}. ${back}`;
  }
  const next = limit.to === "Auto" ? "Auto continues it on another model" : `this run continues on ${limit.to}`;
  return `${what} on ${limit.from}: ${next}. ${back}`;
}

/** Nothing took the run over: it starts again at `startsAt`, on `on` (the bot's own engine, or the backup that
 * refused when its reset comes first) when the engine that refused was standing in for the bot's own. */
export function routineLimitWaitingText(limit: Pick<RoutineUsageLimit, "from" | "kind" | "home" | "noTaker">, startsAt: number,
  options: RoutineLimitWordsOptions = {}, on?: string): string {
  const when = limitWhen(startsAt, options);
  const fr = isFrench(options.language);
  const where = limit.home && on;
  const again = fr
    ? where ? `Cette exécution repart sur ${on} à la réinitialisation de sa limite, le ${when}.` : `Cette exécution repart à la réinitialisation, le ${when}.`
    : where ? `This run starts again on ${on} at its reset, ${when}.` : `This run starts again at the reset, ${when}.`;
  return `${reachedOn(limit, fr)}. ${noTakerText(limit.noTaker, fr)} ${again}`;
}

/** Nothing took the run over and it does not wait: when the bot's own engine comes back (its reset, or that it named
 * none). A quick model Sagax picked is not the bot's engine: Sagax skips it until it resets, and choosing another
 * engine for the bot would not change that. The advice to choose another engine for the bot is given only when
 * automatic switching is off: otherwise Sagax already tried every engine this person may use. */
export function routineLimitStoppedText(limit: Pick<RoutineUsageLimit, "from" | "kind" | "resetsAt" | "estimated" | "detour" | "home" | "noTaker">,
  options: RoutineLimitWordsOptions = {}): string {
  const fr = isFrench(options.language);
  const head = `${reachedOn(limit, fr)}. ${noTakerText(limit.noTaker, fr)}`;
  if (limit.detour) return `${head} ${detourSkipText(limit, limitWhen(limit.resetsAt, options), fr)}`;
  const own = limit.home ?? { name: limit.from, resetsAt: limit.resetsAt, estimated: limit.estimated };
  const advice = limit.noTaker === "off" ? (fr ? " Ou choisissez dès maintenant un autre moteur pour ce bot." : " Or choose another engine for this bot now.") : "";
  return `${head} ${resetText(own.name, own.resetsAt, own.estimated, options, fr)}${advice}`;
}

/** The engine that refused is out of credit and nothing took the run over. A quick model Sagax picked: Sagax skips it
 * for quick turns (no advice to change the bot's engine). A backup standing in for the bot's own engine: when the
 * bot's own engine comes back. Otherwise the bot's own engine: add credit, or choose another engine for the bot. */
export function routineLimitCreditsText(limit: Pick<RoutineUsageLimit, "from" | "resetsAt" | "estimated" | "detour" | "home" | "noTaker">,
  options: RoutineLimitWordsOptions = {}): string {
  const fr = isFrench(options.language);
  if (limit.detour) {
    const when = limitWhen(limit.resetsAt, options);
    return fr
      ? `${limit.from}, un modèle rapide choisi par Sagax pour cette exécution, n'a plus de crédit : Sagax l'évite pour les tours rapides jusque vers le ${when}. ${noTakerText(limit.noTaker, true)}`
      : `${limit.from}, a quick model Sagax picked for this run, is out of credit: Sagax skips it for quick turns until around ${when}. ${noTakerText(limit.noTaker, false)}`;
  }
  if (limit.home) {
    const back = resetText(limit.home.name, limit.home.resetsAt, limit.home.estimated, options, fr);
    return fr
      ? `Le compte ${limit.from}, qui remplaçait ${limit.home.name}, n'a plus de crédit. ${back}`
      : `The ${limit.from} account, which was standing in for ${limit.home.name}, is out of credit. ${back}`;
  }
  return fr
    ? `Le compte ${limit.from} n'a plus de crédit. Ajoutez du crédit chez le fournisseur, ou choisissez un autre moteur pour ce bot.`
    : `The ${limit.from} account is out of credit. Add credit with the provider, or choose another engine for this bot.`;
}

/** A usage limit read from the run's words alone, with no engine known
 * (its turn was never dispatched): it names no engine it cannot know. */
export function routineLimitUnknownEngineText(options: RoutineLimitWordsOptions = {}, startsAt?: number): string {
  if (isFrench(options.language)) {
    return startsAt === undefined
      ? "Le moteur de cette exécution a atteint sa limite d'utilisation. Les exécutions sur ce moteur reprendront à sa réinitialisation. Ou choisissez dès maintenant un autre moteur pour ce bot."
      : `Le moteur de cette exécution a atteint sa limite d'utilisation. Cette exécution repart à la réinitialisation, le ${limitWhen(startsAt, options)}.`;
  }
  return startsAt === undefined
    ? "This run's engine reached its usage limit. Runs on it work again once it resets. Or choose another engine for this bot now."
    : `This run's engine reached its usage limit. This run starts again at the reset, ${limitWhen(startsAt, options)}.`;
}
