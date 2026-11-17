import { describe, expect, it } from "vitest";

import { CARD_BOX, CARD_GRID } from "./plugins-style";

describe("the one card grid of Yours and Discover", () => {
  it("stretches the cards of a row to one height with their content centred", () => {
    // a grid item stretches by default; a list item that only wraps a card is `display: contents`, so the card itself is the item
    expect(CARD_GRID).toContain("[&>li:not([data-item-row])]:contents");
    expect(CARD_GRID).not.toMatch(/items-(start|center)/);
    expect(CARD_BOX).toContain("items-center");
    expect(CARD_BOX).not.toContain("items-start");
  });
  it("is one column while a card would be narrower than a typical name needs", () => {
    expect(CARD_GRID).toContain("grid-cols-2");
    expect(CARD_GRID).toContain("*:@max-[760px]:col-span-full");
    // the card inside a transparent list item is the grid item: it follows the same rule
    expect(CARD_GRID).toContain("[&>li:not([data-item-row])>*]:@max-[760px]:col-span-full");
  });
});

describe("the Claude Code block on a solo installation", () => {
  it("is a group of the page: the shared heading, its one line under it, nothing drawn as a loose block", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { AccountsView } = await import("./AccountsView");
    const html = renderToStaticMarkup(createElement(AccountsView, { claudeCode: createElement("p", { className: "px-1" }, "Developer settings") }));
    expect(html).toContain("data-plugins-claude-code");
    expect(html).toMatch(/<h3 class="[^"]*text-\[14px\][^"]*font-medium[^"]*">/);
    expect(html).toContain("[&amp;_p]:!px-0");
    expect(html).not.toContain("mb-2 text-[13px] font-semibold");
  });
});
