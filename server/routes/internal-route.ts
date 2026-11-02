// Internal harness routes (POST /api/internal/...) that live in server/routes.
//
// An internal route answers only behind the per-turn capability the internal
// block of server/index.ts checks first (bearer, bot, kind, live turn). The
// ROUTES table runs before that gate, so these handlers are not listed there:
// index.ts builds each one with its dependencies (`createXRoutes(deps)`), lists
// it in INTERNAL_ROUTES and runs that list from the internal block with the
// capability it already checked. Same contract as table.ts: PASS declines.
import type { ServerResponse } from "node:http";
import type { json } from "../harness/http.ts";
import { PASS } from "./table.ts";

/** What the internal block already checked about the caller. */
export interface InternalCapabilityView {
  botId: string;
  threadId: string;
  generation: string;
  /** How deep in a bot-to-bot chain this turn is: 0 is a person's own turn. */
  depth?: number;
  sandboxPrincipalId?: string;
  desktopPrincipalId?: string;
  /** react_to_message calls this turn has made. Mutable on the live capability. */
  reactions?: number;
  /** Group memory / workspace write refusals this turn. Mutable on the live capability. */
  memoryRefusals?: number;
  /** Whether this turn may stage skill writes (I4 skills/stage). */
  skillAuthoring?: boolean;
  /** attach_file may also copy host files saved this turn (I4). */
  deliversSavedFiles?: boolean;
  /** Wall clock when the turn minted its capability (I4 attach_file). */
  turnStartedAt?: number;
  /** attach_file calls this turn has made. Mutable on the live capability. */
  attachedFiles?: number;
  /** Perspicax profile mounted for this turn (I6 /api/internal/perspicax/mcp). */
  perspicaxProfile?: string;
  /** Browser session id mounted for this turn (I1 /api/internal/browser/mcp). */
  browserSession?: string;
  /** Team computer id when this turn uses a shared team computer (I1 computer-control). */
  teamComputerId?: string;
  /** Personal MCP server name for a personal-mcp capability (I1). */
  personalMcpServer?: string;
  /** Plugin MCP identity for a personal-mcp capability that relays a plugin command (I1). */
  pluginMcp?: { scope: "organization" | "person" | "bot"; key: string; name: string };
  /** Cloud computer Boat id for this turn (I1 /api/internal/computer/mcp). null means first-call claim. */
  boxId?: string | null;
  /** Room coordination turn (I5 coordinate_bots / room-targets). */
  roomCoordination?: boolean;
  /** Active room handoff id when this turn is a coordinator child (I5). */
  roomHandoffId?: string;
  /** Delegations this turn handed out; their ids may not be polled until a later turn (I5). */
  delegatedThisTurn?: Set<string>;
  /** create_bot calls this turn has made (I5). Mutable. */
  createdBots?: number;
  /** create_room calls this turn has made (I5). Mutable. */
  createdRooms?: number;
  /** start_thread / run_with_engine opens this turn has made (I5). Mutable. */
  openedThreads?: number;
  /** post_to_room calls this turn has made (I5). Mutable. */
  roomPosts?: number;
  /** Whether a room turn may open a self-owned thread (I5 threads). */
  ownThreadCreation?: boolean;
}

export interface InternalRouteContext {
  res: ServerResponse;
  path: string;
  method: string;
  /** Request URL (query params for GET internal routes). Optional until every
   * caller passes it; wave-1 slices that need query params read it. */
  url?: URL;
  /** Request headers (I5 ask-bot / delegate-bot idempotency-key). */
  headers?: Record<string, string | string[] | undefined>;
  json: typeof json;
  capability: InternalCapabilityView;
  /** The internal block's body reader: it re-checks that the turn is live. */
  readBody(): Promise<Record<string, unknown>>;
}

export type InternalRouteHandler = (ctx: InternalRouteContext) => Promise<typeof PASS | void>;

/** Runs handlers in order until one answers; true means stop routing. */
export async function dispatchInternalRoutes(routes: readonly InternalRouteHandler[], ctx: InternalRouteContext): Promise<boolean> {
  for (const route of routes) {
    const out = await route(ctx);
    if (out !== PASS || ctx.res.headersSent || ctx.res.writableEnded) return true;
  }
  return false;
}
