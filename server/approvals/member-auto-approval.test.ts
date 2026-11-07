// Automatic approval levels for members' bots (server/approvals/member-auto-approval.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { memberAutoApprovalAllowed, memberAutoChangeRefused, memberAutoLevelResets, memberAutoResetPending, memberAutoSettle, memberRoomTurnLevel, memberTurnLevel, type MemberAutoResetBot } from "./member-auto-approval.ts";

describe("memberAutoApprovalAllowed", () => {
  it("has no admin switch: a member's bot keeps Auto, a saved false is ignored (2026-10-26)", () => {
    expect(memberAutoApprovalAllowed(undefined)).toBe(true);
    expect(memberAutoApprovalAllowed({})).toBe(true);
    expect(memberAutoApprovalAllowed({ memberAutoApproval: true })).toBe(true);
    expect(memberAutoApprovalAllowed({ memberAutoApproval: false })).toBe(true);
  });
});

describe("memberTurnLevel", () => {
  it("runs Auto and Auto-accept edits as Ask while the organization does not allow them", () => {
    expect(memberTurnLevel("auto", false)).toBe("ask");
    expect(memberTurnLevel("edits", false)).toBe("ask");
    expect(memberTurnLevel("auto", true)).toBe("auto");
    expect(memberTurnLevel("edits", true)).toBe("edits");
  });

  it("leaves Ask, Full and Custom to their own rules", () => {
    for (const allowed of [true, false]) {
      expect(memberTurnLevel("ask", allowed)).toBe("ask");
      expect(memberTurnLevel("full", allowed)).toBe("full");
      expect(memberTurnLevel("custom", allowed)).toBe("custom");
    }
  });
});

