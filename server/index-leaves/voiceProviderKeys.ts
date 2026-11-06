// @ts-nocheck
/** voiceProviderKeys (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createVoiceProviderKeys(getHost: () => Host): any {
async function voiceProviderKeys(provider: Exclude<VoiceTtsProvider, "xai">, speaker: VoiceSpeaker) {
  const host = getHost();
  const { VOICE_SERVER_ENGINE } = host;

  if (speaker.disabled) return [];
  if (provider === "system" || provider === "chatterbox") {
    const available = provider === "system" ? host.systemVoicesAvailable() : Boolean(host.cfg.tts?.baseUrl?.trim());
    return available ? [{ key: `local-${provider}`, via: "server", source: "server", last4: null, provider }] : [];
  }
  const serverKey = (provider === "openai" ? host.cfg.openai?.key : provider === "fish" ? host.cfg.tts?.fishKey : host.voiceCredential(host.cfg.tts?.key)?.token)?.trim();
  if (host.IDENTITY.kind !== "perspicax") {
    const key = await host.providerAccounts.key(undefined, provider).catch(() => undefined) || serverKey;
    return key ? [{ key, via: "server", source: "server", last4: host.keyLast4(key), provider }] : [];
  }
  if (speaker.disabled || !speaker.principalId) return [];
  const keys: VoiceKeyCandidate[] = [];
  const owner = host.providerAccountOwner(speaker.principalId);
  const personal = owner ? await host.providerAccounts.key(owner, provider).catch(() => undefined) : undefined;
  if (personal) keys.push({ key: personal, via: "speaker-key", source: "perspicax-key", last4: host.keyLast4(personal), payerPrincipalId: speaker.principalId, provider });
  const grant = provider === "elevenlabs" ? ELEVENLABS_VOICE_SERVER_ENGINE : provider === "fish" ? FISH_VOICE_SERVER_ENGINE : VOICE_SERVER_ENGINE;
  if (serverKey && host.serverEngineAllowedFor(speaker.principalId, grant)) keys.push({ key: serverKey, via: "org-key", source: "org-key", last4: host.keyLast4(serverKey), provider });
  return keys;

}
  return voiceProviderKeys;
}
