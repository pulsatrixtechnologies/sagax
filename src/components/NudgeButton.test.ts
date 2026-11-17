import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NudgeButton, NudgeButtonFace } from "./NudgeButton";

const html = (node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(node).replace(/&#x27;/g, "'");

describe("NudgeButton", () => {
  it("names the person and keeps the wait sentence off the idle control", () => {
    const markup = html(createElement(NudgeButton, { principalId: "pr_ada", name: "Ada" }));
    expect(markup).toContain('data-nudge="pr_ada"');
    expect(markup).toContain('aria-label="Nudge Ada"');
    expect(markup).toContain('title="Nudge Ada"');
    expect(markup).not.toContain("data-nudge-cooling");
    expect(markup).not.toContain("data-nudge-tooltip");
    expect(markup).not.toContain("Wait 4 min before nudging again.");
    expect(markup).not.toContain("Nudge sent");
  });

  it("grays the control and keeps the wait sentence in a hover tooltip", () => {
    const sentence = "Wait 4 min before nudging again.";
    const markup = html(createElement(NudgeButtonFace, {
      token: "pr_ada",
      cooling: true,
      busy: false,
      tooltip: sentence,
      tip: sentence,
      onClick: () => {},
    }));
    expect(markup).toContain('data-nudge-cooling=""');
    expect(markup).toContain("cursor-not-allowed");
    expect(markup).toContain("opacity-40");
    expect(markup).not.toMatch(/\sdisabled=/);
    const tip = markup.match(/<span id="nudge-tip-pr_ada"[^>]*>[^<]*<\/span>/)?.[0] ?? "";
    expect(tip).toContain('role="tooltip"');
    expect(tip).toContain("opacity-0");
    expect(tip).toContain("group-hover/tip:opacity-100");
    expect(tip).toContain(sentence);
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain("Nudge sent");
  });
});
