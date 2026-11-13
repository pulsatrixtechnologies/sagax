import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ATTACHMENT_FIRST_SET, AttachmentGallery } from "./AttachmentGallery";

// #4205: a message carrying 300 pictures, 250 of them unreachable.
const images = Array.from({ length: 300 }, (_, index) => `/store/${index < 50 ? "ok" : "gone"}-${index}.png`);
const message = { threadId: "t", messageId: "m" };

function render(beneath: boolean, list = images) {
  return renderToStaticMarkup(createElement(AttachmentGallery, { images: list, message, eager: true, beneath }));
}

describe("a message with hundreds of pictures (#4205)", () => {
  for (const beneath of [false, true]) {
    it(`fills the first set with pictures and one +N more tile${beneath ? " under a reply" : ""}`, () => {
      const html = render(beneath);
      expect(ATTACHMENT_FIRST_SET).toBe(4);
      // the tile takes the last slot of the set: 3 pictures + the tile
      expect(html.match(/<img /g) ?? []).toHaveLength(ATTACHMENT_FIRST_SET - 1);
      expect(html).toContain("ok-2.png");
      expect(html).not.toContain("ok-3.png");
      // one control opens the rest: the tile, never a second chip or button
      expect(html.match(/aria-expanded="false"/g) ?? []).toHaveLength(1);
      expect(html).toContain('aria-label="Show 297 more"');
      expect(html).toContain("+297 more");
      expect(html).not.toContain("Show less");
    });
  }

  it("keeps the pictures and the tile on one row under a reply, whatever the bubble width", () => {
    const html = render(true);
    // equal slots that narrow with the bubble, never a wrapping row
    expect(html).toContain("grid-template-columns:repeat(4, minmax(0, 8rem))");
    expect(html).not.toMatch(/flex max-w-full flex-wrap gap-2/);
  });

  it("shows exactly four pictures, no tile, when there are four", () => {
    const html = render(true, images.slice(0, 4));
    expect(html.match(/<img /g) ?? []).toHaveLength(4);
    expect(html).not.toContain("more");
  });

  it("asks for the first set at once and nothing past it", () => {
    const html = render(false);
    expect(html.match(/loading="eager"/g) ?? []).toHaveLength(ATTACHMENT_FIRST_SET - 1);
  });
});
