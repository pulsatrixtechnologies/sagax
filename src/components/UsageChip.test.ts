import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageChip } from "./UsageChip";

const priced = {
  input: 12, output: 5, cachedInput: 2, costUsd: 0.01, turns: 1,
  lastTurn: { input: 12, output: 5, cachedInput: 2, costUsd: 0.01 },
};

describe("UsageChip", () => {
  it("shows the conversation cost and the last turn's tokens and cost", () => {
    const markup = renderToStaticMarkup(createElement(UsageChip, { usage: priced }));
    expect(markup).toContain('data-testid="usage-chip"');
    expect(markup).toContain("$0.01");
    expect(markup).toContain("Last message: 10 uncached input · 2 cached input · 5 output · $0.01");
  });

  it("keeps the last message line when that turn reported no dollars", () => {
    const markup = renderToStaticMarkup(createElement(UsageChip, {
      usage: { ...priced, lastTurn: { ...priced.lastTurn, costUsd: null } },
    }));
    expect(markup).toContain("$0.01");
    expect(markup).toContain("Last message: 10 uncached input · 2 cached input · 5 output");
    expect(markup).not.toContain("Last message: 10 uncached input · 2 cached input · 5 output ·");
  });

  it("renders nothing until a turn has a figure", () => {
    expect(renderToStaticMarkup(createElement(UsageChip, { usage: { input: 0, output: 0, costUsd: null, turns: 0 } }))).toBe("");
    expect(renderToStaticMarkup(createElement(UsageChip, {}))).toBe("");
  });
});
