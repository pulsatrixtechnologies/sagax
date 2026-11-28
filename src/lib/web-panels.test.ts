import { describe, expect, it } from "vitest";

import {
  findPinnedPage,
  MAX_WEB_PANELS,
  newWebPanelId,
  parseWebPanels,
  pinnedPageName,
  togglePinnedPage,
} from "./web-panels";

describe("pinned chat pages in the top bar", () => {
  const page = { pageId: "pageAAAA1111", botId: "b1", threadId: "t1" };

  it("pins a chat page under its title and unpins it again", () => {
    const pinned = togglePinnedPage([], page, "  Company   dashboard ");
    expect(pinned).toEqual([{ id: "panel-1", name: "Company dashboard", page }]);
    expect(findPinnedPage(pinned, page)).toBe(pinned[0]);
    expect(togglePinnedPage(pinned, page, "Company dashboard")).toEqual([]);
  });

  it("never pins onto a full list", () => {
    const full = Array.from({ length: MAX_WEB_PANELS }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      page: { pageId: `pageAAAA${String(i).padStart(4, "0")}`, botId: "b", threadId: "t" },
    }));
    expect(togglePinnedPage(full, page, "Sales")).toBe(full);
  });

  it("names a page after its title, cut to 40 characters, or Page when it has none", () => {
    expect(pinnedPageName("a".repeat(60))).toHaveLength(40);
    expect(togglePinnedPage([], page, "   ")[0]?.name).toBe("Page");
  });

  it("gives each new panel an unused id", () => {
    expect(newWebPanelId([])).toBe("panel-1");
    expect(newWebPanelId([{ id: "panel-2", name: "A", page }])).toBe("panel-3");
    expect(
      newWebPanelId([
        { id: "panel-1", name: "A", page },
        { id: "panel-2", name: "B", page: { ...page, pageId: "pageBBBB2222" } },
      ]),
    ).toBe("panel-3");
  });

  it("reads a stored list defensively: bad entries dropped, duplicates ignored, at most six", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      page: { pageId: `pageAAAA${String(i).padStart(4, "0")}`, botId: "b", threadId: "t" },
    }));
    expect(parseWebPanels(JSON.stringify(many))).toHaveLength(MAX_WEB_PANELS);
    const mixed = [
      { id: "a", name: "Sales", page },
      { id: "a", name: "dup", page: { ...page, pageId: "pageBBBB2222" } },
      { id: "b", name: "No ref", page: { pageId: "short", botId: "b1", threadId: "t1" } },
      { id: "c", name: "Bad ref", page: "t1/m1" },
      { id: "d", name: "", page },
      { name: "no id", page },
      "nonsense",
    ];
    expect(parseWebPanels(JSON.stringify(mixed))).toEqual([{ id: "a", name: "Sales", page }]);
    expect(parseWebPanels("{not json")).toEqual([]);
    expect(parseWebPanels(null)).toEqual([]);
    expect(parseWebPanels('{"id":"x"}')).toEqual([]);
  });

  it("matches a pin by pageId only", () => {
    const pinned = togglePinnedPage([], page, "Sales");
    expect(findPinnedPage(pinned, { ...page, botId: "other", threadId: "other" })).toBe(pinned[0]);
    expect(findPinnedPage(pinned, { ...page, pageId: "pageBBBB2222" })).toBeUndefined();
  });
});
