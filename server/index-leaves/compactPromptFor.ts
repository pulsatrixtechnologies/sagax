// @ts-nocheck
/** compactPromptFor (#1388). Pure move from server/index.ts. */
import { compactMemoryDir, compactPins, toolUsage, KNOWN_USE_CALLS } from "../context/compact-prompt.ts";
export type Host = Record<string, any>;

export function createCompactPromptFor(getHost: () => Host): any {
function compactPromptFor(bot: BotRecord, person: string) {
  const host = getHost();
  const { DATA_DIR } = host;

  const day = new Date().toISOString().slice(0, 10);
  let cached = host.compactPinsByBot.get(bot.id);
  if (!cached || cached.day !== day) {
    const owner = host.effectiveBotOwner(bot);
    const own = host.recentToolUses(bot.id);
    const siblings = host.store.bots.filter((other) => other.id !== bot.id && host.effectiveBotOwner(other) === owner).flatMap((other) => host.recentToolUses(other.id));
    const ownUsage = toolUsage(own);
    const all = toolUsage([...own, ...siblings]);
    // A bot with little recorded use of its own Sagax tools takes its
    // owner's bots' use, never a guess.
    const ownAgentsCalls = [...(ownUsage.get("agents")?.values() ?? [])].reduce((sum, count) => sum + count, 0);
    cached = {
      day,
      value: {
        agents: compactPins(ownAgentsCalls >= KNOWN_USE_CALLS ? ownUsage : all, []).agents,
        pinned: compactPins(all, [...all.keys()].filter((server) => server !== "agents")).pinned
      }
    };
    host.compactPinsByBot.set(bot.id, cached);
  }
  return { ...cached.value, memoryDir: compactMemoryDir(DATA_DIR, bot.id, person) };

}
  return compactPromptFor;
}
