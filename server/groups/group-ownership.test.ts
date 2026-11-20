import { describe, expect, it } from "vitest";

import { groupOwnerId, groupPatchOwnerRefusal, isSelfLeave, mayDeleteGroup, ownsGroup, unlistedOwnRooms } from "./group-ownership.ts";

const owner = { id: "pr_owner", email: "owner@example.test", orgAdmin: false };
const member = { id: "pr_member", email: "member@example.test", orgAdmin: false };
const admin = { id: "pr_admin", email: "admin@example.test", orgAdmin: true };
const group = {
  createdBy: "pr_owner",
  humanIds: ["pr_owner", "pr_member", "team:01ABC"],
  name: "Ops",
  bulletin: "Be brief.",
  defaultResponder: { kind: "auto" },
  memberIds: ["bot_a"],
};

describe("group ownership", () => {
  it("is the creator, else the first person listed, else nobody (its admins)", () => {
    expect(groupOwnerId(group)).toBe("pr_owner");
    expect(groupOwnerId({ humanIds: ["team:01ABC", "Ada@Example.test", "pr_x"] })).toBe("ada@example.test");
    expect(groupOwnerId({ humanIds: [] })).toBeNull();
    expect(ownsGroup({ humanIds: [] }, admin)).toBe(true);
    expect(ownsGroup({ humanIds: [] }, member)).toBe(false);
    expect(ownsGroup({ humanIds: ["owner@example.test"] }, owner)).toBe(true);
  });

  it("refuses every settings change by someone else, admins included", () => {
    for (const patch of [
      { name: "Mine" },
      { bulletin: "" },
      { cwd: "/tmp" },
      { defaultResponder: { kind: "everyone" } },
      { memberIds: [] },
      { humanIds: ["pr_owner", "pr_member", "team:01ABC", "pr_new"] },
    ]) {
      expect(groupPatchOwnerRefusal(group, patch, member)).toMatch(/owner/);
      expect(groupPatchOwnerRefusal(group, patch, admin)).toMatch(/owner/);
      expect(groupPatchOwnerRefusal(group, patch, owner)).toBeNull();
    }
  });

  it("lets anyone mark, pin or resend unchanged values", () => {
    expect(groupPatchOwnerRefusal(group, { unread: false, pinnedMessageId: "m1" }, member)).toBeNull();
    expect(groupPatchOwnerRefusal(group, { name: " Ops ", bulletin: "Be brief.", defaultResponder: { kind: "auto" } }, member)).toBeNull();
  });

  it("lets a listed person leave, and only themselves", () => {
    expect(isSelfLeave(group, ["pr_owner", "team:01ABC"], member)).toBe(true);
    expect(groupPatchOwnerRefusal(group, { humanIds: ["pr_owner", "team:01ABC"] }, member)).toBeNull();
    expect(isSelfLeave(group, ["pr_member", "team:01ABC"], member)).toBe(false);
    expect(isSelfLeave(group, ["pr_owner", "team:01ABC", "pr_new"], member)).toBe(false);
    expect(groupPatchOwnerRefusal(group, { humanIds: ["pr_owner"] }, member)).toMatch(/owner/);
  });

  it("lets the owner or an organization admin delete", () => {
    expect(mayDeleteGroup(group, owner)).toBe(true);
    expect(mayDeleteGroup(group, admin)).toBe(true);
    expect(mayDeleteGroup(group, member)).toBe(false);
  });
  it("lets a member bring in or take out their own bots, never another's", () => {
    const owners: Record<string, string> = { bot_a: "pr_owner", bot_m: "pr_member", bot_m2: "pr_member" };
    const botOwner = (id: string) => owners[id];
    const withMine = { ...group, memberIds: ["bot_a", "bot_m"] };
    expect(groupPatchOwnerRefusal(group, { memberIds: ["bot_a", "bot_m"] }, member, botOwner)).toBeNull();
    expect(groupPatchOwnerRefusal(withMine, { memberIds: ["bot_a"] }, member, botOwner)).toBeNull();
    expect(groupPatchOwnerRefusal(withMine, { memberIds: ["bot_a", "bot_m", "bot_m2"] }, member, botOwner)).toBeNull();
    expect(groupPatchOwnerRefusal(withMine, { memberIds: ["bot_m"] }, member, botOwner)).toMatch(/owner/);
    expect(groupPatchOwnerRefusal(withMine, { memberIds: ["bot_m", "bot_a"] }, member, botOwner)).toMatch(/owner/);
    expect(groupPatchOwnerRefusal(withMine, { memberIds: [] }, owner, botOwner)).toBeNull();
    expect(groupPatchOwnerRefusal(withMine, { memberIds: ["bot_a"], name: "Mine" }, member, botOwner)).toMatch(/owner/);
  });
});

// #5152: the operator's own rooms that do not list them
describe("unlistedOwnRooms", () => {
  const owners: Record<string, string> = { "bot-local": "pr_local", "bot-ada": "pr_ada" };
  const botOwner = (botId: string) => owners[botId];
  const rooms = [
    { id: "made-here", createdBy: "PR_LOCAL", humanIds: [] as string[], memberIds: ["bot-local"] },
    { id: "made-here-with-ada", createdBy: "pr_local", humanIds: ["pr_ada"], memberIds: ["bot-local"] },
    { id: "made-here-for-a-team", createdBy: "pr_local", humanIds: ["team:T1"], memberIds: [] as string[] },
    { id: "before-the-org", memberIds: ["bot-local"] },
    { id: "before-the-org-empty", humanIds: [] as string[], memberIds: [] as string[] },
    { id: "already-listed", createdBy: "pr_local", humanIds: ["pr_local", "pr_ada"], memberIds: ["bot-local"] },
    { id: "ada-made-it", createdBy: "pr_ada", humanIds: [] as string[], memberIds: ["bot-local"] },
    { id: "lists-ada-first", humanIds: ["pr_ada"], memberIds: ["bot-local"] },
    { id: "nobody-with-ada-bot", memberIds: ["bot-local", "bot-ada"] },
    { id: "nobody-unknown-bot", memberIds: ["bot-gone"] },
    { id: "a-dm", createdBy: "pr_local", humanIds: [] as string[], peopleDm: true },
    { id: "archived", createdBy: "pr_local", humanIds: [] as string[], archivedAt: 1 },
  ];
  it("finds the person's rooms that do not list them, and no one else's", () => {
    expect(unlistedOwnRooms(rooms, "pr_local", botOwner).map((room) => room.id)).toEqual([
      "made-here", "made-here-with-ada", "made-here-for-a-team", "before-the-org", "before-the-org-empty",
    ]);
  });
  it("finds nothing for nobody", () => {
    expect(unlistedOwnRooms(rooms, " ", botOwner)).toEqual([]);
  });
});
