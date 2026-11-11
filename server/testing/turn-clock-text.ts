// Tests that check the exact text a turn delivered, or the fake CLI's echo
// of it, compare it without the per-turn clock note (server/turns/turn-clock.ts),
// whose minute depends on when the test runs, nor the fresh-time line a later
// model call of the turn ends with (turnClockNow).
const CLOCK_NOTE = /\[Current time:[^\]\n]*\]\n\n/g;
const CLOCK_LINE = /(?:\n+)?\[Current time:[^\]\n]*, now\.\]$/;

export function withoutTurnClock(text: string): string {
  return text.replace(CLOCK_LINE, "").replace(CLOCK_NOTE, "");
}
