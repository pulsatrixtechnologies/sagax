import { describe, expect, it } from "vitest";

import {
  EMPTY_SECTION_PARENTS,
  MAX_SECTION_DEPTH,
  ancestorsOf,
  orderSectionTree,
  parentOf,
  parseSectionParents,
  removeFromSectionTree,
  renameInSectionTree,
  setSectionParent,
  type SectionParents,
} from "./section-tree";
import { buildTeamMapSections } from "./team-map";
import { partitionSidebarBots } from "./sidebar-layout";

const names = new Set(["Ops", "Support", "Night", "Sales"]);

function nest(tree: SectionParents, child: string, parent: string): SectionParents {
  const result = setSectionParent(tree, child, parent, names);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

describe("section tree (#2045)", () => {
  it("creates a sub-team, moves it to another parent and detaches it", () => {
    let tree = nest(EMPTY_SECTION_PARENTS, "Support", "Ops");
    expect(parentOf(tree, "Support", names)).toBe("Ops");
    expect(orderSectionTree(["Sales", "Support", "Ops"], tree)).toEqual([
      { name: "Sales", depth: 0 },
      { name: "Ops", depth: 0 },
      { name: "Support", depth: 1, parent: "Ops" },
    ]);
    tree = nest(tree, "Support", "Sales");
    expect(orderSectionTree(["Sales", "Support", "Ops"], tree)).toEqual([
      { name: "Sales", depth: 0 },
      { name: "Support", depth: 1, parent: "Sales" },
      { name: "Ops", depth: 0 },
    ]);
    const detached = setSectionParent(tree, "Support", "", names);
    expect(detached.ok && detached.value.parents).toEqual({});
  });

  it("refuses a team under itself, a loop and a missing parent", () => {
    const tree = nest(nest(EMPTY_SECTION_PARENTS, "Support", "Ops"), "Night", "Support");
    expect(setSectionParent(tree, "Ops", "Ops", names)).toEqual({ ok: false, code: "self" });
    expect(setSectionParent(tree, "Ops", "Night", names)).toEqual({ ok: false, code: "cycle" });
    expect(setSectionParent(tree, "Ops", "Gone", names)).toEqual({ ok: false, code: "missing" });
    expect(ancestorsOf(tree, "Night", names)).toEqual(["Support", "Ops"]);
  });

  it("caps the depth, counting the sub-teams that move along", () => {
    const deep = new Set(["A", "B", "C", "D", "E"]);
    let tree: SectionParents = EMPTY_SECTION_PARENTS;
    for (const [child, parent] of [["B", "A"], ["C", "B"], ["D", "C"]] as const) {
      const result = setSectionParent(tree, child, parent, deep);
      if (!result.ok) throw new Error(result.code);
      tree = result.value;
    }
    expect(MAX_SECTION_DEPTH).toBe(4);
    expect(setSectionParent(tree, "E", "D", deep)).toEqual({ ok: false, code: "depth" });
    const branch = setSectionParent({ parents: { B: "A", C: "B", E: "D" } }, "D", "C", deep);
    expect(branch).toEqual({ ok: false, code: "depth" });
  });

  it("follows a rename and hands a deleted team's sub-teams to its parent", () => {
    const tree = nest(nest(EMPTY_SECTION_PARENTS, "Support", "Ops"), "Night", "Support");
    expect(renameInSectionTree(tree, "Support", "Help").parents).toEqual({ Help: "Ops", Night: "Help" });
    expect(removeFromSectionTree(tree, "Support").parents).toEqual({ Night: "Ops" });
    expect(removeFromSectionTree(tree, "Ops").parents).toEqual({ Night: "Support" });
  });

  it("shows a team whose parent is gone at the top level and survives a loop on disk", () => {
    expect(orderSectionTree(["Night"], { parents: { Night: "Gone" } })).toEqual([{ name: "Night", depth: 0 }]);
    const looped = orderSectionTree(["Ops", "Support"], { parents: { Ops: "Support", Support: "Ops" } });
    expect(looped.map((row) => row.name).sort()).toEqual(["Ops", "Support"]);
    expect(parseSectionParents('{"parents":{"A":"A","B":"C"}}')).toEqual({ parents: { B: "C" } });
    expect(parseSectionParents("not json")).toBeNull();
  });
});

describe("Primary Bot per person (#2045)", () => {
  const bots = [
    { id: "mine", name: "Mine", section: "Ops", chiefOfStaff: true, ownerUserId: "person-a" },
    { id: "theirs", name: "Theirs", section: "Ops", chiefOfStaff: true, ownerUserId: "person-b" },
  ];

  it("heads a Team map team with the viewer's own Primary Bot only", () => {
    const [team] = buildTeamMapSections(bots, ["Ops"], { viewerId: "person-a" });
    expect(team!.chiefs.map((bot) => bot.id)).toEqual(["mine"]);
    expect(team!.members.map((bot) => bot.id)).toEqual(["theirs"]);
    const [solo] = buildTeamMapSections(bots, ["Ops"]);
    expect(solo!.chiefs).toHaveLength(2);
  });

  it("heads a sidebar section with the viewer's own Primary Bot only", () => {
    const parts = partitionSidebarBots(bots, { viewerId: "person-b" });
    expect(parts.sectionChiefs.map((bot) => bot.id)).toEqual(["theirs"]);
    expect(parts.sectionedBots.map((bot) => bot.id)).toEqual(["mine"]);
  });
});
