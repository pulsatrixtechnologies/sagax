// 2026-10-28 (one source of truth): the line under Approval level says when
// the open conversation runs another level than the bot's setting, and why.
// #4200: a conversation holds no level of its own, so the line never offers
// "Use <level> here"; only Full access waiting for its confirmation keeps a button.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppliedLevelNote, appliedLevelLine } from "./AppliedLevelNote";

describe("AppliedLevelNote", () => {
  it("says the real level and why, with no per-conversation way back", () => {
    expect(appliedLevelLine({ mode: "ask", reason: "guest" })).toBe("This conversation runs at Ask for approval: someone else drives this conversation.");
    const html = renderToStaticMarkup(createElement(AppliedLevelNote, { setting: "full", applied: { mode: "ask", reason: "member-policy" }, onConfirmFull: () => {} }));
    expect(html).toContain('data-approval-applied="ask"');
    expect(html).not.toContain("here");
    expect(html).not.toContain("data-approval-applied-fix");
    const consent = renderToStaticMarkup(createElement(AppliedLevelNote, { setting: "full", applied: { mode: "ask", reason: "consent" }, onConfirmFull: () => {} }));
    expect(consent).toContain("Confirm Full access");
  });

  it("shows nothing when the conversation runs the setting", () => {
    expect(renderToStaticMarkup(createElement(AppliedLevelNote, { setting: "full", applied: { mode: "full", reason: "delegated" } }))).toBe("");
  });
});
