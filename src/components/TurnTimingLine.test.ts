import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { TurnTimingLine, turnTimingLabel } from "./TurnTimingLine";
import { setShowTurnTiming } from "@/lib/turn-timing-preferences";

describe("TurnTimingLine", () => {
  afterEach(() => setShowTurnTiming(false));

  // 2026-10-28: a diagnostic, never part of the conversation by default
  it("shows nothing in the conversation unless the developer setting is on", () => {
    expect(renderToStaticMarkup(createElement(TurnTimingLine, { timing: { queueMs: 421900, firstResponseMs: 29779 } }))).toBe("");
  });

  it("with the developer setting on, shows the wait and the first text only when a number is there", () => {
    setShowTurnTiming(true);
    expect(renderToStaticMarkup(createElement(TurnTimingLine, {}))).toBe("");
    const markup = renderToStaticMarkup(createElement(TurnTimingLine, { timing: { queueMs: 40, firstResponseMs: 160 } }));
    expect(markup).toContain('data-turn-timing=""');
    expect(markup).toContain("Wait before send: 40 ms");
    expect(markup).toContain("First text: 160 ms");
    expect(markup).not.toContain("hello");
  });

  it("reads a turn from the send to the first word, where the time went and the total (#4215)", () => {
    expect(turnTimingLabel({ queueMs: 300, engineStartMs: 3_000, engineStart: "cold", firstResponseMs: 5_000, firstWordMs: 5_300, totalMs: 6_000 }))
      .toBe("Send to first word: 5300 ms · Wait before send: 300 ms · Engine start: 3000 ms · First text: 5000 ms · Total: 6000 ms");
    expect(turnTimingLabel({ queueMs: 10, engineStartMs: 5, engineStart: "warm" })).toBe("Wait before send: 10 ms · Warm engine: 5 ms");
  });

  it("words the counters the same way when shown", () => {
    expect(turnTimingLabel({ queueMs: 1 })).toBe("Wait before send: 1 ms");
    expect(turnTimingLabel(undefined)).toBeNull();
  });

  // #4215 review: the main number was drawn under the header's fade and the
  // wrapped rows began with a separator.
  it("shows each number as its own piece, main number first, with no separator to lead a wrapped row", () => {
    setShowTurnTiming(true);
    const markup = renderToStaticMarkup(createElement(TurnTimingLine, { timing: { queueMs: 2_140, engineStartMs: 6_480, engineStart: "cold", firstResponseMs: 9_020, firstWordMs: 11_160, totalMs: 12_900 } }));
    expect(markup).not.toContain("·");
    expect(markup).toContain("flex-wrap");
    const pieces = [...markup.matchAll(/<span class="([^"]*)">([^<]*)<\/span>/g)];
    expect(pieces.map((piece) => piece[2])).toEqual([
      "Send to first word: 11160 ms", "Wait before send: 2140 ms", "Engine start: 6480 ms", "First text: 9020 ms", "Total: 12900 ms",
    ]);
    expect(pieces.every((piece) => piece[1].includes("whitespace-nowrap"))).toBe(true);
    expect(pieces[0][1]).toContain("text-ink-secondary");
  });

  it("a bot conversation draws the line inside the banner stack, below the floating header and its fade", () => {
    const banners = readFileSync(new URL("./ChatView.tsx-parts/ChatViewBanners.tsx", import.meta.url), "utf8");
    const stack = banners.indexOf('<div className="chat-banners pt-[52px]');
    expect(stack).toBeGreaterThan(-1);
    expect(banners.indexOf("<TurnTimingLine")).toBeGreaterThan(stack);
  });
});
