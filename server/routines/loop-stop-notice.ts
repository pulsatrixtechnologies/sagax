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
