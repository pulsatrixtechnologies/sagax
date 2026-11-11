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

/** One line put before the turn's text. The time is the moment the turn
 * starts on its engine (clockAtHandoff), and a turn can run for minutes. */
export function turnClockNote(now: Date, timeZone: string): string {
  const { text, offset } = zonedNow(now, timeZone);
  // The note once said "answer the date, the time ... from it" and "give
  // dates and times": bots added the time to answers nobody asked it for,
  // and a slow turn repeated a minute already past (QA 0.8.86).
  return `${TURN_CLOCK_MARKER} ${text}, ${timeZone} (${offset}), when this turn started. A turn can run for minutes: when the person asks the time or the answer depends on the minute, read the clock again (a shell \`date\`) instead of repeating this one. Say the time only when asked or needed. Times you show are in ${timeZone} unless the user asks for another zone; convert UTC or other-zone timestamps from tools before showing them.]`;
}

export function withTurnClock(text: string, now: Date, timeZone: string): string {
  if (text.startsWith(TURN_CLOCK_MARKER)) return text;
  return `${turnClockNote(now, timeZone)}\n\n${text}`;
}

/** The clock note a turn's text carries: its zone and its exact words. */
export type TurnClock = { timeZone: string; note: string };

/** The clock note `withTurnClock` put in `text`, or null when it holds none. */
export function turnClockIn(text: string, timeZone: string): TurnClock | null {
  const at = text.indexOf(TURN_CLOCK_MARKER);
  if (at < 0) return null;
  const end = text.indexOf("]", at);
  return end < 0 ? null : { timeZone, note: text.slice(at, end + 1) };
}

/** `text` with the note `clock` names replaced by `note` (unchanged when
 * it does not hold that note). */
export function restampTurnClock(text: string, clock: TurnClock, note: string): string {
  const at = text.indexOf(clock.note);
  return at < 0 ? text : text.slice(0, at) + note + text.slice(at + clock.note.length);
}

/** A turn's input as it is handed to its engine: the clock note read now,
 * after every wait (queue, workspace, the bot being busy, an engine slot),
 * not when the person's message arrived. */
export function clockAtHandoff<T extends { text: string; recoveryText?: string; turnClock?: TurnClock }>(input: T, now: Date): T {
  const clock = input.turnClock;
  if (!clock) return input;
  const note = turnClockNote(now, clock.timeZone);
  if (note === clock.note) return input;
  return {
    ...input,
    text: restampTurnClock(input.text, clock, note),
    ...(input.recoveryText !== undefined ? { recoveryText: restampTurnClock(input.recoveryText, clock, note) } : {}),
    turnClock: { timeZone: clock.timeZone, note },
  };
}

/** How the clock note opens, for code that strips it from an echoed turn. */
export const TURN_CLOCK_LEAD = TURN_CLOCK_MARKER;

/** The host's IANA timezone (a runtime that reports none reads as UTC). */
export function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
