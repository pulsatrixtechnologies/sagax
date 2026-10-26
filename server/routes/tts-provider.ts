// The voice engine alone (iOS parity, docs/ios-companion.md):
//
//   PUT /api/tts/provider   { provider: "elevenlabs" | "fish" | "system" | "chatterbox" | "xai" }
//
// The phone's Voice engine picker used to send PUT /api/config, which the
// companion sidecar refuses outright (that route carries API keys) and a
// client session may not use. This route is one field of that write and
// nothing beside it: never a key, an address or another setting. It stays
// admin scope (request-auth.ts does not list it for clients): the owner at
// this computer, the owner's paired phone through the companion, an admin
// session. Switching engines clears every voice id, as PUT /api/config does.
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const TTS_PROVIDERS = ["elevenlabs", "fish", "system", "chatterbox", "xai"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export interface TtsProviderRouteDeps {
  /** 2026-10-19: a person an admin gave server.settings in Perspicax. */
  delegate?: (auth: RequestAuth) => boolean;
  /** The engine in use now. */
  current(): TtsProvider;
  /** Another provider-settings write is in flight. */
  busy(): boolean;
  /** Save the provider (clearing voice ids when it changes) and return the
   * new config status. */
  apply(provider: TtsProvider, clearVoices: boolean): unknown;
  /** The status as this caller may read it. */
  view(auth: RequestAuth, status: unknown): unknown;
}

export function createTtsProviderRoutes(deps: TtsProviderRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/tts/provider") return PASS;
    if (method !== "PUT") return json(res, 405, { error: "PUT only" });
    if (auth.kind === "loopback" ? auth.trust === "service" : !auth.scopes.includes("admin") && !deps.delegate?.(auth)) {
      return json(res, 403, { error: "forbidden: only this computer's owner or an admin can change the voice engine" });
    }
    const body = await readBody(req) as unknown;
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : null;
    const provider = (body as { provider?: unknown } | null)?.provider;
    if (!keys || keys.length !== 1 || keys[0] !== "provider" || !TTS_PROVIDERS.includes(provider as TtsProvider)) {
      return json(res, 400, { error: `send { provider } alone: ${TTS_PROVIDERS.join(", ")}` });
    }
    if (deps.busy()) return json(res, 409, { error: "provider settings are already being updated" });
    const next = provider as TtsProvider;
    const status = deps.apply(next, next !== deps.current());
    return json(res, 200, deps.view(auth, status));
  };
}
