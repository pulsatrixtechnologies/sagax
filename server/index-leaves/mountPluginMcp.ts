// @ts-nocheck
/** mountPluginMcp (#1388). Pure move from server/index.ts. */
import { pluginMcpPrecheck, pluginSpecOnComputer } from "../capabilities/capability-plugin-mounts.ts";
import { pluginMcpAsPerson } from "../turns/turn-mounts.ts";
export type Host = Record<string, any>;

export function createMountPluginMcp(getHost: () => Host): any {
async function mountPluginMcp(   integrations: NonNullable<SendTurnInput["integrations"]>,   input: { botId: string; threadId: string; generation: string; customMcp: boolean; principal: string | null }, ) {
  const host = getHost();
  // GitHub servers left out: the person has no GitHub connection (the
  // turn's prompt says so, githubWithheldPrompt).
  const githubWithheld: string[] = [];

  if (!input.customMcp) return { githubWithheld };
  const bot = host.store.bot(input.botId);
  if (!bot) return { githubWithheld };
  const person = host.IDENTITY.kind === "perspicax" ? input.principal?.trim().toLowerCase() : host.localPrincipalId();
  if (!person) return { githubWithheld };
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
      // #3385: a GitHub server carries the person's GitHub connection,
      // never its literal ${GITHUB_PERSONAL_ACCESS_TOKEN} placeholder.
      const asPerson = pluginMcpAsPerson(server.name, spec, { organization: host.IDENTITY.kind === "perspicax", githubToken: () => host.githubAccountToken(person) });
      if (!asPerson) { githubWithheld.push(server.name); continue; }
      spec = asPerson;
    } else if (host.IDENTITY.kind === "perspicax") {
      // stopped before answering anything in the last 30 min (#3181): not mounted
      if (host.stdioRelay?.startFailed(person, server.name, { argv: [spec.command, ...spec.args], env: spec.env })) continue;
      spec = host.personalStdioIntegration(input.botId, input.threadId, input.generation, person, server.name, { scope: server.scope, key: server.key, name: server.name });
    } else spec = pluginSpecOnComputer(spec, { name: server.plugin, dir: server.dir });
    integrations.custom = { ...integrations.custom, [server.name]: spec };
  }
  return { githubWithheld };
}
  return mountPluginMcp;
}
