// @ts-nocheck
/** piTurnPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPiTurnPerson(getHost: () => Host): any {
function piTurnPerson(bot: BotRecord, speaker: TurnSpeaker) {
  const host = getHost();
  const { isPrincipalId } = host;

  const ids = [
    speaker.origin === "person" ? speaker.principalId : undefined,
    host.autoPayerKey(bot, speaker),
    host.effectiveBotOwner(bot),
  ].map((id) => id?.trim().toLowerCase() ?? "");
  return ids.find((id) => id && isPrincipalId(id));

}
  return piTurnPerson;
}
