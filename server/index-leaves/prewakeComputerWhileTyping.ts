// @ts-nocheck
/** prewakeComputerWhileTyping (#1388). Pure move from server/index.ts. */
import { reportBackgroundError } from "../background-error.ts";
import { cloudOnlyBot } from "../bots/cloud-only-bots.ts";
export type Host = Record<string, any>;

export function createPrewakeComputerWhileTyping(getHost: () => Host): any {
function prewakeComputerWhileTyping(botId: string, principalId: string | null | undefined): void {
  const host = getHost();
  if (!host.userSandbox || host.IDENTITY.kind !== "perspicax") return;
  const principal = principalId?.trim().toLowerCase();
  if (!principal) return;
  const bot = host.store.bot(botId);
  if (!bot || bot.computer === "off") return;
  const place = host.decideWorkplace({ desktopTargeted: false, routine: false, principal, personAsked: false });
  if (place.target !== "user-sandbox" && !cloudOnlyBot(botId)) return;
  if (!host.typingPrewake.take(principal, botId, Date.now())) return;
  void host.userSandbox.prewake(principal, botId).catch(reportBackgroundError);
}
  return prewakeComputerWhileTyping;
}
