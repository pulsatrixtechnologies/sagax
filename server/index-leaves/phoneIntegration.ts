// @ts-nocheck
/** phoneIntegration (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPhoneIntegration(getHost: () => Host): any {
function phoneIntegration(botId: string, threadId: string, generation: string) {
  const host = getHost();

  // The phone is claimed lazily, at the first tools/call the engine makes
  // through this proxy (/api/internal/phone/claim): trigger-term matching
  // only decides whether the tools are mounted, so a conversation that
  // merely mentions "android" holds nothing while it runs.
  const token = host.mintInternalCapability({
    botId,
    threadId,
    generation,
    depth: 0,
    kind: "phone",
    skillAuthoring: false,
    createdBots: 0,
    openedThreads: 0
  });
  const env: Record<string, string> = {
    ...host.AGENTS_NODE_FLAG,
    SAGAX_PHONE_TOKEN: token,
    SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`
  };
  if (process.env.SAGAX_ADB_PATH) env.SAGAX_ADB_PATH = process.env.SAGAX_ADB_PATH;
  if (process.env.SAGAX_RESOURCES_PATH) env.SAGAX_RESOURCES_PATH = process.env.SAGAX_RESOURCES_PATH;
  if (process.env.PH_ANDROID_SERIAL) env.PH_ANDROID_SERIAL = process.env.PH_ANDROID_SERIAL;
  return { command: process.execPath, args: [host.phoneProxyPath], env };

}
  return phoneIntegration;
}
