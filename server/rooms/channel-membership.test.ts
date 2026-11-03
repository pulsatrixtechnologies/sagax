import { describe, expect, it } from "vitest";
import { applyHumanIds, canEditHumans, canPlaceBot, firstUnseenPerson, ownerUserIdForPlacement } from "./channel-membership.ts";

describe("channel membership", () => {
  it("refuses a human list on a bot-to-bot dm", () => {
    expect(applyHumanIds({ dm: true, humanIds: ["morgan@example.test"] })).toEqual({ ok: false, error: "dm-has-no-humans" });
  });
  it("lets only the bot owner place it", () => {
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId: "owner" })).toBe(false);
    expect(canPlaceBot({ actorId: "owner", ownerUserId: "owner" })).toBe(true);
  });
  it("lets an admin edit people and stops a member", () => {
    expect(canEditHumans("admin")).toBe(true);
    expect(canEditHumans("owner")).toBe(true);
    expect(canEditHumans("member")).toBe(false);
  });
  it("refuses an admin who is not the bot owner", () => {
    const ownerUserId = ownerUserIdForPlacement({
      recordedOwnerUserId: "owner",
      orgOwnerUserId: "ada@example.test",
      localOperatorId: "local-owner",
    });
    expect(ownerUserId).toBe("owner");
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "owner", ownerUserId })).toBe(true);
  });
  it("lets only the org owner place a bot that has no owner", () => {
    const ownerUserId = ownerUserIdForPlacement({
      orgOwnerUserId: "owner",
      localOperatorId: "local-owner",
    });
    expect(ownerUserId).toBe("owner");
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "morgan@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "local-owner", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "owner", ownerUserId })).toBe(true);
  });
  it("lets only the local operator place a bot before an organization exists", () => {
    const ownerUserId = ownerUserIdForPlacement({ localOperatorId: "local-owner" });
    expect(ownerUserId).toBe("local-owner");
    expect(canPlaceBot({ actorId: "morgan@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "local-owner", ownerUserId })).toBe(true);
  });
});

describe("firstUnseenPerson (#1061)", () => {
  const visible = (id: string) => id === "usr_bob";
  it("lets a member add a person the directory shows, and keep the room as is", () => {
    expect(firstUnseenPerson({ actorId: "usr_ann", before: ["usr_ann"], after: ["usr_ann", "usr_bob"], visible })).toBeNull();
    expect(firstUnseenPerson({ actorId: "usr_ann", before: ["usr_zed"], after: ["usr_zed"], visible })).toBeNull();
  });
  it("lets a member add a team of the organization to their own group (2026-10-26)", () => {
    expect(firstUnseenPerson({ actorId: "usr_ann", before: [], after: ["team:ops", "usr_bob"], visible })).toBeNull();
  });
  it("still refuses a person outside the directory", () => {
    expect(firstUnseenPerson({ actorId: "usr_ann", before: [], after: ["usr_eve"], visible })).toBe("usr_eve");
    expect(firstUnseenPerson({ actorId: "usr_ann", before: [], after: ["team:ops", "usr_eve"], visible })).toBe("usr_eve");
  });
});
