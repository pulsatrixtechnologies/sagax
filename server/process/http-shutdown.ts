// Bounded HTTP drain for a deploy or restart: mark probes unready so the
// edge (Caddy health checks, k8s readiness) stops sending new work, close
// live SSE streams so clients reconnect with their cursor, stop accepting
// new sockets, and wait for in-flight HTTP to finish within a deadline.
import type { Server } from "node:http";

// How long the server keeps an idle kept-alive connection open (#4128).
//
// HTTP/1.1 lets the client reuse a connection, but either side may close it
// once it is idle. When the server closes first, a request the client writes
// at that moment is lost without an answer ("other side closed", a 502 from a
// proxy for a POST it may not retry). Node closes after 5 s by default, which
// is shorter than the idle window of the proxies in front of the server (a
// reverse proxy's upstream pool keeps a connection up to 2 minutes) and of a
// client whose event loop is busy for a few seconds between two calls.
//
// So the server is the side that waits longest: past every such window, the
// client or the proxy always closes an idle connection first, and the server
// only ever closes one nobody can still be writing to. The reply's
// `Keep-Alive: timeout=` header tells clients the same figure. A drain below
// still closes idle connections at once.

/** Above a reverse proxy's 2 minute upstream idle timeout. */
export const HTTP_KEEP_ALIVE_MS = 125_000;

/** Applies the server's kept-alive idle timeout to a listener. */
export function keepIdleConnectionsOpen<T extends Server>(server: T): T {
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_MS;
  return server;
}

let shuttingDown = false;

/** True once graceful shutdown has begun. Health probes return 503. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Flip readiness off. Idempotent. Safe to call before drainHttpServers. */
export function markShuttingDown(): void {
  shuttingDown = true;
}

/** Tests only: restore the ready state between cases. */
export function resetShuttingDownForTests(): void {
  shuttingDown = false;
}

const bounded = (work: Promise<unknown>, ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return Promise.race([work.then(() => undefined, () => undefined), deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

/** Stop accepting on each server and wait for open connections to finish,
 * or force-close them when the budget elapses. */
export async function drainHttpServers(
  servers: ReadonlyArray<Server | null | undefined>,
  options: { timeoutMs?: number; closeStreams?: () => void } = {},
): Promise<void> {
  markShuttingDown();
  options.closeStreams?.();
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10_000);
  const live = servers.filter((server): server is Server => Boolean(server));
  if (live.length === 0) return;

  await bounded(
    Promise.all(
      live.map(
        (server) =>
          new Promise<void>((resolve) => {
            // close() refuses new connections and resolves when existing ones end.
            server.close(() => resolve());
            // Idle keep-alives would otherwise hold the process until the OS times them out.
            server.closeIdleConnections?.();
            if (timeoutMs === 0) {
              server.closeAllConnections?.();
              resolve();
            }
          }),
      ),
    ),
    timeoutMs,
  );

  for (const server of live) {
    try {
      server.closeAllConnections?.();
    } catch {
      // Already closed or platform without closeAllConnections.
    }
  }
}
