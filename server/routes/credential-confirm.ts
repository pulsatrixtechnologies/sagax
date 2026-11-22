// POST /api/me/credential-confirm { threadId }: the person agrees that this
// conversation may fall back onto a paid API key (#5180). The resolution
// that asked is the card; this is the answer the API stores for the next try.
import { PASS, type RouteHandler } from "./table.ts";

export const CREDENTIAL_CONFIRM_PATH = "/api/me/credential-confirm";

export function createCredentialConfirmRoutes(deps: { rememberPaidKey(threadId: string): boolean }): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== CREDENTIAL_CONFIRM_PATH || method !== "POST") return PASS;
    res.setHeader("cache-control", "no-store");
    if (!auth) return json(res, 401, { error: "Sign in to confirm a paid API key." });
    const body = await readBody(req).catch(() => undefined);
    const threadId = body && typeof body === "object" && !Array.isArray(body) ? (body as { threadId?: unknown }).threadId : undefined;
    if (typeof threadId !== "string" || !deps.rememberPaidKey(threadId)) {
      return json(res, 400, { error: "Send { threadId } for the conversation that asked to use a paid API key." });
    }
    return json(res, 200, { ok: true, threadId });
  };
}
