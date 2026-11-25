import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { imageKeyCandidate, xaiAccountImage, xaiKeyImage, type ChatImageCredential } from "../media/chat-image.ts";
import { VoiceKeyRefusals } from "../voice/voice-keys.ts";
import type { ImageInternalDeps } from "./image-internal.ts";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const capability = { botId: "b", threadId: "t", generation: "g" };
let home = "";
let mod: typeof import("./image-internal.ts");

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "sagax-image-route-"));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("SAGAX_DATA_DIR", join(home, ".sagax"));
  mod = await import("./image-internal.ts");
});
afterAll(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

/** A chain of one credential. */
const one = (credential: ChatImageCredential) => [imageKeyCandidate(credential, "server")];

async function call(body: unknown, deps: Partial<ImageInternalDeps> = {}) {
  const appended: unknown[] = [];
  const fetchCalls: string[] = [];
  const handler = mod.createImageInternalRoutes({
    owner: () => "solo",
    credentials: async () => one({ provider: "xai", key: "k", baseUrl: "https://api.x.ai/v1", model: "m" }),
    refusals: new VoiceKeyRefusals(),
    refusalText: (cause) => `refused: ${cause}`,
    image: async () => ({ bytes: Buffer.from(PNG_B64, "base64"), mime: "image/png" }),
    append: (_cap, attachment) => appended.push(attachment),
    fetch: (async (url: string) => { fetchCalls.push(url); return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] })); }) as unknown as typeof fetch,
    ...deps,
  });
  let status = 0;
  let payload: Record<string, unknown> = {};
  const json = ((_res: unknown, s: number, b: Record<string, unknown>) => { status = s; payload = b; }) as never;
  await handler({ res: {} as never, path: mod.IMAGE_INTERNAL_PATH, method: "POST", json, capability, readBody: async () => body } as never);
  return { status, payload, appended, fetchCalls };
}

