// The agents tools' only way to the harness: JSON over HTTP to the
// loopback-only /api/internal/* routes, carrying the capability token the
// harness minted for this turn (or the standing one of an external runtime).
// The harness authenticates and scopes every call; nothing here decides what
// a bot may do.
import { readFileSync } from "node:fs";

export type Json = Record<string, unknown>;

export interface HarnessClient {
  /** The route's JSON body. A refusal is thrown as an Error carrying the
   * route's own `error` sentence. */
  api(path: string, init?: RequestInit): Promise<Json>;
  /** Like api, but a refusal comes back as its body instead of an Error —
   * for the tools whose refusals carry more than a sentence. */
  apiResponse(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Json }>;
}

export function createHarnessClient(baseUrl: string, token: string | (() => string)): HarnessClient {
  async function api(path: string, init?: RequestInit): Promise<Json> {
    const { ok, status, body } = await apiResponse(path, init);
    if (!ok) throw new Error(String(body.error ?? `HTTP ${status}`));
    return body;
  }

  async function apiResponse(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Json }> {
    const res = await fetch(baseUrl + path, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(120_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${typeof token === "function" ? token() : token}`, ...init?.headers },
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    return { ok: res.ok, status: res.status, body };
  }

  return { api, apiResponse };
}

/** The client a spawned proxy was given:
 *   SAGAX_HARNESS_URL  base URL of the harness (http://127.0.0.1:8799)
 *   SAGAX_COMMS_TOKEN  the capability token for the internal endpoints
 *   SAGAX_COMMS_TOKEN_FILE  optional: where the current turn's token is */
export function harnessClientFromEnv(env: NodeJS.ProcessEnv): HarnessClient {
  return createHarnessClient(env.SAGAX_HARNESS_URL ?? "http://127.0.0.1:8799", commsToken(env));
}

/** The comms token, read fresh for each request when the process outlives
 * a turn (SAGAX_COMMS_TOKEN_FILE: a call's warm engine session, whose token
 * the harness rewrites every turn), else the one it was launched with. */
export function commsToken(env: NodeJS.ProcessEnv): () => string {
  const file = env.SAGAX_COMMS_TOKEN_FILE;
  const launched = env.SAGAX_COMMS_TOKEN ?? "";
  if (!file) return () => launched;
  return () => {
    try {
      return readFileSync(file, "utf8").trim() || launched;
    } catch {
      return launched;
    }
  };
}
