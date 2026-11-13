/** A refusal from one of the app's own routes, run as the person
 * (performAsMember), read once for every API that passes it on (the agent
 * API and the member API): its status, its code, its sentence (message,
 * else error, else the fallback, never empty), its permission, its field
 * and the run it names. */
export interface RouteRefusalParts {
  status: number;
  code: string;
  message: string;
  permission?: string;
  field?: string;
  runId?: string;
}

/** A word that is a code, not a sentence (bots_read_only, not_found...). */
const CODE_WORD = /^[a-z][a-z0-9_]{2,40}$/;

const codeForStatus = (status: number): string =>
  status === 404 ? "not_found" : status === 403 ? "forbidden" : status === 409 ? "conflict" : status >= 500 ? "server_error" : "refused";

export function readRouteRefusal(reply: { status: number; body: unknown }, fallback: string): RouteRefusalParts {
  const body = reply.body && typeof reply.body === "object" && !Array.isArray(reply.body) ? reply.body as Record<string, unknown> : {};
  const said = (key: string): string => typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const permission = said("permission");
  const field = said("field");
  // A start refused because a run is under way names that run (2026-11-01).
  const runId = said("runId");
  const error = said("error");
  // The route's own code; "forbidden" is only the permission gate's marker.
  const own = said("code") || (CODE_WORD.test(error) && error !== "forbidden" ? error : "");
  const message = said("message") || (error && error !== own && !(error === "forbidden" && permission) ? error : "") || fallback;
  const status = reply.status >= 400 && reply.status < 600 ? reply.status : 502;
  return {
    status,
    code: permission ? "forbidden_permission" : own || codeForStatus(status),
    message: message.slice(0, 500),
    ...(permission ? { permission } : {}),
    ...(field ? { field } : {}),
    ...(runId ? { runId } : {}),
  };
}
