// #4416: the Gemini engine lists the models its key really offers, the
// written list only as the fallback.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../../config.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { GeminiAgentDriver, geminiModelCatalog, STATIC_GEMINI_MODELS } from "./gemini.ts";

describe("Gemini live model list", () => {
  let previousFetch: typeof globalThis.fetch;
  /** What each key's account lists; a missing key answers 403. */
  let accounts: Record<string, unknown[]> = {};
  let requests = 0;

  beforeEach(() => {
    previousFetch = globalThis.fetch;
    requests = 0;
    globalThis.fetch = (async (_url, init) => {
      requests++;
      const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      const models = accounts[key];
      return models ? Response.json({ models }) : new Response("denied", { status: 403 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = previousFetch;
  });

  const row = (id: string, displayName: string, methods = ["generateContent"], inputTokenLimit?: number) =>
    ({ name: `models/${id}`, displayName, supportedGenerationMethods: methods, ...(inputTokenLimit ? { inputTokenLimit } : {}) });

  it("lists more models than the written list, under Google's names, and leaves out non-chat models", async () => {
    accounts = { "key-a": [
      row("gemini-2.5-pro", "Gemini 2.5 Pro", ["generateContent"], 1_048_576),
      row("gemini-3-pro-preview", "Gemini 3 Pro Preview"),
      row("gemini-2.5-flash", "Gemini 2.5 Flash"),
      row("gemini-embedding-001", "Gemini Embedding", ["embedContent"]),
      row("gemini-2.5-flash-image", "Nano Banana"),
      row("imagen-4.0-generate-001", "Imagen 4", ["predict"]),
    ] };
    const catalog = await geminiModelCatalog({ GEMINI_API_KEY: "key-a" });
    expect(catalog.default).toBe("gemini-2.5-pro");
    expect(catalog.options).toEqual([
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextWindow: 1_048_576 },
      { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ]);
  });

  it("lists fewer when the key offers fewer, and two keys get their own lists", async () => {
    accounts = { "key-b": [row("gemini-2.5-flash", "Gemini 2.5 Flash")], "key-c": [row("gemini-3-flash", "Gemini 3 Flash")] };
    expect(await geminiModelCatalog({ GEMINI_API_KEY: "key-b" })).toEqual({
      default: "gemini-2.5-flash", options: [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }],
    });
    expect((await geminiModelCatalog({ GOOGLE_API_KEY: "key-c" })).options.map((option) => option.id)).toEqual(["gemini-3-flash"]);
  });

  it("throws on a failed or empty lookup, so the runtime keeps its last usable catalog", async () => {
    accounts = { "key-e": [] };
    await expect(geminiModelCatalog({ GEMINI_API_KEY: "key-d" })).rejects.toThrow("HTTP 403");
    await expect(geminiModelCatalog({ GEMINI_API_KEY: "key-e" })).rejects.toThrow("empty");
  });

  const create = async (instanceId: string, environment: Record<string, string>): Promise<ProviderInstance> => {
    created.push(instanceId);
    const instance = await GeminiAgentDriver.create({
      instanceId, displayName: "Gemini", enabled: true, environment, config: GeminiAgentDriver.defaultConfig(),
    });
    instances.push(instance);
    return instance;
  };
  const instances: ProviderInstance[] = [];
  const created: string[] = [];
  afterEach(async () => {
    await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
    for (const id of created.splice(0)) rmSync(join(DATA_DIR, "providers", "engine-models", `${id}.json`), { force: true });
  });
  const personAccess = (principal: string, key: string) => ({
    via: "speaker-key" as const, identity: `speaker-key:${principal}:fp`, environment: { GEMINI_API_KEY: key },
    engineHome: join(DATA_DIR, "principals", principal, "geminiAgent-key"),
  });
  const ids = (catalog: { options: { id: string }[] }) => catalog.options.map((option) => option.id);

  it("gives two people with their own keys on one instance their own lists", async () => {
    accounts = {
      "server-key": [row("gemini-2.5-flash", "Gemini 2.5 Flash")],
      "person-a": [row("gemini-3-pro-preview", "Gemini 3 Pro Preview"), row("gemini-2.5-pro", "Gemini 2.5 Pro")],
      "person-b": [row("gemini-3-flash", "Gemini 3 Flash")],
    };
    const instance = await create("gemini-4416-two", { GEMINI_API_KEY: "server-key" });
    expect(ids(instance.models)).toEqual(["gemini-2.5-flash"]);
    expect(ids(await instance.modelsForAccess!(personAccess("person-a", "person-a")))).toEqual(["gemini-3-pro-preview", "gemini-2.5-pro"]);
    expect(ids(await instance.modelsForAccess!(personAccess("person-b", "person-b")))).toEqual(["gemini-3-flash"]);
    // the organization's key keeps the instance's own list
    expect(ids(await instance.modelsForAccess!({ via: "org-key", identity: "org-key" }))).toEqual(["gemini-2.5-flash"]);
  });

  it("reads a person's key with no server key, and the written list when it fails", async () => {
    accounts = { "person-c": [row("gemini-3-flash", "Gemini 3 Flash")] };
    const instance = await create("gemini-4416-nokey", {});
    expect(instance.models).toBe(STATIC_GEMINI_MODELS);
    expect(ids(await instance.modelsForAccess!(personAccess("person-c", "person-c")))).toEqual(["gemini-3-flash"]);
    expect(await instance.modelsForAccess!(personAccess("person-d", "person-d"))).toBe(STATIC_GEMINI_MODELS);
  });

  it("keeps the written list without a key (Vertex or an enterprise login), with no lookup", async () => {
    expect(await geminiModelCatalog({})).toBe(STATIC_GEMINI_MODELS);
    expect(requests).toBe(0);
  });
});
