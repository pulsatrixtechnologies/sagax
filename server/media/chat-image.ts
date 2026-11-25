/** make_image (#2954): one image generated or edited in the chat, on the
 * person's own connected provider. The credentials are taken from what is
 * connected, in one order, so the bot never searches for an image skill:
 * the person's connected Grok account (#5223), their xAI key (Grok Imagine),
 * their OpenAI key (gpt-image), the server's configured image provider, then
 * the organization's xAI key when it was given to them. A credential out of
 * credits, or refused, gives way to the next one by the voice's own chain
 * (server/voice/voice-keys.ts, D-20261123-053). Never a provider URL from
 * the model. */
import type { ReadableStreamReadResult } from "node:stream/web";
import { z } from "zod";
import { normalizeImageGenerationUrl, type ImageGenerationConfig } from "../../shared/image-generation.ts";
import { providerOrder } from "../../shared/voice-providers.ts";
import type { ProviderKeyResult } from "../perspicax/perspicax-link.ts";
import { decodeGeneratedImage } from "./generated-image.ts";
import type { VoiceKeySource, VoiceModeRefusalCause } from "../../shared/voice-mode.ts";
import { voiceOutOfCredits, type GrokVoiceFailure } from "../tts/grok.ts";
import {
  describeVoiceKey, keyLast4, nextKeyIndex, voiceKeyFailureIsFinal, voiceKeyRef, VoiceKeyFailure, withVoiceKeys,
  type VoiceKeyCandidate, type VoiceKeyRefusals,
} from "../voice/voice-keys.ts";

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

export const xaiKeyImage = (key: string): ChatImageCredential => ({ provider: "xai", auth: "key", key, baseUrl: "https://api.x.ai/v1", model: XAI_IMAGE_MODEL });
export const xaiAccountImage = (token: string): ChatImageCredential => ({ provider: "xai", auth: "account", key: token, baseUrl: XAI_ACCOUNT_IMAGE_BASE, model: XAI_IMAGE_MODEL });
export const openaiKeyImage = (key: string): ChatImageCredential => ({ provider: "openai", auth: "key", key, baseUrl: "https://api.openai.com/v1", model: OPENAI_IMAGE_MODEL });

/** One credential of an image chain, in the shape the voice chain runs
 * (server/voice/voice-keys.ts): whose it is (`source`) and its last four
 * characters for the log, never more of it. */
export interface ImageKeyCandidate extends VoiceKeyCandidate {
  credential: ChatImageCredential;
}

export function imageKeyCandidate(credential: ChatImageCredential, source: VoiceKeySource): ImageKeyCandidate {
  const key = credential.key ?? "";
  return {
    key, source, last4: keyLast4(key), credential,
    via: source === "org-key" || source === "server" ? source : "speaker-key",
    ...(credential.provider === "openai" ? { provider: "openai" as const } : {}),
  };
}

/** The providers an image can be made on, in the order of the chain's default. */
export const IMAGE_PROVIDERS = ["xai", "openai", "custom"] as const satisfies readonly ChatImageProvider[];

/** The order of one person's image credentials. ONE rule for the chat
 * (make_image) and the avatar (#5223 review, #5231), in the decided order
 * [D-20261120-012]: the person's explicit choice, then their connected Grok
 * account, then their keys, then the organization's. `keys` come in that
 * order already (the person's, then the shared ones) and the account leads
 * them, an account beating a key. The explicit choice is the provider the
 * image settings name (`imageGen.provider`): when it has a credential to
 * serve, every credential of that provider comes first, in the same order
 * among themselves, the person's own keys of another provider included.
 * Whether a choice leads is the voice's own verdict (`providerOrder`,
 * shared/voice-providers.ts: the chosen provider first when it serves, else
 * the default order), not a second rule. */
export function imageChainWithAccount(keys: readonly ImageKeyCandidate[], account: ImageKeyCandidate | null, imageGen?: ImageGenerationConfig): ImageKeyCandidate[] {
  const all = account ? [account, ...keys] : [...keys];
  const choice = imageGen?.provider ?? "auto";
  const serving = IMAGE_PROVIDERS.filter((provider) => all.some((entry) => entry.credential.provider === provider));
  if (choice === "auto" || providerOrder(choice, serving, IMAGE_PROVIDERS)[0] !== choice) return all;
  return [...all.filter((entry) => entry.credential.provider === choice), ...all.filter((entry) => entry.credential.provider !== choice)];
}

