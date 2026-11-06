// @ts-nocheck
/** voiceFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createVoiceFor(getHost: () => Host): any {
async function voiceFor(cfg: AppConfig, principalId: string | null | undefined, organizationXaiGiven: boolean): Promise<{ cfg: AppConfig; access: tts.VoiceKeyAccess }> {
  const host = getHost();
  const owner = host.providerAccountOwner(principalId);
  const own = owner === null ? {} : Object.fromEntries(await Promise.all((["elevenlabs", "fish", "xai"] as const).map(async (provider) =>
    [provider, await host.providerAccounts.key(owner, provider).catch(() => undefined)])));
  return { cfg: host.withPersonalVoiceKeys(host.cfg, own), access: {
    xaiKeyGiven: own.xai ? true : organizationXaiGiven,
    elevenlabsKeyGiven: Boolean(own.elevenlabs) || host.serverEngineAllowedFor(principalId ?? "", ELEVENLABS_VOICE_SERVER_ENGINE),
    fishKeyGiven: Boolean(own.fish) || host.serverEngineAllowedFor(principalId ?? "", FISH_VOICE_SERVER_ENGINE)
  } };

}
  return voiceFor;
}
