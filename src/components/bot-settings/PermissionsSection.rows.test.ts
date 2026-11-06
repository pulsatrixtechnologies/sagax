import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Email drafts row once used the bare SwitchRow, which has no row
// padding or help button, so it sat against the card edge. Every row of
// the Approvals card is a DescribedRow with the shared Switch.
describe("PermissionsSection approvals rows", () => {
  const source = readFileSync(new URL("./PermissionsSection.tsx", import.meta.url), "utf8");
  const drafts = source.slice(source.indexOf("{showDrafts && ("), source.indexOf("{showHooks &&"));

  it("draws Email drafts as a DescribedRow with a help tip and the shared Switch", () => {
    expect(drafts).toContain("<DescribedRow");
    expect(drafts).toContain("help={t(\"botPanel.emailDrafts.help\")}");
    expect(drafts).toContain("<Switch");
    expect(drafts).not.toContain("<SwitchRow");
  });
});

// #1674: Edit N bots on an organization server offers Full as Edit bot does
// (no desktop channel there); the server decides each bot at Apply, and the
// level stays each bot's own change, never the organization grant of the draft.
describe("PermissionsSection Full in Edit N bots", () => {
  const source = readFileSync(new URL("./PermissionsSection.tsx", import.meta.url), "utf8");
  it("reads the organization's Full rule for the bulk draft, and keeps the level as the bulk change", () => {
    expect(source).toContain("const orgFullAccess = draft && !bulk ? undefined : orgFullAccessFor(perspicaxOrg, bot, viewerId);");
    expect(source).toContain("if (orgFullAccess !== undefined && !bulk) {");
  });
  it("lists Full when the organization allows it, without a desktop channel", async () => {
    const { approvalModeOptionsFor } = await import("../ApprovalModeSelector");
    expect(approvalModeOptionsFor("claudeAgent", false, "allowed").map((option) => option.mode)).toContain("full");
    // omb #2701: Full is available from any client on a solo server too
    expect(approvalModeOptionsFor("claudeAgent", false, undefined).map((option) => option.mode)).toContain("full");
  });
});
