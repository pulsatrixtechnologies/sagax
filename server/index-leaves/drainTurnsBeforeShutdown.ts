// @ts-nocheck
/** drainTurnsBeforeShutdown (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDrainTurnsBeforeShutdown(getHost: () => Host): any {
async function drainTurnsBeforeShutdown() {
  const host = getHost();
  const { sseClients } = host;

  // 1. Mark probes unready so the edge holds new requests (Caddy lb_try /
  //    k8s readiness) instead of answering 502 while we drain.
  host.markShuttingDown();
  // 2. End live SSE streams so clients reconnect with their cursor; the
  //    edge holds those reconnects until the next process is ready.
  //    #2013: each first hears that this is a planned restart (an update
  //    or a restart), so the app says "back in a moment", not "unreachable".
  //    No id: it is transport news, never a replay boundary.
  const restarting = `data: ${JSON.stringify({ kind: "server.restarting", at: Date.now() })}\n\n`;
  // A copy on purpose: close() removes the client from the live set.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const client of [...sseClients]) {
    try { deliverSseFrame(client, "server.restarting", restarting); } catch { /* already gone */ }
    try { client.close(); } catch { /* already gone */ }
  }
  host.routines?.pause();
  host.coordinator.close();
  // Written first, so a stop that kills the process during the drain (a
  // short container grace period) still resumes them; rewritten after.
  host.noteTurnsCutByShutdown(false);
  const left = await drainTurns({ busy: () => host.busyDirectThreads().map((t) => t.threadId), waitingOnPerson: host.threadWaitsOnPerson, timeoutMs: host.SHUTDOWN_DRAIN_MS });
  console.log(`shutdown: ${left.length ? `${left.length} turn(s) still working, resumed at the next start` : "no turn in progress"}`);
  // 3. Stop accepting and finish in-flight HTTP within the remaining budget.
  //    Runtime state is already durable; bus/session flush runs in exit().
  const httpBudget = Math.max(1_000, Math.min(host.SHUTDOWN_DRAIN_MS || 5_000, 10_000));
  await host.drainHttpServers([host.server, host.webhookIngress?.server, host.tunnelListener], { timeoutMs: httpBudget });

}
  return drainTurnsBeforeShutdown;
}
