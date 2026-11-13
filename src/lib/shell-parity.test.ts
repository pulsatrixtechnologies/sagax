// #4093: the app shell reacts to the window's width as the reference app
// does (docs/design/ux-reference-grokbot-cursor.md, "Shell by window width"):
// one set of breakpoints, the 88px rail, the header pill on one line, the
// reading column and the bubbles' type, the composer's folded model chip and
// the account menu's update row.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SIDEBAR_AUTO_RAIL_BELOW,
  SIDEBAR_CHAT_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_DRAWER_BELOW,
  SIDEBAR_RAIL_WIDTH,
  sidebarViewportFor,
} from "./sidebar-preferences";
import { CHAT_BUBBLE_TEXT_CLASS, chatBubbleWidthClasses, chatColumnClass, chatComposerShellClass } from "./chat-bubble-width";
import { PillName } from "../components/BotHeaderPill";
import { COMPOSER_NARROW_ONLY, COMPOSER_WIDE_ONLY, ComposerPlusMenu } from "../components/ComposerControls";
import { AccountMenuUpdateBanner } from "../components/SidebarProfileMenu";
import { BotRoleTag } from "../components/LabelTag";

describe("the shell by window width, as the reference (#4093)", () => {
  it("keeps one set of breakpoints: the drawer below 640, the 88px rail below the sidebar plus 424px", () => {
    expect(SIDEBAR_RAIL_WIDTH).toBe(88);
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(280);
    expect(SIDEBAR_CHAT_MIN_WIDTH).toBe(424);
    expect(SIDEBAR_DRAWER_BELOW).toBe(640);
    expect(SIDEBAR_AUTO_RAIL_BELOW).toBe(704);
    const at = (width: number) => sidebarViewportFor(width);
    expect([480, 640, 703, 704, 768, 900, 1024, 1280, 1440, 1800].map(at)).toEqual([
      "phone", "medium", "medium", "wide", "wide", "wide", "wide", "wide", "wide", "wide",
    ]);
  });

  it("reads the transcript in a 960px column with a 16px gutter, the composer on the same edges", () => {
    expect(chatColumnClass("reading")).toContain("max-w-[960px]");
    expect(chatComposerShellClass("reading")).toContain("px-[max(16px,calc((100%-960px)/2))]");
    expect(chatComposerShellClass("full")).toContain("px-4");
  });

  it("draws bubble text at 15px on a 22px line, Markdown included, with the 560px cap", () => {
    expect(CHAT_BUBBLE_TEXT_CLASS.split(" ")).toEqual(expect.arrayContaining(["chat-bubble-type", "text-[15px]", "leading-[22px]"]));
    // the prose inside keeps the 22px line through a CSS rule, so the
    // bubble's class list never carries the prose class's name
    expect(CHAT_BUBBLE_TEXT_CLASS).not.toContain("chat-text");
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.chat-bubble-type :is\(\.chat-text, \.chat-md\) \{\s*line-height: 22px;/);
    expect(chatBubbleWidthClasses("reading").fit).toContain("max-w-[min(80%,560px,calc(100%-82px))]");
  });

  it("writes the header pill's name and title on one line, 14px, the title in secondary grey", () => {
    const html = renderToStaticMarkup(createElement(PillName, { name: "Atlas", label: "Service desk", weight: "font-normal" }));
    expect(html).not.toContain("flex-col");
    expect(html).toContain("text-[14px]");
    expect(html.replace(/<[^>]+>/g, "")).toBe("Atlas·Service desk");
    expect(html).toMatch(/data-bot-header-label="" class="[^"]*text-ink-secondary/);
  });

  it("writes a sidebar row's role after the name on its line, and a pinned tile's under it, as plain text", () => {
    const row = renderToStaticMarkup(createElement(BotRoleTag, { text: "Service desk" }));
    expect(row.replace(/<[^>]+>/g, "")).toBe("·Service desk");
    expect(row).toContain("text-[14px]");
    expect(row).not.toMatch(/border-\[0\.5px\]|rounded-\[4px\]/);
    const tile = renderToStaticMarkup(createElement(BotRoleTag, { text: "Service desk", tile: true }));
    expect(tile).not.toContain("·");
    expect(tile).not.toMatch(/border-\[0\.5px\]|rounded-\[4px\]/);
    expect(tile).toContain("text-sidebar-ink-secondary");
  });

  it("folds the composer's model chip into the + menu below a 560px capsule, one rule for both", () => {
    expect(COMPOSER_WIDE_ONLY).toBe("contents @max-[35rem]/composer:hidden");
    expect(COMPOSER_NARROW_ONLY).toBe("hidden @max-[35rem]/composer:contents");
    const html = renderToStaticMarkup(createElement(ComposerPlusMenu, {
      items: [],
      initialOpen: true,
      rowsClassName: COMPOSER_NARROW_ONLY,
      rows: () => createElement("button", { "data-test-model-row": "" }, "Model"),
    }));
    expect(html).toMatch(/data-composer-plus-rows="" class="hidden @max-\[35rem\]\/composer:contents"><div role="separator"[^>]*><\/div><button data-test-model-row="">Model<\/button>/);
  });

  it("offers a waiting update at the top of the account menu, with Install", () => {
    const html = renderToStaticMarkup(createElement(AccountMenuUpdateBanner, { onInstall: () => {} }));
    expect(html).toContain("data-account-update-banner");
    expect(html).toContain("data-account-update-install");
    expect(html).toContain("rounded-[10px]");
  });
});
