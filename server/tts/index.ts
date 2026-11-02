import type { AppConfig } from "../config.ts";
import { voiceCredential } from "../included-services.ts";
import * as chatterbox from "./chatterbox.ts";
import * as elevenlabs from "./elevenlabs.ts";
import * as grok from "./grok.ts";
import * as fish from "./fish.ts";
import * as systemVoices from "./system-voices.ts";

export type VoiceProvider = "elevenlabs" | "fish" | "system" | "chatterbox" | "xai";

export class NoVoiceConfigured extends Error {
  // a plain field rather than a constructor parameter property: the harness
  // runs under `node --experimental-strip-types`, which is strip-ONLY, so a
  // parameter property is rejected at load time even though it typechecks
  readonly reason: "key" | "voice";

  constructor(reason: "key" | "voice", hint?: string) {
    super(
      hint ??
        (reason === "key"
          ? "Add an ElevenLabs key in Settings on the computer to turn on voice."
          : "Pick a voice in the agent profile."),
    );
    this.reason = reason;
  }
}

/** Who the speech is for may use the xAI key (2026-10-16): on an
 * organization server the caller passes whether the organization gave its
 * xAI voice to that person (server/org/org-xai-media.ts). Absent: allowed (a
 * solo server, or a provider that is not xAI). */
export interface VoiceKeyAccess {
  xaiKeyGiven?: boolean;
  elevenlabsKeyGiven?: boolean;
  fishKeyGiven?: boolean;
}

/** The xAI voice was refused for this person: no fallback to the key. */
export class XaiVoiceNotGiven extends Error {
  readonly code = "server_engine_not_allowed" as const;
  constructor(message = "Your organization has not given you its xAI voice (read aloud and voice notes). Ask an admin to give it to you in Perspicax.") {
    super(message);
  }
}

function voiceKeyGiven(provider: VoiceProvider, access?: VoiceKeyAccess): boolean {
  return provider === "xai" ? access?.xaiKeyGiven !== false
    : provider === "elevenlabs" ? access?.elevenlabsKeyGiven !== false
    : provider === "fish" ? access?.fishKeyGiven !== false : true;
}

function requireVoiceKey(provider: VoiceProvider, access?: VoiceKeyAccess): void {
  if (voiceKeyGiven(provider, access)) return;
  const label = provider === "fish" ? "Fish Audio" : provider === "elevenlabs" ? "ElevenLabs" : "xAI";
  throw new XaiVoiceNotGiven(`Your organization has not given you its ${label} voice. Add your own provider key or ask an admin to give you the organization's voice.`);
}

/** The ElevenLabs credential in use: the person's own key, else the one
 * included with Cloud Pro. Settings' own-key flows read cfg.tts.key instead. */
const elevenLabs = (cfg: AppConfig) => voiceCredential(cfg.tts?.key);

/** Grok voice runs on the xAI key, the one bots on Grok use (2026-10-14: one
 * key per provider in Settings > Models and voice). A Grok voice key saved
 * by an older build was folded into it by loadConfig(). */
function grokVoiceKey(cfg: AppConfig, access?: VoiceKeyAccess): string | undefined {
  if (access?.xaiKeyGiven === false) return undefined;
  const key = cfg.xai?.key?.trim();
  return key || undefined;
}

export function voiceProvider(cfg: AppConfig): VoiceProvider {
  const provider = cfg.tts?.provider;
  return provider === "xai" || provider === "fish" || provider === "system" || provider === "chatterbox" ? provider : "elevenlabs";
}

/** The system provider needs no credential — it is only ever offered where
 * the platform actually has it, so "configured" means "this engine can
 * speak", not "a key is on file". */
export function providerConfigured(cfg: AppConfig): boolean {
  const provider = voiceProvider(cfg);
  if (provider === "xai") return Boolean(grokVoiceKey(cfg));
  if (provider === "system") return systemVoices.systemVoicesAvailable();
  if (provider === "chatterbox") return Boolean(cfg.tts?.baseUrl?.trim());
  if (provider === "fish") return Boolean(cfg.tts?.fishKey);
  return Boolean(elevenLabs(cfg));
}

export function voiceConfigured(cfg: AppConfig): boolean {
  const provider = voiceProvider(cfg);
  if (provider === "xai") return Boolean(grokVoiceKey(cfg) && cfg.tts?.voice);
  if (provider === "system") {
    return systemVoices.systemVoicesAvailable() && Boolean(cfg.tts?.voice);
  }
  if (provider === "chatterbox") return Boolean(cfg.tts?.baseUrl?.trim() && cfg.tts?.voice);
  if (provider === "fish") return Boolean(cfg.tts?.fishKey && cfg.tts?.voice);
  return Boolean(elevenLabs(cfg) && cfg.tts?.voice);
}

/** A per-bot voice is a complete choice too; it should not be blocked just
 * because the app-wide fallback has not been selected yet. */
export function voiceReady(cfg: AppConfig, voiceId?: string, access?: VoiceKeyAccess): boolean {
  const provider = voiceProvider(cfg);
  if (!voiceKeyGiven(provider, access)) return false;
  if (provider === "xai") return Boolean(grokVoiceKey(cfg, access) && (voiceId || cfg.tts?.voice));
  if (provider === "system") {
    return systemVoices.systemVoicesAvailable() && Boolean(voiceId || cfg.tts?.voice);
  }
  if (provider === "chatterbox") return Boolean(cfg.tts?.baseUrl?.trim() && (voiceId || cfg.tts?.voice));
  if (provider === "fish") return Boolean(cfg.tts?.fishKey && (voiceId || cfg.tts?.voice));
  return Boolean(elevenLabs(cfg) && (voiceId || cfg.tts?.voice));
}

