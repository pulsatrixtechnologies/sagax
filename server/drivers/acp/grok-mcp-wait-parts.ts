// #3623: which of the engine's tool servers the bounded wait of
// configureSession (grok.ts) waited for. Each poll of `_x.ai/mcp/list` is
// read once more here: a server's time is the time from the wait's start to
// the first poll after the last one where it was seen waiting
// (grokMcpServerWaiting, the same reading grokMcpSettled makes). At the first
// poll the engine has often not begun to connect anything (no state yet), so
// a server never seen waiting gets no time of its own; `resolvedMs` is the
// first poll where the engine said `sessionMcpResolved`. The poll interval
// (50 to 100 ms plus the request) bounds the precision. Numbers and fixed
// product names only: the person's own connections are counted, never named.
// Sagax's own side of the same wait (its endpoints' first request and tool
// list answer) rides the turn's trace (server/turns/turn-trace.ts).
import { PERSPICAX_MCP_PREFIX, RESERVED_MCP_NAMES } from "../../../shared/mcp-reserved-names.ts";
import { closeTurnServing, openTurnServing } from "../../turns/turn-trace.ts";
import type { TurnToolWait } from "./turn-latency.ts";

type CatalogServer = { name?: unknown; session?: { enabled?: unknown; status?: unknown } } | null | undefined;

/** Whether one server of an `_x.ai/mcp/list` answer is still connecting
 * (pending, connecting, starting or initializing) and enabled: the one
 * reading of a server's state, shared with grokMcpSettled. Grok 1.0.77
 * reports a server it is still starting as `initializing` (seen on a fixture
 * turn, #3623); without it no server was ever seen waiting and toolsBy only
 * ever printed `resolved`. */
export function grokMcpServerWaiting(server: CatalogServer): boolean {
  const status = typeof server?.session?.status === "string" ? server.session.status.toLowerCase() : "";
  return server?.session?.enabled !== false && (status === "pending" || status === "connecting" || status === "starting" || status === "initializing");
}

/** The servers Sagax mounts under a fixed product name (instance-mcp.ts,
 * the index-leaves mounts). Any other name a turn mounts (a person's own
 * server, a plugin's, the installation's) prints as its kind. */
const PRODUCT_NAMES: ReadonlySet<string> = new Set([...RESERVED_MCP_NAMES, "messages", "perspicax", "sagax-computer"]);

/** The name a mount prints under: its product name, or its kind when the name
 * is not one of Sagax's fixed names (it may carry a person's or a bot's
 * identifier). */
export function grokMountLabel(name: string): string {
  if (PERSPICAX_MCP_PREFIX.test(name)) return "perspicax";
  return PRODUCT_NAMES.has(name) ? name : "connector";
}

const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Times each server of the catalog from `start` (epoch ms). `mounted` is the
 * list of servers the turn sent with session/new or load (by name).
 * `threadId`: the turn whose own endpoints note what they served meanwhile. */
export function grokMcpWaitClock(mounted: readonly string[], start: number, threadId?: string) {
  const mounts = new Map<string, string>();
  for (const name of mounted) mounts.set(normalized(name), name);
  if (threadId) openTurnServing(threadId, start);
  const since = (at: number) => Math.max(0, Math.round(at - start));
  /** catalog name -> ms from start to the first poll after its last wait */
  const answered = new Map<string, number>();
  /** servers seen waiting (pending, connecting, starting) at some poll */
  const waited = new Set<string>();
  let waiting = new Set<string>();
  let resolvedMs: number | undefined;
  return {
    /** One poll's answer (`result` of `_x.ai/mcp/list`), read at `at`. */
    note(catalog: unknown, at = Date.now()): void {
      const value = catalog as { servers?: unknown; sessionMcpResolved?: unknown } | null | undefined;
      const servers = value?.servers;
      if (!Array.isArray(servers)) return;
      if (resolvedMs === undefined && value?.sessionMcpResolved === true) resolvedMs = since(at);
      const still = new Set<string>();
      for (const server of servers as CatalogServer[]) {
        const name = typeof server?.name === "string" ? server.name : "";
        if (!name || server?.session?.enabled === false) continue;
        if (grokMcpServerWaiting(server)) {
          still.add(name);
          waited.add(name);
          answered.delete(name);
        } else if (waited.has(name) && !answered.has(name)) {
          answered.set(name, since(at));
        }
      }
      waiting = still;
    },
    /** What the turn's latency line prints. `limitHit`: the wait ended on its
     * time limit (or without the engine's word) with servers still waiting. */
    result(end: number, limitHit: boolean): TurnToolWait {
      const wait: TurnToolWait = { waitedMs: since(end), mounts: [] };
      let ownCount = 0;
      let ownLongest = 0;
      for (const [name, ms] of answered) {
        const mount = mounts.get(normalized(name));
        if (mount !== undefined) {
          wait.mounts.push([grokMountLabel(mount), ms]);
        } else {
          ownCount += 1;
          ownLongest = Math.max(ownLongest, ms);
        }
      }
      wait.mounts.sort((a, b) => b[1] - a[1]);
      if (ownCount) wait.own = { count: ownCount, longestMs: ownLongest };
      if (limitHit && waiting.size) wait.pending = waiting.size;
      if (resolvedMs !== undefined) wait.resolvedMs = resolvedMs;
      const served = threadId ? closeTurnServing(threadId) : [];
      if (served.length) wait.served = served;
      return wait;
    },
  };
}
