// The answer handleRequest gives when a step throws (#3216).
//
// A route that already started its reply (an SSE stream, a streamed body, a
// json() it sent before failing) and then throws must never get a second
// writeHead: ERR_HTTP_HEADERS_SENT from inside the catch escaped the async
// handler as an unhandled rejection and took the whole server down twice in
// four minutes on a hosted server (0.8.77). Log the original error with the route, close
// the half-sent reply, and keep the process up.
import type { ServerResponse } from "node:http";

import { json } from "../harness/http.ts";

/** Error codes the client is allowed to see by name. */
const CLIENT_CODES = new Set([
  "guarded_busy",
  "guarded_branch",
  "guarded_permissions",
  "guarded_request_changed",
  "guarded_request_untracked",
  "outside_workspace",
  "org_full_access_disabled",
  "parallel_limit",
  "parallel_nested",
  "misuse_blocked",
  "misuse_approval_required",
  "misuse_locked",
  "safety_blocked",
  "no_engine"
]);

export function answerRequestError(
  res: ServerResponse,
  e: unknown,
  method: string,
  path: string,
  log: (...args: unknown[]) => void = console.error
): void {
  if (res.headersSent || res.writableEnded) {
    log(`[request] ${method} ${path} failed after its reply started:`, e);
    if (!res.writableEnded) {
      try {
        res.destroy();
      } catch {
        /* already gone */
      }
    }
    return;
  }
  const status = (e as { status?: unknown })?.status;
  const candidateCode = (e as { code?: unknown })?.code;
  const code = typeof candidateCode === "string" && CLIENT_CODES.has(candidateCode) ? candidateCode : undefined;
  // 2026-11-02: a misuse block names its one reason (a category id)
  const candidateReason = (e as { reason?: unknown })?.reason;
  const reason =
    code === "misuse_blocked" && typeof candidateReason === "string" && /^[a-z_]{1,40}$/.test(candidateReason)
      ? candidateReason
      : undefined;
  json(res, typeof status === "number" ? status : 500, {
    error: e instanceof Error ? e.message : String(e),
    ...(code ? { code } : {}),
    ...(reason ? { reason } : {})
  });
}
