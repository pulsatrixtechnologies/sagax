// @ts-nocheck
/** mountPluginMcp (#1388). Pure move from server/index.ts. */
import { pluginMcpPrecheck, pluginSpecOnComputer } from "../capabilities/capability-plugin-mounts.ts";
export type Host = Record<string, any>;

export function createMountPluginMcp(getHost: () => Host): any {
async function mountPluginMcp(   integrations: NonNullable<SendTurnInput["integrations"]>,   input: { botId: string; threadId: string; generation: string; customMcp: boolean; principal: string | null }, ) {
  const host = getHost();

  if (!input.customMcp) return;
  const bot = host.store.bot(input.botId);
  if (!bot) return;
  const person = host.IDENTITY.kind === "perspicax" ? input.principal?.trim().toLowerCase() : host.localPrincipalId();
  if (!person) return;
  for (const server of host.scopedPluginMcp(bot, person)) {
    const refused = pluginMcpPrecheck(server.name, server.spec, {
      taken: (name) => Object.hasOwn(integrations.custom ?? {}, name),
      organization: host.IDENTITY.kind === "perspicax", hasEnvironment: Boolean(host.userSandbox)
    });
    if (refused) continue;
    if (!Object.hasOwn(host.managedPolicy.filterMcp({ [server.name]: server.spec }), server.name)) continue;
    let spec = server.spec;
    if ("url" in spec) {
      if (host.IDENTITY.kind === "perspicax" && await host.personalHostRefusalCached(spec.url)) continue;
    } else if (host.IDENTITY.kind === "perspicax") {
      // stopped before answering anything in the last 30 min (#3181): not mounted
      if (host.stdioRelay?.startFailed(person, server.name, { argv: [spec.command, ...spec.args], env: spec.env })) continue;
      spec = host.personalStdioIntegration(input.botId, input.threadId, input.generation, person, server.name, { scope: server.scope, key: server.key, name: server.name });
    } else spec = pluginSpecOnComputer(spec, { name: server.plugin, dir: server.dir });
    integrations.custom = { ...integrations.custom, [server.name]: spec };
  }

}
  return mountPluginMcp;
}
