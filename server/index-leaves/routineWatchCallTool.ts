// @ts-nocheck
/** routineWatchCallTool (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineWatchCallTool(getHost: () => Host): any {
async function routineWatchCallTool(routine: WatchRoutine, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolAnswer | { error: string }> {
  const host = getHost();
  const { mcpDisabledTools } = host;

  const bot = host.store.bot(routine.botId);
  if (!bot) return { error: "The bot of this routine is gone" };
  const parsed = parseToolId(tool);
  if (parsed.server) {
    await host.refreshMcpOAuth(bot);
    const runAs = host.effectiveRunAs({ botId: routine.botId, ...(routine.runAs ? { runAs: routine.runAs } : {}) }) || host.effectiveBotOwner(bot);
    const spec = host.mcpServersAsPerson(bot, runAs.trim().toLowerCase()).servers[parsed.server];
    if (spec) {
      if (!("url" in spec)) return { error: "A watch reaches the bot's remote MCP servers and Perspicax; this server only runs inside a turn" };
      if (mcpDisabledTools(host.cfg)[parsed.server]?.includes(parsed.name)) return { error: "This tool is turned off for this workspace" };
      const client = new host.RemoteMcpClient(spec);
      try {
        await client.initialize("Sagax routine watch", signal);
        return host.toolResultValue(await client.request("tools/call", { name: parsed.name, arguments: args }, signal));
      } finally {
        await client.close().catch(host.reportBackgroundError);
      }
    }
  }
  if (host.IDENTITY.kind === "perspicax") {
    const principal = host.effectiveRunAs({ botId: routine.botId, ...(routine.runAs ? { runAs: routine.runAs } : {}) }) || host.effectiveBotOwner(bot);
    return host.perspicaxReadAlone({ botId: bot.id, principalId: principal, threadId: `routine-watch-${routine.id}`, tool: tool.replace(/^mcp__[A-Za-z0-9_.-]+?__(?=[A-Za-z0-9])/, ""), args, clientName: "Sagax routine watch" });
  }
  return { error: "This tool is not one of the bot's MCP servers" };

}
  return routineWatchCallTool;
}
