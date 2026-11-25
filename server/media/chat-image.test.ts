import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { voiceOutOfCredits } from "../tts/grok.ts";
import {
  chatImageCredentials,
  type ChatImageCredential,
  ChatImageError,
  type ImageKeyCandidate,
  type ImagePeople,
  personImageCredentials,
  imageRefusalCause,
  NO_IMAGE_PROVIDER,
  OPENAI_IMAGE_MODEL,
  renderChatImage,
  XAI_IMAGE_MODEL,
} from "./chat-image.ts";
import type { ProviderKeyResult } from "../perspicax/perspicax-link.ts";
import { imageWord, type ImageWord } from "./image-words.ts";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG = Buffer.from(PNG_B64, "base64");
const ok = () => new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 });
const none = async (): Promise<ProviderKeyResult> => ({ ok: false, error: "no_key" });

/** The head of the chain: the credential an image starts on, or null. */
async function firstCredential(input: Parameters<typeof chatImageCredentials>[0]): Promise<ChatImageCredential | null> {
  const chain = await chatImageCredentials(input);
  return Array.isArray(chain) ? chain[0]?.credential ?? null : null;
}

function recorder(answer: () => Response = ok) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer(); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("chatImageCredential (#2954)", () => {
  const base = { organization: false as boolean, personal: none, solo: async (): Promise<string | undefined> => undefined, organizationXaiAllowed: (): boolean => false, organizationXaiKey: (): string | undefined => undefined };

  it("prefers the xAI key, then OpenAI, then the image settings", async () => {
    expect((await firstCredential({ ...base, solo: async (p) => p === "xai" ? "xk" : "ok" }))?.provider).toBe("xai");
    expect((await firstCredential({ ...base, solo: async (p) => p === "openai" ? "ok" : undefined }))).toMatchObject({ provider: "openai", model: OPENAI_IMAGE_MODEL });
    expect((await firstCredential({ ...base, imageGen: { provider: "openai", key: "gk" } as never }))?.provider).toBe("openai");
    expect((await firstCredential({ ...base, imageGen: { provider: "custom", customUrl: "https://img.example.test/v1", customModel: "m" } as never }))?.provider).toBe("custom");
  });

  it("uses the person's own key in an organization and the shared xAI key only when allowed", async () => {
    const org = { ...base, organization: true, solo: async () => "never", organizationXaiKey: () => "shared" };
    expect(await firstCredential(org)).toBeNull();
    expect((await firstCredential({ ...org, organizationXaiAllowed: () => true }))?.provider).toBe("xai");
    const mine = await firstCredential({ ...org, personal: async (p) => p === "openai" ? { ok: true, key: "mine", fingerprint: "f" } as never : { ok: false, error: "no_key" } });
    expect(mine).toMatchObject({ provider: "openai", key: "mine" });
  });

  // #5223 review, point 3 (and #5231): the chosen image provider is never
  // overtaken by the account, on the chat as on the avatar.
  it("a chosen image provider keeps its place: the account comes after it, never in front", async () => {
    const account = async (): Promise<string | undefined> => "acct-token";
    const sources = async (input: Parameters<typeof chatImageCredentials>[0]) => {
      const chain = await chatImageCredentials(input);
      return Array.isArray(chain) ? chain.map((entry) => `${entry.credential.provider}:${entry.credential.auth ?? "key"}`) : chain;
    };
    // OpenAI chosen: OpenAI first, then the account
    expect(await sources({ ...base, account, imageGen: { provider: "openai", key: "gk" } })).toEqual(["openai:key", "xai:account"]);
    // a custom endpoint chosen: the same
    expect(await sources({ ...base, account, imageGen: { provider: "custom", customUrl: "https://img.example.test/v1", customModel: "m" } }))
      .toEqual(["custom:key", "xai:account"]);
    // xAI chosen, or nothing chosen: the account leads, a key behind it
    expect(await sources({ ...base, account, imageGen: { provider: "xai" }, organizationXaiKey: () => "shared" })).toEqual(["xai:account", "xai:key"]);
    expect(await sources({ ...base, account, imageGen: { key: "gk" } })).toEqual(["xai:account", "openai:key"]);
    // a chosen provider that cannot serve (no key) leaves the account in front
    expect(await sources({ ...base, account, imageGen: { provider: "openai" } })).toEqual(["xai:account"]);
  });

  // #5231: the provider the image settings name is the explicit choice. It
  // leads whatever else the person has, their own xAI key included, and
  // without a choice the decided order stands [D-20261120-012].
  it("a chosen image provider leads the person's own keys too, solo and organization (#5231)", async () => {
    const account = async (): Promise<string | undefined> => "acct-token";
    const chainOf = async (input: Parameters<typeof chatImageCredentials>[0]) => {
      const chain = await chatImageCredentials(input);
      return Array.isArray(chain) ? chain.map((entry) => `${entry.credential.provider}:${entry.credential.auth ?? "key"}:${entry.source}`) : chain;
    };
    const solo = { ...base, account, solo: async (p: "xai" | "openai") => p === "xai" ? "own-xai" : undefined };
    // OpenAI chosen: the person's xAI key no longer takes the image in front of it
    expect(await chainOf({ ...solo, imageGen: { provider: "openai", key: "gk" } }))
      .toEqual(["openai:key:server", "xai:account:grok-account", "xai:key:server"]);
    expect(await chainOf({ ...solo, imageGen: { provider: "custom", customUrl: "https://img.example.test/v1", customModel: "m" } }))
      .toEqual(["custom:key:server", "xai:account:grok-account", "xai:key:server"]);
    // nothing chosen: account, the person's key, then the shared one
    expect(await chainOf({ ...solo, imageGen: { key: "gk" } }))
      .toEqual(["xai:account:grok-account", "xai:key:server", "openai:key:server"]);
    const org = {
      ...base, organization: true, account,
      personal: async (p: "xai" | "openai") => ({ ok: true, key: `own-${p}`, fingerprint: "f" } as never),
      organizationXaiAllowed: () => true, organizationXaiKey: () => "shared",
    };
    // OpenAI chosen in an organization: the person's OpenAI key, the organization's, then the decided order
    expect(await chainOf({ ...org, imageGen: { provider: "openai", key: "gk" } })).toEqual([
      "openai:key:perspicax-key", "openai:key:org-key", "xai:account:grok-account", "xai:key:perspicax-key", "xai:key:org-key",
    ]);
    // xAI chosen: every xAI form first, an account before a key at each level
    expect(await chainOf({ ...org, imageGen: { provider: "xai" } })).toEqual([
      "xai:account:grok-account", "xai:key:perspicax-key", "xai:key:org-key", "openai:key:perspicax-key",
    ]);
    // a chosen provider with nothing to serve changes nothing
    expect(await chainOf({ ...org, personal: none, imageGen: { provider: "openai" } })).toEqual(["xai:account:grok-account", "xai:key:org-key"]);
  });

  // isolation between people: one person's key or account never serves another
  it("one person's chain holds nothing of another person (#5231)", async () => {
    const keys: Record<string, Partial<Record<"xai" | "openai", string>>> = { alice: { xai: "alice-xai-key" }, bob: { xai: "bob-xai-key", openai: "bob-openai-key" } };
    const accounts: Record<string, string> = { bob: "bob-account-token" };
    const read: string[] = [];
    const people: ImagePeople = {
      organization: true,
      person: (principalId) => ({ principalId: principalId ?? "" }),
      ownKey: async (principalId, provider) => {
        read.push(`key:${principalId}:${provider}`);
        const key = keys[principalId ?? ""]?.[provider];
        return key ? { ok: true, key, fingerprint: "f" } : { ok: false, error: "no_key" };
      },
      soloKey: async () => "never-in-an-organization",
      account: async (person) => { read.push(`account:${person.principalId}`); return accounts[person.principalId ?? ""]; },
      imageGen: () => undefined,
      organizationXaiGiven: () => false,
      organizationXaiKey: () => "shared",
    };
    const secrets = async (principalId: string | null) => {
      const chain = await personImageCredentials(people, principalId);
      return Array.isArray(chain) ? chain.map((entry) => entry.credential.key) : chain;
    };
    expect(await secrets("alice")).toEqual(["alice-xai-key"]);
    expect(read.filter((line) => !line.endsWith(":alice") && !line.includes(":alice:"))).toEqual([]);
    expect(await secrets("bob")).toEqual(["bob-account-token", "bob-xai-key", "bob-openai-key"]);
    // nobody known: nothing of anyone, and the shared key only as the organization gives it
    expect(await secrets(null)).toEqual([]);
    // the request made for alice carries her key and nothing of bob's
    const { calls, fetchImpl } = recorder();
    const alice = await personImageCredentials(people, "alice");
    await renderChatImage((alice as ImageKeyCandidate[])[0]!.credential, { prompt: "an owl" }, fetchImpl);
    expect(JSON.stringify(calls)).toContain("alice-xai-key");
    expect(JSON.stringify(calls)).not.toMatch(/bob-/);
  });

  it("the whole chain, in order: account, the person's keys, then the organization's (D-20261123-053)", async () => {
    const chain = await chatImageCredentials({
      ...base, organization: true, account: async () => "acct-token-0001",
      personal: async (p) => ({ ok: true, key: p === "xai" ? "person-xai-0002" : "person-oai-0003", fingerprint: "f" } as never),
      organizationXaiAllowed: () => true, organizationXaiKey: () => "org-key-00000004",
    });
    expect(Array.isArray(chain) && chain.map((entry) => [entry.source, entry.credential.provider, entry.last4])).toEqual([
      ["grok-account", "xai", "0001"], ["perspicax-key", "xai", "0002"], ["perspicax-key", "openai", "0003"], ["org-key", "xai", "0004"],
    ]);
  });

  // #5223 review, point 2: same verdict as the voice (resolveVoiceKeys)
  it("a person turned off in their organization is refused as the voice refuses them, before any credential is read", async () => {
    let read = 0;
    const account = async (): Promise<string | undefined> => { read += 1; return "acct-token"; };
    expect(await chatImageCredentials({ ...base, organization: true, disabled: true, account, organizationXaiAllowed: () => true, organizationXaiKey: () => "shared" }))
      .toEqual({ refused: "payer_disabled" });
    expect(read).toBe(0);
  });

  it("answers null with nothing connected, and the message says what to do", async () => {
    expect(await firstCredential(base)).toBeNull();
    expect(NO_IMAGE_PROVIDER).toMatch(/Grok account/);
  });

  it("a connected Grok account beats every key, solo and organization (#5223)", async () => {
    const account = async (): Promise<string | undefined> => "acct-token";
    // solo: account first, even with a solo xAI key present
    const solo = await firstCredential({ ...base, account, solo: async (p) => p === "xai" ? "xk" : undefined });
    expect(solo).toMatchObject({ provider: "xai", auth: "account", key: "acct-token", baseUrl: "https://cli-chat-proxy.grok.com/v1" });
    // organization: account before the person's own key and before the shared key
    const org = await firstCredential({
      ...base, organization: true, account,
      personal: async () => ({ ok: true, key: "mine", fingerprint: "f" } as never),
      organizationXaiAllowed: () => true, organizationXaiKey: () => "shared",
    });
    expect(org).toMatchObject({ auth: "account", key: "acct-token" });
    // no account falls back to the keys exactly as before
    const keyed = await firstCredential({ ...base, account: async () => undefined, solo: async (p) => p === "xai" ? "xk" : undefined });
    expect(keyed).toMatchObject({ provider: "xai", auth: "key", key: "xk", baseUrl: "https://api.x.ai/v1" });
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

  it("accepts a gateway that sends url and revised_prompt as null next to the image (upstream #4802)", async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ created: 1, data: [{ b64_json: PNG_B64, url: null, revised_prompt: null }] }), { status: 200 }));
    const out = await renderChatImage({ provider: "openai", key: "k", baseUrl: "https://api.openai.com/v1", model: OPENAI_IMAGE_MODEL }, { prompt: "owl" }, fetchImpl);
    expect(out.mime).toBe("image/png");
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

  it("generates on the account through the CLI host with its token header, no key (#5223)", async () => {
    const { calls, fetchImpl } = recorder();
    const accountCred = { provider: "xai" as const, auth: "account" as const, key: "acct-token", baseUrl: "https://cli-chat-proxy.grok.com/v1", model: XAI_IMAGE_MODEL };
    const out = await renderChatImage(accountCred, { prompt: "an owl" }, fetchImpl);
    expect(out.mime).toBe("image/png");
    expect(calls[0]!.url).toBe("https://cli-chat-proxy.grok.com/v1/images/generations");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer acct-token");
    expect(headers["x-xai-token-auth"]).toBe("xai-grok-cli");
  });

  // #5223 review, point 1: which words mean spent credits is the voice's rule
  // (server/tts/grok.ts); the image reads it there and adds only the status.
  it("spent credits are read by the voice's own rule, plus HTTP 402", () => {
    for (const said of ['{"error":"out_of_credits"}', "This team needs credits", "You hit your spending limit", '{"error":{"code":"insufficient_quota"}}', "all good", "Incorrect API key provided"]) {
      expect(imageRefusalCause(503, said) === "credits").toBe(voiceOutOfCredits(said));
    }
    expect(imageRefusalCause(402, "")).toBe("credits");
    expect(imageRefusalCause(401, "")).toBe("key");
    expect(imageRefusalCause(400, "Incorrect API key provided")).toBe("key");
    expect(imageRefusalCause(500, "boom")).toBe("error");
    // one place for the words: no second list of them in this file
    const source = readFileSync(fileURLToPath(new URL("./chat-image.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/insufficient_quota|spending limit|needs credits/);
  });

  it("reads spent credits as credits, never as a missing key or the network (#5223)", async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ code: "payment_required", error: "out_of_credits" }), { status: 402 }));
    const error = await renderChatImage({ provider: "xai", auth: "account", key: "t", baseUrl: "https://cli-chat-proxy.grok.com/v1", model: XAI_IMAGE_MODEL }, { prompt: "x" }, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(ChatImageError);
    expect(error.cause).toBe("credits");
    expect(error.message).toMatch(/out of credits/);
    expect(error.message).not.toMatch(/key|reach/i);
  });

  it("a refused account says the account was refused, not an API key, never the body (#5223)", async () => {
    const { fetchImpl } = recorder(() => new Response('{"error":"Invalid or expired credentials"}', { status: 401 }));
    const error = await renderChatImage({ provider: "xai", auth: "account", key: "t", baseUrl: "https://cli-chat-proxy.grok.com/v1", model: XAI_IMAGE_MODEL }, { prompt: "x" }, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(ChatImageError);
    expect(error.cause).toBe("key");
    expect(error.message).toMatch(/Grok account/);
    expect(error.message).not.toMatch(/expired credentials|secret/i);
  });

  // #5223, expected 5: the sentence is the person's to read, in their language
  it("says a refusal in the person's language, the cause unchanged (#5223)", async () => {
    const account = { provider: "xai" as const, auth: "account" as const, key: "t", baseUrl: "https://cli-chat-proxy.grok.com/v1", model: XAI_IMAGE_MODEL };
    const refused = async (answer: () => Response, credential: ChatImageCredential = account) =>
      renderChatImage(credential, { prompt: "x" }, recorder(answer).fetchImpl, undefined, "fr").catch((e) => e);
    const dry = await refused(() => new Response('{"error":"out_of_credits"}', { status: 402 }));
    expect(dry.cause).toBe("credits");
    expect(dry.message).toBe("xAI n'a plus de crédits pour générer des images. Ajoute des crédits, puis redemande.");
    const out = await refused(() => new Response('{"error":"Invalid or expired credentials"}', { status: 401 }));
    expect(out.cause).toBe("key");
    expect(out.message).toBe("xAI a refusé ton compte Grok connecté (HTTP 401). Reconnecte-le dans Réglages.");
    const key = await refused(() => new Response("no", { status: 403 }), { provider: "openai", key: "k", baseUrl: "https://api.openai.com/v1", model: OPENAI_IMAGE_MODEL });
    expect(key.message).toBe("OpenAI a refusé la clé d'API (HTTP 403). Reconnecte-la dans Réglages > Fournisseurs.");
    const down = await renderChatImage(account, { prompt: "x" }, (async () => { throw new Error("socket"); }) as unknown as typeof fetch, undefined, "fr").catch((e) => e);
    expect(down.cause).toBe("network");
    expect(down.message).toBe("Impossible de joindre xAI pour générer l'image");
    for (const error of [dry, out, key, down]) expect(error.message).not.toMatch(/out of credits|refused|Settings|Could not/);
    // no language known: English, as before
    const english = await renderChatImage(account, { prompt: "x" }, recorder(() => new Response('{"error":"out_of_credits"}', { status: 402 })).fetchImpl).catch((e) => e);
    expect(english.message).toBe("xAI is out of credits for image generation. Add credits, then ask again.");
  });

  it("every image sentence exists in French and in English, and the two files keep no sentence of their own (#5223)", () => {
    const catalog = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/locales/${name}.json`, import.meta.url)), "utf8")) as Record<string, string>;
    const en = catalog("en");
    const fr = catalog("fr");
    const keys = Object.keys(en).filter((key) => key.startsWith("image.error."));
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(fr[key], key).toBeTruthy();
      expect(fr[key], key).not.toBe(en[key]);
      expect(imageWord("fr", key.slice("image.error.".length) as ImageWord), key).toBe(fr[key]);
    }
    // every word the code can say is in the catalog (an unknown key would be said as the key itself)
    for (const file of ["./chat-image.ts", "./avatar-image.ts", "../routes/image-internal.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      for (const match of source.matchAll(/(?:say|imageWord)\((?:language, |"en", )?([^)]*)\)/g)) {
        for (const word of match[1]!.matchAll(/(?<!=== )"([A-Za-z0-9]+)"/g)) expect(en[`image.error.${word[1]}`], `${file}: ${word[1]}`).toBeTruthy();
      }
      // a sentence written in the file would be English for everyone (a
      // lowercase word is an inner marker, caught where it is thrown)
      expect(source.match(/new (?:ChatImage)?Error\(\s*[`"][A-Z$]/g), file).toBeNull();
      expect(source.match(/\?\? "[A-Z]/g), file).toBeNull();
    }
  });
});
