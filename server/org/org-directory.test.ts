import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS, acceptInvite, inviteStatus, roleOf, type OrgInvite } from "./org-directory.ts";

const invite = (over: Partial<OrgInvite> = {}): OrgInvite => ({
  token: "tok",
  email: "morgan@example.test",
  createdAt: 0,
  expiresAt: INVITE_TTL_MS,
  ...over,
});

describe("inviteStatus", () => {
  it("treats the exact expiry instant as expired", () => {
    expect(inviteStatus(invite(), INVITE_TTL_MS)).toBe("expired");
  });
  it("reports used even after expiry", () => {
    expect(inviteStatus(invite({ usedAt: 10 }), INVITE_TTL_MS + 1)).toBe("used");
  });
  it("reports revoked above used and expired", () => {
    expect(inviteStatus(invite({ usedAt: 10, revokedAt: 11 }), 12)).toBe("revoked");
  });
});

describe("acceptInvite", () => {
  it("marks a token used once and refuses the second presentation", () => {
    const first = acceptInvite(invite(), 1_000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = acceptInvite(first.invite, 2_000);
    expect(second).toEqual({ ok: false, status: "used" });
  });
});

describe("roleOf", () => {
  it("gives the creator owner and keeps admins distinct from members", () => {
    const lists = { ownerUserId: "owner", admins: ["owner", "ada@example.test"], members: ["morgan@example.test"] };
    expect(roleOf({ ...lists, userId: "owner" })).toBe("owner");
    expect(roleOf({ ...lists, userId: "ada@example.test" })).toBe("admin");
    expect(roleOf({ ...lists, userId: "morgan@example.test" })).toBe("member");
    expect(roleOf({ ...lists, userId: "stranger" })).toBeNull();
  });
});

describe("roles by principal", () => {
  const lists = { ownerUserId: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", admins: ["ana@example.com"], members: ["morgan@example.com", "@client.com"] };
  it("finds the owner by principal id and others by email", () => {
    expect(roleOf({ ...lists, userId: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).toBe("owner");
    expect(roleOf({ ...lists, userId: "pr_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "Ana@example.com" })).toBe("admin");
    expect(roleOf({ ...lists, userId: "pr_cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "morgan@example.com" })).toBe("member");
    expect(roleOf({ ...lists, userId: "pr_dddddddd-dddd-4ddd-8ddd-dddddddddddd", email: "stranger@example.com" })).toBeNull();
  });
  it("never makes someone owner because of their email", () => {
    expect(roleOf({ ...lists, ownerUserId: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: "pr_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", email: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).toBeNull();
  });
});
