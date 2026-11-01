import { describe, expect, it } from "vitest";

import { approvalLevelPrompt, peerContactPrompt } from "./approval-level-prompt.ts";

describe("what a turn is told about its approval level (2026-10-28, #1819)", () => {
  it("Full access acts without asking: no card, no confirmation, no typed GO, no spurious ask_choice", () => {
    const text = approvalLevelPrompt("full");
    expect(text).toContain("Full access");
    expect(text).toMatch(/without asking first/);
    expect(text).toMatch(/Never ask the person to type GO/);
    // a plugin's or skill's "operator GO" is answered by the level itself
    expect(text).toMatch(/this approval level is that answer/);
    // only Sagax's own holds remain: Refuse, Ask first, allowed recipients
    expect(text).toMatch(/Refuse or Ask first/);
    expect(text).toMatch(/allowed recipients/);
    // it never tells the bot to wait for or ask for an approval
    expect(text).not.toMatch(/wait(?:s)? for the person's approval card/);
    expect(text).not.toMatch(/ask (?:the person )?(?:for )?(?:a )?confirmation before/i);
    expect(text).toMatch(/Do not pose ask_choice/);
    expect(text).toMatch(/never invent a second person gate/);
  });

  it("Approve for me acts on the request: no ask_choice for in-scope next steps", () => {
    const text = approvalLevelPrompt("auto");
    expect(text).toContain("Approve for me");
    expect(text).toMatch(/Do not pose ask_choice/);
    expect(text).toMatch(/already in scope of the person's last instruction/);
    expect(text).toMatch(/never invent a second person gate/);
    expect(text).toMatch(/real product decision the person did not authorize/);
    expect(text).toMatch(/Never ask the person to type GO/);
    expect(text).toMatch(/approval card/);
  });

  it("Auto-accept edits also skips spurious permission choices", () => {
    const text = approvalLevelPrompt("edits");
    expect(text).toContain("Auto-accept edits");
    expect(text).toMatch(/Do not pose ask_choice/);
    expect(text).toMatch(/Never ask the person to type GO/);
  });

  it("Ask still uses the card and does not add the Approve-for-me bypass wording", () => {
    const text = approvalLevelPrompt("ask");
    expect(text).toContain("Ask");
    expect(text).toMatch(/approval card/);
    expect(text).toMatch(/Never ask the person to type GO/);
    expect(text).not.toMatch(/Do not pose ask_choice/);
    expect(text).not.toContain("Full access");
    expect(text).not.toContain("Approve for me");
  });

  it("below Full Custom still uses the card, never a typed word", () => {
    const text = approvalLevelPrompt("custom");
    expect(text).toMatch(/approval card/);
    expect(text).toMatch(/Never ask the person to type GO/);
    expect(text).not.toContain("Full access");
    expect(text).not.toMatch(/Do not pose ask_choice/);
  });

  it("no level, no section; never a dash read as an em dash", () => {
    expect(approvalLevelPrompt(undefined)).toBe("");
    for (const level of ["ask", "edits", "auto", "full", "custom"] as const) expect(approvalLevelPrompt(level)).not.toMatch(/[–—]/);
  });
});

describe("ask-before-contacting-bots flag on the turn (#1819)", () => {
  it("off: contact teammates without asking the person", () => {
    const text = peerContactPrompt({ canContact: true, asksBeforeContact: false });
    expect(text).toMatch(/Ask before contacting bots: off/);
    expect(text).toMatch(/coordinate_bots/);
    expect(text).toMatch(/send_to_bot/);
    expect(text).toMatch(/post_to_room/);
    expect(text).toMatch(/immediately/);
    expect(text).toMatch(/Do not ask the person first/);
    expect(text).toMatch(/ask_choice/);
    // Coordinating turns replace ask_bot / delegate_bot.
    expect(text).not.toMatch(/\bask_bot\b/);
    expect(text).not.toMatch(/\bdelegate_bot\b/);
    expect(text).not.toMatch(/[–—]/);
  });

  it("on: Sagax shows its card; do not invent a second may-I", () => {
    const text = peerContactPrompt({ canContact: true, asksBeforeContact: true });
    expect(text).toMatch(/Ask before contacting bots: on/);
    expect(text).toMatch(/Sagax shows its own card/);
    expect(text).toMatch(/coordinate_bots/);
    expect(text).toMatch(/send_to_bot/);
    expect(text).toMatch(/Do not also ask the person/);
    expect(text).not.toMatch(/\bask_bot\b/);
    expect(text).not.toMatch(/\bdelegate_bot\b/);
    expect(text).not.toMatch(/immediately/);
    expect(text).not.toMatch(/[–—]/);
  });

  it("no contact capability, no section", () => {
    expect(peerContactPrompt({ canContact: false, asksBeforeContact: false })).toBe("");
    expect(peerContactPrompt({ canContact: false, asksBeforeContact: true })).toBe("");
  });
});
