import { describe, expect, it } from "vitest";

import {
  foldGrokVoiceCredential,
  grokVoiceFoldLog,
  migrateWorkspaceCredentials,
  workspaceCredentialEnv,
  WORKSPACE_CREDENTIALS,
} from "./workspace-credentials.mjs";

describe("workspace credential migration", () => {
  it("migrates a Live-only key to the OpenAI provider from config or the encrypted store", () => {
    for (const [config, credentials] of [
      [{ live: { key: "legacy-live", voice: "ash" } }, {}],
      [{ live: { voice: "ash" } }, { openaiLiveKey: "legacy-live" }],
    ]) {
      const first = migrateWorkspaceCredentials(config, credentials);
      expect(first.credentials).toEqual({ openaiApiKey: "legacy-live" });
      expect(first.config.live).toEqual({ voice: "ash" });
      expect(workspaceCredentialEnv(first.credentials)).toEqual({ SAGAX_OPENAI_API_KEY: "legacy-live" });
      const second = migrateWorkspaceCredentials(first.config, first.credentials);
      expect(second.credentialsChanged).toBe(false);
      expect(second.configChanged).toBe(false);
    }
  });

  it("keeps the OpenAI provider key when retiring an older Live-only duplicate", () => {
    const result = migrateWorkspaceCredentials({ openai: { key: "new-provider" }, live: { key: "old-live" } }, { openaiLiveKey: "old-stored-live" });
    expect(result.credentials).toEqual({ openaiApiKey: "new-provider" });
    expect(result.config).toEqual({ openai: {}, live: {} });
    expect(migrateWorkspaceCredentials({}, { openaiApiKey: "keep-provider", openaiLiveKey: "old-live" }).credentials).toEqual({ openaiApiKey: "keep-provider" });
  });

  it("stores the router key separately while keeping provider settings", () => {
    const result = migrateWorkspaceCredentials({ imageGen: {
      provider: "custom", key: "openai-only", customApiKey: "router-only",
      customUrl: "http://127.0.0.1:4000/v1", customModel: "local/image",
    } }, {});
    expect(result.credentials).toEqual({ openaiImageApiKey: "openai-only", customImageApiKey: "router-only" });
    expect(result.config.imageGen).toEqual({ provider: "custom", customUrl: "http://127.0.0.1:4000/v1", customModel: "local/image" });
    expect(workspaceCredentialEnv(result.credentials)).toEqual({ SAGAX_OPENAI_IMAGE_KEY: "openai-only", SAGAX_CUSTOM_IMAGE_KEY: "router-only" });
  });
  it("moves every plaintext secret into the store and deletes the field", () => {
    const config = {
      xai: { key: "xai-secret", url: "https://api.example.test/v1" },
      box: { token: "boat-secret" },
      tts: { key: "tts-secret", fishKey: "fish-secret", voice: "narrator" },
      imageGen: { key: "image-secret" },
      opencodeGo: { apiKey: "ocg-secret" },
      profile: { name: "Ada" },
    };
    const result = migrateWorkspaceCredentials(config, {});
    expect(result.configChanged).toBe(true);
    expect(result.credentialsChanged).toBe(true);
    expect(result.credentials).toEqual({
      xaiApiKey: "xai-secret",
      boxToken: "boat-secret",
      ttsKey: "tts-secret",
      fishAudioKey: "fish-secret",
      opencodeGoApiKey: "ocg-secret",
      openaiImageApiKey: "image-secret",
    });
    // secrets are DELETED (not blanked) so "" stays meaningful as "cleared";
    // non-secret siblings (endpoint url, chosen voice) stay in the file
    expect(result.config).toEqual({
      xai: { url: "https://api.example.test/v1" },
      box: {},
      tts: { voice: "narrator" },
      imageGen: {},
      opencodeGo: {},
      profile: { name: "Ada" },
    });
    // inputs are never mutated — main.mjs decides which files to rewrite
    expect(config.xai.key).toBe("xai-secret");
  });

  it("is idempotent: a second boot over migrated output changes nothing", () => {
    const first = migrateWorkspaceCredentials(
      { xai: { key: "xai-secret" }, tts: { key: "tts-secret", voice: "narrator" } },
      {},
    );
    const second = migrateWorkspaceCredentials(first.config, first.credentials);
    expect(second.configChanged).toBe(false);
    expect(second.credentialsChanged).toBe(false);
    expect(second.credentials).toEqual(first.credentials);
    expect(second.config).toEqual(first.config);
  });

  it("treats a saved non-empty value as newest intent and overwrites the store", () => {
    // mid-session key change: the server persisted the new key to config.json;
    // the stale stored secret must not win at the next boot
    const result = migrateWorkspaceCredentials(
      { box: { token: "box-NEW" } },
      { boxToken: "box-OLD", xaiApiKey: "xai-keep" },
    );
    expect(result.credentials).toEqual({ boxToken: "box-NEW", xaiApiKey: "xai-keep" });
    expect(result.config.box).toEqual({});
  });

  it("treats an empty saved value as no information and keeps the stored secret", () => {
    // The packaged app tombstones every external-mode save as "" in
    // config.json while the real key goes to credentials.bin — a boot that
    // read "" as "cleared" would delete freshly saved keys on every restart.
    const result = migrateWorkspaceCredentials(
      { xai: { key: "" }, tts: { key: "   " } },
      { xaiApiKey: "xai-OLD", ttsKey: "tts-OLD", boxToken: "box-keep" },
    );
    expect(result.credentialsChanged).toBe(false);
    expect(result.credentials).toEqual({ xaiApiKey: "xai-OLD", ttsKey: "tts-OLD", boxToken: "box-keep" });
    // the swept field itself is still removed from the file
    expect(result.config).toEqual({ xai: {}, tts: {} });
    expect(result.configChanged).toBe(true);
  });

  it("keeps the packaged save → restart cycle lossless end to end", () => {
    // first boot migrates the plaintext key in and sweeps the field
    const boot = migrateWorkspaceCredentials({ opencodeGo: { apiKey: "ocg-secret" } }, {});
    expect(boot.credentials).toEqual({ opencodeGoApiKey: "ocg-secret" });

    // an external-mode save commits the key to the store and leaves a ""
    // tombstone in config.json; the next boot must not read it as a clear
    const afterTombstone = migrateWorkspaceCredentials(
      { opencodeGo: { apiKey: "" }, profile: { name: "Ada" } },
      { opencodeGoApiKey: "ocg-secret" },
    );
    expect(afterTombstone.credentials).toEqual({ opencodeGoApiKey: "ocg-secret" });
    expect(afterTombstone.credentialsChanged).toBe(false);
  });

  it("keeps stored secrets when the field is absent (already migrated)", () => {
    const stored = { xaiApiKey: "xai-keep", boxToken: "box-keep" };
    const result = migrateWorkspaceCredentials({ profile: { name: "Ada" } }, stored);
    expect(result.configChanged).toBe(false);
    expect(result.credentialsChanged).toBe(false);
    expect(result.credentials).toEqual(stored);
  });

  it("leaves non-string junk for the server's schema instead of destroying it", () => {
    const result = migrateWorkspaceCredentials({ xai: { key: 42 }, box: "not-an-object" }, {});
    expect(result.configChanged).toBe(false);
    expect(result.credentialsChanged).toBe(false);
    expect(result.config.xai.key).toBe(42);
  });
});

