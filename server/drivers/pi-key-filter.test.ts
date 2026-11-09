// #3085: pi offers, and accepts, only the models of providers the turn's
// payer really holds a key for. Provider names only, never a key value.
import { describe, expect, it } from "vitest";

import type { ModelCatalog } from "../contracts.ts";
import { piKeyProvider, piPayerProviders, type EngineCredentialInput } from "../engines/engine-credentials.ts";
import { filterPiCatalogByProviders, piModelRefusal } from "./pi-key-filter.ts";

const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const OTHER = "pr_00000000-0000-4000-8000-000000000002";
const PI = { instanceId: "pi", driver: "piAgent", installed: true };

function input(keys: string[], patch: Partial<EngineCredentialInput> = {}): EngineCredentialInput {
  return {
    identity: "perspicax",
    speaker: { origin: "person", principalId: OWNER },
    owner: { principalId: OWNER, sub: "SUB-OWNER" },
    instance: PI,
    person: (principalId) => (principalId === OTHER ? { sub: "SUB-OTHER" } : undefined),
    subscriptionSignedIn: () => false,
    hasKey: (sub, provider) => keys.includes(`${sub}/${provider}`),
    keyBacked: false,
    ...patch,
  };
}

const row = (provider: string, id: string) => ({ id: `${provider}/${id}`, label: id, custom: true as const, provider });
const CATALOG: ModelCatalog = {
  default: "openrouter/auto",
  options: [
    row("openrouter", "auto"),
    row("anthropic", "model-a"),
    row("anthropic", "model-b"),
    row("openai", "model-c"),
    row("amazon-bedrock", "model-d"),
    row("moonshotai", "model-e"),
    row("px-org-lab", "model-f"),
    { id: "localhost::model-g", label: "model-g", custom: true },
  ],
};

describe("pi models filtered by the payer's keys (#3085)", () => {
  it("a payer with only an anthropic key sees only anthropic/* models", () => {
    const providers = piPayerProviders(input(["SUB-OWNER/anthropic"]), []);
    expect([...providers!]).toEqual(["anthropic"]);
    const catalog = filterPiCatalogByProviders(CATALOG, providers);
    const keyed = catalog.options.filter((option) => option.keyPaid);
    expect(keyed.map((option) => option.id)).toEqual(["anthropic/model-a", "anthropic/model-b"]);
    // nothing of another provider, no OpenRouter default chosen in advance
    expect(catalog.options.some((option) => option.id.startsWith("openrouter/") || option.id.startsWith("openai/") || option.id.startsWith("amazon-bedrock/"))).toBe(false);
    expect(catalog.default).toBe("anthropic/model-a");
    // a model server's or a local row keeps its own rules
    expect(catalog.options.map((option) => option.id)).toContain("px-org-lab/model-f");
    expect(catalog.options.map((option) => option.id)).toContain("localhost::model-g");
  });

  it("a payer without an openrouter key is refused an openrouter/* model, never swapped", () => {
    const providers = piPayerProviders(input(["SUB-OWNER/anthropic"]), ["openrouter"]);
    expect(piModelRefusal("openrouter/auto", providers)).toEqual({ provider: "openrouter", available: ["anthropic"] });
    expect(piModelRefusal("anthropic/model-a", providers)).toBeNull();
    // a provider no Perspicax key can pay is refused too
    expect(piModelRefusal("amazon-bedrock/model-d", providers)?.provider).toBe("amazon-bedrock");
    // a model server's and a local model are not judged by provider keys
    expect(piModelRefusal("px-own-lab/model-f", providers)).toBeNull();
    expect(piModelRefusal("localhost::model-g", providers)).toBeNull();
  });

  it("when org-key applies, the providers offered are the organization's pi keys", () => {
    const providers = piPayerProviders(input([], { keyBacked: true }), ["anthropic", "openrouter"]);
    expect([...providers!].sort()).toEqual(["anthropic", "openrouter"]);
    const ids = filterPiCatalogByProviders(CATALOG, providers).options.filter((option) => option.keyPaid).map((option) => option.id);
    expect(ids).toEqual(["openrouter/auto", "anthropic/model-a", "anthropic/model-b"]);
    // the organization's key not given to this person: nothing
    const refused = piPayerProviders(input([], { keyBacked: true, serverEngineAllowed: () => false }), ["anthropic"]);
    expect(refused!.size).toBe(0);
    // the payer's own key wins: only their providers, as their turn runs
    const own = piPayerProviders(input(["SUB-OWNER/openai"], { keyBacked: true }), ["anthropic"]);
    expect([...own!]).toEqual(["openai"]);
  });

  it("the bot's owner pays when the owner pays: their keys decide, not the speaker's", () => {
    const speaker = { origin: "person" as const, principalId: OTHER };
    const owned = piPayerProviders(input(["SUB-OWNER/anthropic", "SUB-OTHER/openai"], { speaker, payerMode: "owner" }), []);
    expect([...owned!]).toEqual(["anthropic"]);
    const spoken = piPayerProviders(input(["SUB-OWNER/anthropic", "SUB-OTHER/openai"], { speaker }), []);
    expect([...spoken!]).toEqual(["openai"]);
  });

  it("solo: no filter (pi lists only what its own keys serve)", () => {
    expect(piPayerProviders(input([], { identity: "solo" }), [])).toBeNull();
    expect(filterPiCatalogByProviders(CATALOG, null)).toBe(CATALOG);
  });

  it("pi provider names map to key providers", () => {
    expect(piKeyProvider("moonshotai")).toBe("moonshot");
    expect(piKeyProvider("kimi-coding")).toBe("kimi");
    expect(piKeyProvider("opencode-go")).toBe("opencode");
    expect(piKeyProvider("amazon-bedrock")).toBeNull();
    expect(piKeyProvider("anthropic")).toBe("anthropic");
  });
});
