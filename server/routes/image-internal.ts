// POST /api/internal/image: bot tool make_image (#2954).
// Generates or edits one image on the person's connected provider and posts
// it in the current chat as the bot's attachment. Keys never leave the
// server: not in the request, the answer or an error.
import { saveImage } from "../attachments/attachments.ts";
import {
  ChatImageError,
  chatImageRequestSchema,
  renderChatImage,
  withImageCredentials,
  type ChatImageCredential,
  type ImageCredentials,
} from "../media/chat-image.ts";
import { imageWord, type ImageLanguage } from "../media/image-words.ts";
import type { VoiceModeRefusalCause } from "../../shared/voice-mode.ts";
import type { VoiceKeyRefusals } from "../voice/voice-keys.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const IMAGE_INTERNAL_PATH = "/api/internal/image";

export interface ImageInternalDeps {
  /** The person this conversation speaks for, or null. */
  owner(capability: InternalCapabilityView): string | null;
  /** Every credential that may make this person's image, in the order to
   * try them, or why none may (chatImageCredentials). */
  credentials(capability: InternalCapabilityView): Promise<ImageCredentials>;
  /** The voice's own words for a refusal cause (voice-mode.ts voiceRefusalText). */
  refusalText(cause: VoiceModeRefusalCause): string;
  /** What was refused lately, so the next image goes straight to the
   * credential that serves (the voice's own memory, voice-keys.ts). */
  refusals: VoiceKeyRefusals;
  log?(line: string): void;
  /** The language of the person this conversation speaks for (#5223): the
   * sentence of a refusal is theirs to read. Absent: English. */
  language?(capability: InternalCapabilityView): ImageLanguage;
  /** The image named by reference, or the latest one in the current person's
   * message when reference is omitted; null when there is none. */
  image(capability: InternalCapabilityView, reference?: string): Promise<{ bytes: Buffer; mime: string } | null>;
  append(capability: InternalCapabilityView, attachment: { kind: "image"; path: string; mime: string; name: string }): void;
  fetch?: typeof fetch;
  now?: () => number;
}

export function createImageInternalRoutes(deps: ImageInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === IMAGE_INTERNAL_PATH)) return PASS;
    const parsed = chatImageRequestSchema.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "prompt (1-4000 characters) is required; aspect_ratio is 1:1, 16:9, 9:16, 4:3, 3:4, 3:2 or 2:3." });
    const owner = deps.owner(capability);
    const language = deps.language?.(capability);
    if (!owner) return json(res, 403, { error: imageWord(language, "noOwner") });
    const candidates = await deps.credentials(capability);
    if (!Array.isArray(candidates)) return json(res, 403, { error: deps.refusalText(candidates.refused), code: candidates.refused });
    if (!candidates.length) return json(res, 409, { error: imageWord(language, "noProvider"), code: "no_provider" });
    const now = deps.now ?? Date.now;
    const started = now();
    try {
      const wantsSource = parsed.data.image !== undefined || parsed.data.use_attached_image !== false;
      const source = wantsSource ? await deps.image(capability, parsed.data.image) : null;
      if (parsed.data.image && !source) return json(res, 400, { error: "image must identify an image attached in the current person's message (PNG, JPEG or WebP)." });
      // D-20261123-053: a credential out of credits (or refused) gives way to
      // the next one, by the voice's chain; the person is told which one served
      const { value: result, used: credential, skipped } = await withImageCredentials(
        { who: owner, refusals: deps.refusals, ...(deps.log ? { log: deps.log } : {}) },
        candidates,
        (credential) => renderChatImage(credential, {
          prompt: parsed.data.prompt,
          ...(source ? { image: source } : {}),
          ...(parsed.data.aspect_ratio ? { aspectRatio: parsed.data.aspect_ratio } : {}),
        }, deps.fetch, undefined, language),
      );
      const saved = saveImage(result.bytes, result.mime, undefined, owner);
      const ext = saved.mime === "image/png" ? "png" : saved.mime === "image/webp" ? "webp" : "jpg";
      deps.append(capability, { kind: "image", path: saved.path, mime: saved.mime, name: `${source ? "Edited" : "Generated"} image.${ext}` });
      const via = imageCredentialName(credential);
      // a credential that gave way is never a silent switch: one sentence for the person
      const gaveWay = skipped.map((entry) => `${imageCredentialName(entry.credential)} ${entry.cause === "credits" ? "is out of credits" : "was refused"}`);
      return json(res, 200, {
        ok: true,
        text: `${source ? "Edited" : "Generated"} the image with ${via}; it is already shown in the chat. Do not attach or describe it again: one short line at most.${gaveWay.length ? ` Tell the person in that line: ${gaveWay.join(", and ")}, so this image used ${via}.` : ""}`,
        mode: source ? "edit" : "generate",
        provider: credential.provider,
        ms: now() - started,
      });
    } catch (error) {
      // The cause (credits, a refused credential, the network) is computed
      // server-side; it is sent as a code so the person is not told to
      // "configure a key" when an account served but is out of credits (#5223).
      if (error instanceof ChatImageError) return json(res, error.status, { error: error.message, code: error.cause });
      const status = (error as { status?: number })?.status;
      return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502, { error: imageWord(language, "notSaved") });
    }
  };
}

/** A credential as the bot may name it to the person: never the key. */
function imageCredentialName(credential: ChatImageCredential): string {
  return credential.auth === "account"
    ? "your connected Grok account (Grok Imagine)"
    : credential.provider === "xai" ? "xAI Grok Imagine" : credential.provider === "openai" ? "OpenAI" : "the configured image API";
}
