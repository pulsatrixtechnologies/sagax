import { describe, expect, it } from "vitest";

import { groupLeftFrameAllowed, groupLeftLine, listedInGroup, planGroupLeave } from "./group-leave.ts";

const bots = {
  owners: { mine: "p-ann", shared: "p-ann", theirs: "p-bob" } as Record<string, string>,
  sharedIds: new Set(["shared"]),
};
const deps = {
  ownerOf: (botId: string) => bots.owners[botId],
  shared: (botId: string) => bots.sharedIds.has(botId),
};
const ann = { id: "p-ann", email: "ann@example.test" };
const room = { createdBy: "p-own", humanIds: ["p-own", "p-ann", "p-bob"], memberIds: ["mine", "shared", "theirs"] };

describe("planGroupLeave (#1480)", () => {
  it("a member leaves: out of the people, their private bots with them, the owner stays", () => {
    const plan = planGroupLeave(room, ann, deps);
    expect(plan).toEqual({ ok: true, humanIds: ["p-own", "p-bob"], memberIds: ["shared", "theirs"], archive: false, removedBotIds: ["mine"] });
  });

  it("leaves under every id they are listed by (an older group lists the email)", () => {
    const plan = planGroupLeave({ ...room, humanIds: ["p-own", "ANN@example.test", "p-bob"] }, ann, deps);
    expect(plan.ok && plan.humanIds).toEqual(["p-own", "p-bob"]);
  });

  it("the owner leaving hands the group to the person listed longest", () => {
    const plan = planGroupLeave({ ...room, createdBy: "p-ann", humanIds: ["team:sales", "p-ann", "p-bob", "p-own"] }, ann, deps);
    expect(plan).toMatchObject({ ok: true, createdBy: "p-bob", archive: false, humanIds: ["team:sales", "p-bob", "p-own"] });
  });

  it("an older group with no createdBy: its first person is the owner", () => {
    const plan = planGroupLeave({ humanIds: ["p-ann", "p-bob"], memberIds: [] }, ann, deps);
    expect(plan).toMatchObject({ ok: true, createdBy: "p-bob" });
  });

  it("the last person leaving archives the group (a team left alone does not keep it)", () => {
    expect(planGroupLeave({ createdBy: "p-ann", humanIds: ["p-ann"], memberIds: ["theirs"] }, ann, deps)).toMatchObject({ ok: true, archive: true, humanIds: [] });
    expect(planGroupLeave({ createdBy: "p-ann", humanIds: ["p-ann", "team:sales"], memberIds: [] }, ann, deps)).toMatchObject({ ok: true, archive: true });
  });

  it("refuses someone not listed in their own name, a two-person or bot conversation, an archived group", () => {
    expect(planGroupLeave({ humanIds: ["p-own", "team:sales"], memberIds: [], createdBy: "p-own" }, ann, deps)).toMatchObject({ ok: false, status: 409, code: "not_listed" });
    expect(planGroupLeave({ ...room, peopleDm: true }, ann, deps)).toMatchObject({ ok: false, code: "not_a_group" });
    expect(planGroupLeave({ ...room, dm: true }, ann, deps)).toMatchObject({ ok: false, code: "not_a_group" });
    expect(planGroupLeave({ ...room, archivedAt: 1 }, ann, deps)).toMatchObject({ ok: false, code: "archived" });
  });

  it("the owner recorded by createdBy counts as listed even when absent from humanIds", () => {
    expect(listedInGroup({ createdBy: "p-ann", humanIds: ["p-bob"] }, ann)).toBe(true);
    expect(planGroupLeave({ createdBy: "p-ann", humanIds: ["p-bob"], memberIds: [] }, ann, deps)).toMatchObject({ ok: true, createdBy: "p-bob", humanIds: ["p-bob"] });
  });

  it("a re-invite is a plain add: the plan never blocks a later return", () => {
    const plan = planGroupLeave(room, ann, deps);
    if (!plan.ok) throw new Error("expected a plan");
    const back = { ...room, humanIds: [...plan.humanIds, "p-ann"], memberIds: plan.memberIds };
    expect(listedInGroup(back, ann)).toBe(true);
  });
});

describe("the line and the frame", () => {
  it("writes one neutral roster line with a fallback text", () => {
    expect(groupLeftLine("p-ann", "  Ann  ", 5)).toEqual({ role: "bot", kind: "roster", at: 5, text: "Ann left the group", roster: { event: "left", personId: "p-ann", name: "Ann" } });
    expect(groupLeftLine("p-ann", "", 5).roster.name).toBe("Someone");
  });

  it("the left frame reaches the person's own streams only", () => {
    expect(groupLeftFrameAllowed({ audience: "p-ann" }, "P-ANN", undefined)).toBe(true);
    expect(groupLeftFrameAllowed({ audience: "p-ann" }, "p-bob", undefined)).toBe(false);
    expect(groupLeftFrameAllowed({ audience: "p-ann" }, undefined, "p-ann")).toBe(true);
    expect(groupLeftFrameAllowed({}, "p-ann", undefined)).toBe(false);
  });
});
