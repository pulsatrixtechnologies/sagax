// Tests that check the exact text a turn delivered, or the fake CLI's echo
// of it, compare it without the per-turn clock note (server/turns/turn-clock.ts),
// whose minute depends on when the test runs.
const CLOCK_NOTE = /\[Current time:[^\]\n]*\]\n\n/g;

export function withoutTurnClock(text: string): string {
  return text.replace(CLOCK_NOTE, "");
}
