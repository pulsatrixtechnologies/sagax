// The one way to a bot's profile page (#2136, #2994): it fills the main
// area in place of the chat, never the right panel. The companion
// connection has no profile page, so it opens the bot's panel instead.
import type { Action } from "@/state/store";

export function openBotProfile(dispatch: (action: Action) => void, botId: string) {
  const remoteClient = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  if (remoteClient) dispatch({ type: "toggleSettings", open: true, botId });
  else dispatch({ type: "openPersonaEditor", botId });
}
