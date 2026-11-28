// What the live browser's bar shows for the page on screen [M-20261127-180]:
// the address field and the tab labels follow the page the stream reports,
// never a page the person or the bot already left.

type Tab = { url: string; title: string; active: boolean };

/** What the address field shows for a page: nothing for a blank one. */
export function shownAddress(url: string | null | undefined): string {
  return !url || url === "about:blank" ? "" : url;
}

/** A web page's host, for a tab whose page has given no title yet. */
export function tabHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : "";
  } catch {
    return "";
  }
}

/** A tab's label: its page's title, else its site; "" for a blank page. */
export function tabLabel(tab: { title: string; url: string }): string {
  return tab.title || tabHost(tab.url);
}

const withoutHash = (url: string) => url.split("#", 1)[0];

/** The tabs once the active one moved to `url` (the stream's url event). The
 * engine lists titles only after a command, so a new document's title is
 * unknown until then: it is cleared, never left naming the page before. A
 * move within the same document (a #fragment) keeps it. */
export function followActiveUrl<T extends Tab>(tabs: T[], url: string): T[] {
  const index = tabs.findIndex((tab) => tab.active);
  const tab = tabs[index];
  if (!tab || tab.url === url) return tabs;
  const next = [...tabs];
  next[index] = { ...tab, url, title: withoutHash(tab.url) === withoutHash(url) ? tab.title : "" };
  return next;
}
