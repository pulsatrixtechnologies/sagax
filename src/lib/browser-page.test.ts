import { describe, expect, it } from "vitest";
import { followActiveUrl, shownAddress, tabHost, tabLabel } from "./browser-page";

const tabs = [
  { tabId: "t1", title: "Inbox", url: "https://mail.example/inbox", active: false },
  { tabId: "t2", title: "test at DuckDuckGo", url: "https://duckduckgo.com/?q=test", active: true },
];

describe("the bar follows the page on screen (M-20261127-180)", () => {
  it("gives the active tab the new address and drops the title of the page it left", () => {
    const next = followActiveUrl(tabs, "https://www.google.ca/");
    expect(next[1]).toEqual({ tabId: "t2", title: "", url: "https://www.google.ca/", active: true });
    expect(next[0]).toBe(tabs[0]);
  });

  it("keeps the title for a move within the same document, and changes nothing for the same address", () => {
    expect(followActiveUrl(tabs, "https://duckduckgo.com/?q=test#results")[1]!.title).toBe("test at DuckDuckGo");
    expect(followActiveUrl(tabs, "https://duckduckgo.com/?q=test")).toBe(tabs);
    expect(followActiveUrl([], "https://www.google.ca/")).toEqual([]);
  });

  it("names a page with no title by its site, and a blank page by nothing", () => {
    expect(tabHost("https://www.google.ca/search?q=a")).toBe("www.google.ca");
    expect(tabHost("about:blank")).toBe("");
    expect(tabLabel({ title: "", url: "https://www.google.ca/" })).toBe("www.google.ca");
    expect(tabLabel({ title: "Google", url: "https://www.google.ca/" })).toBe("Google");
    expect(tabHost("")).toBe("");
    expect(shownAddress("about:blank")).toBe("");
    expect(shownAddress(null)).toBe("");
    expect(shownAddress("https://google.ca/")).toBe("https://google.ca/");
  });
});
