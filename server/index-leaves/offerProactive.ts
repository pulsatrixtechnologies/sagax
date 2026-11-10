// @ts-nocheck
/** offerProactive (#1388). Pure move from server/index.ts. */
import { chosenWatchEvent } from "../proactive/proactive-wake.ts";
export type Host = Record<string, any>;

export function createOfferProactive(getHost: () => Host): any {
function offerProactive(event: ProactiveEvent) {
  const host = getHost();

  try {
    // #2694: a wake kind the person said "never" to, or voted down past the
    // mute line (votes fade in two weeks), does not wake the bot
    // #3423: a watch the person chose is their yes; its "never" stops that
    // watch in their choices, so an old mute of the kind does not apply
    if (!chosenWatchEvent(event) && host.backgroundBriefs?.wakeMuted(event.botId, event.source)) return undefined;
    return host.proactiveWaker.offer(event);
  } catch (error) {
    console.warn(`[proactive] offer failed: ${error instanceof Error ? error.name : "error"}`);
    return undefined;
  }

}
  return offerProactive;
}
