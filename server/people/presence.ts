// Presence of the people of an organization server, in memory
// (shared/presence.ts holds the thresholds and the state machine).
//
// A connection is one signed-in session: its event streams (/api/events) and
// the pages that send heartbeats (POST /api/presence/heartbeat). The tracker
// keeps them per person, remembers when each person was last connected, and
// calls `onChange` when a person's state changes, from an event or from the
// sweep that notices a threshold crossed. Nothing here is written to disk.
import {
  connectionLive,
  personState,
  type PresenceClientKind,
  type PresenceConnection,
  type PresencePage,
  type PresenceState,
  type PresenceView,
  type SystemIdleState,
} from "../../shared/presence.ts";

interface MutableConnection extends PresenceConnection {
  pages: Map<string, PresencePage>;
}

export interface PresenceHeartbeat {
  pageId: string;
  kind: PresenceClientKind;
  /** How long the person has not used this page (or the computer). */
  idleMs: number;
  systemIdle: SystemIdleState;
}

/** At most this many pages per session: a page id is the client's word. */
const MAX_PAGES = 16;
/** A day: a larger idle time says nothing more. */
const MAX_IDLE_MS = 24 * 60 * 60_000;

export class PresenceTracker {
  private readonly people = new Map<string, Map<string, MutableConnection>>();
  private readonly lastSeen = new Map<string, number>();
  private readonly emitted = new Map<string, PresenceState>();
  private readonly now: () => number;
  private readonly onChange: (view: PresenceView) => void;

  constructor(options: { now?: () => number; onChange?: (view: PresenceView) => void } = {}) {
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange ?? (() => {});
  }

  private key(principalId: string): string {
    return principalId.trim().toLowerCase();
  }

  private connection(person: string, sessionId: string, now: number): MutableConnection {
    let connections = this.people.get(person);
    if (!connections) {
      connections = new Map();
      this.people.set(person, connections);
    }
    let connection = connections.get(sessionId);
    if (!connection) {
      connection = { streams: 0, closedAt: null, openedAt: now, lastSeenAt: now, pages: new Map() };
      connections.set(sessionId, connection);
    }
    return connection;
  }

  /** An event stream of this session opened. Returns its close. */
  connect(principalId: string, sessionId: string): () => void {
    const person = this.key(principalId);
    const now = this.now();
    const connection = this.connection(person, sessionId, now);
    // back after the grace (or for the first time): opening the app is a use
    if (connection.streams === 0) connection.openedAt = now;
    connection.streams += 1;
    connection.closedAt = null;
    connection.lastSeenAt = now;
    this.lastSeen.set(person, now);
    this.settle(person);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const at = this.now();
      connection.streams = Math.max(0, connection.streams - 1);
      if (connection.streams === 0) connection.closedAt = at;
      this.lastSeen.set(person, at);
      // the grace keeps it present; the sweep turns it offline
    };
  }

  /** A stream of this session is still there (its keepalive went out). */
  touch(principalId: string, sessionId: string): void {
    const person = this.key(principalId);
    const connection = this.people.get(person)?.get(sessionId);
    if (!connection) return;
    const now = this.now();
    connection.lastSeenAt = now;
    if (connectionLive(connection, now)) this.lastSeen.set(person, now);
  }

  /** A page of this session reports in. Returns the person's state now. */
  heartbeat(principalId: string, sessionId: string, beat: PresenceHeartbeat): PresenceView {
    const person = this.key(principalId);
    const now = this.now();
    const connection = this.connection(person, sessionId, now);
    if (!connection.pages.has(beat.pageId) && connection.pages.size >= MAX_PAGES) {
      // drop the stalest page to make room
      let stalest: string | null = null;
      for (const [id, page] of connection.pages) if (stalest === null || page.at < connection.pages.get(stalest)!.at) stalest = id;
      if (stalest !== null) connection.pages.delete(stalest);
    }
    const idleMs = Math.min(MAX_IDLE_MS, Math.max(0, Math.floor(beat.idleMs)));
    connection.pages.set(beat.pageId, { kind: beat.kind, at: now, lastInteractionAt: now - idleMs, systemIdle: beat.systemIdle });
    connection.lastSeenAt = now;
    this.lastSeen.set(person, now);
    this.settle(person);
    return this.view(person);
  }

  /** The person's real state (not narrowed for a hidden person). */
  view(principalId: string): PresenceView {
    const person = this.key(principalId);
    const now = this.now();
    const connections = this.people.get(person);
    const state = connections ? personState(connections.values(), now) : "offline";
    return { principalId: person, state, lastSeenAt: state === "offline" ? this.lastSeen.get(person) ?? null : now };
  }

  /** Recompute everyone: drop what is gone, report what changed. */
  sweep(): void {
    // settle may drop the entry being visited; a Map allows that
    for (const person of this.people.keys()) this.settle(person);
  }

  /** Report this person again even when the state is the same (their
   * "Show when I am online" changed). */
  refresh(principalId: string): void {
    const person = this.key(principalId);
    this.settle(person, true);
  }

  /** Forget a person entirely (removed from the organization). */
  forget(principalId: string): void {
    const person = this.key(principalId);
    this.people.delete(person);
    this.lastSeen.delete(person);
    this.emitted.delete(person);
  }

  private settle(person: string, force = false): void {
    const now = this.now();
    const connections = this.people.get(person);
    if (connections) {
      for (const [id, connection] of connections) {
        // lastSeen already holds its last sign of life or its close
        if (!connectionLive(connection, now)) connections.delete(id);
      }
      if (connections.size === 0) this.people.delete(person);
    }
    const view = this.view(person);
    const before = this.emitted.get(person);
    if (before === view.state && !force) return;
    this.emitted.set(person, view.state);
    // nobody was ever told this person was here: offline needs no news
    if (before === undefined && view.state === "offline" && !force) return;
    this.onChange(view);
  }
}
