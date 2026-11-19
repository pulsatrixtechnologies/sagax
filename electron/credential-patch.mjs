// Which config patch a workspace credential name maps to (moved out of main.mjs).
export const CREDENTIAL_PATCH = {
  xaiApiKey: (value) => ({ xai: { key: value } }),
  boxToken: (value) => ({ box: { token: value } }),
  opencodeGoApiKey: (value) => ({ opencodeGo: { apiKey: value } }),
  ttsKey: (value) => ({ tts: { key: value } }),
  fishAudioKey: (value) => ({ tts: { fishKey: value } }),
  jevApiKey: (value) => ({ decider: { key: value } }),
  openaiImageApiKey: (value) => ({ imageGen: { key: value } }),
  customImageApiKey: (value) => ({ imageGen: { customApiKey: value } }),
  openaiApiKey: (value) => ({ openai: { key: value } }),
  // everyClaudeBot travels with the key, so a first key never moves every
  // signed-in Claude bot onto API billing (port of upstream #5280).
  anthropicApiKey: (value, options) => ({ anthropic: { key: value, ...(options?.everyClaudeBot === false ? { everyClaudeBot: false } : {}) } }),
  openrouterApiKey: (value) => ({ openrouter: { key: value } }),
  mistralApiKey: (value) => ({ mistral: { key: value } }),
  cerebrasApiKey: (value) => ({ cerebras: { key: value } }),
  groqApiKey: (value) => ({ groq: { key: value } }),
  metaApiKey: (value) => ({ meta: { key: value } }),
  deepseekApiKey: (value) => ({ deepseek: { key: value } }),
  openaiCompatApiKey: (value) => ({ openaiCompat: { key: value } }),
};
