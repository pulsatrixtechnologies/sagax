// @ts-nocheck
/** ownComputerChoiceRequest (#1388). Pure move from server/index.ts. */
import { ownComputerChoiceCall } from "../people/member-environment.ts";
export type Host = Record<string, any>;

export function createOwnComputerChoiceRequest(getHost: () => Host): any {
function ownComputerChoiceRequest(bot: BotRecord, threadId: string, tool: string | undefined, answerer: string, guestDriven: boolean) {
  const host = getHost();

  const workplace = host.turnWorkplaces.get(threadId);
  const mine = workplace?.botId === bot.id;
  const persons = [answerer];
  const speaker = host.turnSpeakers.get(threadId);
  const person = speaker?.origin === "person" ? speaker.principalId?.trim().toLowerCase() ?? "" : "";
  if (person && (host.store.taskByThread(bot.id, threadId)?.ownerPrincipalId ?? "").trim().toLowerCase() === person
    && host.destinationTurnOrigin(bot, threadId, person) === "owner") persons.push(person);
  return ownComputerChoiceCall({
    identity: host.IDENTITY.kind,
    tool,
    mounted: Boolean(mine && workplace.computerChoice),
    choicePrincipalId: mine ? workplace.decision.principal : null,
    personPrincipalIds: persons,
    guestDriven
  });

}
  return ownComputerChoiceRequest;
}
