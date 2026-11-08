// POST /api/internal/image: bot tool make_image (#2954).
// Generates or edits one image on the person's connected provider and posts
// it in the current chat as the bot's attachment. Keys never leave the
// server: not in the request, the answer or an error.
import { saveImage } from "../attachments/attachments.ts";
import {
  ChatImageError,
  chatImageRequestSchema,
  NO_IMAGE_PROVIDER,
  renderChatImage,
  type ChatImageCredential,
} from "../media/chat-image.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const IMAGE_INTERNAL_PATH = "/api/internal/image";

export interface ImageInternalDeps {
  /** The person this conversation speaks for, or null. */
  owner(capability: InternalCapabilityView): string | null;
  credential(capability: InternalCapabilityView): Promise<ChatImageCredential | null>;
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
    if (!owner) return json(res, 403, { error: "Image generation needs the person this conversation speaks for." });
    const credential = await deps.credential(capability);
    if (!credential) return json(res, 409, { error: NO_IMAGE_PROVIDER, code: "no_provider" });
    const now = deps.now ?? Date.now;
    const started = now();
    try {
      const wantsSource = parsed.data.image !== undefined || parsed.data.use_attached_image !== false;
      const source = wantsSource ? await deps.image(capability, parsed.data.image) : null;
      if (parsed.data.image && !source) return json(res, 400, { error: "image must identify an image attached in the current person's message (PNG, JPEG or WebP)." });
      const result = await renderChatImage(credential, {
        prompt: parsed.data.prompt,
        ...(source ? { image: source } : {}),
        ...(parsed.data.aspect_ratio ? { aspectRatio: parsed.data.aspect_ratio } : {}),
      }, deps.fetch);
      const saved = saveImage(result.bytes, result.mime, undefined, owner);
      const ext = saved.mime === "image/png" ? "png" : saved.mime === "image/webp" ? "webp" : "jpg";
      deps.append(capability, { kind: "image", path: saved.path, mime: saved.mime, name: `${source ? "Edited" : "Generated"} image.${ext}` });
      return json(res, 200, {
        ok: true,
        text: `${source ? "Edited" : "Generated"} the image with ${credential.provider === "xai" ? "xAI Grok Imagine" : credential.provider === "openai" ? "OpenAI" : "the configured image API"}; it is already shown in the chat. Do not attach or describe it again: one short line at most.`,
        mode: source ? "edit" : "generate",
        provider: credential.provider,
        ms: now() - started,
      });
    } catch (error) {
      if (error instanceof ChatImageError) return json(res, error.status, { error: error.message });
      const status = (error as { status?: number })?.status;
      return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502, { error: "The image could not be saved in the chat." });
    }
  };
}
