// The calm notice while the server or the Perspicax connector cannot be
// reached (#2013, the maintainer, 2026-11-05): "Server update in progress, back in a
// moment", "Sagax can't reach the server, retrying…", "Perspicax is
// unreachable, retrying…", then "Reconnected". Nothing permanent: it goes by
// itself when the state clears, the person can dismiss it (for that
// occurrence only), and Settings > Notifications turns it off.
//
// "Updating" is told apart from "unreachable" by what the server said: the
// `server.restarting` live frame it sends just before a planned restart (an
// update rolls the container through the same graceful shutdown), or a
// health probe answering 503 with `shuttingDown` (the drain) or the edge's
// `x-sagax-maintenance` marker. A bare 502/503/504 from the edge in front
// of the server (#4794) reads as a restart too: the network and the edge
// answer, only the server behind them is starting again. On a compose host a
// roll stops the server's own proxy before the server can announce its
// restart, so this answer is the only sign the app gets of most updates.
//
// What shows nothing (the owner's rule: a notice only when there is
// something to do): a drop with no answer at all shorter than
// CONNECTION_NOTICE_DEBOUNCE_MS, and a restart (announced, draining, an
// edge gateway answer, or the server's health already back while the
// stream reconnects) shorter than RESTART_QUIET_MS. Past that the notice
// shows once for the occurrence. The device being offline has its own line
// (ChatStaleBanner), not this one.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { listenLiveFrames, retryLiveEventsNow } from "@/lib/live-events";
import { connectionNotices, useLocalSwitch } from "@/lib/notification-preferences";
import { useNetworkOnline } from "@/lib/drafts";
import { useStoreSelector } from "@/state/store-selector";

/** A drop with no answer from the server or its edge shows nothing before this. */
export const CONNECTION_NOTICE_DEBOUNCE_MS = 8_000;
/** A restart (planned, or an edge saying the server behind it is starting)
 * shows nothing before this: a roll is over well within it most times. */
export const RESTART_QUIET_MS = 30_000;
/** An edge answering 502/503/504 this long reads as unreachable, not an update. */
export const GATEWAY_RESTART_MAX_MS = 2 * 60_000;
/** A restart announced this recently explains a drop as an update. */
export const RESTART_ANNOUNCE_WINDOW_MS = 10 * 60_000;
/** An update that has not come back after this reads as unreachable. */
export const UPDATING_MAX_MS = 5 * 60_000;
/** How long before the drop a restart announcement still explains it. */
export const ANNOUNCE_LEAD_MS = 60_000;
/** How long "Reconnected" stays. */
export const RECONNECTED_SHOW_MS = 3_000;
/** While the server is away, how often its health is asked. */
export const HEALTH_PROBE_MS = 5_000;

export type ConnectionNoticeKind = "updating" | "server_unreachable" | "perspicax_unreachable";

/** draining: the server said it restarts on purpose; gateway: the edge
 * answers but the server behind it does not (yet); down: no answer at all. */
export type HealthState = "draining" | "gateway" | "down" | "up";

export interface ConnectorStatus { state: "ok" | "unreachable"; since: number }

/** What the app knows about its connections now. */
export interface ConnectionWatch {
  connected: boolean;
  everConnected: boolean;
  disconnectedAt: number | null;
  /** When the server last said it was restarting on purpose. */
  restartAnnouncedAt: number | null;
  /** The last health probe while the live stream was down. */
  health: HealthState | null;
  perspicax: ConnectorStatus | null;
  online: boolean;
}

export interface ConnectionNotice {
  kind: ConnectionNoticeKind;
  /** One occurrence: a dismissal holds for it and no other. */
  occurrence: string;
}

/** The notice the state calls for now, or null. Pure. */
export function connectionNoticeFor(watch: ConnectionWatch, now: number, debounceMs = CONNECTION_NOTICE_DEBOUNCE_MS): ConnectionNotice | null {
  if (!watch.online) return null;
  if (!watch.connected && watch.everConnected && watch.disconnectedAt != null) {
    const away = now - watch.disconnectedAt;
    // the announcement comes just before the stream closes: one from an
    // earlier restart explains nothing about this drop
    const announced = watch.restartAnnouncedAt != null && now - watch.restartAnnouncedAt < RESTART_ANNOUNCE_WINDOW_MS
      && watch.restartAnnouncedAt >= watch.disconnectedAt - ANNOUNCE_LEAD_MS;
    const planned = announced || watch.health === "draining";
    const gateway = watch.health === "gateway";
    // the health already answers: the stream is on its way back
    const restarting = planned || gateway || watch.health === "up";
    if (away < (restarting ? RESTART_QUIET_MS : debounceMs)) return null;
    const updating = (planned && away < UPDATING_MAX_MS) || (gateway && away < GATEWAY_RESTART_MAX_MS);
    const kind: ConnectionNoticeKind = updating ? "updating" : "server_unreachable";
    return { kind, occurrence: `${kind}:${watch.disconnectedAt}` };
  }
  if (watch.connected && watch.perspicax?.state === "unreachable" && now - watch.perspicax.since >= debounceMs) {
    return { kind: "perspicax_unreachable", occurrence: `perspicax:${watch.perspicax.since}` };
  }
  return null;
}

