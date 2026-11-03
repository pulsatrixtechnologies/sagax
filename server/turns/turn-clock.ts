// The clock a turn is told (the engine runs in a UTC container and has no
// tool-free way to read the time): the current date and time in the zone of
// the person it answers, so times are said in their zone, not the server's.
//
// Zone, first set wins: the speaker's own (Settings > Bot, per person on an
// organization server), the bot owner's, the server's, the host's.
export function turnTimeZone(input: { speaker?: string | null; owner?: string | null; server?: string | null }): string | null {
  for (const zone of [input.speaker, input.owner, input.server]) if (zone && isTimeZone(zone)) return zone;
  return null;
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** "Sunday, October 11, 2026, 9:40 PM" and "UTC-04:00" for that instant in that zone. */
export function zonedNow(now: Date, timeZone: string): { text: string; offset: string } {
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(now);
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = part === "GMT" ? "UTC+00:00" : part.replace(/^GMT/, "UTC");
  return { text, offset };
}

export const TURN_CLOCK_MARKER = "[Current time:";

/** SAGAX_TURN_CLOCK=off leaves turns without the clock note (the test suite's fake engines echo prompts verbatim). */
export function turnClockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAGAX_TURN_CLOCK?.trim().toLowerCase() !== "off";
}

/** One line put before the turn's text. */
export function turnClockNote(now: Date, timeZone: string): string {
  const { text, offset } = zonedNow(now, timeZone);
  return `${TURN_CLOCK_MARKER} ${text}, ${timeZone} (${offset}). Give dates and times in ${timeZone} unless the user asks for another zone; convert UTC or other-zone timestamps from tools before showing them.]`;
}

export function withTurnClock(text: string, now: Date, timeZone: string): string {
  if (text.startsWith(TURN_CLOCK_MARKER)) return text;
  return `${turnClockNote(now, timeZone)}\n\n${text}`;
}

/** How the clock note opens, for code that strips it from an echoed turn. */
export const TURN_CLOCK_LEAD = TURN_CLOCK_MARKER;

/** The host's IANA timezone (a runtime that reports none reads as UTC). */
export function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
