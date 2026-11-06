// @ts-nocheck
/** orgAdminEngines (#1388). Pure move from server/index.ts. */
import { ELEVENLABS_VOICE_SERVER_ENGINE, FISH_VOICE_SERVER_ENGINE } from "../../shared/voice-mode.ts";
export type Host = Record<string, any>;

export function createOrgAdminEngines(getHost: () => Host): any {
function orgAdminEngines() {
  const host = getHost();
  const { VOICE_SERVER_ENGINE, driverKeyBacked } = host;

  const configs = host.providerConfigs();
  const engines: AdminEngine[] = host.registry.entries().filter((entry) => !host.personalProviderInstances.get(entry.instanceId)).map((entry) => {
    const live = host.registry.get(entry.instanceId);
    const access = configs[entry.instanceId]?.access ?? host.registry.access(entry.instanceId);
    const auth: AdminEngine["auth"] = access === "api" ? "apiKey"
      : access === "custom" ? "none"
      : live?.startAuthentication ? "oauth" : "none";
    const driver = entry.shadow?.driverKind ?? entry.live?.driverKind ?? "";
    return {
      id: entry.instanceId,
      name: live ? host.engineDisplayName(live) : entry.instanceId,
      kind: access === "custom" ? "local" : "cloud",
      installed: host.engineInstalled(entry.instanceId),
      auth,
      // 2026-10-16: the organization's key serves this engine (never the
      // key): the engines a person sheet's sagax_server_engines can give.
      orgKey: driverKeyBacked(host.cfg, driver, entry.instanceId)
    };
  });
  // Voice mode on the organization's xAI key is given the same way.
  if (host.cfg.xai?.key) engines.push({ id: VOICE_SERVER_ENGINE, name: "Grok voice (xAI)", kind: "cloud", installed: true, auth: "apiKey", orgKey: true, voice: true });
  if (host.voiceCredential(host.cfg.tts?.key)) engines.push({ id: ELEVENLABS_VOICE_SERVER_ENGINE, name: "ElevenLabs voice", kind: "cloud", installed: true, auth: "apiKey", orgKey: true, voice: true });
  if (host.cfg.tts?.fishKey) engines.push({ id: FISH_VOICE_SERVER_ENGINE, name: "Fish Audio voice", kind: "cloud", installed: true, auth: "apiKey", orgKey: true, voice: true });
  // 2026-10-16: Grok voice also covers read aloud and voice notes when the
  // voice engine is xAI; avatar images on the organization's xAI key are
  // given the same way.
  if (host.cfg.xai?.key) engines.push({ id: host.IMAGE_SERVER_ENGINE, name: "Grok images and videos (xAI)", kind: "cloud", installed: true, auth: "apiKey", orgKey: true, image: true });
  return engines;

}
  return orgAdminEngines;
}