/** What a health answer says about a server that dropped its stream. */
export async function readHealth(response: Response): Promise<HealthState> {
  if (response.headers.get("x-sagax-maintenance")) return "draining";
  if (response.status === 503) {
    try {
      const body = await response.clone().json() as { shuttingDown?: unknown; maintenance?: unknown };
      if (body?.shuttingDown === true || body?.maintenance === true) return "draining";
    } catch {
      /* not the server's own answer */
    }
  }
  // the edge answers for a server that is not there (yet)
  if (response.status === 502 || response.status === 503 || response.status === 504) return "gateway";
  return response.ok ? "up" : "down";
}

// The live frames are read once for the whole app, outside React.
let restartAnnouncedAt: number | null = null;
let perspicax: ConnectorStatus | null = null;
const listeners = new Set<() => void>();
let snapshot: { restartAnnouncedAt: number | null; perspicax: ConnectorStatus | null } = { restartAnnouncedAt, perspicax };
function publish() {
  snapshot = { restartAnnouncedAt, perspicax };
  for (const listener of listeners) listener();
}
let unlisten: (() => void) | null = null;
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  unlisten ??= listenLiveFrames({
    onFrame: (frame) => {
      if (frame.kind === "server.restarting") {
        restartAnnouncedAt = Date.now();
        publish();
      } else if (frame.kind === "connector.status") {
        perspicax = parseConnector(frame.perspicax);
        publish();
      }
    },
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unlisten) { unlisten(); unlisten = null; }
  };
}

function parseConnector(value: unknown): ConnectorStatus | null {
  const status = value as Partial<ConnectorStatus> | null | undefined;
  if (!status || (status.state !== "ok" && status.state !== "unreachable") || typeof status.since !== "number") return null;
  return { state: status.state, since: status.since };
}

/** Tests only. */
export function resetConnectionNoticeForTests(): void {
  restartAnnouncedAt = null;
  perspicax = null;
  publish();
}

/** The notice to draw now: one of the three kinds, "reconnected" for a
 * moment after one that showed clears, or null. */
export function useConnectionNotice(): { kind: ConnectionNoticeKind | "reconnected"; dismiss: () => void } | null {
  const enabled = useLocalSwitch(connectionNotices);
  const online = useNetworkOnline();
  const connected = useStoreSelector((current) => current.connected);
  const everConnected = useStoreSelector((current) => current.everConnected);
  const disconnectedAt = useStoreSelector((current) => current.disconnectedAt);
  const frames = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const [health, setHealth] = useState<ConnectionWatch["health"]>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [reconnectedUntil, setReconnectedUntil] = useState(0);
  const [polled, setPolled] = useState<ConnectorStatus | null>(null);
  const shown = useRef<string | null>(null);

  // The connector's state when the stream (re)opens; frames follow it.
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    void fetch("/api/connector-status", { cache: "no-store", headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { perspicax?: unknown } | null) => { if (alive) setPolled(parseConnector(body?.perspicax)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [connected]);

  // While away: ask the server's health every few seconds, and tick so the
  // debounce and the update window are crossed on time.
  useEffect(() => {
    if (connected) { setHealth(null); return; }
    if (!everConnected) return;
    let alive = true;
    const probe = () => {
      void fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(4_000) })
        .then(readHealth, () => "down" as const)
        .then((state) => {
          if (!alive) return;
          setHealth(state);
          // the server is back: reconnect now instead of at the end of the
          // stream's backoff, so a restart passes without a notice
          if (state === "up") retryLiveEventsNow();
        });
    };
    const first = setTimeout(probe, 1_000);
    const timer = setInterval(probe, HEALTH_PROBE_MS);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
  }, [connected, everConnected]);

  const connector = frames.perspicax ?? polled;
  const pending = (!connected && everConnected) || connector?.state === "unreachable" || reconnectedUntil > now;
  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [pending]);

  const notice = useMemo(() => connectionNoticeFor({
    connected, everConnected, disconnectedAt, restartAnnouncedAt: frames.restartAnnouncedAt, health,
    perspicax: connector, online,
  }, now), [connected, everConnected, disconnectedAt, frames.restartAnnouncedAt, health, connector, online, now]);

  const visible = notice && !dismissed.has(notice.occurrence) ? notice : null;
  // A notice that showed and then cleared on its own says "Reconnected".
  useEffect(() => {
    if (visible) { shown.current = visible.occurrence; return; }
    if (shown.current && !notice) {
      shown.current = null;
      if (online) setReconnectedUntil(Date.now() + RECONNECTED_SHOW_MS);
    }
  }, [visible, notice, online]);

  if (!enabled) return null;
  if (visible) {
    return { kind: visible.kind, dismiss: () => {
      // dismissed for this occurrence, and no "Reconnected" after it either
      shown.current = null;
      setDismissed((current) => new Set(current).add(visible.occurrence));
    } };
  }
  if (reconnectedUntil > now) return { kind: "reconnected", dismiss: () => setReconnectedUntil(0) };
  return null;
}
