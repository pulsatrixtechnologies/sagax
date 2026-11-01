// 2026-10-28 (one source of truth): the line under Approval level says when
// the open conversation runs another level than the bot's setting, and why.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppliedLevelNote, appliedLevelLine } from "./AppliedLevelNote";

describe("AppliedLevelNote", () => {
  it("says the real level and why, and offers the way back where there is one", () => {
    expect(appliedLevelLine({ mode: "ask", reason: "engine" })).toBe("This conversation runs at Ask for approval: an engine change asked again in this conversation.");
    const html = renderToStaticMarkup(createElement(AppliedLevelNote, { setting: "full", applied: { mode: "ask", reason: "thread" }, onUseSetting: () => {} }));
    expect(html).toContain('data-approval-applied="ask"');
    expect(html).toContain("Use Full access here");
    const consent = renderToStaticMarkup(createElement(AppliedLevelNote, { setting: "full", applied: { mode: "ask", reason: "consent" }, onUseSetting: () => {} }));
    expect(consent).toContain("Confirm Full access");
    const policy = renderToStaticMarkup(createElement(AppliedLevelNote, { setting: "auto", applied: { mode: "ask", reason: "member-policy" }, onUseSetting: () => {} }));
    expect(policy).not.toContain("data-approval-applied-fix");
  });

  it("shows nothing when the conversation runs the setting", () => {
    expect(renderToStaticMarkup(createElement(AppliedLevelNote, { setting: "full", applied: { mode: "full", reason: "thread" } }))).toBe("");
  });
});