describe("memberRoomTurnLevel (a Primary Bot's handoff in a room)", () => {
  it("never lifts a member's bot to Auto or Auto-accept edits while the organization turned them off", () => {
    expect(memberRoomTurnLevel("auto", false)).toBe("ask");
    expect(memberRoomTurnLevel("edits", false)).toBe("ask");
    expect(memberRoomTurnLevel("auto", true)).toBe("auto");
    expect(memberRoomTurnLevel("edits", true)).toBe("edits");
  });

  it("is what the server's room turns apply to a member's bot (index.ts delegatedLevel wiring)", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    // omb #3470: memberRoomTurnLevel rides createDelegatedLevel's roomTurn hook.
    expect(source).toMatch(/memberRoomTurnLevel:\s*\(level\)\s*=>\s*memberRoomTurnLevel\(level,\s*memberAutoApprovalAllowed\(cfg\.organization\)\)/);
    expect(source).toMatch(/function roomTurnApprovalMode\(/);
    expect(source).toMatch(/delegatedLevel\.roomTurn\(/);
  });

  it("the owner route of a member's bot runs as Approval while the setting is off (request.opened ownerModeForTurn autoAllowed)", () => {
    // #1388: the request.opened handler left index.ts for runtime-events/,
    // reading the server through its leaf host
    const source = readFileSync(new URL("../runtime-events/request-opened.ts", import.meta.url), "utf8");
    expect(source).toMatch(/autoAllowed: !\(host\.memberOwnedInOrg\(asker\) && !memberAutoApprovalAllowed\(host\.cfg\.organization\)\),/);
  });

  it("keeps Custom at Ask and leaves Ask and Full to their own rules", () => {
    for (const allowed of [true, false]) {
      expect(memberRoomTurnLevel("custom", allowed)).toBe("ask");
      expect(memberRoomTurnLevel("ask", allowed)).toBe("ask");
      expect(memberRoomTurnLevel("full", allowed)).toBe("full");
    }
  });
});

describe("memberAutoChangeRefused", () => {
  const base = { memberOwned: true, policyAllowed: false };

  it("refuses a member's bot moving to Auto or Auto-accept edits while the setting is off", () => {
    expect(memberAutoChangeRefused({ ...base, froms: ["ask"], to: "auto" })).toBe(true);
    expect(memberAutoChangeRefused({ ...base, froms: [undefined], to: "edits" })).toBe(true);
    expect(memberAutoChangeRefused({ ...base, froms: ["full"], to: "auto" })).toBe(true);
    expect(memberAutoChangeRefused({ ...base, froms: ["auto", "ask"], to: "auto" })).toBe(true);
  });

  it("lets the same level through (a profile resend), and Ask always", () => {
    expect(memberAutoChangeRefused({ ...base, froms: ["auto"], to: "auto" })).toBe(false);
    expect(memberAutoChangeRefused({ ...base, froms: ["auto"], to: "ask" })).toBe(false);
  });

  it("never refuses an admin's bot, or once the organization allows it", () => {
    expect(memberAutoChangeRefused({ ...base, memberOwned: false, froms: ["ask"], to: "auto" })).toBe(false);
    expect(memberAutoChangeRefused({ ...base, policyAllowed: true, froms: ["ask"], to: "auto" })).toBe(false);
  });

  it("leaves Full and Custom to their own refusals", () => {
    expect(memberAutoChangeRefused({ ...base, froms: ["ask"], to: "full" })).toBe(false);
    expect(memberAutoChangeRefused({ ...base, froms: ["ask"], to: "custom" })).toBe(false);
  });
});

describe("memberAutoLevelResets", () => {
  const bots: MemberAutoResetBot[] = [
    {
      id: "member", approvalMode: "auto", autoApprove: true,
      tasks: [
        { threadId: "m-auto", approvalMode: "auto", autoApprove: true },
        { threadId: "m-edits", approvalMode: "edits", autoApprove: false },
        { threadId: "m-ask", approvalMode: "ask", autoApprove: false },
        { threadId: "m-full", approvalMode: "full", autoApprove: false },
        { threadId: "m-legacy", autoApprove: true },
        { threadId: "m-inherits" },
      ],
    },
    { id: "member-edits", approvalMode: "edits", tasks: [] },
    { id: "member-legacy", autoApprove: true },
    { id: "member-ask", approvalMode: "ask", tasks: [{ threadId: "ma-custom", approvalMode: "custom" }] },
    { id: "admin", approvalMode: "auto", autoApprove: true, tasks: [{ threadId: "a-auto", approvalMode: "auto" }] },
  ];
  const memberOwned = (bot: MemberAutoResetBot) => bot.id !== "admin";

  it("names every saved automatic level of members' bots, and nothing else", () => {
    expect(memberAutoLevelResets(bots, memberOwned)).toEqual({
      bots: ["member", "member-edits", "member-legacy"],
      threads: [
        { botId: "member", threadId: "m-auto" },
        { botId: "member", threadId: "m-edits" },
        { botId: "member", threadId: "m-legacy" },
      ],
    });
  });

  it("is empty with no member's bot", () => {
    expect(memberAutoLevelResets(bots, () => false)).toEqual({ bots: [], threads: [] });
  });
});

describe("memberAutoResetPending", () => {
  it("never runs by default, nor while the setting is on", () => {
    expect(memberAutoResetPending("perspicax", undefined)).toBe(false);
    expect(memberAutoResetPending("perspicax", {})).toBe(false);
    expect(memberAutoResetPending("perspicax", { memberAutoApproval: true })).toBe(false);
  });

  it("never runs: the switch is gone (2026-10-26)", () => {
    expect(memberAutoResetPending("perspicax", { memberAutoApproval: false })).toBe(false);
    expect(memberAutoResetPending("perspicax", { memberAutoApproval: false, memberAutoResetAt: 1 })).toBe(false);
    expect(memberAutoResetPending("solo", { memberAutoApproval: false })).toBe(false);
  });
});

describe("memberAutoSettle (a demoted admin's bots, every start; 2026-10-17, follow-up of #696)", () => {
  const bots: MemberAutoResetBot[] = [
    // Dana was an admin and is now a member: her stored levels go
    { id: "dana-bot", approvalMode: "auto", tasks: [{ threadId: "d1", approvalMode: "edits" }, { threadId: "d2", approvalMode: "ask" }, { threadId: "d3" }] },
    // still an admin's: kept
    { id: "admin-bot", approvalMode: "auto", tasks: [{ threadId: "a1", approvalMode: "auto" }] },
    // legacy bit only
    { id: "dana-legacy", autoApprove: true },
  ];
  const members = new Set(["dana-bot", "dana-legacy"]);
  const memberOwned = (bot: MemberAutoResetBot) => members.has(bot.id);

  it("never sets a member's stored Auto back, even with a saved false (2026-10-26)", () => {
    expect(memberAutoSettle({ identity: "perspicax", organization: { memberAutoApproval: false }, bots, memberOwned })).toEqual({ bots: [], threads: [] });
  });

  it("does nothing while the organization allows them, by default, or on a solo server", () => {
    const none = { bots: [], threads: [] };
    expect(memberAutoSettle({ identity: "perspicax", organization: undefined, bots, memberOwned })).toEqual(none);
    expect(memberAutoSettle({ identity: "perspicax", organization: { memberAutoApproval: true }, bots, memberOwned })).toEqual(none);
    expect(memberAutoSettle({ identity: "solo", organization: { memberAutoApproval: false }, bots, memberOwned })).toEqual(none);
  });
});
