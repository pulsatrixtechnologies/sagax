// @ts-nocheck
/** backgroundBriefReads (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBackgroundBriefReads(getHost: () => Host): any {
async function backgroundBriefReads(botId: string) {
  const host = getHost();
  const { customMcpServers, mcpDisabledTools } = host;

  const bot = host.store.bot(botId);
  // a GitHub server reads as the bot's owner, never as whoever saved it
  const saved = bot ? customMcpServers(host.cfg, bot.mcpServers) : {};
  const servers = bot && host.IDENTITY.kind === "perspicax" ? host.githubServersAsPerson(saved, host.githubAccountToken(host.effectiveBotOwner(bot).trim().toLowerCase())).servers : saved;
  const signal = AbortSignal.timeout(12_000);
  const apps = await host.listBriefApps(servers, mcpDisabledTools(host.cfg), signal);
  return {
    apps: () => apps,
    read: (app, tool) => {
      const server = servers[app];
      return server ? host.readBriefTool(server, tool, signal) : Promise.resolve(null);
    }
  };

}
  return backgroundBriefReads;
}