describe("POST /api/internal/image (#2954)", () => {
  it("edits the attached image and posts it in the chat as the bot's image", async () => {
    const out = await call({ prompt: "put this person in Paris" });
    expect(out.status).toBe(200);
    expect(out.payload).toMatchObject({ ok: true, mode: "edit", provider: "xai" });
    expect(out.fetchCalls).toEqual(["https://api.x.ai/v1/images/edits"]);
    expect(out.appended).toEqual([expect.objectContaining({ kind: "image", mime: "image/png", name: "Edited image.png" })]);
  });

  it("generates from scratch when asked not to use the attachment", async () => {
    const out = await call({ prompt: "a cat", use_attached_image: false });
    expect(out.payload).toMatchObject({ mode: "generate" });
    expect(out.fetchCalls).toEqual(["https://api.x.ai/v1/images/generations"]);
  });

  it("answers in one line with the action when no provider is connected", async () => {
    const out = await call({ prompt: "x" }, { credentials: async () => [] });
    expect(out.status).toBe(409);
    expect(out.payload).toMatchObject({ code: "no_provider" });
    expect(String(out.payload.error)).toMatch(/Grok account/);
    expect(out.fetchCalls).toEqual([]);
  });

  it("generates on the person's Grok account with no key at all, on the CLI host (#5223)", async () => {
    const account = { provider: "xai", auth: "account", key: "acct", baseUrl: "https://cli-chat-proxy.grok.com/v1", model: "m" };
    const out = await call({ prompt: "an owl", use_attached_image: false }, { credentials: async () => one(account as never) });
    expect(out.status).toBe(200);
    expect(out.payload).toMatchObject({ ok: true, mode: "generate", provider: "xai" });
    expect(out.fetchCalls).toEqual(["https://cli-chat-proxy.grok.com/v1/images/generations"]);
    expect(String(out.payload.text)).toMatch(/your connected Grok account/);
  });

  it("a credits refusal reaches the person as credits, not a missing key (#5223)", async () => {
    const account = { provider: "xai", auth: "account", key: "acct", baseUrl: "https://cli-chat-proxy.grok.com/v1", model: "m" };
    const out = await call(
      { prompt: "an owl", use_attached_image: false },
      {
        credentials: async () => one(account as never),
        fetch: (async () => new Response('{"error":"out_of_credits"}', { status: 402 })) as unknown as typeof fetch,
      },
    );
    expect(out.status).toBe(502);
    expect(out.payload).toMatchObject({ code: "credits" });
    expect(String(out.payload.error)).toMatch(/out of credits/);
    expect(String(out.payload.error)).not.toMatch(/Settings > Providers|configure a key|reach/i);
  });

  // #5223, expected 5: the route says a refusal in the language of the person the turn is for
  it("says a refusal in the person's language, with the same code (#5223)", async () => {
    const french = { language: () => "fr" as const };
    const none = await call({ prompt: "x" }, { ...french, credentials: async () => [] });
    expect(none.payload).toEqual({ code: "no_provider", error: "Aucun fournisseur d'images n'est connecté. Connecte ton compte Grok, ou une clé xAI (Grok Imagine) ou OpenAI dans Réglages > Fournisseurs, puis redemande." });
    const account = { provider: "xai", auth: "account", key: "acct", baseUrl: "https://cli-chat-proxy.grok.com/v1", model: "m" };
    const dry = await call({ prompt: "an owl", use_attached_image: false }, {
      ...french, credentials: async () => one(account as never),
      fetch: (async () => new Response('{"error":"out_of_credits"}', { status: 402 })) as unknown as typeof fetch,
    });
    expect(dry.status).toBe(502);
    expect(dry.payload).toEqual({ code: "credits", error: "xAI n'a plus de crédits pour générer des images. Ajoute des crédits, puis redemande." });
    const nobody = await call({ prompt: "x" }, { ...french, owner: () => null });
    expect(nobody.payload.error).toBe("La génération d'image a besoin de la personne pour qui cette conversation parle.");
  });

  it("the server gives the route and the avatar the language of the person each is for (#5223)", () => {
    const index = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
    expect(index).toMatch(/language: \(capability\) => personLanguageCode\(languageOfPerson\(turnMediaPrincipal\(capability\.threadId\)\)\),/);
    expect(index).toMatch(/language: personLanguageCode\(languageOfPerson\(principalId\)\),/);
  });

  // D-20261123-053: a Grok account out of credits goes on to the person's API
  // key, then the organization's, by the voice's own chain.
  describe("a credential out of credits gives way to the next one", () => {
    const chain = () => [
      imageKeyCandidate(xaiAccountImage("acct-token-0001"), "grok-account"),
      imageKeyCandidate(xaiKeyImage("person-key-0002"), "perspicax-key"),
      imageKeyCandidate(xaiKeyImage("org-key-00000003"), "org-key"),
    ];
    const image = () => new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    const dry = () => new Response('{"error":"out_of_credits"}', { status: 402 });
    /** A provider that answers per credential, and records who was asked. */
    function provider(answers: Record<string, () => Response>) {
      const asked: string[] = [];
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        const key = String((init.headers as Record<string, string>).authorization).replace("Bearer ", "");
        asked.push(key);
        return (answers[key] ?? image)();
      }) as unknown as typeof fetch;
      return { asked, fetchImpl };
    }

    it("the account is dry: the image is made on the person's key, and the person is told", async () => {
      const { asked, fetchImpl } = provider({ "acct-token-0001": dry });
      const out = await call({ prompt: "an owl", use_attached_image: false }, { credentials: async () => chain(), fetch: fetchImpl });
      expect(out.status).toBe(200);
      expect(asked).toEqual(["acct-token-0001", "person-key-0002"]);
      expect(out.fetchCalls).toEqual([]);
      expect(String(out.payload.text)).toMatch(/Generated the image with xAI Grok Imagine/);
      expect(String(out.payload.text)).toMatch(/your connected Grok account \(Grok Imagine\) is out of credits/);
      // never a key in what the bot reads
      expect(JSON.stringify(out.payload)).not.toMatch(/acct-token|person-key|org-key-0/);
    });

    it("the account and the person's key are dry: the organization's key makes it", async () => {
      const { asked, fetchImpl } = provider({ "acct-token-0001": dry, "person-key-0002": dry });
      const out = await call({ prompt: "an owl", use_attached_image: false }, { credentials: async () => chain(), fetch: fetchImpl });
      expect(out.status).toBe(200);
      expect(asked).toEqual(["acct-token-0001", "person-key-0002", "org-key-00000003"]);
    });

    it("a dry credential is remembered: the next image goes straight to the one that serves", async () => {
      const refusals = new VoiceKeyRefusals();
      const { asked, fetchImpl } = provider({ "acct-token-0001": dry });
      await call({ prompt: "an owl", use_attached_image: false }, { credentials: async () => chain(), fetch: fetchImpl, refusals });
      await call({ prompt: "a fox", use_attached_image: false }, { credentials: async () => chain(), fetch: fetchImpl, refusals });
      expect(asked).toEqual(["acct-token-0001", "person-key-0002", "person-key-0002"]);
    });

    it("every credential dry: credits, in the words of the credential closest to the person", async () => {
      const { asked, fetchImpl } = provider({ "acct-token-0001": dry, "person-key-0002": dry, "org-key-00000003": dry });
      const out = await call({ prompt: "an owl", use_attached_image: false }, { credentials: async () => chain(), fetch: fetchImpl });
      expect(asked).toHaveLength(3);
      expect(out.status).toBe(502);
      expect(out.payload).toMatchObject({ code: "credits" });
      expect(String(out.payload.error)).toMatch(/out of credits/);
    });

    it("an outage stays with the credential that got it: no second provider call, no second charge", async () => {
      const { asked, fetchImpl } = provider({ "acct-token-0001": () => new Response("upstream down", { status: 503 }) });
      const out = await call({ prompt: "an owl", use_attached_image: false }, { credentials: async () => chain(), fetch: fetchImpl });
      expect(asked).toEqual(["acct-token-0001"]);
      expect(out.status).toBe(502);
      expect(out.payload).toMatchObject({ code: "error" });
    });
  });

  // #5223 review, point 2: the voice refuses a person turned off in their
  // organization (payer_disabled); the image gives the same verdict.
  it("a person turned off in their organization gets the voice's own refusal, and nothing is asked of a provider", async () => {
    const out = await call({ prompt: "an owl" }, { credentials: async () => ({ refused: "payer_disabled" }) });
    expect(out.status).toBe(403);
    expect(out.payload).toEqual({ error: "refused: payer_disabled", code: "payer_disabled" });
    expect(out.fetchCalls).toEqual([]);
    expect(out.appended).toEqual([]);
  });

  it("refuses an empty prompt", async () => {
    expect((await call({ prompt: "" })).status).toBe(400);
  });
});
