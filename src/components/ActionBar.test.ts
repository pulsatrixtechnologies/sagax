// The routine page's action bar follows its own container width (2026-10-28):
// every button keeps an aria-label and a tooltip, the labels carry the class
// that hides them once the container is compact, and none can wrap. The real
// widths are checked in a browser by scripts/capture/routine-detail-actions.mjs.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACTION_LABEL, ACTION_LABEL_MAIN, ActionBar, ActionButton } from "./ActionBar";

const noop = () => {};
const markup = renderToStaticMarkup(createElement(ActionBar, { "data-routine-detail-actions": "" },
  createElement(ActionButton, { icon: null, label: "Pause", fold: "main", onClick: noop }),
  createElement(ActionButton, { icon: null, label: "Journal", onClick: noop }),
  createElement(ActionButton, { icon: null, label: "Delete", danger: true, onClick: noop }),
));

describe("ActionBar", () => {
  it("is a container, so it answers to the panel width and not the viewport", () => {
    expect(markup).toContain("@container/actionbar");
  });
  it("gives every button its aria-label and tooltip, in icon mode too", () => {
    for (const label of ["Pause", "Journal", "Delete"]) expect(markup).toContain(`aria-label="${label}" title="${label}"`);
  });
  it("hides the label (never wraps or cuts it) and turns the button into a round icon when compact", () => {
    expect(markup).toContain(`<span class="${ACTION_LABEL_MAIN}">Pause</span>`);
    expect(markup).toContain(`<span class="${ACTION_LABEL}">Journal</span>`);
    expect(ACTION_LABEL_MAIN).toContain("@max-[22rem]/actionbar:hidden");
    expect(ACTION_LABEL).toContain("whitespace-nowrap");
    expect(ACTION_LABEL).toContain("@max-[38rem]/actionbar:hidden");
    expect(markup).toContain("@max-[38rem]/actionbar:w-10");
  });
  it("every action has its words while there is room (2026-10-29), and Delete stays red and apart", () => {
    expect(markup).toContain(">Delete</span>");
    expect(markup).toMatch(/text-danger[^"]*"[^>]*>|class="[^"]*text-danger/);
    expect(markup).toContain("ml-1");
  });
});
