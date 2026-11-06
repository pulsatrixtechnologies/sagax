// @ts-nocheck
/** postDesktopPrivateMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPostDesktopPrivateMessage(getHost: () => Host): any {
function postDesktopPrivateMessage(message: DesktopPrivateMessage) {
  const host = getHost();

  if (!host.utilityParentPort) return false;
  try {
    host.utilityParentPort.postMessage(message);
    return true;
  } catch (error) {
    console.error(`[desktop-sync] could not send private parent message: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

}
  return postDesktopPrivateMessage;
}
