// #4163 (the owner, 2026-11-13, the two top bars side by side): the round
// controls of the top bar and of the sidebar's head (search, New, "...",
// gear, close) and the chat header's pill wear the reference's measured
// values, in the owner's configuration (its own typeface, 15px chat prose):
//
// - round control: 36px, the reference's elevated fill (#1f1f1f dark,
//   #ffffff light), a 1px ring of the ink at 6% (dark) or 8% (light), a 6%
//   ink wash on hover, the glyph in the ink at 90% (dark) or 92% (light);
//   one style for the frame and the rail, no dimmer glyph on the rail;
// - pill: 40px (a 24px mascot, 7.5px around it, a 0.5px ring), 7.5px
//   before the mascot, 8px to the text, 13.5px after it, the same fill and
//   ring, "Name · Title" in ONE type (14/20 medium) and ONE ink (primary).
//
// The classes and tokens are the contract: they are read here from the
// shared modules and the stylesheet, and every chat's pill is checked to
// draw from them.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CIRCLE_BUTTON, CIRCLE_ICON, SIDEBAR_CIRCLE_BUTTON } from "./circle-button";
import { BotHeaderPill, CHAT_PILL_AVATAR_PX, CHAT_PILL_CLASS, CHAT_PILL_GROUP_CLASS, CHAT_PILL_TEXT_CLASS, PillName } from "../components/BotHeaderPill";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const styles = read("../styles.css");
const classes = (value: string) => value.split(/\s+/).filter(Boolean);
const block = (selector: string) => {
  const start = styles.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return styles.slice(start, styles.indexOf("\n}", start));
};

