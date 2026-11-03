// Who of the organization is here: online, away or offline (organization
// server only). One module for the thresholds and the state machine, read by
// the server (server/people/presence.ts, the routes in server/routes/presence.ts)
// and by the renderer (src/lib/presence.ts) for its own clock.
//
//   online   a client of that person is connected and the person used it
//            within PRESENCE_AWAY_AFTER_MS
//   away     connected, but idle longer than that, or the desktop app says
//            the computer is idle or its screen is locked
//   offline  no connected client: every stream closed (after a short grace
//            for a reconnect), or the last sign of a client that vanished
//            without closing is older than PRESENCE_OFFLINE_AFTER_MS
//
// A person who turned off "Show when I am online" reads as offline for
// everyone else, with no last-seen time. Presence lives in memory only: it is
// never written to a chat, the journal or a backup.

/** Idle longer than this: away. */
export const PRESENCE_AWAY_AFTER_MS = 5 * 60_000;
/** No sign of a client for longer than this: that client is gone. */
export const PRESENCE_OFFLINE_AFTER_MS = 10 * 60_000;
/** How often an open app tells the server it is there and how idle it is. */
export const PRESENCE_HEARTBEAT_MS = 60_000;
/** A closed event stream counts this long, so a reconnect does not flicker. */
export const PRESENCE_DISCONNECT_GRACE_MS = 20_000;
/** How often the server looks for thresholds crossed with no new event. */
export const PRESENCE_SWEEP_MS = 15_000;
/** The synced preference behind Settings > Privacy > "Show when I am online".
 * Absent or anything but "0": shown. */
export const PRESENCE_VISIBLE_PREFERENCE = "sagax.presenceVisible.v1";

export type PresenceState = "online" | "away" | "offline";
export type PresenceClientKind = "desktop" | "web";
/** Electron's powerMonitor.getSystemIdleState, or unknown (browser). */
export type SystemIdleState = "active" | "idle" | "locked" | "unknown";

export const PRESENCE_STATES: readonly PresenceState[] = ["online", "away", "offline"];
export const SYSTEM_IDLE_STATES: readonly SystemIdleState[] = ["active", "idle", "locked", "unknown"];

/** One page of an app (a desktop window, a browser tab) as its heartbeats
 * last described it. */
export interface PresencePage {
  kind: PresenceClientKind;
  /** When the page sent its last heartbeat. */
  at: number;
  /** When the person last used it (or the computer, on the desktop). */
  lastInteractionAt: number;
  systemIdle: SystemIdleState;
}

/** One signed-in session's connection: its event streams and its pages. */
export interface PresenceConnection {
  /** Open event streams of this session. */
  streams: number;
  /** When its last stream closed; null while one is open or none ever was. */
  closedAt: number | null;
  /** When it connected. Counts as an interaction until a page says more. */
  openedAt: number;
  /** The last sign of life: a stream opened or kept alive, a heartbeat. */
  lastSeenAt: number;
  pages: ReadonlyMap<string, PresencePage>;
}

/** Whether this connection still counts as a client of its person. */
export function connectionLive(connection: PresenceConnection, now: number): boolean {
  if (now - connection.lastSeenAt > PRESENCE_OFFLINE_AFTER_MS) return false;
  if (connection.streams > 0) return true;
  if (connection.closedAt !== null) return now - connection.closedAt <= PRESENCE_DISCONNECT_GRACE_MS;
  // heartbeats with no stream (a client whose stream failed): fresh is enough
  return true;
}

/** A page says its person is here: recent input, and the computer neither
 * idle nor locked. */
export function pageActive(page: PresencePage, now: number): boolean {
  if (page.systemIdle === "idle" || page.systemIdle === "locked") return false;
  return now - page.lastInteractionAt <= PRESENCE_AWAY_AFTER_MS;
}

export function connectionState(connection: PresenceConnection, now: number): PresenceState {
  if (!connectionLive(connection, now)) return "offline";
  const pages = [...connection.pages.values()].filter((page) => now - page.at <= PRESENCE_OFFLINE_AFTER_MS);
  // a client that sends no heartbeat (the phone): connecting was the last use
  if (pages.length === 0) return now - connection.openedAt <= PRESENCE_AWAY_AFTER_MS ? "online" : "away";
  return pages.some((page) => pageActive(page, now)) ? "online" : "away";
}

const RANK: Record<PresenceState, number> = { online: 2, away: 1, offline: 0 };

/** A person is as present as their most present client. */
export function personState(connections: Iterable<PresenceConnection>, now: number): PresenceState {
  let best: PresenceState = "offline";
  for (const connection of connections) {
    const state = connectionState(connection, now);
    if (RANK[state] > RANK[best]) best = state;
    if (best === "online") break;
  }
  return best;
}

/** What one person shows the others. */
export interface PresenceView {
  principalId: string;
  state: PresenceState;
  /** When they were last connected; null when unknown or hidden. */
  lastSeenAt: number | null;
}

/** A hidden person reads as offline, with no last-seen time. */
export function publicPresence(view: PresenceView, hidden: boolean): PresenceView {
  return hidden ? { principalId: view.principalId, state: "offline", lastSeenAt: null } : view;
}

/** The synced preference value: only "0" hides. */
export function presenceHidden(preference: string | undefined | null): boolean {
  return preference === "0";
}

export function isPresenceState(value: unknown): value is PresenceState {
  return typeof value === "string" && (PRESENCE_STATES as readonly string[]).includes(value);
}