describe("workspace credential env", () => {
  it("maps each stored secret to exactly its server env var", () => {
    expect(
      workspaceCredentialEnv({
        xaiApiKey: "xai-secret",
        boxToken: "boat-secret",
        ttsKey: "tts-secret",
        fishAudioKey: "fish-secret",
        opencodeGoApiKey: "ocg-secret",
        openaiImageApiKey: "image-secret",
      }),
    ).toEqual({
      XAI_API_KEY: "xai-secret",
      BOX_TOKEN: "boat-secret",
      SAGAX_TTS_KEY: "tts-secret",
      SAGAX_FISH_AUDIO_API_KEY: "fish-secret",
      OPENCODE_API_KEY: "ocg-secret",
      SAGAX_OPENAI_IMAGE_KEY: "image-secret",
    });
  });

  it("emits nothing for absent or empty secrets", () => {
    expect(workspaceCredentialEnv({})).toEqual({});
    expect(workspaceCredentialEnv({ xaiApiKey: "" })).toEqual({});
    expect(workspaceCredentialEnv(undefined)).toEqual({});
  });

  it("covers every credential the migration table declares", () => {
    const credentials = Object.fromEntries(WORKSPACE_CREDENTIALS.map((c) => [c.name, `v-${c.name}`]));
    const env = workspaceCredentialEnv(credentials);
    expect(Object.keys(env).sort()).toEqual(WORKSPACE_CREDENTIALS.map((c) => c.env).sort());
  });
});

