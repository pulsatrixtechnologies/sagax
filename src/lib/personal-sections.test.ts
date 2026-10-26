// Sidebar sections are each person's own folders on an organization server
// (src/lib/personal-sections.ts): they share nothing.
import { describe, expect, it } from "vitest";

import { isUserPreferenceKey, MAX_PREFERENCE_VALUE } from "../../shared/user-preferences";
import { partitionSidebarGroups } from "./sidebar-layout";
import { buildTeamMapSections } from "./team-map";
import {
  EMPTY_PERSONAL_SECTIONS,
  PERSONAL_SECTIONS_KEY,
  assignToPersonalSection,
  createPersonalSection,
  deletePersonalSection,
  fitsPreference,
  itemKey,
  parsePersonalSections,
  personalSectionNames,
  personalSectionOf,
  renamePersonalSection,
  seedPersonalSections,
  serializePersonalSections,
  withPersonalSections,
  type PersonalSections,
  type SectionEditResult,
} from "./personal-sections";

const ok = (result: SectionEditResult): PersonalSections => {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result.prefs;
};

describe("personal sections: create, rename, reorder data, delete", () => {
  it("creates, renames and refuses General, duplicates and bad names", () => {
    let prefs = ok(createPersonalSection(EMPTY_PERSONAL_SECTIONS, " Ventes "));
    prefs = ok(createPersonalSection(prefs, "TEST"));
    expect(personalSectionNames(prefs)).toEqual(["Ventes", "TEST"]);
    expect(createPersonalSection(prefs, "Ventes")).toEqual({ ok: false, code: "exists" });
    for (const reserved of ["General", "général", "Sans section", "Unassigned", "Non assigné", "Não atribuído"]) expect(createPersonalSection(prefs, reserved)).toEqual({ ok: false, code: "reserved" });
    expect(createPersonalSection(prefs, "")).toEqual({ ok: false, code: "bad_name" });
    expect(createPersonalSection(prefs, "x".repeat(61))).toEqual({ ok: false, code: "bad_name" });
    prefs = ok(assignToPersonalSection(prefs, itemKey("bot", "b1"), "Ventes"));
    prefs = ok(renamePersonalSection(prefs, "Ventes", "Ventes QC"));
    expect(personalSectionOf(prefs, itemKey("bot", "b1"))).toBe("Ventes QC");
    expect(renamePersonalSection(prefs, "Ventes QC", "TEST")).toEqual({ ok: false, code: "exists" });
    expect(renamePersonalSection(prefs, "Nope", "Other")).toEqual({ ok: false, code: "missing" });
  });

  it("files an item in one section at a time; an empty name puts it back in Unassigned", () => {
    let prefs = ok(assignToPersonalSection(EMPTY_PERSONAL_SECTIONS, itemKey("bot", "b1"), "Ops"));
    prefs = ok(assignToPersonalSection(prefs, itemKey("group", "g1"), "Ops"));
    prefs = ok(assignToPersonalSection(prefs, itemKey("bot", "b1"), "Ventes"));
    expect(prefs.sections).toEqual([{ name: "Ops", items: ["group:g1"] }, { name: "Ventes", items: ["bot:b1"] }]);
    prefs = ok(assignToPersonalSection(prefs, itemKey("bot", "b1"), ""));
    expect(personalSectionOf(prefs, itemKey("bot", "b1"))).toBeUndefined();
    // the empty section stays: only Delete removes a section
    expect(personalSectionNames(prefs)).toEqual(["Ops", "Ventes"]);
  });

  it("delete moves the section's items back to Unassigned and deletes nothing else", () => {
    let prefs = ok(assignToPersonalSection(EMPTY_PERSONAL_SECTIONS, itemKey("bot", "b1"), "TEST"));
    prefs = ok(assignToPersonalSection(prefs, itemKey("group", "dm-bob"), "TEST"));
    type Row = { id: string; name: string; section?: string | undefined };
    const bots: Row[] = [{ id: "b1", name: "Ada" }, { id: "b2", name: "Bex" }];
    const groups: Row[] = [{ id: "dm-bob", name: "Bob" }];
    const after = deletePersonalSection(prefs, "TEST");
    expect(personalSectionNames(after)).toEqual([]);
    const view = withPersonalSections(bots, groups, after);
    expect(view.bots.map((bot) => [bot.id, bot.section])).toEqual([["b1", undefined], ["b2", undefined]]);
    expect(view.groups.map((group) => [group.id, group.section])).toEqual([["dm-bob", undefined]]);
  });

  it("round-trips through its preference and drops bad entries", () => {
    const prefs = ok(assignToPersonalSection(EMPTY_PERSONAL_SECTIONS, itemKey("bot", "b1"), "Ops"));
    expect(parsePersonalSections(serializePersonalSections(prefs))).toEqual(prefs);
    expect(parsePersonalSections(null)).toBeNull();
    expect(parsePersonalSections("{nope")).toBeNull();
    expect(parsePersonalSections(JSON.stringify({ sections: [
      { name: "General", items: ["bot:a"] },
      { name: "Ops", items: ["bot:a", "weird"] },
      { name: "Ops", items: ["bot:b"] },
      { name: "Two", items: ["bot:a", "group:g"] },
    ] }))).toEqual({ sections: [{ name: "Ops", items: ["bot:a"] }, { name: "Two", items: ["group:g"] }] });
  });

  it("stays within one preference value, pruning items that no longer exist", () => {
    let prefs: PersonalSections = { sections: [{ name: "Big", items: Array.from({ length: 400 }, (_, n) => `bot:gone-${String(n).padStart(30, "0")}`) }] };
    expect(fitsPreference(prefs)).toBe(false);
    expect(assignToPersonalSection(prefs, itemKey("bot", "new"), "Big")).toEqual({ ok: false, code: "full" });
    prefs = ok(assignToPersonalSection(prefs, itemKey("bot", "new"), "Big", new Set(["bot:new"])));
    expect(prefs.sections[0]!.items).toEqual(["bot:new"]);
    expect(serializePersonalSections(prefs).length).toBeLessThanOrEqual(MAX_PREFERENCE_VALUE);
  });
});

