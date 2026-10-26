import { describe, expect, it } from "vitest";

import type { ConfigStatus } from "@/state/store";
import { canEditConfig, canManageBackups, canManageComputers, canViewUsage, otherAuthorName, viewerActorId, viewerBotsReadOnly, viewerCan, viewerCanCreateBots, viewerIsOrgMember } from "./viewer";

const ZARA = "pr_00000000-0000-4000-8000-000000000002";
const member = { viewer: { operator: false, principalId: ZARA, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true, operatorName: "JC" } } as ConfigStatus;
const operator = { viewer: { operator: true, principalId: "pr_local", email: "jc@example.com", name: "JC", role: "owner", canCreateBots: true } } as ConfigStatus;

describe("viewerCan (2026-10-09)", () => {
  it("reads the server's list, else the member defaults for a member, else everything", () => {
    expect(viewerCan({ viewer: { ...member.viewer!, permissions: ["usage.view"] } } as ConfigStatus, "usage.view")).toBe(true);
    expect(viewerCan({ viewer: { ...member.viewer!, permissions: ["usage.view", "server.link"] } } as ConfigStatus, "server.link")).toBe(false);
    expect(viewerCan({ viewer: { ...member.viewer!, permissions: [] as string[] } } as ConfigStatus, "bots.create")).toBe(false);
    // an older server sends no list: a member holds the defaults
    expect(viewerCan(member, "bots.create")).toBe(true);
    expect(viewerCan(member, "usage.view")).toBe(false);
    expect(viewerCan(operator, "host.shell")).toBe(true);
    expect(viewerCan(null, "engines.manage")).toBe(true);
  });
});

describe("viewer", () => {
  it("uses the server's principal, else the profile email, else local-owner", () => {
    expect(viewerActorId(member)).toBe(ZARA);
    expect(viewerActorId({ profile: { name: "JC", email: "JC@example.com" } } as ConfigStatus)).toBe("jc@example.com");
    expect(viewerActorId(null)).toBe("local-owner");
  });

  it("reads a read-only person and an organization member from the server's viewer", () => {
    expect(viewerBotsReadOnly(member)).toBe(false);
    expect(viewerBotsReadOnly({ viewer: { ...member.viewer!, canCreateBots: false, botsReadOnly: true } } as ConfigStatus)).toBe(true);
    expect(viewerBotsReadOnly(undefined)).toBe(false);
    expect(viewerIsOrgMember(member)).toBe(true);
    expect(viewerIsOrgMember(operator)).toBe(false);
    expect(viewerIsOrgMember(null)).toBe(false);
  });

  it("hides installation writes from a member and keeps them for everyone else", () => {
    expect(canEditConfig(member)).toBe(false);
    expect(canManageComputers(member)).toBe(false);
    expect(canViewUsage(member)).toBe(false);
    expect(canManageBackups(member)).toBe(false);
    expect(canEditConfig(operator)).toBe(true);
    expect(canEditConfig(null)).toBe(true);
    expect(canEditConfig({ viewer: { ...member.viewer!, role: "admin", capabilities: { editConfig: true, manageKeys: true, manageComputers: true, viewUsage: true, manageBackups: true, pairDevices: true } } } as ConfigStatus)).toBe(true);
    expect(canEditConfig({ viewer: { ...member.viewer!, capabilities: { editConfig: false, manageKeys: false, manageComputers: false, viewUsage: false, manageBackups: false, pairDevices: true } } } as ConfigStatus)).toBe(false);
  });

  it("offers New bot on the server's word, and by default for older servers", () => {
    expect(viewerCanCreateBots(member)).toBe(true);
    expect(viewerCanCreateBots({ viewer: { ...member.viewer!, canCreateBots: false } } as ConfigStatus)).toBe(false);
    expect(viewerCanCreateBots(undefined)).toBe(true);
  });

  it("names another person's line and leaves your own unnamed", () => {
    const fromZara = { role: "user" as const, sender: { name: "zara@example.test", id: ZARA } };
    const fromOperator = { role: "user" as const };
    expect(otherAuthorName(fromZara, member)).toBeNull();
    expect(otherAuthorName(fromOperator, member)).toBe("JC");
    expect(otherAuthorName(fromZara, operator)).toBe("zara@example.test");
    expect(otherAuthorName(fromOperator, operator)).toBeNull();
    expect(otherAuthorName({ role: "bot" }, member)).toBeNull();
    expect(otherAuthorName(fromZara, null)).toBeNull();
  });

  it("the line this app is still sending is the viewer's own, even for a member", () => {
    const sending = { id: "optimistic-s1", role: "user" as const };
    expect(otherAuthorName(sending, member)).toBeNull();
    expect(otherAuthorName(sending, operator)).toBeNull();
    // a stored line without a sender is still the operator's for a member
    expect(otherAuthorName({ id: "m1", role: "user" as const }, member)).toBe("JC");
  });
});
