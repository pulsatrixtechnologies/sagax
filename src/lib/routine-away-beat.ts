// A solo server's "is the person here" signal for routines set to "Only
// when I'm here" (server/routines/routine-away.ts): every minute, how long this page
// has gone unused, the desktop app adding the computer's own idle time and
// state (window.ogb.systemIdle: using the computer counts as being here).
// Coming back after an idle spell beats at once. An organization server
// answers 404 (its presence is the signal there) and the loop stops.
import type { SystemIdleState } from "../../shared/presence";

export const ROUTINE_AWAY_BEAT_PATH = "/api/routines/away/beat";
const BEAT_MS = 60_000;

export interface RoutineAwayBeatDeps {
  post: (path: string, body: { idleMs: number; systemIdle: SystemIdleState }) => Promise<{ ok: boolean; status: number }>;
  now: () => number;
  systemIdle?: () => Promise<{ state: SystemIdleState; idleSeconds: number } | null>;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/** The loop, for the page and for tests. Resolves null when the server has
 * no such route (an organization server, an older server). */
export async function startRoutineAwayLoop(deps: RoutineAwayBeatDeps): Promise<{ interacted: () => void; beat: () => Promise<boolean> } | null> {
  let lastInteraction = deps.now();
  let stopped = false;
  let idleSpell = false;
  const beat = async (): Promise<boolean> => {
    if (stopped) return false;
    let idleMs = Math.max(0, deps.now() - lastInteraction);
    let systemIdle: SystemIdleState = "unknown";
    if (deps.systemIdle) {
      try {
        const system = await deps.systemIdle();
        if (system) {
          systemIdle = system.state;
          idleMs = Math.min(idleMs, system.idleSeconds * 1_000);
        }
      } catch {
        // the page's own idle time decides
      }
    }
    idleSpell = idleMs > BEAT_MS || systemIdle === "idle" || systemIdle === "locked";
    try {
      const answer = await deps.post(ROUTINE_AWAY_BEAT_PATH, { idleMs: Math.floor(idleMs), systemIdle });
      if (answer.status === 404) stopped = true;
      return answer.ok;
    } catch {
      return false;
    }
  };
  await beat();
  if (stopped) return null;
  const handle = deps.setInterval(() => {
    if (stopped) deps.clearInterval(handle);
    else void beat();
  }, BEAT_MS);
  return {
    interacted: () => {
      lastInteraction = deps.now();
      if (idleSpell) { idleSpell = false; void beat(); }
    },
    beat,
  };
}

let started = false;

/** Started once by src/main.tsx for the desktop app or a page on a solo server. */
export async function startRoutineAwayBeat(): Promise<void> {
  if (started || typeof window === "undefined") return;
  started = true;
  const { api } = await import("@/state/store");
  const shell = window.ogb?.systemIdle;
  const loop = await startRoutineAwayLoop({
    post: async (path, body) => {
      try {
        await api(path, { method: "POST", body: JSON.stringify(body) });
        return { ok: true, status: 200 };
      } catch (error) {
        const status = (error as { status?: number }).status;
        return { ok: false, status: typeof status === "number" ? status : 0 };
      }
    },
    now: Date.now,
    systemIdle: shell ? () => shell() : undefined,
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
  });
  if (!loop) return;
  for (const name of ["pointerdown", "keydown", "wheel", "touchstart", "focus"] as const) {
    window.addEventListener(name, loop.interacted, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loop.interacted();
  });
}
