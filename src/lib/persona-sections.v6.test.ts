// V6 bot page (#2612): one option, one place. Every setting of the bot page
// lands on exactly one sub-page, every sub-page on exactly one tab, and every
// piece of the permissions section on exactly one of its sub-pages.
import { describe, expect, it } from "vitest";

import { PERMISSIONS_PARTS } from "@/components/bot-settings/PermissionsSection";
import {
  BOT_PROFILE_SUBPAGES,
  BOT_PROFILE_SUBPAGE_SECTIONS,
  BOT_PROFILE_TAB_GROUPS,
  BOT_PROFILE_TABS,
  HEADER_SECTIONS,
  PERSONA_CATEGORIES,
  botProfileSubPageOf,
} from "./persona-sections";

const count = <T,>(items: readonly T[]) => items.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map<T, number>());

describe("V6 bot page map", () => {
  it("puts each setting on exactly one sub-page (the header, Appearance and Stats aside)", () => {
    const placed = count(BOT_PROFILE_SUBPAGES.flatMap((page) => BOT_PROFILE_SUBPAGE_SECTIONS[page]));
    for (const category of PERSONA_CATEGORIES) {
      const expected = (HEADER_SECTIONS as readonly string[]).includes(category) || category === "usage" || category === "appearance" ? 0 : 1;
      expect(placed.get(category) ?? 0, category).toBe(expected);
      if (expected) expect(BOT_PROFILE_SUBPAGE_SECTIONS[botProfileSubPageOf(category)!]).toContain(category);
    }
  });

  it("lists each sub-page in exactly one group of one tab", () => {
    const listed = count(BOT_PROFILE_TABS.flatMap((tab) => BOT_PROFILE_TAB_GROUPS[tab].flatMap((group) => group.pages)));
    for (const page of BOT_PROFILE_SUBPAGES) expect(listed.get(page), page).toBe(1);
    expect([...listed.keys()].sort()).toEqual([...BOT_PROFILE_SUBPAGES].sort());
  });

  // 0.8.66 put the approval card in "Before acting" too: 16 pieces, none twice
  it("splits the 16 permissions pieces across its sub-pages once each", () => {
    const pieces = [...PERMISSIONS_PARTS.beforeActing, ...PERMISSIONS_PARTS.actsAlone, ...PERMISSIONS_PARTS.rules, ...PERMISSIONS_PARTS.advanced];
    expect(pieces).toHaveLength(16);
    expect(new Set(pieces).size).toBe(16);
  });
});
