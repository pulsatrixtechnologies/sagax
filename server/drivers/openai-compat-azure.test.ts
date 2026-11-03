// Azure AI Foundry / Azure OpenAI through the OpenAI-compatible engine,
// against a fake Azure resource (a stubbed fetch on a fixture host): the
// deployments are the list, the key goes in `api-key`, a turn names the
// deployment, and a list that fails says why.
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordEvents } from "../testing/events.ts";
import { checkProviderKey } from "../engines/provider-key-check.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";
import { azureDeployments, azureOpenAIEndpoint, looksLikeAzureUrl } from "../../shared/azure-openai.ts";

const RESOURCE = "https://fixture-resource.openai.azure.com";
const KEY = "fixture-azure-key";
const DEPLOYMENTS_URL = `${RESOURCE}/openai/deployments?api-version=2022-12-01`;

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

/** A fake Azure resource: GET deployments, POST chat/completions and
 * responses on /openai/v1. Only the `api-key` header is accepted. */
function fakeAzure(options: {
  deployments?: unknown[];
  deploymentsStatus?: number;
  responses?: boolean;
} = {}) {
  const calls: Call[] = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, method: init?.method ?? "GET", headers, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (headers["api-key"] !== KEY) {
      return new Response(JSON.stringify({ error: { code: "401", message: "Access denied due to invalid subscription key or wrong API endpoint." } }), { status: 401 });
    }
    if (url === DEPLOYMENTS_URL) {
      if (options.deploymentsStatus) return new Response(JSON.stringify({ error: { code: "404" } }), { status: options.deploymentsStatus });
      return new Response(JSON.stringify({ data: options.deployments ?? [], object: "list" }), { status: 200 });
    }
    if (url === `${RESOURCE}/openai/v1/responses`) {
      if (!options.responses) return new Response(JSON.stringify({ error: { code: "404", message: "Resource not found" } }), { status: 404 });
    }
    if (url === `${RESOURCE}/openai/v1/chat/completions`) {
      const body = JSON.parse(String(init?.body)) as { model: string; stream?: boolean };
      if (body.model !== "deepseek-prod" && body.model !== "support-bot") {
        return new Response(JSON.stringify({ error: { code: "DeploymentNotFound", message: "The API deployment for this resource does not exist." } }), { status: 404 });
      }
      return new Response(
        'data: {"choices":[{"index":0,"delta":{"content":"ok from azure"}}]}\n\n'
        + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }
    return new Response(JSON.stringify({ error: { code: "404" } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchStub);
  return calls;
}

const DEPLOYMENTS = [
  { id: "support-bot", model: "gpt-4.1", status: "succeeded", object: "deployment" },
  { id: "deepseek-prod", model: "DeepSeek-V4.1-Flash", status: "succeeded", object: "deployment" },
  { id: "search-vectors", model: "text-embedding-3-large", status: "succeeded", object: "deployment" },
  { id: "still-creating", model: "gpt-5-mini", status: "running", object: "deployment" },
  { id: "o4-mini", model: "o4-mini", status: "succeeded", object: "deployment" },
];

async function azureInstance(url: string, extra: Record<string, unknown> = {}) {
  return OpenAICompatDriver.create({
    instanceId: "openaiCompat", displayName: "Azure", enabled: true,
    config: OpenAICompatDriver.decodeConfig({ url, apiKeyEnv: "FIXTURE_AZURE_KEY", ...extra }),
    environment: { FIXTURE_AZURE_KEY: KEY },
  });
}

describe("Azure AI Foundry / Azure OpenAI endpoints", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the resource from any URL pasted for it", () => {
    for (const url of [
      "https://fixture-resource.openai.azure.com",
      "https://fixture-resource.openai.azure.com/openai/v1/",
      "fixture-resource.openai.azure.com",
      "https://fixture-resource.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21",
    ]) {
      expect(azureOpenAIEndpoint(url)).toEqual({
        origin: RESOURCE,
        v1: `${RESOURCE}/openai/v1`,
        deployments: DEPLOYMENTS_URL,
      });
    }
    expect(azureOpenAIEndpoint("https://fixture-hub.services.ai.azure.com/api/projects/fixture")?.v1)
      .toBe("https://fixture-hub.services.ai.azure.com/openai/v1");
    expect(azureOpenAIEndpoint("https://fixture.cognitiveservices.azure.com/")?.v1)
      .toBe("https://fixture.cognitiveservices.azure.com/openai/v1");
    expect(azureOpenAIEndpoint("https://openrouter.ai/api/v1")).toBeNull();
    expect(azureOpenAIEndpoint("http://fixture-resource.openai.azure.com")).toBeNull();
    expect(azureOpenAIEndpoint("https://ai.azure.com/build/deployments")).toBeNull();
    expect(looksLikeAzureUrl("https://ai.azure.com/build/deployments")).toBe(true);
    expect(looksLikeAzureUrl("https://api.groq.com/openai/v1")).toBe(false);
  });

  it("keeps every deployment that can converse, by the model under it, whatever its name", () => {
    expect(azureDeployments({ data: DEPLOYMENTS })).toEqual([
      { id: "support-bot", model: "gpt-4.1" },
      { id: "deepseek-prod", model: "DeepSeek-V4.1-Flash" },
      { id: "o4-mini", model: "o4-mini" },
    ]);
    // No model named: kept, the name is all Azure gives.
    expect(azureDeployments({ data: [{ id: "my-free-name" }] })).toEqual([{ id: "my-free-name" }]);
  });

  it("lists the resource's deployments with the api-key header, not the region's catalog", async () => {
    const calls = fakeAzure({ deployments: DEPLOYMENTS });
    const inst = await azureInstance(`${RESOURCE}/openai/v1/`);
    await inst.refreshModels?.();
    expect(calls.map((call) => call.url)).toEqual([DEPLOYMENTS_URL, DEPLOYMENTS_URL]);
    expect(calls[0]!.headers["api-key"]).toBe(KEY);
    expect(calls[0]!.headers.authorization).toBeUndefined();
    const { options, default: fallback, issue } = inst.models;
    expect(issue).toBeUndefined();
    expect(options.map((option) => [option.id, option.label])).toEqual([
      ["support-bot", "support-bot (gpt-4.1)"],
      ["deepseek-prod", "deepseek-prod (DeepSeek-V4.1-Flash)"],
      ["o4-mini", "o4-mini"],
    ]);
    // The resource's own list: never `custom`, so an organization server
    // offers it to its members (ModelPicker) and Auto can use it.
    expect(options.every((option) => option.custom !== true)).toBe(true);
    expect(fallback).toBe("support-bot");
    // Effort follows the model under the deployment.
    expect(options.find((option) => option.id === "o4-mini")?.effortLevels).toEqual(["low", "medium", "high"]);
    expect(options.find((option) => option.id === "deepseek-prod")?.effortLevels).toEqual([]);
    await inst.dispose();
  });

  it("runs a turn on a deployment through /openai/v1 with the api-key header", async () => {
    const calls = fakeAzure({ deployments: DEPLOYMENTS });
    const inst = await azureInstance(RESOURCE);
    await inst.refreshModels?.();
    const recorder = recordEvents(inst.adapter);
    await inst.adapter.sendTurn({ threadId: "azure-thread", text: "hi", model: "deepseek-prod" });
    const completed = await recorder.until((event) => event.type === "turn.completed");
    expect(completed).toMatchObject({ ok: true });
    const chat = calls.find((call) => call.method === "POST");
    expect(chat?.url).toBe(`${RESOURCE}/openai/v1/chat/completions`);
    expect(chat?.headers["api-key"]).toBe(KEY);
    expect(chat?.headers.authorization).toBeUndefined();
    expect(JSON.parse(chat!.body!).model).toBe("deepseek-prod");
    recorder.stop();
    await inst.dispose();
  }, 20_000);

  it("tries /responses first on a deployment of an OpenAI model, then chat completions", async () => {
    const calls = fakeAzure({ deployments: DEPLOYMENTS, responses: false });
    const inst = await azureInstance(RESOURCE);
    await inst.refreshModels?.();
    const recorder = recordEvents(inst.adapter);
    await inst.adapter.sendTurn({ threadId: "azure-gpt", text: "hi", model: "support-bot" });
    const completed = await recorder.until((event) => event.type === "turn.completed");
    expect(completed).toMatchObject({ ok: true });
    const posts = calls.filter((call) => call.method === "POST").map((call) => call.url);
    expect(posts[0]).toBe(`${RESOURCE}/openai/v1/responses`);
    expect(posts).toContain(`${RESOURCE}/openai/v1/chat/completions`);
    recorder.stop();
    await inst.dispose();
  }, 20_000);

  it("says why the list is empty: key refused, wrong URL, no deployment", async () => {
    fakeAzure({ deployments: DEPLOYMENTS });
    const refused = await OpenAICompatDriver.create({
      instanceId: "openaiCompat", displayName: "Azure", enabled: true,
      config: OpenAICompatDriver.decodeConfig({ url: RESOURCE, apiKeyEnv: "FIXTURE_AZURE_KEY" }),
      environment: { FIXTURE_AZURE_KEY: "wrong-key" },
    });
    await refused.refreshModels?.();
    expect(refused.models.issue).toBe("key-refused");
    expect(refused.models.options).toEqual([]);
    await refused.dispose();

    fakeAzure({ deploymentsStatus: 404 });
    const notFound = await azureInstance(RESOURCE);
    await notFound.refreshModels?.();
    expect(notFound.models.issue).toBe("azure-bad-url");
    await notFound.dispose();

    fakeAzure({ deployments: [] });
    const empty = await azureInstance(RESOURCE);
    await empty.refreshModels?.();
    expect(empty.models.issue).toBe("azure-no-deployments");
    await empty.dispose();

    // The portal or a Foundry web page: nothing is sent there at all.
    const calls = fakeAzure({ deployments: DEPLOYMENTS });
    const portal = await azureInstance("https://ai.azure.com/build/deployments");
    await portal.refreshModels?.();
    expect(portal.models.issue).toBe("azure-bad-url");
    expect(calls).toEqual([]);
    await portal.dispose();
  });

  it("offers a deployment typed by hand even when the list fails", async () => {
    fakeAzure({ deploymentsStatus: 404 });
    const inst = await azureInstance(RESOURCE, { model: "my-deployment" });
    await inst.refreshModels?.();
    expect(inst.models.options).toEqual([{ id: "my-deployment", label: "my-deployment" }]);
    expect(inst.models.default).toBe("my-deployment");
    await inst.dispose();
  });

  it("tests an Azure key against the deployments with api-key", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), method: "GET", headers });
      return headers["api-key"] === KEY
        ? new Response(JSON.stringify({ data: DEPLOYMENTS }), { status: 200 })
        : new Response("{}", { status: 401 });
    }) as typeof fetch;
    await expect(checkProviderKey({ provider: "openaiCompat", key: KEY, url: `${RESOURCE}/openai/v1` }, fetchImpl))
      .resolves.toEqual({ ok: true, check: "models", models: ["support-bot", "deepseek-prod", "o4-mini"] });
    expect(calls[0]!.url).toBe(DEPLOYMENTS_URL);
    await expect(checkProviderKey({ provider: "openaiCompat", key: "nope", url: RESOURCE }, fetchImpl))
      .resolves.toMatchObject({ ok: false, reason: "rejected" });
  });
});
