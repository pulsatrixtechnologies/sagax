// An orchestrator bot's work, kept current for its panel without polling
// hard (#3451 lot 2, #3462; design section 2):
// 1. one read when the section mounts (GET /api/bots/:id/team-work, since
//    the reader's local midnight);
// 2. the ids-only `team.work` frame (a hand-over created, started, parked or
//    settled) reads it again, debounced 1 second;
// 3. between the two, no request: the runtime events of the step threads,
//    which the app's one live stream already carries, move the last action,
//    the tool call in flight and the computer wait (one map lookup per
//    frame, no React state written per frame), and a clock looks every
//    second while a step is open, and redraws only when what the section
//    shows changed (an age in seconds, a minute passed, a state): "6 min"
//    redraws once a minute, not sixty times (#3624);
// 4. a safety read every 60 seconds while a step is open, and one when the
//    stream lost frames it could not replay.
// The last read is kept per orchestrator so a step's coding chat words its
// meta line from the same list.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { TEAM_WORK_FRAME, type TeamWork } from "../../shared/team-work";
import { listenLiveFrames } from "@/lib/live-events";
import { foldTeamEvent, teamLiveThreads, teamWorkAt, teamWorkFace, teamWorkTicking, type TeamOverlay } from "@/lib/team-work";

/** One read after a burst of frames, at most this often. */
export const TEAM_WORK_DEBOUNCE_MS = 1_000;
/** The safety read while a step is open. */
export const TEAM_WORK_SAFETY_MS = 60_000;
/** The clock of the ages while a step is open. */
export const TEAM_WORK_TICK_MS = 1_000;

export type TeamWorkLoader = (botId: string, since: number) => Promise<TeamWork>;

/** The reader's local midnight: what "Done today" counts from. */
export function localMidnight(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function teamWorkPath(botId: string, since: number): string {
  return `/api/bots/${encodeURIComponent(botId)}/team-work?since=${since}`;
}

/** The read itself, through the app's api helper (loaded on use, so a
 * test of the section never pulls the whole store in). */
export const loadTeamWork: TeamWorkLoader = async (botId, since) => {
  const { api } = await import("@/state/store");
  return api<TeamWork>(teamWorkPath(botId, since));
};

// ── the last read, per orchestrator ───────────────────────────────────

/** A read and what the stream said since, shared with the step's chat. */
export interface TeamWorkRead {
  work: TeamWork;
  overlays: ReadonlyMap<string, TeamOverlay>;
}

const reads = new Map<string, TeamWorkRead>();
const readListeners = new Set<() => void>();

function keepRead(botId: string, read: TeamWorkRead | null): void {
  if (read) reads.set(botId, read);
  else reads.delete(botId);
  for (const listener of readListeners) listener();
}

function subscribeReads(listener: () => void): () => void {
  readListeners.add(listener);
  return () => readListeners.delete(listener);
}

/** The orchestrator's last read, while its panel holds one (a step's
 * coding chat reads its place from it). */
export function useTeamWorkRead(botId: string | undefined): TeamWorkRead | null {
  return useSyncExternalStore(subscribeReads, () => (botId ? reads.get(botId) ?? null : null), () => null);
}

/** Hold a read for an orchestrator without its panel (tests, galleries). */
export function setTeamWorkRead(botId: string, work: TeamWork | null): void {
  keepRead(botId, work ? { work, overlays: new Map() } : null);
}

// ── the hook ──────────────────────────────────────────────────────────

export interface TeamWorkView {
  /** The work re-aged at `now`; null before the first read or after a failed one. */
  work: TeamWork | null;
  /** The first read failed: the caller keeps today's section. */
  failed: boolean;
  now: number;
}

export function useTeamWork(botId: string, options: { load?: TeamWorkLoader; clock?: () => number } = {}): TeamWorkView {
  const load = options.load ?? loadTeamWork;
  const clock = options.clock ?? Date.now;
  const [read, setRead] = useState<TeamWork | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => clock());
  // what the stream said since the read, by step thread: a ref, so a frame
  // writes no React state
  const overlays = useRef(new Map<string, TeamOverlay>());
  const threads = useRef<ReadonlySet<string>>(new Set());
  const alive = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const clockRef = useRef(clock);
  clockRef.current = clock;

  const refresh = useCallback(() => {
    const at = clockRef.current();
    return loadRef.current(botId, localMidnight(at)).then(
      (next) => {
        if (!alive.current) return;
        overlays.current = new Map();
        threads.current = teamLiveThreads(next);
        setRead(next);
        setFailed(false);
        setNow(clockRef.current());
        keepRead(botId, { work: next, overlays: overlays.current });
      },
      () => {
        // a failed first read keeps today's section; a failed refresh keeps the last list
        if (alive.current) setFailed(true);
      },
    );
  }, [botId]);

  useEffect(() => {
    alive.current = true;
    setRead(null);
    setFailed(false);
    overlays.current = new Map();
    threads.current = new Set();
    void refresh();
    return () => {
      alive.current = false;
      keepRead(botId, null);
    };
  }, [botId, refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void refresh(); }, TEAM_WORK_DEBOUNCE_MS);
    };
    const stop = listenLiveFrames({
      onMissedFrames: () => void refresh(),
      onFrame: (frame) => {
        const kind = (frame as { kind: string }).kind;
        if (kind === TEAM_WORK_FRAME) {
          if ((frame as unknown as { botId?: string }).botId === botId) soon();
          return;
        }
        if (frame.kind !== "runtime") return;
        const event = frame.event;
        if (!threads.current.has(event.threadId)) return;
        const at = Date.parse(event.createdAt);
        const next = foldTeamEvent(overlays.current.get(event.threadId), event as { type: string; itemType?: string }, Number.isFinite(at) ? Math.min(at, clockRef.current()) : clockRef.current());
        if (next) overlays.current.set(event.threadId, next);
      },
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [botId, refresh]);

  const ticking = teamWorkTicking(read);
  const readRef = useRef(read);
  readRef.current = read;
  // what the last render shows (teamWorkFace), for the clock to compare
  const shown = useRef("");
  useEffect(() => {
    if (!ticking) return;
    const tick = setInterval(() => {
      const at = clockRef.current();
      const current = readRef.current;
      if (current && teamWorkFace(teamWorkAt(current, overlays.current, at), at) === shown.current) return;
      setNow(at);
    }, TEAM_WORK_TICK_MS);
    const safety = setInterval(() => void refresh(), TEAM_WORK_SAFETY_MS);
    return () => { clearInterval(tick); clearInterval(safety); };
  }, [ticking, refresh]);

  // the overlays (a ref) are read again at each tick
  const work = useMemo(() => {
    const next = read ? teamWorkAt(read, overlays.current, now) : null;
    shown.current = next ? teamWorkFace(next, now) : "";
    return next;
  }, [read, now]);
  return { work, failed: failed && read === null, now };
}
