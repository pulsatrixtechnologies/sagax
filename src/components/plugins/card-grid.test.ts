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
  });
});
