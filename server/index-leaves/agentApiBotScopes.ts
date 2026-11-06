// @ts-nocheck
/** agentApiBotScopes (#1388). Pure move from server/index.ts. */
import { readFileSync } from "node:fs";
export type Host = Record<string, any>;

export function createAgentApiBotScopes(getHost: () => Host): any {
function agentApiBotScopes(bot: BotRecord) {
  const host = getHost();

  const fallback: AgentScope[] = bot.chiefOfStaff && !host.ownerBotsReadOnly(bot) ? ["agents.read", "agents.send", "agents.create"] : ["agents.read", "agents.send"];
  try {
    const parsed = JSON.parse(readFileSync(host.AGENT_API_GRANTS_FILE, "utf8")) as { bots?: Record<string, unknown> };
    const listed = parsed.bots?.[bot.id];
    if (Array.isArray(listed)) {
      const scopes = listed.filter((scope): scope is AgentScope => scope === "agents.read" || scope === "agents.send" || scope === "agents.create");
      // create stays a Primary Bot's, whatever a file says
      return new Set(scopes.filter((scope) => scope !== "agents.create" || (bot.chiefOfStaff && !host.ownerBotsReadOnly(bot))));
    }
  } catch {
    // no file, or unreadable: the defaults
  }
  return new Set(fallback);

}
  return agentApiBotScopes;
}
