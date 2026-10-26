import { describe, expect, it } from "vitest";

import { orgServerExecRouting, webhookExecTargetAdminOnly, workplaceIsBotComputer } from "./exec-target.ts";

describe("orgServerExecRouting", () => {
  it("defaults a non-admin's command to the bot's own computer when it has one", () => {
    expect(orgServerExecRouting({ callerMayDriveOrgServer: false, botHasOwnComputer: true })).toBe("use-bot-computer");
  });

  it("refuses a non-admin's command when the bot has no computer, instead of falling back to the server", () => {
    expect(orgServerExecRouting({ callerMayDriveOrgServer: false, botHasOwnComputer: false })).toBe("no-computer");
  });

  it("keeps the admin 'runs on the server' card when an admin drives the turn, even without a bot computer", () => {
    expect(orgServerExecRouting({ callerMayDriveOrgServer: true, botHasOwnComputer: false })).toBe("admin-card");
    expect(orgServerExecRouting({ callerMayDriveOrgServer: true, botHasOwnComputer: true })).toBe("admin-card");
  });
});

describe("workplaceIsBotComputer", () => {
  it("counts the owner's server environment and own computer as the bot's computer", () => {
    expect(workplaceIsBotComputer("user-sandbox")).toBe(true);
    expect(workplaceIsBotComputer("user-desktop")).toBe(true);
  });

  it("does not count the shared host, nothing mounted, or an absent target", () => {
    expect(workplaceIsBotComputer("host")).toBe(false);
    expect(workplaceIsBotComputer("none")).toBe(false);
    expect(workplaceIsBotComputer(undefined)).toBe(false);
  });
});

describe("webhookExecTargetAdminOnly", () => {
  it("lets the owner create a webhook on the bot's own computer without the server-settings right", () => {
    expect(webhookExecTargetAdminOnly("maus")).toBe(false);
    expect(webhookExecTargetAdminOnly("cloud")).toBe(false);
    expect(webhookExecTargetAdminOnly(undefined)).toBe(false);
    expect(webhookExecTargetAdminOnly("")).toBe(false);
    expect(webhookExecTargetAdminOnly("MAUS")).toBe(false);
  });

  it("requires admin only for a target on the shared organization server", () => {
    expect(webhookExecTargetAdminOnly("server")).toBe(true);
    expect(webhookExecTargetAdminOnly("org-server")).toBe(true);
  });
});