describe("personal sections are per person", () => {
  it("travel as the person's own preference (synced per person on an organization server)", () => {
    expect(PERSONAL_SECTIONS_KEY).toBe("sagax.sidebarSections.v1");
    expect(isUserPreferenceKey(PERSONAL_SECTIONS_KEY)).toBe(true);
  });

  it("the same bot sits in each viewer's own section, never in the owner's", () => {
    const bots = [{ id: "shared", name: "Shared", section: "Owner's Ops", ownerUserId: "pr_alice" }];
    const alice = ok(assignToPersonalSection(EMPTY_PERSONAL_SECTIONS, itemKey("bot", "shared"), "Owner's Ops"));
    const bob = ok(assignToPersonalSection(EMPTY_PERSONAL_SECTIONS, itemKey("bot", "shared"), "Mine"));
    expect(withPersonalSections(bots, [], alice).bots[0]!.section).toBe("Owner's Ops");
    expect(withPersonalSections(bots, [], bob).bots[0]!.section).toBe("Mine");
    expect(withPersonalSections(bots, [], EMPTY_PERSONAL_SECTIONS).bots[0]!.section).toBeUndefined();
  });

  it("the first value starts from the viewer's own bots and the rooms they see; shared bots start in General", () => {
    const seeded = seedPersonalSections({
      viewerId: "pr_bob",
      sections: ["Ventes", "Ops"],
      bots: [
        { id: "mine", section: "Ops", ownerUserId: "pr_bob" },
        { id: "local", section: "Ventes" },
        { id: "alice", section: "Alice private", ownerUserId: "pr_alice" },
        { id: "loose", ownerUserId: "pr_bob" },
      ],
      groups: [{ id: "room", section: "Ops" }, { id: "bot-dm", section: "Ops", dm: { a: 1 } }, { id: "dm-carol" }],
    });
    expect(seeded.sections).toEqual([
      { name: "Ventes", items: ["bot:local"] },
      { name: "Ops", items: ["bot:mine", "group:room"] },
    ]);
  });
});

describe("unassigned items are always visible", () => {
  it("own bots, bots shared with me, groups and conversations with people with no section of mine land in General", () => {
    const bots = [
      { id: "own", name: "Own", section: "Server section", ownerUserId: "pr_bob" },
      { id: "shared", name: "Shared", section: "Alice's section", ownerUserId: "pr_alice" },
      { id: "filed", name: "Filed", ownerUserId: "pr_bob" },
    ];
    const groups = [{ id: "room", name: "Room", section: "Old" }, { id: "dm-carol", name: "Carol", peopleDm: true }];
    const prefs = ok(assignToPersonalSection(ok(createPersonalSection(EMPTY_PERSONAL_SECTIONS, "TEST")), itemKey("bot", "filed"), "TEST"));
    const view = withPersonalSections(bots, groups, prefs);
    const teams = buildTeamMapSections(view.bots, personalSectionNames(prefs), { general: true });
    const general = teams.find((team) => team.key === "")!;
    expect(general.members.map((bot) => bot.id).sort()).toEqual(["own", "shared"]);
    expect(teams.find((team) => team.key === "TEST")!.members.map((bot) => bot.id)).toEqual(["filed"]);
    expect(partitionSidebarGroups(view.groups).unsectionedRooms.map((group) => group.id)).toEqual(["room", "dm-carol"]);
  });
});

describe("a room that arrives after the sections were set", () => {
  it("stays in the list (Unassigned) until the person files it", () => {
    const prefs = { sections: [{ name: "Work", items: [itemKey("group", "old")] }] };
    const view = withPersonalSections([], [{ id: "old", section: "General" }, { id: "bot-made", section: "General" }], prefs);
    expect(view.groups.map((group) => group.id)).toEqual(["old", "bot-made"]);
    expect(view.groups.find((group) => group.id === "old")!.section).toBe("Work");
    expect(view.groups.find((group) => group.id === "bot-made")!.section).toBeUndefined();
  });
});
