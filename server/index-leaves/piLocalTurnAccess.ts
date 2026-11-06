// @ts-nocheck
/** piLocalTurnAccess (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
export type Host = Record<string, any>;

export function createPiLocalTurnAccess(getHost: () => Host): any {
function piLocalTurnAccess(bot: BotRecord, speaker: TurnSpeaker) {
  const host = getHost();
  const { DATA_DIR, isPrincipalId } = host;
  const ids = [
    speaker.origin === "person" ? speaker.principalId : undefined,
    host.autoPayerKey(bot, speaker),
    host.effectiveBotOwner(bot),
  ].map((id) => id?.trim().toLowerCase() ?? "");
  const person = ids.find((id) => id && isPrincipalId(id));
  return {
    via: "server",
    identity: person ? `local:${person}` : "local:org",
    engineHome: person ? join(DATA_DIR, "principals", person, "piAgent-key") : join(DATA_DIR, "org", "piAgent-local")
  };

}
  return piLocalTurnAccess;
}
