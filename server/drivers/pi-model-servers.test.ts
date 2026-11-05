// #2024: Perspicax model servers as pi providers.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  modelServerAccess,
  modelServerEffort,
  modelServerKeyEnv,
  modelServerOptions,
  overlayModelServers,
  parseModelServers,
  piProviderEntry,
  writePiModelServers,
} from "./pi-model-servers.ts";

const ANSWER = {
  servers: [
    {
      instanceId: "acme-models",
      name: "Acme models",
      url: "https://models.example.com/v1/",
      protocol: "openai",
      scope: "org",
      apiKey: "test-key-org",
      models: [
        {
          id: "example-27b",
          label: "Example 27B",
          contextWindow: 262144,
          maxTokens: 32768,
          input: ["text", "image"],
          thinkingLevelMap: { off: "none", minimal: "low", low: "low", medium: "medium", high: "xhigh", xhigh: "xhigh" },
          defaultThinkingLevel: "medium",
        },
        { id: "example-small" },
      ],
    },
    { instanceId: "acme-models", name: "Mine", url: "https://own.example.com", protocol: "anthropic", scope: "personal", apiKey: "", models: [{ id: "own-1", reasoning: false }] },
    { instanceId: "Bad Id", url: "https://x.example.com", protocol: "openai", apiKey: "k", models: [{ id: "m" }] },
    { instanceId: "no-models", url: "https://x.example.com", protocol: "openai", apiKey: "k", models: [] },
    { instanceId: "bad-key", url: "https://x.example.com", protocol: "openai", apiKey: "$(cat secret)", models: [{ id: "m" }] },
    { instanceId: "bad-proto", url: "https://x.example.com", protocol: "grpc", apiKey: "k", models: [{ id: "m" }] },
  ],
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sagax-pi-servers-"));
}

describe("parseModelServers", () => {
  it("keeps the valid servers with the contract's defaults", () => {
    const servers = parseModelServers(ANSWER);
    expect(servers.map((server) => [server.instanceId, server.scope])).toEqual([["acme-models", "org"], ["acme-models", "personal"]]);
    const [org] = servers;
    expect(org!.url).toBe("https://models.example.com/v1");
    expect(org!.models[0]).toMatchObject({ contextWindow: 262144, maxTokens: 32768, input: ["text", "image"], defaultThinkingLevel: "medium" });
    expect(org!.models[1]).toMatchObject({ id: "example-small", label: "example-small", contextWindow: 131072, maxTokens: 16384, reasoning: true, input: ["text"] });
  });

  it("reads nothing from a malformed answer", () => {
    expect(parseModelServers(null)).toEqual([]);
    expect(parseModelServers({ servers: "x" })).toEqual([]);
    expect(parseModelServers([])).toEqual([]);
  });
});

describe("modelServerAccess", () => {
  it("puts each key in the environment and none in the servers", () => {
    const access = modelServerAccess(parseModelServers(ANSWER));
    expect(access.environment).toEqual({ SAGAX_PI_KEY_ORG_ACME_MODELS: "test-key-org", SAGAX_PI_KEY_OWN_ACME_MODELS: "none" });
    expect(access.servers.map((server) => [server.provider, server.keyEnv])).toEqual([
      ["px-org-acme-models", "SAGAX_PI_KEY_ORG_ACME_MODELS"],
      ["px-own-acme-models", "SAGAX_PI_KEY_OWN_ACME_MODELS"],
    ]);
    expect(JSON.stringify(access.servers)).not.toContain("test-key-org");
    expect(modelServerKeyEnv({ instanceId: "a-b", scope: "org" })).toBe("SAGAX_PI_KEY_ORG_A_B");
  });
});

describe("models.json", () => {
  it("writes one pi provider per server with the key by name", () => {
    const { servers } = modelServerAccess(parseModelServers(ANSWER));
    expect(piProviderEntry(servers[0]!)).toEqual({
      baseUrl: "https://models.example.com/v1",
      api: "openai-completions",
      apiKey: "$SAGAX_PI_KEY_ORG_ACME_MODELS",
      compat: { supportsDeveloperRole: false },
      models: [
        {
          id: "example-27b",
          name: "Example 27B",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 262144,
          maxTokens: 32768,
          thinkingLevelMap: { off: "none", minimal: "low", low: "low", medium: "medium", high: "xhigh", xhigh: "xhigh" },
        },
        { id: "example-small", name: "example-small", reasoning: true, input: ["text"], contextWindow: 131072, maxTokens: 16384 },
      ],
    });
    expect(piProviderEntry(servers[1]!).api).toBe("anthropic-messages");
  });

  it("replaces the server providers, keeps the others, never writes a key", () => {
    const dir = tempDir();
    const path = join(dir, "models.json");
    writeFileSync(path, JSON.stringify({ providers: { omlx: { baseUrl: "http://127.0.0.1:8000/v1" }, "px-org-gone": { baseUrl: "https://old.example.com" } } }));
    const { servers } = modelServerAccess(parseModelServers(ANSWER));
    expect(writePiModelServers(dir, servers)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(Object.keys(JSON.parse(text).providers)).toEqual(["omlx", "px-org-acme-models", "px-own-acme-models"]);
    expect(text).not.toContain("test-key-org");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(writePiModelServers(dir, [])).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(path, "utf8")).providers)).toEqual(["omlx"]);
  });

  it("leaves a malformed file alone", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "models.json"), "{ not json");
    expect(writePiModelServers(dir, modelServerAccess(parseModelServers(ANSWER)).servers)).toBe(false);
    expect(readFileSync(join(dir, "models.json"), "utf8")).toBe("{ not json");
  });
});

describe("catalog", () => {
  it("offers each model with its thinking levels", () => {
    const { servers } = modelServerAccess(parseModelServers(ANSWER));
    const rows = modelServerOptions(servers);
    expect(rows.map((row) => row.id)).toEqual(["px-org-acme-models/example-27b", "px-org-acme-models/example-small", "px-own-acme-models/own-1"]);
    expect(rows[0]).toMatchObject({ contextWindow: 262144, effortLevels: ["none", "low", "medium", "high", "xhigh"], defaultEffort: "medium" });
    expect(rows[1]!.effortLevels).toBeUndefined();
    expect(rows[2]!.effortLevels).toEqual([]);
    expect(modelServerEffort({ id: "m", label: "m", contextWindow: 1, maxTokens: 1, reasoning: true, input: ["text"], thinkingLevelMap: { high: "h", off: null } })).toEqual({ effortLevels: ["high"] });
  });

  it("overlays only pi engines and replaces an earlier overlay", () => {
    const { servers } = modelServerAccess(parseModelServers(ANSWER));
    const instances = [
      { driverKind: "piAgent", models: { default: "anthropic/x", options: [{ id: "anthropic/x" }, { id: "px-org-old/m" }] } },
      { driverKind: "codex", models: { default: "gpt", options: [{ id: "gpt" }] } },
    ];
    const [pi, codex] = overlayModelServers(instances, servers);
    expect(pi!.models.options.map((option) => option.id)).toEqual(["anthropic/x", "px-org-acme-models/example-27b", "px-org-acme-models/example-small", "px-own-acme-models/own-1"]);
    expect(codex).toBe(instances[1]);
  });
});