describe("Grok voice key fold (2026-10-14)", () => {
  it("makes a stored Grok voice key the xAI key when none is stored", () => {
    const input = { xaiVoiceKey: " voice-secret ", ttsKey: "eleven" };
    const result = foldGrokVoiceCredential(input);
    expect(result).toEqual({ credentials: { xaiApiKey: "voice-secret", ttsKey: "eleven" }, changed: true, outcome: "moved" });
    expect(input.xaiVoiceKey).toBe(" voice-secret ");
    expect(grokVoiceFoldLog("moved")).not.toContain("voice-secret");
  });

  it("keeps the stored xAI key and drops the duplicate", () => {
    const result = foldGrokVoiceCredential({ xaiVoiceKey: "voice-secret", xaiApiKey: "bot-key" });
    expect(result).toEqual({ credentials: { xaiApiKey: "bot-key" }, changed: true, outcome: "dropped" });
    expect(grokVoiceFoldLog("dropped")).toContain("not kept");
  });

  it("follows the plaintext migration: a config.json Grok voice key reaches the xAI key", () => {
    const migrated = migrateWorkspaceCredentials({ tts: { xaiKey: "voice-secret", provider: "xai" } }, {});
    const folded = foldGrokVoiceCredential(migrated.credentials);
    expect(folded.credentials).toEqual({ xaiApiKey: "voice-secret" });
    expect(workspaceCredentialEnv(folded.credentials)).toEqual({ XAI_API_KEY: "voice-secret" });
  });

  it("changes nothing when there is no Grok voice key", () => {
    expect(foldGrokVoiceCredential({ xaiApiKey: "bot-key" })).toEqual({ credentials: { xaiApiKey: "bot-key" }, changed: false, outcome: null });
    expect(grokVoiceFoldLog(null)).toBeNull();
  });
});

// Port of upstream #5280: every AI provider key goes to the encrypted store.
const AI_PROVIDER_KEYS = [
  ["openai", "openaiApiKey", "SAGAX_OPENAI_API_KEY"],
  ["anthropic", "anthropicApiKey", "SAGAX_ANTHROPIC_API_KEY"],
  ["openrouter", "openrouterApiKey", "SAGAX_OPENROUTER_API_KEY"],
  ["mistral", "mistralApiKey", "MISTRAL_API_KEY"],
  ["cerebras", "cerebrasApiKey", "CEREBRAS_API_KEY"],
  ["groq", "groqApiKey", "SAGAX_GROQ_API_KEY"],
  ["meta", "metaApiKey", "SAGAX_META_API_KEY"],
  ["deepseek", "deepseekApiKey", "SAGAX_DEEPSEEK_API_KEY"],
  ["openaiCompat", "openaiCompatApiKey", "OPENAI_COMPAT_API_KEY"],
];

describe("AI provider keys in the encrypted store", () => {
  it.each(AI_PROVIDER_KEYS)("moves %s into its slot and hands it to the server under its own variable", (section, name, env) => {
    const result = migrateWorkspaceCredentials({ [section]: { key: `fixture-${section}` } }, {});
    expect(result.credentials).toEqual({ [name]: `fixture-${section}` });
    expect(result.config).toEqual({ [section]: {} });
    expect(workspaceCredentialEnv(result.credentials)).toEqual({ [env]: `fixture-${section}` });
  });

  it("keeps the Anthropic and OpenAI-compatible settings that are not secrets", () => {
    const { config } = migrateWorkspaceCredentials({
      anthropic: { key: "ant", url: "https://claude.example.test", everyClaudeBot: false },
      openaiCompat: { key: "compat", url: "http://127.0.0.1:1234/v1", model: "local", provider: "pin" },
    }, {});
    expect(config).toEqual({
      anthropic: { url: "https://claude.example.test", everyClaudeBot: false },
      openaiCompat: { url: "http://127.0.0.1:1234/v1", model: "local", provider: "pin" },
    });
  });

  it("has a save patch for every slot, and a first Anthropic key keeps Claude bots on their sign-in", async () => {
    const { CREDENTIAL_PATCH } = await import("./credential-patch.mjs");
    for (const [section, name] of AI_PROVIDER_KEYS) expect(CREDENTIAL_PATCH[name]?.("k")).toEqual({ [section]: { key: "k" } });
    expect(CREDENTIAL_PATCH.anthropicApiKey("k", { everyClaudeBot: false })).toEqual({ anthropic: { key: "k", everyClaudeBot: false } });
  });
});
