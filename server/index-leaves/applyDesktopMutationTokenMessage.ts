// @ts-nocheck
/** applyDesktopMutationTokenMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createApplyDesktopMutationTokenMessage(getHost: () => Host): any {
function applyDesktopMutationTokenMessage(raw: unknown) {
  const host = getHost();

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const message = raw as Record<string, unknown>;
  if (message.type !== "openmausbot:desktop-mutation-token") return false;
  if (typeof message.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(message.token)) {
    throw new Error("invalid desktop mutation capability");
  }
  host.desktopMutationToken = message.token;
  if (typeof message.companionToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(message.companionToken)) {
    host.companionMutationToken = message.companionToken;
  }
  return true;

}
  return applyDesktopMutationTokenMessage;
}
