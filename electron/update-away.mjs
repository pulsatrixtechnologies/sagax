// When a downloaded update may install by itself, and when to warn about the
// bots a restart would cut short. Pure, so the rules are tested without
// Electron. Nothing here installs: updater.mjs asks `awayInstallDecision`
// once a minute and, on "install", goes through the same confirmed install
// path as the person's own "Restart to install" (cookies flushed on
// before-quit-for-update, Windows installer visible).

/** The computer counts as "away" after this much idle time (or a locked screen). */
export const AWAY_INSTALL_IDLE_SECONDS = 15 * 60;
/** The page reports the working bots every ~30 s; older than this, the count is unknown. */
export const ACTIVITY_STALE_MS = 5 * 60 * 1000;

/** A reported count made safe: a whole number of bots, or null when unusable. */
export function cleanActiveBots(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.min(Math.floor(count), 1000) : null;
}

/**
 * @param {object} input
 * @param {string} input.status updater status; only "downloaded" can install
 * @param {boolean} input.handOff a system package: the person's to install
 * @param {{state: string}|null} input.systemIdle systemIdleSnapshot at AWAY_INSTALL_IDLE_SECONDS
 * @param {number|null} input.activeBots working bots, null when never reported
 * @param {number} input.reportedAt epoch ms of that report
 * @param {number} input.now epoch ms
 * @param {boolean} input.enabled the person turned on "install while I am away"
 * @param {boolean} input.waiting the person asked to restart once the bots finish
 */
export function awayInstallDecision({ status, handOff = false, systemIdle = null, activeBots = null, reportedAt = 0, now = Date.now(), enabled = false, waiting = false }) {
  if (status !== "downloaded") return { install: false, reason: "not-downloaded" };
  if (handOff) return { install: false, reason: "hand-off" };
  if (!enabled && !waiting) return { install: false, reason: "off" };
  // Never restart on a guess: a count that was never reported, or went stale
  // (the page is gone or frozen), could hide a bot mid-turn.
  if (activeBots === null || now - reportedAt > ACTIVITY_STALE_MS) return { install: false, reason: "activity-unknown" };
  if (activeBots > 0) return { install: false, reason: "bots-working" };
  // Waiting for the bots: the person asked for this restart, no idle needed.
  if (waiting) return { install: true, reason: "bots-finished" };
  const away = systemIdle?.state === "idle" || systemIdle?.state === "locked";
  return away ? { install: true, reason: "away" } : { install: false, reason: "present" };
}
