import { describe, expect, it } from "vitest";

import type { ConfigStatus, Group } from "@/state/store";
import { canLeaveGroup, leaveOutcome, viewerListedInGroup } from "./group-leave";

const me = { viewer: { principalId: "pr_me", email: "me@example.test" } } as unknown as ConfigStatus;
const group = (over: Partial<Group>): Pick<Group, "ownerId" | "humanIds" | "dm" | "peopleDm"> => ({ ownerId: "pr_boss", humanIds: ["pr_boss", "pr_me"], ...over });

describe("leaving a group (#1480, #2119)", () => {
  it("a person listed in their own name may leave, owner included when others remain", () => {
    expect(canLeaveGroup(group({}), me)).toBe(true);
    expect(canLeaveGroup(group({ ownerId: "pr_me", humanIds: ["pr_me", "pr_bob"] }), me)).toBe(true);
    expect(viewerListedInGroup(group({ ownerId: "pr_me", humanIds: ["pr_bob"] }), me)).toBe(true);
    expect(viewerListedInGroup(group({ humanIds: ["pr_boss", "ME@example.test"] }), me)).toBe(true);
  });

  it("not through a team, not on a solo server, not a conversation, not from a remote client", () => {
    expect(canLeaveGroup(group({ humanIds: ["pr_boss", "team:ops"] }), me)).toBe(false);
    expect(canLeaveGroup(group({ ownerId: undefined }), me)).toBe(false);
    expect(canLeaveGroup(group({ peopleDm: true }), me)).toBe(false);
    expect(canLeaveGroup(group({ dm: true }), me)).toBe(false);
    expect(canLeaveGroup(group({}), me, true)).toBe(false);
  });

  it("the sole remaining person cannot leave (bots and teams do not count)", () => {
    expect(canLeaveGroup(group({ ownerId: "pr_me", humanIds: ["pr_me"] }), me)).toBe(false);
    expect(canLeaveGroup(group({ ownerId: "pr_me", humanIds: ["pr_me", "team:ops"] }), me)).toBe(false);
    expect(leaveOutcome(group({ ownerId: "pr_me", humanIds: ["pr_me"] }), me)).toBe("last");
  });

  it("says what leaving does: a member, the owner handing it on, or sole-member (leave refused)", () => {
    expect(leaveOutcome(group({}), me)).toBe("member");
    expect(leaveOutcome(group({ ownerId: "pr_me", humanIds: ["pr_me", "pr_bob"] }), me)).toBe("owner");
    expect(leaveOutcome(group({ ownerId: "pr_me", humanIds: ["pr_me", "team:ops"] }), me)).toBe("last");
  });
});
