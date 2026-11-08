import { describe, expect, it } from "vitest";
import {
  chatImageCredential,
  ChatImageError,
  NO_IMAGE_PROVIDER,
  OPENAI_IMAGE_MODEL,
  renderChatImage,
  XAI_IMAGE_MODEL,
} from "./chat-image.ts";
import type { ProviderKeyResult } from "../perspicax/perspicax-link.ts";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG = Buffer.from(PNG_B64, "base64");
const ok = () => new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 });
const none = async (): Promise<ProviderKeyResult> => ({ ok: false, error: "no_key" });

function recorder(answer: () => Response = ok) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer(); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("chatImageCredential (#2954)", () => {
  const base = { organization: false as boolean, personal: none, solo: async (): Promise<string | undefined> => undefined, organizationXaiAllowed: (): boolean => false, organizationXaiKey: (): string | undefined => undefined };

  it("prefers the xAI key, then OpenAI, then the image settings", async () => {
    expect((await chatImageCredential({ ...base, solo: async (p) => p === "xai" ? "xk" : "ok" }))?.provider).toBe("xai");
    expect((await chatImageCredential({ ...base, solo: async (p) => p === "openai" ? "ok" : undefined }))).toMatchObject({ provider: "openai", model: OPENAI_IMAGE_MODEL });
    expect((await chatImageCredential({ ...base, imageGen: { provider: "openai", key: "gk" } as never }))?.provider).toBe("openai");
    expect((await chatImageCredential({ ...base, imageGen: { provider: "custom", customUrl: "https://img.example.test/v1", customModel: "m" } as never }))?.provider).toBe("custom");
  });

  it("uses the person's own key in an organization and the shared xAI key only when allowed", async () => {
    const org = { ...base, organization: true, solo: async () => "never", organizationXaiKey: () => "shared" };
    expect(await chatImageCredential(org)).toBeNull();
    expect((await chatImageCredential({ ...org, organizationXaiAllowed: () => true }))?.provider).toBe("xai");
    const mine = await chatImageCredential({ ...org, personal: async (p) => p === "openai" ? { ok: true, key: "mine", fingerprint: "f" } as never : { ok: false, error: "no_key" } });
    expect(mine).toMatchObject({ provider: "openai", key: "mine" });
  });

  it("answers null with nothing connected, and the message says what to do", async () => {
    expect(await chatImageCredential(base)).toBeNull();
    expect(NO_IMAGE_PROVIDER).toMatch(/Settings > Providers/);
  });
});

describe("renderChatImage (#2954)", () => {
  const image = { bytes: PNG, mime: "image/png" };

  it("edits the attached image on xAI in one JSON call", async () => {
    const { calls, fetchImpl } = recorder();
    const out = await renderChatImage({ provider: "xai", key: "k", baseUrl: "https://api.x.ai/v1", model: XAI_IMAGE_MODEL }, { prompt: "in Paris", image }, fetchImpl);
    expect(out.mime).toBe("image/png");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.x.ai/v1/images/edits");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: XAI_IMAGE_MODEL, prompt: "in Paris", response_format: "b64_json" });
    expect(body.image.url).toMatch(/^data:image\/png;base64,/);
  });

  it("edits on OpenAI as multipart and generates as JSON", async () => {
    const { calls, fetchImpl } = recorder();
    const cred = { provider: "openai" as const, key: "k", baseUrl: "https://api.openai.com/v1", model: OPENAI_IMAGE_MODEL };
    await renderChatImage(cred, { prompt: "cartoon", image }, fetchImpl);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/edits");
    expect(calls[0]!.init.body).toBeInstanceOf(FormData);
    await renderChatImage(cred, { prompt: "a cat", aspectRatio: "16:9" }, fetchImpl);
    expect(calls[1]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({ size: "1536x1024", quality: "low" });
  });

  it("never echoes a provider error body, and names a refused key", async () => {
    const { fetchImpl } = recorder(() => new Response("secret-ish detail", { status: 401 }));
    const error = await renderChatImage({ provider: "xai", key: "k", baseUrl: "https://api.x.ai/v1", model: XAI_IMAGE_MODEL }, { prompt: "x" }, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(ChatImageError);
    expect(error.status).toBe(401);
    expect(error.message).not.toMatch(/secret-ish/);
  });

  it("finishes well under 30 s on a mock provider", async () => {
    const { fetchImpl } = recorder();
    const started = performance.now();
    await renderChatImage({ provider: "xai", key: "k", baseUrl: "https://api.x.ai/v1", model: XAI_IMAGE_MODEL }, { prompt: "x", image }, fetchImpl);
    expect(performance.now() - started).toBeLessThan(30_000);
  });
});
