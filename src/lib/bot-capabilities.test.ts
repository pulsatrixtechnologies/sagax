import { describe, expect, it } from "vitest";

import type { ConfigStatus } from "@/state/store";
import { canEditBotField, canSetBotHost, canStepPrimary, canTeachInBrowser, showBotArchive, showBotDelete, showBotRename, showBotVisibility, showServerSectionMove, viewerOwnsBot } from "./bot-capabilities";

const ZARA = "pr_00000000-0000-4000-8000-000000000002";
const member = {
  viewer: { operator: false, principalId: ZARA, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true },
} as ConfigStatus;
const own = { ownerUserId: ZARA };
const other = { ownerUserId: "pr_other" };

describe("canEditBotField", () => {
  it("opens a field on a bot the member owns when their profile includes its permission (2026-10-09)", () => {
    const granted = { viewer: { ...member.viewer!, permissions: ["bots.create", "bots.approvalLevel", "folders.botWorkingFolder"] } } as ConfigStatus;
    expect(canEditBotField(granted, own, "approvalMode")).toBe(true);
    expect(canEditBotField(granted, own, "cwd")).toBe(true);
    expect(canEditBotField(granted, own, "cloudBackend")).toBe(false);
    // never on someone else's bot, and never a field no permission opens
    expect(canEditBotField(granted, other, "approvalMode")).toBe(false);
    expect(canEditBotField(granted, own, "voice")).toBe(false);
  });

  it("opens a bot's parallel conversations, recovery and tool access to its owner with the permission (2026-10-15)", () => {
    const behaviour = { viewer: { ...member.viewer!, permissions: ["bots.create", "bots.behaviour"] } } as ConfigStatus;
    const tools = { viewer: { ...member.viewer!, permissions: ["bots.create", "bots.tools"] } } as ConfigStatus;
    for (const field of ["maxConcurrentThreads", "maxParallelPerPerson", "busySend", "automaticRecovery"]) {
      expect(canEditBotField(behaviour, own, field), field).toBe(true);
      expect(canEditBotField(behaviour, other, field), field).toBe(false);
      // 2026-10-26: every member holds bots.behaviour on their own bots
      expect(canEditBotField(member, own, field), field).toBe(true);
    }
    // the bot editor's Tool access follows the tools permission
    expect(canEditBotField(tools, own, "toolScope")).toBe(true);
    expect(canEditBotField(behaviour, own, "toolScope")).toBe(false);
  });

  it("lets a solo server, an admin and a missing viewer edit every field", () => {
    expect(canEditBotField(null, other, "cwd")).toBe(true);
    expect(canEditBotField({ viewer: { ...member.viewer!, role: "admin", operator: false } } as ConfigStatus, other, "approvalMode")).toBe(true);
    expect(canEditBotField({ viewer: { ...member.viewer!, operator: true, role: "owner" } } as ConfigStatus, other, "computer")).toBe(true);
  });

  it("lets an organization member edit member fields only on a bot they own", () => {
    expect(viewerOwnsBot(member, own)).toBe(true);
    expect(viewerOwnsBot(member, other)).toBe(false);
    for (const field of ["name", "soul", "notifications", "modelSelection", "avatarUrl", "color"]) {
      expect(canEditBotField(member, own, field), field).toBe(true);
    }
    // 2026-10-26 (owner): every setting of their own bot, without an admin
    // 2026-10-28 (#1098): and its working folder (the server still checks the path)
    for (const field of ["computer", "browser", "approvalMode", "proactiveMode", "mcpServers", "toolScope", "fallback", "memoryEnabled", "loopGuard", "chiefOfStaff", "hidden", "section", "visibility", "outbound", "approvePeerComms", "cwd"]) {
      expect(canEditBotField(member, own, field), field).toBe(true);
      expect(canEditBotField(member, other, field), field).toBe(false);
    }
    // what reaches past their own environment keeps its permission: the
    // server's cloud computer and shared browser profiles
    for (const field of ["cloudBackend", "autoStartVps", "browserProfile", "voice", "speakReplies"]) {
      expect(canEditBotField(member, own, field), field).toBe(false);
    }
  });

  it("lets a member who does not own the bot change only how it looks", () => {
    expect(canEditBotField(member, other, "color")).toBe(true);
    expect(canEditBotField(member, other, "mascotSkin")).toBe(true);
    expect(canEditBotField(member, other, "name")).toBe(false);
    expect(canEditBotField(member, other, "soul")).toBe(false);
  });

  it("treats a draft as the member's own bot, and a read-only person as unable to edit", () => {
    expect(canEditBotField(member, { ownerUserId: undefined }, "name", { draft: true })).toBe(true);
    expect(canEditBotField(member, { ownerUserId: undefined }, "approvalMode", { draft: true })).toBe(true);
    expect(canEditBotField(member, { ownerUserId: undefined }, "cwd", { draft: true })).toBe(true);
    const readOnly = { viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus;
    expect(canEditBotField(readOnly, own, "name")).toBe(false);
    expect(canEditBotField(readOnly, own, "color")).toBe(false);
  });
});

describe("where a bot runs", () => {
  it("lets the owner or an editor choose the computer, not another admin", () => {
    expect(canSetBotHost(member, own)).toBe(true);
    expect(canSetBotHost(member, other)).toBe(false);
    expect(canSetBotHost(member, { ...other, grants: [{ target: `user:${ZARA}`, level: "edit" }] })).toBe(true);
    expect(canSetBotHost({ viewer: { ...member.viewer!, role: "admin" } } as ConfigStatus, other)).toBe(false);
    expect(canSetBotHost(null, other)).toBe(true);
    const readOnly = { viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus;
    expect(canSetBotHost(readOnly, own)).toBe(false);
  });
});

describe("sidebar actions a member may not see", () => {
  const admin = { viewer: { ...member.viewer!, role: "admin" } } as ConfigStatus;
  const readOnly = { viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus;

  it("hides rename for a member who does not own the bot", () => {
    expect(showBotRename(member, own)).toBe(true);
    expect(showBotRename(member, other)).toBe(false);
    expect(showBotRename(admin, other)).toBe(true);
    expect(showBotRename(readOnly, own)).toBe(false);
  });

  it("lets a member archive their own bot, never someone else's (2026-10-26)", () => {
    expect(showBotArchive(member, own)).toBe(true);
    expect(showBotArchive(member, other)).toBe(false);
    expect(showBotArchive(readOnly, own)).toBe(false);
    expect(showBotArchive(admin, other)).toBe(true);
    expect(showBotArchive(null, other)).toBe(true);
  });

  it("hides delete unless the member owns the bot, and always for a read-only person", () => {
    expect(showBotDelete(member, own)).toBe(true);
    expect(showBotDelete(member, other)).toBe(false);
    expect(showBotDelete(readOnly, own)).toBe(false);
    expect(showBotDelete(admin, other)).toBe(true);
  });

  it("lets a member move their own bots between server sections, never someone else's (2026-10-26)", () => {
    expect(showServerSectionMove(member, true)).toBe(true);
    expect(showServerSectionMove(member, false, [own])).toBe(true);
    expect(showServerSectionMove(member, false, [own, other])).toBe(false);
    expect(showServerSectionMove(member, false)).toBe(false);
    expect(showServerSectionMove(admin, false)).toBe(true);
  });
});

describe("canStepPrimary", () => {
  it("keeps the switch for the owner, on a member's own draft too, never on someone else's bot", () => {
    expect(canStepPrimary(null, other)).toBe(true);
    expect(canStepPrimary(member, own)).toBe(true);
    expect(canStepPrimary(member, other)).toBe(false);
    expect(canStepPrimary(member, own, { draft: true })).toBe(true);
    expect(canStepPrimary({ viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus, own)).toBe(false);
  });
});

describe("canTeachInBrowser", () => {
  it("lets an organization member teach in the browser of a bot they own, never another person's (2026-10-26)", () => {
    expect(canTeachInBrowser(member, own, false)).toBe(true);
    expect(canTeachInBrowser(member, own, null)).toBe(true);
    expect(canTeachInBrowser(member, other, false)).toBe(false);
    const readOnly = { viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus;
    expect(canTeachInBrowser(readOnly, own, false)).toBe(false);
  });

  it("keeps the owner on this machine and an admin session, and a solo chat-only session out", () => {
    expect(canTeachInBrowser(null, other, true)).toBe(true);
    expect(canTeachInBrowser(member, other, true)).toBe(true);
    expect(canTeachInBrowser(null, own, false)).toBe(false);
  });
});

describe("showBotVisibility (#1098)", () => {
  const served = { served: true, ownerOrAdmin: false, perspicaxOrg: false };
  it("opens who can see a bot to its owner, not only to an admin", () => {
    expect(showBotVisibility(member, own, served)).toBe(true);
    expect(showBotVisibility(member, other, served)).toBe(false);
    expect(showBotVisibility(member, other, { ...served, ownerOrAdmin: true })).toBe(true);
  });
  it("stays off the desktop and an organization server, which shares through grants", () => {
    expect(showBotVisibility(member, own, { ...served, served: false })).toBe(false);
    expect(showBotVisibility(member, own, { ...served, ownerOrAdmin: true, perspicaxOrg: true })).toBe(false);
  });
});
