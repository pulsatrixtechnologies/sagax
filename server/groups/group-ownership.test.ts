import { describe, expect, it } from "vitest";

import { groupOwnerId, groupPatchOwnerRefusal, isSelfLeave, mayDeleteGroup, ownsGroup } from "./group-ownership.ts";

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
