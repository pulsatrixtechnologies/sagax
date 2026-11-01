// The organization's xAI key (Settings > Connections, `xai.key`) also pays
// for speech when the voice engine is Grok (read aloud, voice notes, the
// phone's voice, /api/tts/*) and for bot avatars when the image provider is
// xAI. On an organization server it serves those only for the people
// Perspicax gives them to, like the engines and voice mode
// (`sagax_server_engines`, 2026-10-16): an admin and this server's own
// operator always, a member when their list holds the id
// (`VOICE_SERVER_ENGINE` for speech, `IMAGE_SERVER_ENGINE` for images) or
// "*", nobody when the list is unknown. Solo servers are unchanged.
//
// When refused there is no fallback to the organization's key: the caller
// answers `server_engine_not_allowed` and never reads the key.

import { IMAGE_SERVER_ENGINE } from "../shared/image-generation.ts";
import { VOICE_SERVER_ENGINE } from "../shared/voice-mode.ts";

export type OrgXaiMedia = "voice" | "image";

/** The `sagax_server_engines` id of each use of the organization's xAI key. */
export const ORG_XAI_MEDIA_ENGINE: Readonly<Record<OrgXaiMedia, string>> = {
  voice: VOICE_SERVER_ENGINE,
  image: IMAGE_SERVER_ENGINE,
};

export const SERVER_ENGINE_NOT_ALLOWED = "server_engine_not_allowed" as const;

export interface OrgXaiMediaInput {
  /** An organization server (IDENTITY.kind === "perspicax"). */
  organization: boolean;
  /** The person the use is for: the signed-in person making the request, or
   * the person a bot turn speaks for (a routine: its owner). */
  principalId?: string | null;
  /** The bot's owner: a use nobody is known to speak for is judged as
   * theirs (the rule of engine-credentials.ts). */
  ownerPrincipalId?: string | null;
  /** serverEngineAllowedFor (server/index.ts): an admin or the local
   * operator always, a member when Perspicax lists the id or "*". */
  allowed(principalId: string, engineId: string): boolean;
}

/** Whether the organization's xAI key may pay for this use for this
 * person. Solo: always (the server's own key, as before). */
export function orgXaiKeyAllowed(media: OrgXaiMedia, input: OrgXaiMediaInput): boolean {
  if (!input.organization) return true;
  const judged = input.principalId?.trim() || input.ownerPrincipalId?.trim() || "";
  if (!judged) return false;
  return input.allowed(judged, ORG_XAI_MEDIA_ENGINE[media]);
}

const REFUSAL: Record<OrgXaiMedia, string> = {
  voice: "Your organization has not given you its xAI voice (read aloud and voice notes). Ask an admin to give it to you in Perspicax.",
  image: "Your organization has not given you image and video generation on its xAI key. Ask an admin to give it to you in Perspicax.",
};

/** The 403 body of a refused use. Never names or hints at the key. */
export function orgXaiRefusal(media: OrgXaiMedia): { error: string; cause: typeof SERVER_ENGINE_NOT_ALLOWED } {
  return { error: REFUSAL[media], cause: SERVER_ENGINE_NOT_ALLOWED };
}

/** The refusal a bot sees when its voice note would run on the
 * organization's xAI key for someone it was not given to. */
export const ORG_XAI_VOICE_NOTE_REFUSAL =
  "This voice note would use the organization's xAI voice, which the organization has not given to the person this turn is for. Answer in text.";

interface MediaStatus {
  tts?: { provider: string; configured: boolean; ready: boolean };
  imageGen?: { provider: string; configured: boolean; xaiConfigured: boolean };
}

/** A config status as one person sees it: when the voice or image provider
 * is xAI on the organization's key and that person was not given it, it is
 * not configured for them (`xaiKeyNotGiven`), so the app does not offer
 * what the server would refuse. */
export function orgXaiMediaStatusFor<T extends MediaStatus>(status: T, given: Record<OrgXaiMedia, boolean>): T {
  let next = status;
  if (!given.voice && status.tts?.provider === "xai" && status.tts.configured) {
    next = { ...next, tts: { ...status.tts, configured: false, ready: false, xaiKeyNotGiven: true } };
  }
  if (!given.image && status.imageGen && status.imageGen.xaiConfigured) {
    const imageGen = { ...status.imageGen, xaiConfigured: false, xaiKeyNotGiven: true };
    if (status.imageGen.provider === "xai") imageGen.configured = false;
    next = { ...next, imageGen };
  }
  return next;
}
