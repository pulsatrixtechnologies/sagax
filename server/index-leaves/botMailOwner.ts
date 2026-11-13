// @ts-nocheck
/** botMailOwner (#1388). Pure move from server/index.ts. */
import { directoryListsActive } from "../perspicax/perspicax-link.ts";
export type Host = Record<string, any>;

export function createBotMailOwner(getHost: () => Host): any {
function botMailOwner(botId: string): { principalId: string; sub: string | null; active: boolean } | null {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot || host.IDENTITY.kind !== "perspicax") return null;
  const principalId = host.effectiveBotOwner(bot);
  const person = principalId ? host.principals.byId(principalId) : null;
  if (!person) return null;
  const sub = person.subject && person.subject.iss === host.IDENTITY.issuer ? person.subject.sub : null;
  const listedActive = directoryListsActive(host.perspicaxDirectory?.directory(), sub);
  return { principalId: person.id, sub, active: listedActive && person.disabledAt === undefined && !person.consoleDisabled };

}
  return botMailOwner;
}
