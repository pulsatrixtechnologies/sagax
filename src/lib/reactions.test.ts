import { describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { searchEmoji } from "./emoji-list";
import { myReactions, reactionChips, reactionSelfIds, reactionTooltip } from "./reactions";
import type { ConfigStatus } from "@/state/store";

const stored = [
  { emoji: "👍", actors: [{ id: "pr_morgan", kind: "person", name: "Sam Taylor" }, { id: "bot:quasar", kind: "bot", name: "Quasar" }, { id: "pr_me", kind: "person", name: "Me" }], at: 1 },
  { emoji: "👀", actors: [{ id: "bot:quasar", kind: "bot", name: "Quasar" }], at: 2 },
];

describe("reaction chips", () => {
  it("counts, marks mine and keeps the order the emojis landed in", () => {
    expect(reactionChips(stored, ["pr_me"]).map((chip) => [chip.emoji, chip.count, chip.mine])).toEqual([["👍", 3, true], ["👀", 1, false]]);
    expect(myReactions(stored, ["pr_me"])).toEqual(["👍"]);
    expect(myReactions(undefined, ["pr_me"])).toEqual([]);
  });

  it("lists who reacted, me as You, in English and French", () => {
    const [thumbs, eyes] = reactionChips(stored, ["pr_me"]);
    expect(reactionTooltip(thumbs!, ["pr_me"])).toBe("Sam Taylor, Quasar and You reacted with 👍");
    expect(reactionTooltip(eyes!, ["pr_me"])).toBe("Quasar reacted with 👀");
    setLocale("fr");
    try {
      expect(reactionTooltip(thumbs!, ["pr_me"])).toBe("Réaction 👍 : Sam Taylor, Quasar et Toi");
    } finally {
      setLocale("en");
    }
  });

  it("knows me by the read receipts' self, the viewer, and on the desktop the legacy user", () => {
    const operator = { viewer: { operator: true, principalId: "PR_Local" } } as unknown as ConfigStatus;
    expect(reactionSelfIds(operator, "pr_local")).toEqual(["pr_local", "user"]);
    const member = { viewer: { operator: false, principalId: "pr_bob" } } as unknown as ConfigStatus;
    expect(reactionSelfIds(member, null)).toEqual(["pr_bob"]);
  });
});

describe("emoji search", () => {
  it("finds by word prefixes, accents ignored, and an emoji finds itself", () => {
    expect(searchEmoji("thumb").map((entry) => entry.emoji)).toEqual(["👍", "👎"]);
    expect(searchEmoji("fête").map((entry) => entry.emoji)).toContain("🎉");
    expect(searchEmoji("🦉")[0]!.emoji).toBe("🦉");
    expect(searchEmoji("").length).toBeGreaterThan(40);
    expect(searchEmoji("nothing-like-this")).toEqual([]);
  });
});
