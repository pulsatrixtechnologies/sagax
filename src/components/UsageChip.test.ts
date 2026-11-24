import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageChip } from "./UsageChip";

const priced = {
  input: 12, output: 5, cachedInput: 2, costUsd: 0.01, turns: 1,
  lastTurn: { input: 12, output: 5, cachedInput: 2, costUsd: 0.01 },
};

describe("UsageChip", () => {
  // #5224: the header never shows a dollar figure; the exact cost stays in
  // Settings > Usage and in the bot's Activity > Usage.
  it("shows the conversation's tokens, never its dollar cost, with the last turn's tokens", () => {
    const markup = renderToStaticMarkup(createElement(UsageChip, { usage: priced }));
    expect(markup).toContain('data-testid="usage-chip"');
    expect(markup).not.toContain("$");
    expect(markup).toContain(">10 uncached<");
    expect(markup).toContain('aria-label="10 uncached for this conversation"');
    expect(markup).toContain("Last message: 10 uncached input · 2 cached input · 5 output");
    expect(markup).not.toContain("Last message: 10 uncached input · 2 cached input · 5 output ·");
  });

  it("reads the same whether the engine reported dollars or not", () => {
    const unpriced = { ...priced, costUsd: null, lastTurn: { ...priced.lastTurn, costUsd: null } };
    expect(renderToStaticMarkup(createElement(UsageChip, { usage: priced })))
      .toBe(renderToStaticMarkup(createElement(UsageChip, { usage: unpriced })));
    const large = { input: 52_000, output: 900, costUsd: 2.53, turns: 9 };
    const markup = renderToStaticMarkup(createElement(UsageChip, { usage: large }));
    expect(markup).not.toContain("2.53");
    expect(markup).toContain(">52k input<");
  });

  it("renders nothing until a turn has a figure", () => {
    expect(renderToStaticMarkup(createElement(UsageChip, { usage: { input: 0, output: 0, costUsd: null, turns: 0 } }))).toBe("");
    expect(renderToStaticMarkup(createElement(UsageChip, {}))).toBe("");
  });
});
