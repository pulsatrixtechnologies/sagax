// Workspace credentials the desktop shell keeps OS-encrypted (credentials.bin
// via safeStorage) instead of leaving in plaintext config.json. Pure functions:
// main.mjs owns the fs and safeStorage plumbing, so the migration decisions
// stay testable without an Electron runtime.
//
// One row per secret: the config.json home it migrates OUT of, the
// credentials.bin field it lives in, and the env var the spawned server
// prefers over the file (server/config.ts loadConfig).
export const WORKSPACE_CREDENTIALS = [
  { section: "xai", field: "key", name: "xaiApiKey", env: "XAI_API_KEY" },
  { section: "box", field: "token", name: "boxToken", env: "BOX_TOKEN" },
  { section: "tts", field: "key", name: "ttsKey", env: "SAGAX_TTS_KEY" },
  { section: "tts", field: "fishKey", name: "fishAudioKey", env: "SAGAX_FISH_AUDIO_API_KEY" },
  { section: "tts", field: "xaiKey", name: "xaiVoiceKey", env: "SAGAX_XAI_VOICE_KEY" },
  { section: "decider", field: "key", name: "jevApiKey", env: "SAGAX_JEV_API_KEY" },
  { section: "imageGen", field: "key", name: "openaiImageApiKey", env: "SAGAX_OPENAI_IMAGE_KEY" },
  { section: "imageGen", field: "customApiKey", name: "customImageApiKey", env: "SAGAX_CUSTOM_IMAGE_KEY" },
  { section: "live", field: "key", name: "openaiLiveKey", env: "SAGAX_OPENAI_LIVE_KEY" },
  { section: "opencodeGo", field: "apiKey", name: "opencodeGoApiKey", env: "OPENCODE_API_KEY" },
];

/** One boot-time sweep of config.json: move every plaintext workspace secret
 * into the encrypted store and DELETE the plaintext field.
 *
 * Deleting (never blanking) keeps the meaning of what remains unambiguous:
 *   - non-empty value  → newest user intent: overwrite the stored secret
 *   - "" or absent     → no plaintext information; the store stays authoritative
 *
 * "" must never drop a stored secret. The packaged app's external-secret
 * save path writes an empty tombstone into config.json on EVERY credential
 * commit (the real value goes to credentials.bin first), so reading "" as
 * "the user cleared this" deleted freshly saved keys at the next boot.
 * Clearing runs through the desktop shell's credential:set handler, which
 * removes the entry from the store directly before persisting the same
 * tombstone — so there is no "" case in which the store should lose data.
 * Running twice is a no-op, and nothing is lost if a boot dies between the
 * two writes — the caller persists credentials BEFORE rewriting config, so
 * the worst case re-runs the same overwrite.
 *
 * Inputs are treated as immutable; the changed flags tell the caller which
 * file(s) actually need rewriting. Non-string junk in a field is left for
 * the server's schema to reject rather than silently destroyed here. */
export function migrateWorkspaceCredentials(config, credentials) {
  const nextConfig = structuredClone(config ?? {});
  const nextCredentials = { ...credentials };
  let configChanged = false;
  let credentialsChanged = false;
  for (const { section, field, name } of WORKSPACE_CREDENTIALS) {
    const home = nextConfig?.[section];
    if (!home || typeof home !== "object" || Array.isArray(home)) continue;
    if (!Object.hasOwn(home, field)) continue;
    const value = home[field];
    if (typeof value !== "string") continue;
    const secret = value.trim();
    if (secret && nextCredentials[name] !== secret) {
      nextCredentials[name] = secret;
      credentialsChanged = true;
    }
    delete home[field];
    configChanged = true;
  }
  return { config: nextConfig, credentials: nextCredentials, configChanged, credentialsChanged };
}

/** 2026-10-14: Grok voice runs on the xAI key. A Grok voice key stored by
 * an older build (`xaiVoiceKey`) becomes the xAI key (`xaiApiKey`) when
 * none is stored; otherwise the xAI key stays and the duplicate is dropped.
 * `outcome` lets the caller log what happened, never the value. Run after
 * migrateWorkspaceCredentials, which first moves a plaintext `tts.xaiKey`
 * into `xaiVoiceKey`. */
export function foldGrokVoiceCredential(credentials) {
  const next = { ...credentials };
  if (!Object.hasOwn(next, "xaiVoiceKey")) return { credentials: next, changed: false, outcome: null };
  const voice = typeof next.xaiVoiceKey === "string" ? next.xaiVoiceKey.trim() : "";
  const xai = typeof next.xaiApiKey === "string" ? next.xaiApiKey.trim() : "";
  delete next.xaiVoiceKey;
  let outcome = null;
  if (voice && !xai) {
    next.xaiApiKey = voice;
    outcome = "moved";
  } else if (voice) {
    outcome = "dropped";
  }
  return { credentials: next, changed: true, outcome };
}

/** The log line for foldGrokVoiceCredential's outcome. */
export function grokVoiceFoldLog(outcome) {
  if (outcome === "moved") return "credentials: the Grok voice key is now the xAI key (Grok voice and Grok bots share one key)";
  if (outcome === "dropped") return "credentials: Grok voice key not kept: an xAI key is already stored and Grok voice uses it";
  return null;
}

/** Env for the spawned server: one var per stored secret, nothing else.
 * The server treats each var as authoritative over its config.json field. */
export function workspaceCredentialEnv(credentials) {
  const env = {};
  for (const { name, env: envName } of WORKSPACE_CREDENTIALS) {
    const value = credentials?.[name];
    if (typeof value === "string" && value) env[envName] = value;
  }
  return env;
}
