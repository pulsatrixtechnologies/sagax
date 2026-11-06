// Sagax watches a remote support session the bot opened, so nobody has to
// say "it is launched" (#1499). From remote_support_open until the end
// user's computer joins, it asks Perspicax for the state on its own, in the
// opener's name, through the same status call the bot makes
// (handleRemoteSupportCall in server/remote-support/remote-support-local.ts): when the
// state says started, that call connects this computer with the session's
// own key and marks it connected, and the registrar posts the session card
// in the conversation (server/remote-support/remote-session-register.ts). The watch ends
// on connected, ended, expired or cancelled, when the code leaked
// (technician_side refused), when the session is closed, at its end, or
// after WATCH_MAX_MS.

export interface SupportWatchTarget {
  principalId: string;
  botId: string;
  threadId: string;
  code: string;
  /** The session's end (RFC 3339): no watch past it. */
  endAt: string;
}

/** What one status call answered, as far as the watch needs it. */
export interface SupportCheck {
  state?: string;
  /** technician_side refused: more than one address took the script. */
  refused?: boolean;
  /** The call failed (Perspicax unreachable, no profile, not yours). */
  error?: boolean;
}

/** Poll every WATCH_FAST_MS for the first WATCH_FAST_FOR_MS (the person
 * usually runs the line within a minute or two), then every WATCH_SLOW_MS. */
export const WATCH_FAST_MS = 4_000;
export const WATCH_FAST_FOR_MS = 3 * 60_000;
export const WATCH_SLOW_MS = 12_000;
/** Perspicax gives the end user 30 minutes to start; a little more here. */
export const WATCH_MAX_MS = 40 * 60_000;
/** Consecutive failed calls before the watch gives up. */
export const WATCH_MAX_ERRORS = 5;

const DONE_STATES = new Set(["connected", "ended", "expired", "cancelled", "closed"]);

/** Whether a check ends the watch. */
export function watchSettled(check: SupportCheck): boolean {
  return check.refused === true || (typeof check.state === "string" && DONE_STATES.has(check.state));
}

/** The status call's text (one JSON object, then perhaps a note line) as a check. */
export function parseSupportCheck(text: string, isError?: boolean): SupportCheck {
  if (isError) return { error: true };
  const first = text.split("\n", 1)[0] ?? "";
  try {
    const parsed = JSON.parse(first) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: true };
    const obj = parsed as Record<string, unknown>;
    return {
      ...(typeof obj.state === "string" ? { state: obj.state } : {}),
      ...(obj.technician_side === "refused" ? { refused: true } : {}),
    };
  } catch {
    return { error: true };
  }
}

export function createRemoteSupportWatcher(deps: {
  /** One remote_support_status for this session, in the opener's name. */
  check(target: SupportWatchTarget): Promise<SupportCheck>;
  /** The watch ended: release what it held (its Perspicax generation). */
  release?(target: SupportWatchTarget): Promise<void> | void;
  now?: () => number;
  /** setTimeout by default; tests drive it. Returns a cancel. */
  schedule?: (run: () => void, ms: number) => () => void;
  log?: (line: string) => void;
}) {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((run, ms) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  });
  const watches = new Map<string, { target: SupportWatchTarget; started: number; errors: number; cancel: (() => void) | null; busy: boolean }>();
  const keyOf = (code: string) => code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  function finish(code: string) {
    const watch = watches.get(code);
    if (!watch) return;
    watches.delete(code);
    watch.cancel?.();
    void Promise.resolve(deps.release?.(watch.target)).catch(() => {});
  }

  function next(code: string) {
    const watch = watches.get(code);
    if (!watch) return;
    const at = now();
    const end = Date.parse(watch.target.endAt);
    if (at - watch.started >= WATCH_MAX_MS || (Number.isFinite(end) && at >= end)) {
      finish(code);
      return;
    }
    const delay = at - watch.started < WATCH_FAST_FOR_MS ? WATCH_FAST_MS : WATCH_SLOW_MS;
    watch.cancel = schedule(() => void tick(code).catch(() => {}), delay);
  }

  async function tick(code: string) {
    const watch = watches.get(code);
    if (!watch || watch.busy) return;
    watch.cancel = null;
    watch.busy = true;
    let check: SupportCheck;
    try {
      check = await deps.check(watch.target);
    } catch {
      check = { error: true };
    }
    watch.busy = false;
    if (watches.get(code) !== watch) return;
    if (watchSettled(check)) {
      finish(code);
      return;
    }
    watch.errors = check.error ? watch.errors + 1 : 0;
    if (watch.errors >= WATCH_MAX_ERRORS) {
      deps.log?.(`remote support: stopped watching a session after ${WATCH_MAX_ERRORS} failed status calls`);
      finish(code);
      return;
    }
    next(code);
  }

  return {
    /** Start watching a session the bot just opened (again: restarts it). */
    watch(target: SupportWatchTarget): void {
      const code = keyOf(target.code);
      if (!code) return;
      const previous = watches.get(code);
      if (previous) {
        previous.cancel?.();
        watches.delete(code);
      }
      watches.set(code, { target: { ...target, code }, started: now(), errors: 0, cancel: null, busy: false });
      next(code);
    },
    /** The session was closed: stop watching it. */
    stop(code: string): void {
      finish(keyOf(code));
    },
    /** The codes watched now, for tests. */
    active(): string[] {
      return [...watches.keys()];
    },
  };
}

export type RemoteSupportWatcher = ReturnType<typeof createRemoteSupportWatcher>;
