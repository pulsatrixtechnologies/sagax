// A person's own voice keys on an organization server (#1098, 2026-10-28,
// server/voice/person-voice-keys.ts). Their own: no admin right, no right to edit
// the installation. The organization's shared keys stay engines.manage.
//
//   GET    /api/me/voice-keys              { elevenlabs, fish, xai, openai }: { configured, last4 }
//   PUT    /api/me/voice-keys/<provider>   { key }
//   DELETE /api/me/voice-keys/<provider>
//
// A solo server answers 404: its one person keeps the installation's keys.
// The key is never in an answer and never logged.
import { isPersonalVoiceKeyProvider } from "../../shared/person-voice-keys.ts";
import type { RequestAuth } from "../request-auth.ts";
import { normalizeVoiceKey, PersonVoiceKeysError, type PersonVoiceKeysStore } from "../voice/person-voice-keys.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const PERSON_VOICE_KEYS_PATH = "/api/me/voice-keys";

export interface PersonVoiceKeysRouteDeps {
  store: PersonVoiceKeysStore;
  /** Whose keys this session reads; null when it names no person or the server is solo. */
  principal(auth: RequestAuth): string | null;
}

export function createPersonVoiceKeysRoutes(deps: PersonVoiceKeysRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PERSON_VOICE_KEYS_PATH && !path.startsWith(`${PERSON_VOICE_KEYS_PATH}/`)) return PASS;
    res.setHeader("cache-control", "no-store");
    const principalId = deps.principal(auth);
    if (!principalId) return json(res, 404, { error: "Your own voice keys are kept on an organization server." });
    try {
      if (path === PERSON_VOICE_KEYS_PATH) {
        if (method !== "GET") return PASS;
        return json(res, 200, deps.store.view(principalId));
      }
      const provider = path.slice(PERSON_VOICE_KEYS_PATH.length + 1);
      if (!isPersonalVoiceKeyProvider(provider)) return json(res, 404, { error: "provider must be elevenlabs, fish, xai or openai." });
      if (method === "DELETE") return json(res, 200, deps.store.set(principalId, provider, null));
      if (method !== "PUT") return PASS;
      const body = await readBody(req).catch(() => undefined);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "Send { key }." });
      const key = normalizeVoiceKey((body as { key?: unknown }).key);
      return json(res, 200, deps.store.set(principalId, provider, key));
    } catch (error) {
      if (error instanceof PersonVoiceKeysError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
