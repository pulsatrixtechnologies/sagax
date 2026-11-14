/** How loud a signal is and the person's quiet hours: types only, so the
 * attention policy, the notification wire and the per-person signal levels
 * share them without importing one another in a circle (#1381 ratchet).
 * shared/signal-levels.ts re-exports them under their usual home. */
export type SignalLevel = "fyi" | "card" | "urgent";

export interface QuietHours {
  start: string;
  end: string;
  timeZone: string;
}
