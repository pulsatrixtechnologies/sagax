// #3623: which of the engine's tool servers the bounded wait of
// configureSession (grok.ts) waited for. Each poll of `_x.ai/mcp/list` is
// read once more here: a server's time is the time from the wait's start to
// the first poll where it no longer waits (grokMcpServerWaiting, the same
// reading grokMcpSettled makes). The poll interval (50 to 100 ms plus the
// request) bounds the precision. Numbers and fixed product names only: the
// person's own connections are counted, never named.
import { PERSPICAX_MCP_PREFIX, RESERVED_MCP_NAMES } from "../../../shared/mcp-reserved-names.ts";
import type { TurnToolWait } from "./turn-latency.ts";

type CatalogServer = { name?: unknown; session?: { enabled?: unknown; status?: unknown } } | null | undefined;

/** Whether one server of an `_x.ai/mcp/list` answer is still connecting
 * (pending, connecting or starting) and enabled: the one reading of a
 * server's state, shared with grokMcpSettled. */
export function grokMcpServerWaiting(server: CatalogServer): boolean {
  const status = typeof server?.session?.status === "string" ? server.session.status.toLowerCase() : "";
  return server?.session?.enabled !== false && (status === "pending" || status === "connecting" || status === "starting");
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
 * list of servers the turn sent with session/new or load (by name). */
export function grokMcpWaitClock(mounted: readonly string[], start: number) {
  const mounts = new Map<string, string>();
  for (const name of mounted) mounts.set(normalized(name), name);
  /** catalog name -> ms from start to the first poll it no longer waited */
  const answered = new Map<string, number>();
  let waiting = new Set<string>();
  return {
    /** One poll's answer (`result` of `_x.ai/mcp/list`), read at `at`. */
    note(catalog: unknown, at = Date.now()): void {
      const servers = (catalog as { servers?: unknown } | null | undefined)?.servers;
      if (!Array.isArray(servers)) return;
      const still = new Set<string>();
      for (const server of servers as CatalogServer[]) {
        const name = typeof server?.name === "string" ? server.name : "";
        if (!name || server?.session?.enabled === false) continue;
        if (grokMcpServerWaiting(server)) still.add(name);
        else if (!answered.has(name)) answered.set(name, Math.max(0, Math.round(at - start)));
      }
      waiting = still;
    },
    /** What the turn's latency line prints. `limitHit`: the wait ended on its
     * time limit (or without the engine's word) with servers still waiting. */
    result(end: number, limitHit: boolean): TurnToolWait {
      const wait: TurnToolWait = { waitedMs: Math.max(0, Math.round(end - start)), mounts: [] };
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
      return wait;
    },
  };
}
