/** Each provider key row of Settings > Models > Keys and the config field
 * the screen writes it to (src/components/ApiKeys.tsx). #1545: ElevenLabs
 * and Fish Audio are kept under tts, the image keys under imageGen. */
export const PROVIDER_KEY_FIELDS: Readonly<Record<string, readonly [string, string]>> = {
  anthropic: ["anthropic", "key"], openai: ["openai", "key"], openrouter: ["openrouter", "key"], xai: ["xai", "key"],
  mistral: ["mistral", "key"], cerebras: ["cerebras", "key"], groq: ["groq", "key"], openaiCompat: ["openaiCompat", "key"],
  elevenlabs: ["tts", "key"], fishAudio: ["tts", "fishKey"], openaiImage: ["imageGen", "key"], customImage: ["imageGen", "customApiKey"],
};
export const PROVIDER_KEYS: ReadonlySet<string> = new Set(Object.keys(PROVIDER_KEY_FIELDS));
type ConfigKeys = { tts?: { keys?: Record<string, unknown> }; imageGen?: { openaiConfigured?: unknown; customKeyConfigured?: unknown }; opencodeGo?: { configured?: unknown; providerKeys?: unknown[] } } & Record<string, { configured?: unknown } | undefined>;
/** Which keys are saved, as the Keys rows say it; never a key. */
export function savedKeys(config: unknown): Record<string, boolean> {
  const c = (config ?? {}) as ConfigKeys;
  const flag = (name: string) => c[name]?.configured === true;
  return {
    anthropic: flag("anthropic"), openai: flag("openai"), openrouter: flag("openrouter"), xai: flag("xai"), mistral: flag("mistral"),
    cerebras: flag("cerebras"), groq: flag("groq"), openaiCompat: flag("openaiCompat"),
    opencodeGo: flag("opencodeGo") || (Array.isArray(c.opencodeGo?.providerKeys) && c.opencodeGo.providerKeys.length > 0),
    elevenlabs: c.tts?.keys?.elevenlabs === true, fishAudio: c.tts?.keys?.fish === true,
    openaiImage: c.imageGen?.openaiConfigured === true, customImage: c.imageGen?.customKeyConfigured === true,
  };
}
