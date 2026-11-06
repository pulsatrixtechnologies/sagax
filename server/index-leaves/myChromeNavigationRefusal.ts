// @ts-nocheck
/** myChromeNavigationRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMyChromeNavigationRefusal(getHost: () => Host): any {
function myChromeNavigationRefusal(params: unknown) {
  const host = getHost();

  const url = (params as { arguments?: { url?: unknown } } | null)?.arguments?.url;
  if (url === undefined || url === null || url === "" || url === "about:blank") return null;
  if (typeof url === "string" && host.myChrome.allows(url)) return null;
  let shown = String(url);
  try { shown = new URL(shown).origin; } catch { /* keep */ }
  return `Sagax blocked ${shown}: it is not one of the sites the person allowed in My Chrome. Ask them to allow it in Settings, or stay on the allowed sites.`;

}
  return myChromeNavigationRefusal;
}
