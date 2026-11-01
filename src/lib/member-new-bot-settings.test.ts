import { describe, expect, it } from "vitest";
import type { ConfigStatus } from "@/state/store";
import { memberNewBotFields, memberNewBotSettings } from "./member-new-bot-settings";

const member = (permissions: string[]) => ({ viewer: { operator: false, role: "member", permissions } }) as unknown as ConfigStatus;

describe("quick New bot settings for an organization member (#1076)", () => {
  it("offers nothing to a member without the permission", () => {
    const config = member(["bots.create"]);
    expect(memberNewBotFields(config)).toEqual({ approvalMode: false, proactiveMode: false });
    expect(memberNewBotSettings(config, { approvalMode: "auto", proactiveMode: "off" })).toEqual({});
  });

  it("offers and keeps approval level and proactive mode with bots.approvalLevel", () => {
    const config = member(["bots.create", "bots.approvalLevel"]);
    expect(memberNewBotFields(config)).toEqual({ approvalMode: true, proactiveMode: true });
    expect(memberNewBotSettings(config, { approvalMode: "ask", proactiveMode: "off" })).toEqual({ approvalMode: "ask", proactiveMode: "off" });
  });

  it("sends only what was chosen", () => {
    expect(memberNewBotSettings(member(["bots.create", "bots.approvalLevel"]), {})).toEqual({});
  });

  it("an admin or solo viewer is not limited (full form)", () => {
    expect(memberNewBotFields(null)).toEqual({ approvalMode: true, proactiveMode: true });
  });
});
