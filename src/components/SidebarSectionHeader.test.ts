import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarSectionHeader } from "./SidebarSectionHeader";

describe("SidebarSectionHeader", () => {
  it("exposes collapse and keyboard reorder semantics without a fake grip button", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Work",
        collapsed: false,
        onToggle: () => {},
        reorderable: true,
        dragging: false,
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("Delete Work section");
    // sentence case (as upstream), a 13/18 regular label (the reference's
    // size with 15px chat prose, the owner's configuration, #4093), chevron
    // for fold state
    expect(html).toContain(">Work</span>");
    expect(html).toContain("text-[13px] font-normal leading-[18px]");
    expect(html).not.toContain("text-[12px]");
    expect(html).toContain("h-[30px]");
    expect(html).toContain("lucide-chevron-right");
    expect(html).toContain("rotate-90");
    expect(html).toContain('data-section-chevron=""');
    expect(html).not.toContain("uppercase");
  });

  it.each([false, true])("keeps delete off the heading and leaves the context menu, collapsed=%s", (collapsed) => {
    const onContextMenu = () => {};
    const element = SidebarSectionHeader({
      name: "Work",
      collapsed,
      onToggle: () => {},
      onContextMenu,
      reorderable: true,
      dragging: false,
    });
    const html = renderToStaticMarkup(element);

    expect(element.props.onContextMenu).toBe(onContextMenu);
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain("Delete Work section");
    expect(html).not.toContain("lucide-trash");
    expect(html).toContain(`aria-expanded="${!collapsed}"`);
    expect(html).toContain("lucide-chevron-right");
    expect(html.includes("rotate-90")).toBe(!collapsed);
    expect(html.match(/<button\b/g)).toHaveLength(1);
  });

  it("renders collapsed attention signals in the heading", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Bot Chats",
        collapsed: true,
        attention: { waiting: 1, unread: 2, working: 1 },
        onToggle: () => {},
        reorderable: false,
        dragging: false,
      }),
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("lucide-chevron-right");
    expect(html).not.toContain("rotate-90");
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("2 unread");
    expect(html).toContain("1 working");
  });

  // #4093: the reference's group title: the name first, then one seat at
  // the row's end holding the folded group's count, the chevron there on
  // hover or keyboard focus.
  it("puts the name first, the folded group's count and the hover chevron at the end", () => {
    const header = (collapsed: boolean) => renderToStaticMarkup(
      createElement(SidebarSectionHeader, { name: "Mon équipe", count: 4, collapsed, onToggle: () => {}, reorderable: false, dragging: false }),
    );
    const folded = header(true);
    const open = header(false);
    expect(folded.replace(/<[^>]+>/g, "")).toBe("Mon équipe4");
    expect(folded).toContain('data-section-count=""');
    expect(open.replace(/<[^>]+>/g, "")).toBe("Mon équipe");
    expect(open).not.toContain("data-section-count");
    for (const html of [folded, open]) {
      expect(html.indexOf(">Mon équipe</span>")).toBeLessThan(html.indexOf("data-section-chevron"));
      const chevron = /<svg[^>]*data-section-chevron=""[^>]*>/.exec(html)?.[0] ?? "";
      expect(chevron).toContain("opacity-0");
      expect(chevron).toContain("group-hover/section:opacity-100");
      expect(html).toContain('aria-expanded=');
    }
  });

  it("draws the focus frame only for keyboard focus, never after a click", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\[data-sidebar-section-header\]\[data-pointer-focus\]:focus-visible \{\s*outline: none;/);
  });

  it("retains the accessible attention summary when the heading cannot collapse", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Bot Chats",
        collapsed: false,
        attention: { waiting: 1, unread: 2, working: 1 },
        reorderable: false,
        dragging: false,
      }),
    );

    expect(html).not.toContain("<button");
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("2 unread");
    expect(html).toContain("1 working");
  });
});
