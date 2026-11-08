/** make_image (#2954): one image generated or edited in the chat, on the
 * person's own connected provider. The provider is chosen from what is
 * connected, fastest first, so the bot never searches for an image skill:
 * the person's xAI key (Grok Imagine), their OpenAI key (gpt-image), the
 * server's configured image provider, then the organization's xAI key when
 * it was given to them. Never a provider URL from the model. */
import type { ReadableStreamReadResult } from "node:stream/web";
import { z } from "zod";
import { normalizeImageGenerationUrl, type ImageGenerationConfig } from "../../shared/image-generation.ts";
import type { ProviderKeyResult } from "../perspicax/perspicax-link.ts";
import { decodeGeneratedImage } from "./generated-image.ts";

export const CHAT_IMAGE_TIMEOUT_MS = 90_000;
const MAX_UPSTREAM_RESPONSE_BYTES = 30 * 1024 * 1024;
export const XAI_IMAGE_MODEL = "grok-imagine-image-2.0";
export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const NO_IMAGE_PROVIDER =
  "No image provider is connected. Connect xAI (Grok Imagine) or OpenAI in Settings > Providers, then ask again.";

export type ChatImageProvider = "xai" | "openai" | "custom";
export interface ChatImageCredential {
  provider: ChatImageProvider;
  key?: string;
  baseUrl: string;
  model: string;
}
export interface ChatImageInput {
  prompt: string;
  /** The image from the person's message, for an edit. */
  image?: { bytes: Buffer; mime: string };
  aspectRatio?: string;
}
export interface ChatImageResult { bytes: Buffer; mime: "image/png" | "image/jpeg" | "image/webp" }

export class ChatImageError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export const chatImageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  image: z.string().trim().max(500).optional(),
  use_attached_image: z.boolean().optional(),
  aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]).optional(),
});

const xai = (key: string): ChatImageCredential => ({ provider: "xai", key, baseUrl: "https://api.x.ai/v1", model: XAI_IMAGE_MODEL });
const openai = (key: string): ChatImageCredential => ({ provider: "openai", key, baseUrl: "https://api.openai.com/v1", model: OPENAI_IMAGE_MODEL });

/** The provider this person's image goes to, or null when none is
 * connected. Solo: the keys of this computer. Organization: the person's own
 * keys first, the shared keys only as the organization allows. */
export async function chatImageCredential(input: {
  organization: boolean;
  personal(provider: "xai" | "openai"): Promise<ProviderKeyResult>;
  solo(provider: "xai" | "openai"): Promise<string | undefined>;
  imageGen?: ImageGenerationConfig;
  organizationXaiAllowed(): boolean;
  organizationXaiKey(): string | undefined;
}): Promise<ChatImageCredential | null> {
  for (const provider of ["xai", "openai"] as const) {
    if (input.organization) {
      const personal = await input.personal(provider).catch(() => null);
      if (personal?.ok && personal.key.trim()) return provider === "xai" ? xai(personal.key.trim()) : openai(personal.key.trim());
    } else {
      const key = (await input.solo(provider).catch(() => undefined))?.trim();
      if (key) return provider === "xai" ? xai(key) : openai(key);
    }
  }
  const gen = input.imageGen;
  if ((gen?.provider ?? "openai") === "openai" && gen?.key?.trim()) return openai(gen.key.trim());
  if (gen?.provider === "custom" && gen.customUrl?.trim() && gen.customModel?.trim()) {
    try {
      return { provider: "custom", baseUrl: normalizeImageGenerationUrl(gen.customUrl), model: gen.customModel.trim(), ...(gen.customApiKey?.trim() ? { key: gen.customApiKey.trim() } : {}) };
    } catch { /* an invalid URL never becomes an outbound request */ }
  }
  if (!input.organization || input.organizationXaiAllowed()) {
    const key = input.organizationXaiKey()?.trim();
    if (key) return xai(key);
  }
  return null;
}

const NAMES: Record<ChatImageProvider, string> = { xai: "xAI", openai: "OpenAI", custom: "Custom" };
const responseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1).optional(), url: z.string().optional() })).min(1),
});

