// @ts-nocheck
/** meetingBrowserRefusal (#1388). Pure move from server/index.ts. */
import { describeBrowserEngine } from "../browser/browser-engine.ts";
export type Host = Record<string, any>;

export function createMeetingBrowserRefusal(getHost: () => Host): any {
function meetingBrowserRefusal(botId: string) {
  const host = getHost();
  const { browserEngineStatus, builtInBrowserEnabled } = host;

  const bot = host.store.bot(botId);
  if (!bot) return "unknown bot";
  if (bot.browser === false || bot.computer === "off" || !builtInBrowserEnabled(host.cfg)) {
    return "Your browser is turned off, so you cannot join a meeting. Tell the person; they can turn it on in your settings.";
  }
  const status = browserEngineStatus();
  if (status.kind !== "ready") return `${describeBrowserEngine(status)}. Tell the person; nothing was joined.`;
  return null;

}
  return meetingBrowserRefusal;
}
