// @ts-nocheck
/** botMailOwner (#1388). Pure move from server/index.ts. */
import { directoryListsActive } from "../perspicax/perspicax-link.ts";
export type Host = Record<string, any>;

/** Whether a person may act on this server: listed active by the linked
 * directory, not disabled, not turned off in the console. One rule for a
 * bot's owner (bot email, the bot's phone line) and, #4236, the person a
 * call was handed to. */
export function personActive(directory: Parameters<typeof directoryListsActive>[0], person: { disabledAt?: unknown; consoleDisabled?: unknown }, sub: string | null): boolean {
  return directoryListsActive(directory, sub) && person.disabledAt === undefined && !person.consoleDisabled;
}

export function createBotMailOwner(getHost: () => Host): any {
function botMailOwner(botId: string): { principalId: string; sub: string | null; active: boolean } | null {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot || host.IDENTITY.kind !== "perspicax") return null;
  const principalId = host.effectiveBotOwner(bot);
  const person = principalId ? host.principals.byId(principalId) : null;
  if (!person) return null;
  const sub = person.subject && person.subject.iss === host.IDENTITY.issuer ? person.subject.sub : null;
  return { principalId: person.id, sub, active: personActive(host.perspicaxDirectory?.directory(), person, sub) };

}
  return botMailOwner;
}
