// #3126: the loop guard's stop notice of a routine run, in the person's
// language. It is posted in the bot's chat with the person (the routine's
// thread) as well as in the run's own thread: nothing stays invisible.
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };

const KEY = "routines.loopStop.notice";
const CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>> = { en, fr };

export function routineLoopStopNotice(language: string | undefined, reason: string): string {
  const tag = (language ?? "").trim().toLowerCase().split("-")[0] ?? "";
  const text = CATALOGS[tag]?.[KEY] ?? en[KEY];
  return text.replace("{reason}", reason.trim());
}

const PREFLIGHT_KEY = "routines.preflight.notice";

/** #3130: a run blocked or skipped at pre-flight (signed out, the engine
 * still starting after the retries, Perspicax unreachable), as one line in
 * the bot's chat with the person, in their language. */
export function routinePreflightNotice(language: string | undefined, name: string, reason: string): string {
  const tag = (language ?? "").trim().toLowerCase().split("-")[0] ?? "";
  const text = CATALOGS[tag]?.[PREFLIGHT_KEY] ?? en[PREFLIGHT_KEY];
  return text.replace("{name}", name.trim()).replace("{reason}", reason.trim());
}