/** What the settings panel needs. Never includes the key — same write-only
 * rule as every other credential. baseUrl and model are Chatterbox
 * settings, not credentials, so they come back in full; `fishModel` is the
 * Fish Audio speech model, resolved to its default when unset. `included`
 * says the voice is Cloud Pro's, not a saved key. */
export function describeVoice(cfg: AppConfig) {
  const provider = voiceProvider(cfg);
  const included = provider === "elevenlabs" && elevenLabs(cfg)?.included === true;
  return {
    configured: providerConfigured(cfg),
    ready: voiceConfigured(cfg),
    voice: cfg.tts?.voice ?? "",
    provider,
    baseUrl: provider === "chatterbox" ? (cfg.tts?.baseUrl ?? "") : "",
    model: provider === "chatterbox" ? (cfg.tts?.model ?? "") : "",
    ...(provider === "fish" ? { fishModel: cfg.tts?.fishModel ?? fish.DEFAULT_FISH_MODEL } : {}),
    ...(included ? { included: true as const } : {}),
    // Which voice keys are saved, whatever the engine: Settings lists them
    // with the model keys. Booleans only, never a value.
    keys: { elevenlabs: Boolean(cfg.tts?.key?.trim()), fish: Boolean(cfg.tts?.fishKey?.trim()) },
  };
}

export function verifyKey(provider: "elevenlabs" | "fish", key: string) {
  return provider === "fish" ? fish.verifyKey(key) : elevenlabs.verifyKey(key);
}

export async function listVoices(cfg: AppConfig, run?: systemVoices.Runner, access?: VoiceKeyAccess): Promise<elevenlabs.Voice[]> {
  const provider = voiceProvider(cfg);
  requireVoiceKey(provider, access);
  if (provider === "xai") {
    if (access?.xaiKeyGiven === false) throw new XaiVoiceNotGiven();
    const key = grokVoiceKey(cfg);
    return key ? grok.listVoices(key) : [];
  }
  if (provider === "system") return systemVoices.listSystemVoices(run);
  if (provider === "chatterbox") {
    const baseUrl = cfg.tts?.baseUrl?.trim();
    return baseUrl ? chatterbox.listChatterboxVoices(baseUrl) : [];
  }
  if (provider === "fish") {
    const key = cfg.tts?.fishKey;
    return key ? fish.listVoices(key) : [];
  }
  const credential = elevenLabs(cfg);
  if (!credential) return [];
  return elevenlabs.listVoices(credential.token, credential.api);
}

/** Synthesize one utterance. Throws NoVoiceConfigured when there is nothing
 * to speak with, which the route turns into a 409 the client can explain,
 * and XaiVoiceNotGiven (a 403) when the xAI voice is not this person's. */
export function speak(cfg: AppConfig, text: string, voiceId?: string, run?: systemVoices.Runner, access?: VoiceKeyAccess) {
  const provider = voiceProvider(cfg);
  requireVoiceKey(provider, access);
  if (provider === "xai") {
    // Never a fallback to the organization's key for someone it was not given to.
    if (access?.xaiKeyGiven === false) throw new XaiVoiceNotGiven();
    const key = grokVoiceKey(cfg);
    if (!key) throw new NoVoiceConfigured("key", "Add an xAI key in Settings > Models. Grok voice uses it.");
    const voice = voiceId || cfg.tts?.voice;
    if (!voice) throw new NoVoiceConfigured("voice");
    return grok.synthesize(text, voice, key);
  }
  if (provider === "system") {
    const voice = voiceId || cfg.tts?.voice;
    // An injected runner is the cross-platform test seam for `/usr/bin/say`;
    // production calls omit it and remain strictly Darwin-gated.
    if (!systemVoices.systemVoicesAvailable() && !run) throw new NoVoiceConfigured("key");
    if (!voice) throw new NoVoiceConfigured("voice");
    return systemVoices.synthesizeSystem(text, voice, run);
  }
  if (provider === "chatterbox") {
    const baseUrl = cfg.tts?.baseUrl?.trim();
    if (!baseUrl) {
      throw new NoVoiceConfigured(
        "key",
        "Add the address of your Chatterbox server in Settings on the computer to turn on voice.",
      );
    }
    const voice = voiceId || cfg.tts?.voice;
    if (!voice) throw new NoVoiceConfigured("voice");
    return chatterbox.synthesizeChatterbox(text, voice, baseUrl, cfg.tts?.model);
  }
  if (provider === "fish") {
    const key = cfg.tts?.fishKey;
    if (!key) {
      throw new NoVoiceConfigured(
        "key",
        "Add a Fish Audio key in Settings on the computer to turn on voice.",
      );
    }
    const voice = voiceId || cfg.tts?.voice;
    if (!voice) throw new NoVoiceConfigured("voice");
    return fish.synthesize(text, voice, key, cfg.tts?.fishModel);
  }
  const credential = elevenLabs(cfg);
  if (!credential) throw new NoVoiceConfigured("key");
  const voice = voiceId || cfg.tts?.voice;
  if (!voice) throw new NoVoiceConfigured("voice");
  return elevenlabs.synthesize(text, voice, credential.token, credential.api).audio;
}

export type { Voice } from "./elevenlabs.ts";