/** One generation or edit; the result is the decoded raster. */
export async function renderChatImage(
  credential: ChatImageCredential,
  input: ChatImageInput,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = CHAT_IMAGE_TIMEOUT_MS,
): Promise<ChatImageResult> {
  const name = NAMES[credential.provider];
  const edit = Boolean(input.image);
  const url = `${credential.baseUrl}/images/${edit ? "edits" : "generations"}`;
  const headers: Record<string, string> = {};
  if (credential.key) headers.authorization = `Bearer ${credential.key}`;
  let body: string | FormData;
  if (credential.provider === "xai") {
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      model: credential.model, prompt: input.prompt, response_format: "b64_json",
      ...(input.image ? { image: { url: `data:${input.image.mime};base64,${input.image.bytes.toString("base64")}`, type: "image_url" } } : {}),
      ...(input.aspectRatio && !edit ? { aspect_ratio: input.aspectRatio } : {}),
    });
  } else if (edit) {
    const form = new FormData();
    form.set("model", credential.model);
    form.set("prompt", input.prompt);
    const ext = input.image!.mime === "image/png" ? "png" : input.image!.mime === "image/webp" ? "webp" : "jpg";
    form.set("image", new Blob([new Uint8Array(input.image!.bytes)], { type: input.image!.mime }), `image.${ext}`);
    if (credential.provider === "openai") form.set("quality", "low");
    else form.set("response_format", "b64_json");
    body = form;
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      model: credential.model, prompt: input.prompt, n: 1,
      ...(credential.provider === "openai" ? { quality: "low", size: openAiSize(input.aspectRatio) } : { response_format: "b64_json" }),
    });
  }
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers, body, redirect: "error", signal });
  } catch (error) {
    const timedOut = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
    throw new ChatImageError(timedOut ? `${name} image ${edit ? "editing" : "generation"} timed out` : `Could not reach ${name} image ${edit ? "editing" : "generation"}`);
  }
  let text: string;
  try { text = await boundedText(response); }
  catch (error) {
    if (signal.aborted) throw new ChatImageError(`${name} image ${edit ? "editing" : "generation"} timed out`);
    throw error;
  }
  // Provider error bodies can echo headers or signed URLs: status only.
  if (!response.ok) {
    throw new ChatImageError(
      response.status === 401 || response.status === 403 ? `${name} refused the API key (HTTP ${response.status}). Reconnect it in Settings > Providers.`
        : `${name} image ${edit ? "editing" : "generation"} failed (HTTP ${response.status})`,
      response.status === 401 || response.status === 403 ? 401 : 502);
  }
  let parsed: z.infer<typeof responseSchema>;
  try { parsed = responseSchema.parse(JSON.parse(text)); }
  catch { throw new ChatImageError(`${name} returned no generated image`); }
  const encoded = parsed.data[0]!.b64_json;
  // A provider URL is never fetched: compatible gateways must return b64_json.
  if (!encoded) throw new ChatImageError(`${name} must return base64 image data (b64_json)`);
  try {
    const image = decodeGeneratedImage(encoded, MAX_UPSTREAM_RESPONSE_BYTES);
    if (image.mime === "image/gif") throw new Error("gif");
    return { bytes: image.bytes, mime: image.mime };
  } catch {
    throw new ChatImageError(`${name} returned invalid image data; expected PNG, JPEG or WebP`);
  }
}

function openAiSize(aspect?: string): string {
  if (aspect === "16:9" || aspect === "3:2" || aspect === "4:3") return "1536x1024";
  if (aspect === "9:16" || aspect === "2:3" || aspect === "3:4") return "1024x1536";
  return "1024x1024";
}

async function boundedText(response: Response): Promise<string> {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > MAX_UPSTREAM_RESPONSE_BYTES * 1.4) {
    await response.body?.cancel().catch(() => {});
    throw new ChatImageError("Generated image exceeded the response limit");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { throw new ChatImageError("Could not read the generated image response"); }
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_UPSTREAM_RESPONSE_BYTES * 1.4) {
        await reader.cancel().catch(() => {});
        throw new ChatImageError("Generated image exceeded the response limit");
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally { reader.releaseLock(); }
}
