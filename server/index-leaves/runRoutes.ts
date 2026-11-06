// @ts-nocheck
/** runRoutes (#1388). Pure move from server/index.ts. */
import { json, readBody, estimateJsonBytes, BODY_YIELD_BYTES, yieldToEventLoop } from "../harness/http.ts";
import { dispatchRoutes, ROUTES } from "../routes/table.ts";
export type Host = Record<string, any>;

export function createRunRoutes(getHost: () => Host): any {
async function runRoutes(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, auth: RequestAuth): Promise<boolean> {
  const host = getHost();
  // #1750: after a large body is read, yield once more before the route's
  // zod safeParse so JSON.parse and validation are not one continuous block.
  if (await dispatchRoutes(ROUTES, {
    req, res, url, path, method, auth, json,
    readBody: async (incoming, limit) => {
      const body = await readBody(incoming, limit);
      if (estimateJsonBytes(body) >= BODY_YIELD_BYTES) await yieldToEventLoop();
      return body;
    }
  })) return true;

  // Isolated integration fixtures cannot invoke an MCP tool before their
  // fake provider exits, so they mint an exact synthetic turn capability
  // through a per-process high-entropy test key. The route does not exist
  // unless the launcher explicitly sets that key; production builds never
  // set it.
  // Isolated fixtures have no Electron parent to relay an organization's
  // library, so a test relays one here instead. Like the capability route
  // below, it exists only when the launcher sets its high-entropy key.
  return false;
}
  return runRoutes;
}
