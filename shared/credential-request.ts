/**
 * Credentials an agent may ask the person to provide through an inline
 * card. The id is the entire authority surface: agents never choose a
 * config path, label, URL, or arbitrary field name.
 */
export const CREDENTIAL_TARGETS = {
  xaiApiKey: {
    label: "xAI API key",
    description: "Used by the built-in Grok provider.",
    placeholder: "xai-…",
    helpUrl: "https://console.x.ai/",
  },
  boxToken: {
    label: "Boat API key",
    description: "Gives bots an isolated cloud computer when Boat is selected.",
    placeholder: "Paste your Boat API key",
    helpUrl: "https://docs.boat.dev/api-keys",
  },
  opencodeGoApiKey: {
    label: "OpenCode API key",
    description: "Used for OpenCode Zen and Go.",
    placeholder: "Paste your OpenCode API key",
    helpUrl: "https://opencode.ai/docs/providers/",
  },
  ttsKey: {
    label: "ElevenLabs API key",
    description: "Enables text-to-speech voices in calls.",
    placeholder: "Paste your ElevenLabs API key",
    helpUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  fishAudioKey: {
    label: "Fish Audio API key",
    description: "Enables Fish Audio voices in calls.",
    placeholder: "Paste your Fish Audio API key",
    helpUrl: "https://fish.audio/app/api-keys/",
  },
  // Kept as an id so older cards and agents still work; since 2026-10-14
  // Grok voice runs on the xAI key, so this card saves that key.
  xaiVoiceKey: {
    label: "xAI API key",
    description: "Used by Grok voice and by the built-in Grok provider.",
    placeholder: "xai-…",
    helpUrl: "https://console.x.ai/",
  },
  openaiImageApiKey: {
    label: "OpenAI API key",
    description: "Used only to generate custom bot avatar images.",
    placeholder: "sk-…",
    helpUrl: "https://platform.openai.com/api-keys",
  },
} as const;

export type CredentialTargetId = keyof typeof CREDENTIAL_TARGETS;
/** Every current allowlisted target is saved in the desktop encrypted store (or /api/config when there is no desktop). */
export type DesktopCredentialSlot = CredentialTargetId;
export type CredentialConfig = {
  xai?: { key?: string };
  // The persisted config section keeps its historical name: cfg.box.
  box?: { token?: string };
  opencodeGo?: { apiKey?: string };
  tts?: { key?: string; fishKey?: string };
  imageGen?: { key?: string };
};

/** A secret Sagax does not keep itself: the bot names it, and gets a one-use reference or a private file. */
export const CUSTOM_SECRET_TARGET = "customSecret";
export type SecretDelivery = "ref" | "file";
export const SECRET_DELIVERIES: readonly SecretDelivery[] = ["ref", "file"];
export const CUSTOM_SECRET_LABEL_MAX = 80;
export const CUSTOM_SECRET_REASON_MAX = 240;

export function isCredentialTargetId(value: unknown): value is CredentialTargetId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CREDENTIAL_TARGETS, value);
}

/** The desktop's encrypted-store slot for this key; null only for targets Settings keeps in the server's config alone.
 * Sagax's current allowlist is all desktop slots. */
export function desktopCredentialSlot(id: CredentialTargetId): DesktopCredentialSlot | null {
  return isCredentialTargetId(id) ? id : null;
}

export function credentialConfigPatch(id: CredentialTargetId, value: string): CredentialConfig {
  switch (id) {
    case "xaiApiKey":
      return { xai: { key: value } };
    case "boxToken":
      return { box: { token: value } };
    case "opencodeGoApiKey":
      return { opencodeGo: { apiKey: value } };
    case "ttsKey":
      return { tts: { key: value } };
    case "fishAudioKey":
      return { tts: { fishKey: value } };
    case "xaiVoiceKey":
      return { xai: { key: value } };
    case "openaiImageApiKey":
      return { imageGen: { key: value } };
  }
}

/** A vault login card (shared/credential-vault.ts) is never "configured":
 * it is answered on its own card, not by saving a key. */
export function credentialIsConfigured(config: CredentialConfig, id: CredentialTargetId | "vaultLogin"): boolean {
  switch (id) {
    case "vaultLogin":
      return false;
    case "xaiApiKey":
      return Boolean(config.xai?.key);
    case "boxToken":
      return Boolean(config.box?.token);
    case "opencodeGoApiKey":
      return Boolean(config.opencodeGo?.apiKey);
    case "ttsKey":
      return Boolean(config.tts?.key);
    case "fishAudioKey":
      return Boolean(config.tts?.fishKey);
    case "xaiVoiceKey":
      return Boolean(config.xai?.key);
    case "openaiImageApiKey":
      return Boolean(config.imageGen?.key);
  }
}

/** A still-pending credential card for this target — the set a newer
 * request supersedes. Provided, dismissed, and already-superseded cards
 * keep their settled state untouched. */
export function isPendingCredentialRequest(
  message: {
    kind?: unknown;
    secret?: { target?: unknown; provided?: unknown; dismissed?: unknown; superseded?: unknown };
    from?: { botId?: unknown };
  },
  target: CredentialTargetId,
  requestingBotId: string,
  roomThread: boolean,
): boolean {
  return (
    message.kind === "secret" &&
    message.secret?.target === target &&
    message.secret.provided !== true &&
    message.secret.dismissed !== true &&
    message.secret.superseded !== true &&
    (!roomThread || message.from?.botId === requestingBotId)
  );
}

/** A still-pending card from this bot for a custom secret with the same name, which a newer request supersedes. */
export function isPendingCustomSecretRequest(
  message: {
    kind?: unknown;
    secret?: { target?: unknown; label?: unknown; provided?: unknown; dismissed?: unknown; superseded?: unknown };
    from?: { botId?: unknown };
  },
  label: string,
  requestingBotId: string,
  roomThread: boolean,
): boolean {
  return (
    message.kind === "secret" &&
    message.secret?.target === CUSTOM_SECRET_TARGET &&
    typeof message.secret.label === "string" &&
    message.secret.label.toLowerCase() === label.toLowerCase() &&
    message.secret.provided !== true &&
    message.secret.dismissed !== true &&
    message.secret.superseded !== true &&
    (!roomThread || message.from?.botId === requestingBotId)
  );
}

export function credentialResumeOutcome(state: {
  provided?: unknown;
  dismissed?: unknown;
}): "provided" | "dismissed" | null {
  const provided = state.provided === true;
  const dismissed = state.dismissed === true;
  if (provided === dismissed) return null;
  return provided ? "provided" : "dismissed";
}