/** Every credential that may make this person's image, in the order to try
 * them; empty when none is connected. Solo: this computer's connected Grok
 * account, then its keys. Organization: the person's own connected Grok
 * account, then their own keys, the shared keys only as the organization
 * allows. The order is decided [D-20261120-012, M-20261122-023]: an account
 * beats a key at each level, the organization's account is the next lot
 * (#5200). The order, a chosen provider included, is `imageChainWithAccount`. A credential
 * refused for credits or for itself gives way to the next one
 * (`withImageCredentials`, D-20261123-053). */
export async function chatImageCredentials(input: {
  organization: boolean;
  personal(provider: "xai" | "openai"): Promise<ProviderKeyResult>;
  solo(provider: "xai" | "openai"): Promise<string | undefined>;
  /** The person's own connected Grok account token, or undefined. xAI only:
   * it reaches the image API on the CLI host, on no OpenAI provider. */
  account?(): Promise<string | undefined>;
  imageGen?: ImageGenerationConfig;
  organizationXaiAllowed(): boolean;
  organizationXaiKey(): string | undefined;
  /** The person is turned off in their organization. */
  disabled?: boolean;
}): Promise<ImageCredentials> {
  // the voice's verdict for the same person (resolveVoiceKeys): nothing of
  // an organization serves a person it turned off, account or key
  if (input.organization && input.disabled) return { refused: "payer_disabled" };
  const shared: VoiceKeySource = input.organization ? "org-key" : "server";
  const keys: ImageKeyCandidate[] = [];
  for (const provider of ["xai", "openai"] as const) {
    const build = provider === "xai" ? xaiKeyImage : openaiKeyImage;
    if (input.organization) {
      const personal = await input.personal(provider).catch(() => null);
      if (personal?.ok && personal.key.trim()) keys.push(imageKeyCandidate(build(personal.key.trim()), "perspicax-key"));
    } else {
      const key = (await input.solo(provider).catch(() => undefined))?.trim();
      if (key) keys.push(imageKeyCandidate(build(key), "server"));
    }
  }
  const gen = input.imageGen;
  if ((gen?.provider ?? "openai") === "openai" && gen?.key?.trim()) keys.push(imageKeyCandidate(openaiKeyImage(gen.key.trim()), shared));
  if (gen?.provider === "custom" && gen.customUrl?.trim() && gen.customModel?.trim()) {
    try {
      keys.push(imageKeyCandidate({ provider: "custom", baseUrl: normalizeImageGenerationUrl(gen.customUrl), model: gen.customModel.trim(), ...(gen.customApiKey?.trim() ? { key: gen.customApiKey.trim() } : {}) }, shared));
    } catch { /* an invalid URL never becomes an outbound request */ }
  }
  if (!input.organization || input.organizationXaiAllowed()) {
    const key = input.organizationXaiKey()?.trim();
    if (key) keys.push(imageKeyCandidate(xaiKeyImage(key), shared));
  }
  const account = (await (input.account?.() ?? Promise.resolve(undefined)).catch(() => undefined))?.trim();
  return imageChainWithAccount(keys, account ? imageKeyCandidate(xaiAccountImage(account), "grok-account") : null, gen);
}

/** Where one person's image credentials are read on this server: the same
 * sources for the chat's image and for the avatar, so both surfaces ask
 * `personImageCredentials` and neither keeps its own list (#5231). Every
 * lookup takes the person it is for: nothing of one person is read for
 * another. */
export interface ImagePeople {
  organization: boolean;
  /** The person as the voice sees them (the same `disabled`). */
  person(principalId: string | null): { principalId?: string | null; disabled?: boolean };
  /** This person's own key for a provider, in an organization. */
  ownKey(principalId: string | null, provider: "xai" | "openai"): Promise<ProviderKeyResult>;
  /** This computer's key for a provider, on a solo server. */
  soloKey(provider: "xai" | "openai"): Promise<string | undefined>;
  /** This person's connected Grok account, by the voice's own rule. */
  account(person: { principalId?: string | null; disabled?: boolean }): Promise<string | undefined>;
  imageGen(): ImageGenerationConfig | undefined;
  /** The organization gave its xAI key to this person for images. */
  organizationXaiGiven(principalId: string | null): boolean;
  organizationXaiKey(): string | undefined;
}

