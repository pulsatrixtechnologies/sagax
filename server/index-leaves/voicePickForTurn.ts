// @ts-nocheck
/** voicePickForTurn (#1388). Pure move from server/index.ts. */
import { pickVoiceModel } from "../models/model-auto.ts";
export type Host = Record<string, any>;

export function createVoicePickForTurn(getHost: () => Host): any {
function voicePickForTurn(bot: BotRecord, base: ModelSelection, speaker: TurnSpeaker, guestConfined: boolean) {
  const host = getHost();

  const payer = host.autoPayerKey(bot, speaker);
  const offered = host.autoEnginesFor({ ...bot, modelSelection: base }, speaker, guestConfined);
  // Sagax's quick pick also skips an engine whose plan the payer's usage
  // report showed spent (J4); Auto reads only the refusals Sagax saw.
  const limited = host.limitFailover.autoExcluded(payer, offered, "quick");
  const engines = offered.filter((engine) => !limited.has(engine.instanceId));
  if (!engines.length) return null;
  return pickVoiceModel({ base, engines, catalog: host.autoCatalogLookup, skip: host.autoRefusalsFor(payer) });

}
  return voicePickForTurn;
}