describe("round controls, as the reference measures them (#4163)", () => {
  it("one style: the reference's fill, ring, glyph and hover wash, 36px", () => {
    const list = classes(CIRCLE_BUTTON);
    expect(list).toEqual(expect.arrayContaining(["size-9", "rounded-full", "border", "border-circle-ring", "bg-circle", "text-circle-glyph", "hover:bg-circle-hover"]));
    for (const old of ["bg-elevated", "border-hairline-weak", "text-ink", "hover:bg-elevated-hover"]) expect(list).not.toContain(old);
  });

  it("the sidebar's head draws the same control from the rail's ink, its glyph as bright as the frame's", () => {
    const list = classes(SIDEBAR_CIRCLE_BUTTON);
    expect(list).toEqual(expect.arrayContaining(["size-9", "rounded-full", "border", "border-sidebar-circle-ring", "bg-sidebar-circle", "text-sidebar-circle-glyph", "hover:bg-sidebar-circle-hover"]));
    for (const old of ["bg-sidebar-elevated", "border-sidebar-hairline-weak", "text-sidebar-ink-secondary", "hover:text-sidebar-ink"]) expect(list).not.toContain(old);
    const sidebar = read("../components/Sidebar.tsx");
    const head = sidebar.slice(sidebar.indexOf("const headButtons = ("), sidebar.indexOf("</>", sidebar.indexOf("const headButtons = (")));
    expect(head).toContain("<Search {...CIRCLE_ICON}");
    expect(head).toContain("<Plus {...CIRCLE_ICON}");
    expect(CIRCLE_ICON).toEqual({ size: 18, strokeWidth: 1.75 });
  });

  it("the tokens resolve to the reference's values: dark by default, light per skin family", () => {
    const theme = block("@theme inline");
    expect(theme).toContain("--color-circle: var(--circle-fill, var(--color-raised));");
    expect(theme).toContain("--color-circle-hover: color-mix(in srgb, var(--color-ink) 6%, var(--circle-fill, var(--color-raised)));");
    expect(theme).toContain("--color-circle-ring: var(--circle-ring, color-mix(in srgb, var(--color-ink) 6%, transparent));");
    expect(theme).toContain("--color-circle-glyph: var(--circle-glyph, color-mix(in srgb, var(--color-ink) 90%, transparent));");
    // Sand Dark's elevated step is the dark skins' raised fill
    expect(block('[data-skin="midnight"]')).toMatch(/--color-raised: #1f1f1f;/);
    expect(block('[data-skin="pulsatrix"]')).toMatch(/--color-raised: #1f1f1f;/);
    // where raised is not the reference's white, the light skins say so
    for (const skin of ["daylight", "meadow"]) expect(block(`[data-skin="${skin}"]`), skin).toMatch(/--circle-fill: #ffffff;/);
    const light = styles.slice(styles.indexOf("The round controls and the chat pill on the light skins"));
    const family = light.slice(light.indexOf(":is("), light.indexOf("\n}"));
    for (const skin of ["pulsatrix-light", "atelier", "lagoon", "linen", "daylight", "retro98", "meadow"]) expect(family).toContain(`[data-skin="${skin}"]`);
    expect(family).toContain("--circle-ring: color-mix(in srgb, var(--color-ink) 8%, transparent);");
    expect(family).toContain("--circle-glyph: color-mix(in srgb, var(--color-ink) 92%, transparent);");
    // the reference's resting chip draws no shadow, in any theme
    expect(styles).not.toContain("--pill-shadow");
  });

  it("the open menus' buttons keep the control's hover wash while their menu is open", () => {
    for (const file of ["../components/ExportTranscriptMenu.tsx", "../components/TaskPicker.tsx", "../components/bot-settings/BotActionsMenu.tsx"]) {
      const source = read(file);
      expect(source, file).toMatch(/CIRCLE_BUTTON[^\n]*&& "bg-circle-hover"/);
      expect(source, file).not.toMatch(/CIRCLE_BUTTON[^\n]*&& "bg-elevated-hover"/);
    }
  });
});

describe("the chat pill, as the reference measures it (#4163)", () => {
  it("is 40px with the reference's paddings, gap, ring and fill, its mascot 24px", () => {
    const list = classes(CHAT_PILL_CLASS);
    expect(list).toEqual(expect.arrayContaining(["h-10", "items-center", "gap-2", "rounded-full", "border-[0.5px]", "border-circle-ring", "bg-circle", "pl-[7.5px]", "pr-[13.5px]", "min-w-0", "max-w-[420px]"]));
    expect(list.some((name) => name.startsWith("shadow"))).toBe(false);
    expect(list).not.toContain("h-9");
    expect(CHAT_PILL_GROUP_CLASS).toBe("pl-[9.5px]");
    expect(CHAT_PILL_AVATAR_PX).toBe(24);
  });

  it("writes the name, the dot and the title in one type and one ink, 14/20 medium", () => {
    expect(classes(CHAT_PILL_TEXT_CLASS)).toEqual(["text-[14px]", "font-medium", "leading-5", "text-ink"]);
    const html = renderToStaticMarkup(createElement(PillName, { name: "Atlas", label: "Chief of staff" }));
    expect(html.replace(/<[^>]+>/g, "")).toBe("Atlas·Chief of staff");
    expect(html).toMatch(/data-bot-header-text="" [^>]*class="[^"]*text-\[14px\] font-medium leading-5 text-ink/);
    expect(html).not.toMatch(/text-ink-secondary|text-ink-tertiary|font-normal|text-\[1[235]px\]/);
  });

  it("folds its chevron at rest and while the panel is open, so its width is its text's", () => {
    const pill = (panelOpen: boolean) => renderToStaticMarkup(createElement(BotHeaderPill, { name: "Atlas", label: "Ops", panelOpen, onToggle: () => {}, avatar: createElement("span") }));
    const chevron = (html: string) => /<svg[^>]*data-bot-header-chevron[^>]*>/.exec(html)?.[0] ?? "";
    expect(chevron(pill(false))).toMatch(/\bw-0\b/);
    expect(chevron(pill(false))).toMatch(/group-hover\/pill:w-3/);
    expect(chevron(pill(false))).toMatch(/width="12"/);
    expect(chevron(pill(true))).toMatch(/\bw-0\b/);
    expect(chevron(pill(true))).not.toMatch(/group-hover\/pill:w-3/);
  });

  it("every chat draws this pill: no ad hoc pill and no smaller mascot", () => {
    const sources = {
      chat: read("../components/ChatView.tsx-parts/useChatViewPresence.tsx"),
      group: read("../components/GroupView.tsx-parts/groupRoomIdentity.tsx"),
      split: read("../components/SplitWorkspace.tsx"),
      coding: read("../components/coding/CodingChat.tsx"),
      exchange: read("../components/BotExchangeChip.tsx"),
    };
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).toContain("CHAT_PILL_AVATAR_PX");
      expect(source, name).not.toMatch(/rounded-full border-\[0\.5px\] border-hairline-weak bg-elevated py-\[7\.5px\]/);
    }
    expect(sources.chat.match(/size=\{CHAT_PILL_AVATAR_PX\}/g)).toHaveLength(2);
    expect(sources.group).toContain("cn(CHAT_PILL_CLASS, CHAT_PILL_HOVER)");
    expect(sources.group).toContain("cn(CHAT_PILL_CLASS, CHAT_PILL_GROUP_CLASS)");
    expect(sources.exchange).not.toMatch(/style=\{\{ color: mausInk\(bot\.color\) \}\}/);
  });
});
