import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { SubmenuEntryRow } from "./SidebarPopoverMenu";

const html = renderToStaticMarkup(createElement(SubmenuEntryRow, {
  entry: { key: "org", label: "Acme", subtitle: "acme.example", checked: true, rename: { label: "Rename", onRename: () => {} } },
  starSlot: false,
  onClose: () => {},
}));

it("keeps the selected row's check at the right edge and hides it while the row is hovered or focused", () => {
  expect(html.match(/<svg[^>]*data-menu-check[^>]*>/)![0]).toContain("group-hover/entry:invisible");
  expect(html).not.toContain("pr-14");
});

it("shows the edit button only on hover or focus, at the right edge, with a tooltip and aria label", () => {
  const button = html.match(/<button[^>]*data-rename-key[^>]*>/)![0];
  expect(button).toContain("opacity-0");
  expect(button).toContain("group-hover/entry:opacity-100");
  expect(button).toContain("focus-visible:opacity-100");
  expect(button).toContain("right-1.5");
  expect(button).toContain('aria-label="Rename"');
  expect(button).toContain('title="Rename"');
  expect(button).not.toMatch(/(^|[ "])right-8/);
});
