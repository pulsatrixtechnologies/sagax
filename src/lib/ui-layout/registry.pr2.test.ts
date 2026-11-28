import { describe, expect, it } from "vitest";

import {
  botGeneralCardOrder,
  botPanelTabOrder,
  botProfileTabOrder,
} from "./bot-page-order";
import {
  conversationHeaderControlOrder,
  conversationHeaderTitleVisible,
} from "./conversation-header-order";
import { defaultUiLayout } from "./preference";
import {
  defaultZoneOrder,
  isHideable,
  ZONE_REGISTRY,
} from "./registry";
import {
  BOT_PAGE_COMPONENT_IDS,
  CONVERSATION_HEADER_COMPONENT_IDS,
} from "./types";

describe("ui-layout PR2 registry (conversationHeader + botPage)", () => {
  it("lists conversationHeader components and defaults", () => {
    const ids = ZONE_REGISTRY.conversationHeader.components.map((entry) => entry.id);
    expect(ids).toEqual([...CONVERSATION_HEADER_COMPONENT_IDS]);
    expect(defaultZoneOrder("conversationHeader")).toEqual([...CONVERSATION_HEADER_COMPONENT_IDS]);
    for (const id of CONVERSATION_HEADER_COMPONENT_IDS) {
      expect(isHideable("conversationHeader", id)).toBe(true);
    }
  });

  it("lists botPage components and defaults", () => {
    const ids = ZONE_REGISTRY.botPage.components.map((entry) => entry.id);
    expect(ids).toEqual([...BOT_PAGE_COMPONENT_IDS]);
    expect(defaultZoneOrder("botPage")).toEqual([...BOT_PAGE_COMPONENT_IDS]);
    for (const id of BOT_PAGE_COMPONENT_IDS) {
      expect(isHideable("botPage", id)).toBe(true);
    }
  });

  it("seeds defaults in defaultUiLayout", () => {
    const layout = defaultUiLayout();
    expect(layout.zones.conversationHeader.order).toEqual([...CONVERSATION_HEADER_COMPONENT_IDS]);
    expect(layout.zones.botPage.order).toEqual([...BOT_PAGE_COMPONENT_IDS]);
  });

  it("orders header controls and title visibility", () => {
    const zone = {
      order: ["tasks", "botPanel", "exportMenu", "liveCall", "title"],
      hidden: ["title", "liveCall"],
    };
    expect(conversationHeaderTitleVisible(zone)).toBe(false);
    expect(conversationHeaderControlOrder(zone)).toEqual(["tasks", "botPanel", "exportMenu"]);
  });

  it("orders bot page tabs, cards, and panel tabs", () => {
    const zone = {
      order: [
        "tab:stats",
        "tab:general",
        "card:more",
        "card:settings",
        "panel:library",
        "panel:activity",
      ],
      hidden: ["tab:outcomes", "card:channels", "panel:coding"],
    };
    expect(botProfileTabOrder(zone)).toEqual(["tab:stats", "tab:general", "tab:knowledge"]);
    expect(botGeneralCardOrder(zone)).toEqual(["card:more", "card:settings", "card:notifications", "card:accounts"]);
    expect(botPanelTabOrder(zone)).toEqual(["panel:library", "panel:activity"]);
  });

  it("puts a card missing from a saved order back at its default place", () => {
    // Saved before card:notifications existed: only more.
    const zone = {
      order: ["card:more"],
      hidden: [] as string[],
    };
    expect(botGeneralCardOrder(zone)).toEqual([
      "card:settings",
      "card:notifications",
      "card:channels",
      "card:accounts",
      "card:more",
    ]);
  });
});