/** One person's image chain, for the chat's image and for the avatar. */
export function personImageCredentials(people: ImagePeople, principalId: string | null): Promise<ImageCredentials> {
  const person = people.person(principalId);
  return chatImageCredentials({
    ...(person.disabled ? { disabled: true } : {}),
    organization: people.organization,
    personal: (provider) => people.ownKey(principalId, provider),
    solo: (provider) => people.soloKey(provider),
    account: () => people.account(person),
    imageGen: people.imageGen(),
    organizationXaiAllowed: () => people.organizationXaiGiven(principalId),
    organizationXaiKey: () => people.organizationXaiKey(),
  });
}

/** The chain of one person, or why the organization serves them nothing
 * (a cause of the voice's own list, said in the voice's own words). */
export type ImageCredentials = ImageKeyCandidate[] | { refused: VoiceModeRefusalCause };

/** Who asks and what was refused lately, for one image chain. */
export interface ImageChain {
  who: string;
  refusals: VoiceKeyRefusals;
  log?(line: string): void;
}

/** A credential that gave way before the one that served. */
export interface ImageCredentialRefusal {
  credential: ChatImageCredential;
  cause: ChatImageCause;
}

/** An image error as the voice chain reads a failure: credits and a refused
 * credential are the two another credential can fix. */
function imageFailure(error: unknown): GrokVoiceFailure {
  const cause = error instanceof ChatImageError ? error.cause : (error as { code?: unknown } | null)?.code;
  return cause === "credits" ? "quota" : cause === "key" ? "key" : cause === "network" ? "down" : "other";
}

/** Run `attempt` on each credential in turn, by the voice's own chain
 * (server/voice/voice-keys.ts withVoiceKeys, D-20261123-053: a Grok account
 * out of credits goes on to the person's API key, then the organization's).
 * A credential refused for credits or for itself is remembered and passed
 * over for a while; an outage or a refused prompt stays with the credential
 * that got it. When none serves, the error of the credential closest to the
 * person is the one they get, as for a call (voiceFailureCause). */
export async function withImageCredentials<T>(
  chain: ImageChain,
  candidates: readonly ImageKeyCandidate[],
  attempt: (credential: ChatImageCredential) => Promise<T>,
): Promise<{ value: T; used: ChatImageCredential; skipped: ImageCredentialRefusal[] }> {
  const failed: Array<{ candidate: ImageKeyCandidate; error: unknown }> = [];
  try {
    const done = await withVoiceKeys<T, ImageKeyCandidate>(chain.who, candidates, chain.refusals, async (candidate) => {
      try { return await attempt(candidate.credential); }
      catch (error) { failed.push({ candidate, error }); throw error; }
    }, { next: nextKeyIndex, failure: imageFailure });
    for (const entry of failed) {
      chain.log?.(`[image] ${NAMES[entry.candidate.credential.provider]} refused the ${describeVoiceKey(voiceKeyRef(entry.candidate))} (${imageFailure(entry.error)}): the image went on to the ${describeVoiceKey(voiceKeyRef(done.used))}`);
    }
    return {
      value: done.value,
      used: done.used.credential,
      skipped: failed.map((entry) => ({ credential: entry.candidate.credential, cause: imageFailure(entry.error) === "quota" ? "credits" : "key" })),
    };
  } catch (error) {
    if (!(error instanceof VoiceKeyFailure) || !failed.length) throw error;
    const allFinal = failed.every((entry) => voiceKeyFailureIsFinal(imageFailure(entry.error)));
    throw (allFinal ? failed[0]! : failed.at(-1)!).error;
  }
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
  const said = body.slice(0, 2_048);
  // which words mean spent credits is the voice's rule, said there only
  // (server/tts/grok.ts): here only the status that means it
  if (status === 402 || voiceOutOfCredits(said)) return "credits";
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
