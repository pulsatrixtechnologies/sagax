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
}

export interface InternalRouteContext {
  res: ServerResponse;
  path: string;
  method: string;
  /** Request URL (query params for GET internal routes). Optional until every
   * caller passes it; wave-1 slices that need query params read it. */
  url?: URL;
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
