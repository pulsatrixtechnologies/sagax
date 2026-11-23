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
/** How a connected Grok account reaches the image API (the vendor accepts it
 * on the CLI host, probe 2026-11-23, #5223): the same image body, the CLI
 * proxy host, one extra token-auth header. An API key stays on console.x.ai.
 * Shared with the avatar route (avatar-image.ts) so the account host is said
 * once. */
export const XAI_ACCOUNT_IMAGE_BASE = "https://cli-chat-proxy.grok.com/v1";
export const XAI_ACCOUNT_HEADER_NAME = "x-xai-token-auth";
export const XAI_ACCOUNT_HEADER_VALUE = "xai-grok-cli";
export const NO_IMAGE_PROVIDER =
  "No image provider is connected. Connect your Grok account or an xAI (Grok Imagine) or OpenAI key in Settings > Providers, then ask again.";

/** Why an image generation could not happen, computed server-side from what
 * the provider answered. Never a hard-coded "configure a key": a connected
 * account out of credits is credits, not a missing key nor the network
 * (#5223, expected 4 and 5). */
export type ChatImageCause = "credits" | "key" | "network" | "error";

export type ChatImageProvider = "xai" | "openai" | "custom";
export interface ChatImageCredential {
  provider: ChatImageProvider;
  /** A secret, never shown. An API key on console.x.ai, or an account token on the CLI host. */
  key?: string;
  /** `account`: a connected Grok account (CLI host, token-auth header). Absent or `key`: an API key. */
  auth?: "key" | "account";
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
  /** What the person can act on, decided from the provider's answer. */
  readonly cause: ChatImageCause;
  constructor(message: string, status = 502, cause: ChatImageCause = "error") {
    super(message); this.status = status; this.cause = cause;
  }
}

export const chatImageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  image: z.string().trim().max(500).optional(),
  use_attached_image: z.boolean().optional(),
  aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]).optional(),
});

const xai = (key: string): ChatImageCredential => ({ provider: "xai", auth: "key", key, baseUrl: "https://api.x.ai/v1", model: XAI_IMAGE_MODEL });
const xaiAccount = (token: string): ChatImageCredential => ({ provider: "xai", auth: "account", key: token, baseUrl: XAI_ACCOUNT_IMAGE_BASE, model: XAI_IMAGE_MODEL });
const openai = (key: string): ChatImageCredential => ({ provider: "openai", auth: "key", key, baseUrl: "https://api.openai.com/v1", model: OPENAI_IMAGE_MODEL });

/** The provider this person's image goes to, or null when none is
 * connected. Solo: this computer's connected Grok account, then its keys.
 * Organization: the person's own connected Grok account first, then their own
 * keys, the shared keys only as the organization allows. The order is decided
 * [D-20261120-012, M-20261122-023]: an account beats a key at each level, the
 * organization's account is the next lot (#5200). #5223: the connected Grok
 * account is a real form, not only keys. */
export async function chatImageCredential(input: {
  organization: boolean;
  personal(provider: "xai" | "openai"): Promise<ProviderKeyResult>;
  solo(provider: "xai" | "openai"): Promise<string | undefined>;
  /** The person's own connected Grok account token, or undefined. xAI only:
   * it reaches the image API on the CLI host, on no OpenAI provider. */
  account?(): Promise<string | undefined>;
  imageGen?: ImageGenerationConfig;
  organizationXaiAllowed(): boolean;
  organizationXaiKey(): string | undefined;
}): Promise<ChatImageCredential | null> {
  // The connected Grok account beats every key at this level, solo and
  // organization alike. An account with no credit still reaches the vendor
  // and answers there, so it is not skipped for a key (the cause comes back
  // from the response, expected 4).
  const account = (await (input.account?.() ?? Promise.resolve(undefined)).catch(() => undefined))?.trim();
  if (account) return xaiAccount(account);
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
  // OpenAI-compatible gateways send unused fields such as url as null (upstream #4802).
  data: z.array(z.object({ b64_json: z.string().min(1).nullish(), url: z.string().nullish() })).min(1),
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
  const account = credential.auth === "account";
  const headers: Record<string, string> = {};
  if (credential.key) headers.authorization = `Bearer ${credential.key}`;
  if (account) headers[XAI_ACCOUNT_HEADER_NAME] = XAI_ACCOUNT_HEADER_VALUE;
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
    // Only a real connection failure or timeout is the network. A provider
    // that answered is handled below, so spent credits are never read as a
    // network outage (#5223, expected 4).
    const timedOut = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
    throw new ChatImageError(timedOut ? `${name} image ${edit ? "editing" : "generation"} timed out` : `Could not reach ${name} image ${edit ? "editing" : "generation"}`, 502, "network");
  }
  let text: string;
  try { text = await boundedText(response); }
  catch (error) {
    if (signal.aborted) throw new ChatImageError(`${name} image ${edit ? "editing" : "generation"} timed out`, 502, "network");
    throw error;
  }
  // Provider error bodies can echo headers or signed URLs: the body is read
  // only to sort the cause, never sent back. The cause says what the person
  // can act on (credits, a refused credential, the network), never a generic
  // "configure a key" when an account served (#5223, expected 4 and 5).
  if (!response.ok) {
    const cause = imageRefusalCause(response.status, text);
    const message = cause === "credits"
      ? `${name} is out of credits for image generation. Add credits, then ask again.`
      : cause === "key"
        ? (account
          ? `${name} refused your connected Grok account (HTTP ${response.status}). Reconnect it in Settings.`
          : `${name} refused the API key (HTTP ${response.status}). Reconnect it in Settings > Providers.`)
        : `${name} image ${edit ? "editing" : "generation"} failed (HTTP ${response.status})`;
    // The status stays coarse (a refused credential is 401, any other provider
    // failure 502); the `cause` carries what the person can act on. A refusal
    // that is spent credits is never reported as a network outage.
    throw new ChatImageError(message, cause === "key" ? 401 : 502, cause);
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

/** Sort a provider's refusal into what the person can act on, read only from
 * the status and the error body (never echoed). Credits win over a generic
 * failure and over the network, as a 503 body that says out_of_credits is
 * spent credits, not an outage (#5223, expected 4; the same reading the voice
 * route makes in tts/grok.ts). Shared with the avatar route. */
export function imageRefusalCause(status: number, body: string): ChatImageCause {
  const said = body.slice(0, 2_048).toLowerCase();
  if (status === 402 || /out_of_credits|insufficient_quota|spending limit|needs credits|no credits|exceeded your (?:current )?quota/i.test(said)) return "credits";
  if (status === 401 || status === 403 || /incorrect api key|invalid api key|invalid or expired credentials|unauthenticated|permission/i.test(said)) return "key";
  return "error";
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
