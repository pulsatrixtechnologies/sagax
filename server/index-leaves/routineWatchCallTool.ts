// @ts-nocheck
/** routineWatchCallTool (#1388). Pure move from server/index.ts. */
import { foldWatchName, watchCatalog } from "../routines/watch-tool-resolution.ts";
import { parseToolId } from "../../shared/approval-describe.ts";
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
      if (spec && "url" in spec && (parsed.server !== "perspicax" || host.IDENTITY.kind !== "perspicax")) {
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

  async function list(routine, tool, signal) {
    const host = getHost();
    const bot = host.store.bot(routine.botId);
    if (!bot) throw new Error("The bot of this routine is gone");
    await host.refreshMcpOAuth(bot);
    const principal = host.effectiveRunAs(routine) || host.effectiveBotOwner(bot);
    const servers = host.mcpServersAsPerson(bot, principal.trim().toLowerCase()).servers;
    const wanted = tool.replace(/^mcp__/, "");
    const parsed = parseToolId(wanted);
    const candidates = Object.keys(servers).filter(server => (server !== "perspicax" || host.IDENTITY.kind !== "perspicax") && (parsed.server
      ? parsed.server === server : foldWatchName(wanted).startsWith(foldWatchName(server) + "_")));
    const names = [];
    for (const server of candidates) {
      const spec = servers[server];
      if (!("url" in spec)) continue;
      const client = new host.RemoteMcpClient(spec);
      try {
        await client.initialize("Sagax routine watch", signal);
        const listed = await watchCatalog(params => client.request("tools/list", params, signal));
        const disabled = host.mcpDisabledTools(host.cfg)[server] ?? [];
        for (const name of listed) {
          const qualified = server + "__" + name;
          if (disabled.includes(name)) {
            if (foldWatchName(qualified) === foldWatchName(wanted)) throw new Error("This tool is turned off for this workspace");
          } else names.push(qualified);
        }
      } finally {
        await client.close().catch(host.reportBackgroundError);
      }
    }
    if (host.IDENTITY.kind === "perspicax" && !(parsed.server && candidates.includes(parsed.server) && "url" in servers[parsed.server])) {
      const answer = await host.perspicaxSessionAlone({ botId: bot.id, principalId: principal,
        threadId: `routine-watch-catalog-${host.randomUUID()}`, clientName: "Sagax routine watch" }, (_call, listTools) => listTools());
      if ("error" in answer) throw new Error(answer.error);
      names.push(...answer);
    }
    return [...new Set(names)];
  }
  return Object.assign(routineWatchCallTool, { list });
}
