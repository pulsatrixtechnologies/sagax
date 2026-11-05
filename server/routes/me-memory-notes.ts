// Person-scoped Perspicax memory notes proxy (2026-11-02).
//
//   /api/me/memory/tree
//   /api/me/memory/entry
//   /api/me/memory/folder
//   /api/me/memory/bulk
//   /api/me/memory/trash[+ /undo|/empty]
//   /api/me/memory/tags
//   /api/me/memory/archived
//   /api/me/memory/order                (PUT: a folder's manual order)
//   /api/me/memory/collections[/<id>]   (curated, ordered notes)
//
// Forwards to Perspicax `/api/v1/memory/read/*` with the session's own live
// access token as Bearer. Session only; subject is always the signed-in
// person (never a body or query field). Solo servers and unsigned callers
// get a clear refusal. An expired Perspicax sign-in is 409
// `memory_sign_in_again` (same idea as me-avatar), never 401 on the Sagax
// session.
import type { ServerResponse } from "node:http";
import type { NotesCallResult, NotesMethod, PerspicaxMemoryNotesClient } from "../memory/perspicax-memory-notes.ts";
import { memoryReadPath } from "../memory/perspicax-memory-notes.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const ME_MEMORY_PREFIX = "/api/me/memory";

export interface MeMemoryNotesDeps {
  /** SAGAX_PERSPICAX_ISSUER when this is an organization server. */
  issuer: string;
  /** True when Perspicax is linked (origin reachable for notes). */
  linked: () => boolean;
  client: PerspicaxMemoryNotesClient;
}

/** The Perspicax person of a session signed in with this issuer, or null. */
export function memoryPrincipal(auth: RequestAuth, issuer: string): { principalId: string; sub: string } | null {
  if (auth.kind !== "session") return null;
  const idp = auth.session.idp;
  const principalId = auth.session.principalId?.trim();
  if (!principalId || !idp?.sub) return null;
  const trim = (value: string) => value.replace(/\/+$/, "");
  if (trim(idp.iss) !== trim(issuer)) return null;
  return { principalId, sub: idp.sub };
}

function mapResult(
  result: NotesCallResult,
  json: (res: ServerResponse, status: number, body: unknown) => void,
  res: ServerResponse,
): void {
  if (result.ok) {
    if (result.status === 204) {
      json(res, 204, { ok: true });
      return;
    }
    json(res, result.status, result.body ?? { ok: true });
    return;
  }
  if (result.error === "unauthorized") {
    json(res, 409, { error: "Sign in with Pulsatrix again to manage these notes.", code: "memory_sign_in_again" });
    return;
  }
  if (result.error === "too_large") {
    json(res, 502, { error: "Perspicax answered more than this server will read.", code: "too_large" });
    return;
  }
  if (result.error === "unreachable") {
    json(res, 502, { error: "Perspicax did not answer.", code: "unreachable" });
    return;
  }
  const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
  const body = result.body && typeof result.body === "object"
    ? result.body
    : { error: "Perspicax refused the request.", code: "refused" };
  json(res, status, body);
}

type Upstream = { method: NotesMethod; path: string; body?: unknown };

/** Map a Sagax `/api/me/memory/...` request onto Perspicax `/memory/read/...`. */
export function upstreamOf(method: string, path: string, url: URL, body: unknown): Upstream | "method" | null {
  if (!path.startsWith(ME_MEMORY_PREFIX)) return null;
  const rest = path.slice(ME_MEMORY_PREFIX.length) || "/";

  if (rest === "/tree") {
    if (method !== "GET") return "method";
    return { method: "GET", path: memoryReadPath("/tree") };
  }
  if (rest === "/tags") {
    if (method !== "GET") return "method";
    return { method: "GET", path: memoryReadPath("/tags") };
  }
  if (rest === "/archived") {
    if (method !== "GET") return "method";
    return { method: "GET", path: memoryReadPath("/archived") };
  }
  if (rest === "/entry") {
    if (method === "GET" || method === "DELETE") {
      const scope = url.searchParams.get("scope") ?? "";
      const id = url.searchParams.get("id") ?? "";
      return { method, path: memoryReadPath("/entry", { scope, id }) };
    }
    if (method === "PUT" || method === "POST") {
      return { method, path: memoryReadPath("/entry"), body };
    }
    return "method";
  }
  if (rest === "/folder") {
    if (method === "POST" || method === "PUT") return { method, path: memoryReadPath("/folder"), body };
    if (method === "DELETE") {
      return {
        method: "DELETE",
        path: memoryReadPath("/folder", {
          scope: url.searchParams.get("scope") ?? "",
          name: url.searchParams.get("name") ?? "",
        }),
      };
    }
    return "method";
  }
  if (rest === "/bulk") {
    if (method !== "POST") return "method";
    return { method: "POST", path: memoryReadPath("/bulk"), body };
  }
  if (rest === "/trash") {
    if (method !== "GET") return "method";
    return { method: "GET", path: memoryReadPath("/trash") };
  }
  if (rest === "/trash/undo") {
    if (method !== "POST") return "method";
    return { method: "POST", path: memoryReadPath("/trash/undo"), body };
  }
  if (rest === "/order") {
    if (method !== "PUT") return "method";
    return { method: "PUT", path: memoryReadPath("/order"), body };
  }
  if (rest === "/collections") {
    if (method === "GET") return { method: "GET", path: memoryReadPath("/collections") };
    if (method === "POST") return { method: "POST", path: memoryReadPath("/collections"), body };
    return "method";
  }
  const collection = /^\/collections\/([^/]+)$/.exec(rest);
  if (collection) {
    // One path segment, re-encoded: the id never reaches another route upstream.
    let raw: string;
    try { raw = decodeURIComponent(collection[1]!); } catch { return null; }
    const id = encodeURIComponent(raw);
    const target = memoryReadPath(`/collections/${id}`);
    if (method === "GET" || method === "DELETE") return { method, path: target };
    if (method === "PUT") return { method, path: target, body };
    return "method";
  }
  if (rest === "/trash/empty") {
    if (method !== "POST") return "method";
    return { method: "POST", path: memoryReadPath("/trash/empty"), body };
  }
  return null;
}

export function createMeMemoryNotesRoutes(deps: MeMemoryNotesDeps): RouteHandler {
  return async ({ res, url, path, method, auth, json, readBody, req }) => {
    const mapped = upstreamOf(method, path, url, undefined);
    if (mapped === null) return PASS;
    if (mapped === "method") return json(res, 405, { error: "method not allowed" });

    res.setHeader("cache-control", "no-store");
    if (auth.kind !== "session") {
      return json(res, 401, { error: "Sign in with Pulsatrix first.", code: "session_required" });
    }
    if (!deps.issuer || !deps.linked()) {
      return json(res, 503, { error: "This server is not linked to Perspicax yet.", code: "link" });
    }
    const who = memoryPrincipal(auth, deps.issuer);
    if (!who) {
      return json(res, 403, { error: "The memory manager needs a person signed in with Pulsatrix.", code: "identity_perspicax" });
    }

    let body: unknown;
    if (mapped.method === "POST" || mapped.method === "PUT") {
      body = await readBody(req);
    }
    const upstream = body === undefined ? mapped : { ...mapped, body };
    const result = await deps.client.call(who.principalId, upstream.method, upstream.path, upstream.body);
    mapResult(result, json, res);
  };
}
