// @ts-nocheck
/** phoneCallbackOrigin (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPhoneCallbackOrigin(getHost: () => Host): any {
function phoneCallbackOrigin(value: string) {
  void getHost();

  try {
    const url = new URL(value);
    if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname.endsWith(".ts.net"))) return url.origin;
    return null;
  } catch {
    return null;
  }

}
  return phoneCallbackOrigin;
}
