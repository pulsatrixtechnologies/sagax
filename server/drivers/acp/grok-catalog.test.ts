import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dismissGrokModelCampaigns, GrokAgentDriver, grokModelsFromInitialize, probeGrokModels, readGrokModelCatalog,
  readGrokModelsCache, renewGrokSignIn, resetGrokLiveModels, STATIC_GROK_MODELS,
} from "./grok.ts";

const fakeCli = join(dirname(fileURLToPath(import.meta.url)), "../../testing/fake-acp-cli.ts");

const scratchDirs: string[] = [];

afterEach(() => {
  resetGrokLiveModels();
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchConfig(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-grok-catalog-"));
  scratchDirs.push(dir);
  mkdirSync(join(dir, ".grok"), { recursive: true });
  writeFileSync(join(dir, ".grok", "config.toml"), toml);
  return dir;
}

describe("readGrokModelCatalog", () => {
  it("returns the static cloud models when there is no config", () => {
    expect(readGrokModelCatalog({ HOME: join(tmpdir(), "omb-grok-missing-home") })).toEqual(STATIC_GROK_MODELS);
  });

  it("appends local slugs from config.toml and prefers their display names", () => {
    const home = scratchConfig(`
[models]
default = "ollama-ornith-35b-bf16"

[model."grok-4.6"]
name = "should not replace the cloud label"

[model."ollama-ornith-35b-bf16"]
model = "ornith:35b-bf16"
name = "ornith:35b-bf16 (Ollama)"
api_key = "must-not-leak"

[model.omlx-minimax-m3]
name = "MiniMax M3 4bit (oMLX)"
`);

    expect(readGrokModelCatalog({ HOME: home })).toEqual({
      default: "ollama-ornith-35b-bf16",
      options: [
        ...STATIC_GROK_MODELS.options,
        { id: "ollama-ornith-35b-bf16", label: "ornith:35b-bf16 (Ollama)", custom: true },
        { id: "omlx-minimax-m3", label: "MiniMax M3 4bit (oMLX)", custom: true },
      ],
    });
  });

  it("ignores invalid slugs and a default that is not in the catalog", () => {
    const home = scratchConfig(`
[models]
default = "not-installed"

[model."bad slug"]
name = "nope"

[model.ok-model]
name = "OK"
`);
    const catalog = readGrokModelCatalog({ HOME: home });
    expect(catalog.default).toBe("grok-4.7");
    expect(catalog.options.map((o) => o.id)).toEqual(["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5", "ok-model"]);
  });

  it("honors GROK_HOME over HOME", () => {
    const ignored = scratchConfig(`[model.ignored]\nname = "Ignored"\n`);
    const grokHomeParent = mkdtempSync(join(tmpdir(), "omb-grok-home-"));
    const grokHome = join(grokHomeParent, "grok");
    scratchDirs.push(grokHomeParent);
    mkdirSync(grokHome, { recursive: true });
    writeFileSync(join(grokHome, "config.toml"), `[model.from-grok-home]\nname = "From GROK_HOME"\n`);
    const catalog = readGrokModelCatalog({ HOME: ignored, GROK_HOME: grokHome });
    expect(catalog.options.map((o) => o.id)).toContain("from-grok-home");
    expect(catalog.options.map((o) => o.id)).not.toContain("ignored");
  });

  it("ignores default keys outside the [models] table", () => {
    const home = scratchConfig(`
[cli]
default = "grok-4.5"

[model.ok-model]
name = "OK"
`);
    expect(readGrokModelCatalog({ HOME: home }).default).toBe("grok-4.7");
  });
});

describe("GrokAgentDriver catalog", () => {
  it("loads the config catalog when the instance is created", async () => {
    const home = scratchConfig(`[model.local-glm]\nname = "GLM local"\n`);
    const instance = await GrokAgentDriver.create({
      instanceId: "grok-catalog",
      displayName: "Grok",
      environment: { HOME: home, USERPROFILE: home },
      enabled: true,
      config: GrokAgentDriver.defaultConfig(),
    });
    try {
      expect(instance.models.options.some((o) => o.id === "local-glm" && o.label === "GLM local")).toBe(true);
      expect(instance.refreshModels).toEqual(expect.any(Function));
    } finally {
      await instance.dispose();
    }
  });
});

/** The shape grok 1.0.50 writes to ~/.grok/models_cache.json (trimmed). */
function writeModelsCache(home: string, ids: string[]) {
  const models = Object.fromEntries(ids.map((id) => [id, { info: { id, model: id, name: id === "grok-4.7-build-fast" ? "Grok 4.7 Fast" : id, context_window: 256_000, hidden: false }, api_key: null }]));
  writeFileSync(join(home, ".grok", "models_cache.json"), JSON.stringify({ fetched_at: "2026-10-08T15:02:13Z", grok_version: "1.0.50", origin: "https://cli-chat-proxy.grok.com/v1/models", models }));
}

describe("the Grok model list comes from the engine", () => {
  it("reads the account catalog Grok cached, before the static list", () => {
    const home = scratchConfig(`[model.local-glm]\nname = "GLM local"\n`);
    writeModelsCache(home, ["grok-4.7", "grok-4.7-build-fast"]);
    expect(readGrokModelsCache({ HOME: home })?.map((o) => o.id)).toEqual(["grok-4.7", "grok-4.7-build-fast"]);
    const catalog = readGrokModelCatalog({ HOME: home });
    expect(catalog.options.map((o) => o.id)).toEqual(["grok-4.7", "grok-4.7-build-fast", "local-glm"]);
    expect(catalog.options.find((o) => o.id === "grok-4.7-build-fast")?.label).toBe("Grok 4.7 Fast");
  });

  it("prefers the engine's own initialize answer and keeps config blocks custom", () => {
    const home = scratchConfig(`[model.local-glm]\nname = "GLM local"\n`);
    writeModelsCache(home, ["grok-4.7", "grok-4.6", "grok-4.5"]);
    const engine = grokModelsFromInitialize({ _meta: { modelState: { currentModelId: "grok-4.7", availableModels: [
      { modelId: "grok-4.7", name: "Grok 4.7", _meta: { totalContextTokens: 500_000 } },
      { modelId: "grok-4.7-build-fast", name: "Grok 4.7 Fast" },
      { modelId: "local-glm", name: "GLM local" },
    ] } } });
    const catalog = readGrokModelCatalog({ HOME: home }, engine);
    expect(catalog.options).toEqual([
      { id: "grok-4.7", label: "Grok 4.7", contextWindow: 500_000 },
      { id: "grok-4.7-build-fast", label: "Grok 4.7 Fast" },
      { id: "local-glm", label: "GLM local", custom: true },
    ]);
    // a retired id the engine no longer lists is not offered
    expect(catalog.options.map((o) => o.id)).not.toContain("grok-4.5");
  });

  it("asks the installed CLI once per short window and falls back when it cannot answer", async () => {
    chmodSync(fakeCli, 0o755);
    const home = scratchConfig("");
    const env = { HOME: home, PATH: process.env.PATH, FAKE_ACP_SESSION_MODELS: "grok-4.7|Grok 4.7,grok-4.7-build-fast|Grok 4.7 Fast" };
    let now = 1_000;
    expect((await probeGrokModels(fakeCli, env, () => now))?.map((o) => o.id)).toEqual(["grok-4.7", "grok-4.7-build-fast"]);
    // cached: a changed engine answer is not seen until the window passes
    const changed = { ...env, FAKE_ACP_SESSION_MODELS: "grok-4.8" };
    expect((await probeGrokModels(fakeCli, changed, () => now))?.map((o) => o.id)).toEqual(["grok-4.7", "grok-4.7-build-fast"]);
    now += 31_000;
    expect((await probeGrokModels(fakeCli, changed, () => now))?.map((o) => o.id)).toEqual(["grok-4.8"]);
    expect(await probeGrokModels(join(home, "no-such-grok"), env)).toBeNull();
  });

  it("refreshes the picker list from a signed-in engine and drops what it does not offer", async () => {
    chmodSync(fakeCli, 0o755);
    const home = scratchConfig(`[model.local-glm]\nname = "GLM local"\n`);
    writeFileSync(join(home, ".grok", "auth.json"), "{}");
    const instance = await GrokAgentDriver.create({
      instanceId: "grok-live", displayName: "Grok", enabled: true, config: { cli: fakeCli, fullAuto: false },
      environment: { HOME: home, USERPROFILE: home, FAKE_ACP_SESSION_MODELS: "grok-4.7|Grok 4.7,grok-4.7-build-fast|Grok 4.7 Fast" },
    });
    try {
      expect(instance.models.options.map((o) => o.id)).toEqual(["grok-4.7", "grok-4.7-build-fast", "local-glm"]);
    } finally {
      await instance.dispose();
    }
  });

  it("does not ask a CLI that is not signed in: the static list stands", async () => {
    chmodSync(fakeCli, 0o755);
    const home = scratchConfig("");
    const instance = await GrokAgentDriver.create({
      instanceId: "grok-signed-out", displayName: "Grok", enabled: true, config: { cli: fakeCli, fullAuto: false },
      environment: { HOME: home, USERPROFILE: home, FAKE_ACP_SESSION_MODELS: "grok-4.6,grok-4.5" },
    });
    try {
      expect(instance.models.options.map((o) => o.id)).toEqual(STATIC_GROK_MODELS.options.map((o) => o.id));
    } finally {
      await instance.dispose();
    }
  });
});

describe("dismissGrokModelCampaigns", () => {
  it("dismisses each model campaign the remote settings list, once, keeping other state", () => {
    const home = scratchConfig("");
    const grok = join(home, ".grok");
    expect(dismissGrokModelCampaigns({ HOME: home })).toEqual([]);
    expect(existsSync(join(grok, "campaigns_state.json"))).toBe(false);
    writeFileSync(join(grok, "settings_cache.json"), JSON.stringify({ payload: JSON.stringify({ settings: { campaigns: [{ id: "grok-4.7-launch", models: { default: "grok-4.7" } }, { id: "no-models" }] } }), signature: "x" }));
    writeFileSync(join(grok, "campaigns_state.json"), JSON.stringify({ dismissed_ids: ["grok-4.6-launch"], other: 1 }));
    expect(dismissGrokModelCampaigns({ HOME: home })).toEqual(["grok-4.7-launch"]);
    expect(JSON.parse(readFileSync(join(grok, "campaigns_state.json"), "utf8"))).toEqual({ dismissed_ids: ["grok-4.6-launch", "grok-4.7-launch"], other: 1 });
    expect(dismissGrokModelCampaigns({ HOME: home })).toEqual([]);
  });
});

describe("per-model reasoning levels (2026-10-13)", () => {
  // What grok 1.0.52 answered in `initialize`, recorded for the picker preview.
  const recorded = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/testing/fixtures/model-picker/grok-initialize.json"), "utf8"));

  it("reads each model's levels and its default from initialize: grok-4.5 has no X-High", () => {
    const models = grokModelsFromInitialize(recorded)!;
    const byId = Object.fromEntries(models.map((model) => [model.id, model]));
    expect(byId["grok-4.7"]).toMatchObject({ effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" });
    expect(byId["grok-4.7-build-fast"]).toMatchObject({ effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" });
    // grok-4.6 currently runs at xhigh, but the level Grok marks default is high
    expect(byId["grok-4.6"]).toMatchObject({ effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" });
    expect(byId["grok-4.5"]).toMatchObject({ effortLevels: ["low", "medium", "high"], defaultEffort: "high" });
  });

  it("gives a model Grok lists without levels none, once Grok reports levels at all", () => {
    const models = grokModelsFromInitialize({ _meta: { modelState: { availableModels: [
      ...recorded._meta.modelState.availableModels,
      { modelId: "qwen38-flash-next", name: "Qwen3.8 Flash-Next local (DwarfStar)", _meta: { totalContextTokens: 262144 } },
    ] } } })!;
    expect(models.find((model) => model.id === "qwen38-flash-next")?.effortLevels).toEqual([]);
    // an older Grok that reports no levels leaves every model to the driver
    expect(grokModelsFromInitialize({ _meta: { modelState: { availableModels: [{ modelId: "grok-4.5", name: "Grok 4.5" }] } } })![0]!.effortLevels).toBeUndefined();
  });

  it("reads the same facts from Grok's cached catalog", () => {
    const home = mkdtempSync(join(tmpdir(), "grok-cache-efforts-"));
    scratchDirs.push(home);
    mkdirSync(join(home, ".grok"), { recursive: true });
    writeFileSync(join(home, ".grok", "models_cache.json"), JSON.stringify({ models: {
      "grok-4.5": { info: { name: "Grok 4.5", supports_reasoning_effort: true, reasoning_effort: "high", reasoning_efforts: [
        { id: "high", value: "high", default: true }, { id: "medium", value: "medium", default: false }, { id: "low", value: "low", default: false },
      ] } },
      "grok-4.7": { info: { name: "Grok 4.7", supports_reasoning_effort: true, reasoning_efforts: [
        { id: "xhigh", value: "xhigh", default: false }, { id: "high", value: "high", default: true },
      ] } },
    } }));
    const models = readGrokModelsCache({ HOME: home })!;
    expect(models.find((model) => model.id === "grok-4.5")).toMatchObject({ effortLevels: ["low", "medium", "high"], defaultEffort: "high" });
    expect(models.find((model) => model.id === "grok-4.7")).toMatchObject({ effortLevels: ["high", "xhigh"], defaultEffort: "high" });
  });
});

describe("renewGrokSignIn (#4192)", () => {
  it("authenticates the person's own CLI on its cached sign-in, and says when it was refused", async () => {
    chmodSync(fakeCli, 0o755);
    const home = scratchConfig("");
    const env = { HOME: home, PATH: process.env.PATH };
    // no login file: nothing to renew, the CLI is not started
    expect(await renewGrokSignIn(fakeCli, env)).toBe(false);
    // a made-up record, never a real credential
    writeFileSync(join(home, ".grok", "auth.json"), JSON.stringify({ "https://auth.example.test::p-1": { auth_mode: "oidc", key: "fake-grok-access-renew-0000000000" } }));
    expect(await renewGrokSignIn(fakeCli, env)).toBe(true);
    expect(await renewGrokSignIn(fakeCli, { ...env, FAKE_ACP_MODE: "authenticate-failed" })).toBe(false);
    expect(await renewGrokSignIn(join(home, "no-such-grok"), env)).toBe(false);
  });
});
