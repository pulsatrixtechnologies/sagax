// V6 bot page (#2612): one option, one place. Every setting of the bot page
// lands on exactly one sub-page, every sub-page on exactly one tab, and every
// piece of the permissions section on exactly one of its sub-pages.
import { describe, expect, it } from "vitest";

import { PERMISSIONS_PARTS } from "@/components/bot-settings/PermissionsSection";
import {
  BOT_PROFILE_CARD_SECTIONS,
  BOT_PROFILE_CARDS,
  BOT_PROFILE_SUBPAGES,
  BOT_PROFILE_SUBPAGE_SECTIONS,
  BOT_PROFILE_TAB_GROUPS,
  BOT_PROFILE_TABS,
  HEADER_SECTIONS,
  PERSONA_CATEGORIES,
  botProfileCardOf,
  botProfileSubPageOf,
  botProfileTabOf,
} from "./persona-sections";

const count = <T,>(items: readonly T[]) => items.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map<T, number>());

describe("V6 bot page map", () => {
  it("puts each setting on exactly one sub-page or card in place (the header, Appearance and Stats aside)", () => {
    const placed = count([
      ...BOT_PROFILE_SUBPAGES.flatMap((page) => BOT_PROFILE_SUBPAGE_SECTIONS[page]),
      ...BOT_PROFILE_CARDS.flatMap((card) => BOT_PROFILE_CARD_SECTIONS[card]),
    ]);
    for (const category of PERSONA_CATEGORIES) {
      const expected = (HEADER_SECTIONS as readonly string[]).includes(category) || category === "usage" || category === "appearance" ? 0 : 1;
      expect(placed.get(category) ?? 0, category).toBe(expected);
      if (!expected) continue;
      const page = botProfileSubPageOf(category);
      const card = botProfileCardOf(category);
      expect(page === null ? BOT_PROFILE_CARD_SECTIONS[card!] : BOT_PROFILE_SUBPAGE_SECTIONS[page]).toContain(category);
    }
  });

  it("lists each sub-page in exactly one group of one tab", () => {
    const listed = count(BOT_PROFILE_TABS.flatMap((tab) => BOT_PROFILE_TAB_GROUPS[tab].flatMap((group) => group.pages)));
    for (const page of BOT_PROFILE_SUBPAGES) expect(listed.get(page), page).toBe(1);
    expect([...listed.keys()].sort()).toEqual([...BOT_PROFILE_SUBPAGES].sort());
  });

  // #3398: General is section cards with their controls in place, as the
  // reference app. The channels and the bot's accounts are cards of the
  // tab, not sub-pages; Shared with is under More (the Channels card holds
  // channels only).
  it("draws the channels and the accounts in place on General, Shared with under More", () => {
    expect(BOT_PROFILE_SUBPAGES).not.toContain("channels");
    expect(BOT_PROFILE_SUBPAGES).not.toContain("accounts");
    expect(BOT_PROFILE_TAB_GROUPS.general.map((group) => group.card ?? group.id)).toEqual(["settings", "channels", "accounts", "more"]);
    expect(BOT_PROFILE_TAB_GROUPS.general.find((group) => group.id === "more")!.pages[0]).toBe("sharing");
    for (const id of ["slack", "access"] as const) {
      expect(botProfileSubPageOf(id), id).toBeNull();
      expect(botProfileTabOf(id), id).toBe("general");
    }
  });

  // #3400: Knowledge is To review and Skills in place, then Its work
  // (Routines, Folder and memory); the Skills sub-page is gone.
  it("draws To review and Skills in place on Knowledge, then Routines and the folder", () => {
    expect(BOT_PROFILE_SUBPAGES).not.toContain("skills");
    expect(BOT_PROFILE_TAB_GROUPS.knowledge.map((group) => group.card ?? group.id)).toEqual(["skills", "work"]);
    expect(BOT_PROFILE_TAB_GROUPS.knowledge.find((group) => group.id === "work")!.pages).toEqual(["routines", "folder"]);
    expect(botProfileSubPageOf("skills")).toBeNull();
    expect(botProfileTabOf("skills")).toBe("knowledge");
  });

  // 0.8.66 put the approval card in "Before acting" too: 16 pieces, none twice
  it("splits the 16 permissions pieces across its sub-pages once each", () => {
    const pieces = [...PERMISSIONS_PARTS.beforeActing, ...PERMISSIONS_PARTS.actsAlone, ...PERMISSIONS_PARTS.rules, ...PERMISSIONS_PARTS.advanced];
    expect(pieces).toHaveLength(16);
    expect(new Set(pieces).size).toBe(16);
  });
});
