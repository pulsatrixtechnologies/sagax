// The sidebar head on Pulsatrix Light (owner, 2026-10-08): its round search and
// New buttons are painted from the rail's own tokens, so they read on the
// navy rail the way the chat header's circles do, and its brand row is the
// chat header's height, so both rows of 36px circles share one centre line.
// These read the sources: the classes are the contract, and a light-mode
// regression here is a token or a height, never runtime state.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CIRCLE_BUTTON, SIDEBAR_CIRCLE_BUTTON } from "@/lib/circle-button";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sidebar = read("./Sidebar.tsx");
// Chat header chrome moved into ChatView.tsx-parts; scan both sources.
const chatView = [read("./ChatView.tsx"), read("./ChatView.tsx-parts/ChatViewHeader.tsx"), read("./ChatView.tsx-parts/ChatViewShell.tsx"), read("./ChatHeaderBar.tsx")].join("\n");
const styles = read("../styles.css");
const classes = (value: string) => value.split(/\s+/).filter(Boolean);
/** Tailwind spacing scale: `h-14` is 3.5rem, 56px. */
const px = (token: string) => {
  const arbitrary = token.match(/\[(\d+)px\]$/);
  if (arbitrary) return Number(arbitrary[1]);
  const scale = token.match(/-(\d+(?:\.\d+)?)$/);
  if (!scale) throw new Error(`no size in ${token}`);
  return Number(scale[1]) * 4;
};

describe("sidebar head buttons", () => {
  it("paint from the rail's tokens, not the content frame's", () => {
    const list = classes(SIDEBAR_CIRCLE_BUTTON);
    for (const token of ["bg-sidebar-elevated", "hover:bg-sidebar-elevated-hover", "border-sidebar-hairline-weak", "text-sidebar-ink-secondary", "hover:text-sidebar-ink"]) {
      expect(list).toContain(token);
    }
    for (const frameToken of ["bg-elevated", "hover:bg-elevated-hover", "border-hairline-weak", "text-ink", "text-ink-secondary", "hover:text-ink"]) {
      expect(list).not.toContain(frameToken);
    }
  });

  it("keep the chat header's circle geometry", () => {
    const geometry = (value: string) => classes(value).filter((token) => /^(flex|size-|shrink-|items-|justify-|rounded-|border)$|^(size|rounded)-/.test(token) && !token.startsWith("border-"));
    expect(geometry(SIDEBAR_CIRCLE_BUTTON)).toEqual(geometry(CIRCLE_BUTTON));
    expect(classes(SIDEBAR_CIRCLE_BUTTON)).toContain("size-9");
  });

  it("are what the head's search and New buttons wear, at every density", () => {
    expect(sidebar).toMatch(/const SIDEBAR_HEAD_BUTTON = cn\(\s*SIDEBAR_CIRCLE_BUTTON,/);
    // one pair, drawn in the head at full width and in the rail's foot (#4093)
    const buttons = sidebar.slice(sidebar.indexOf("const headButtons = ("), sidebar.indexOf("</>", sidebar.indexOf("const headButtons = (")));
    expect(buttons.match(/className=\{SIDEBAR_HEAD_BUTTON\}/g)).toHaveLength(2);
    expect(buttons).not.toMatch(/CIRCLE_BUTTON\b(?!_)/);
    const head = sidebar.slice(sidebar.indexOf("<div data-sidebar-head"), sidebar.indexOf("{/* Bot list."));
    expect(head.match(/\{headButtons\}/g)).toHaveLength(1);
    expect(sidebar.slice(sidebar.indexOf("<SidebarRailFoot ")).split("\n")[0]).toContain("controls={headButtons}");
  });

  it("have rail tokens that equal the frame's on every skin but Pulsatrix Light, Pulsatrix and Midnight", () => {
    const theme = styles.slice(styles.indexOf("@theme inline {"));
    expect(theme).toContain("--color-sidebar-elevated: color-mix(in srgb, var(--color-sidebar-ink) 3%, var(--color-sidebar));");
    expect(theme).toContain("--color-elevated: color-mix(in srgb, var(--color-ink) 3%, var(--color-panel));");
    expect(theme).toContain("--color-sidebar-elevated-hover: color-mix(in srgb, #777777 20%, var(--color-sidebar-elevated));");
    expect(theme).toContain("--color-sidebar-hairline-weak: color-mix(in srgb, var(--color-sidebar-ink) 10%, transparent);");
    for (const block of styles.matchAll(/\[data-skin="([\w-]+)"\] \{([\s\S]*?)\n\}/g)) {
      const [, skin, body] = block;
      const token = (name: string) => body!.match(new RegExp(`--color-${name}:\\s*([^;]+);`))?.[1];
      // Midnight is the reference design's Sand Dark (#491): its rail is darker than the pane.
      // Pulsatrix dark took the same neutral ramp in the premium finish (rail #0e0e0e, pane #161616).
      if (skin === "pulsatrix-light" || skin === "pulsatrix" || skin === "midnight") {
        expect(token("sidebar")).not.toBe(token("panel"));
        continue;
      }
      expect(token("sidebar"), skin).toBe(token("panel"));
      expect(token("sidebar-ink"), skin).toBe(token("ink"));
    }
  });

  it("leave the rows' hover actions on rail tokens too", () => {
    // the row's unread count sits there too, in the unread color: not an action
    const actions = (sidebar.match(/className="pointer-events-none absolute right-[^"]*"/g) ?? []).filter((action) => !action.includes("tabular-nums"));
    expect(actions.length).toBeGreaterThanOrEqual(2);
    for (const action of actions) {
      expect(action).toContain("text-sidebar-ink-secondary");
      expect(action).not.toMatch(/\btext-ink-secondary|hover:bg-raised\b|hover:text-ink\b/);
    }
  });
});

describe("sidebar head row height", () => {
  it("matches the chat header's height, so the two rows share a centre line", () => {
    const header = chatView.match(/"@container\/chathead ([^"]+)"/)?.[1];
    expect(header).toBeDefined();
    const headerClasses = classes(header!);
    const minHeight = px(headerClasses.find((token) => token.startsWith("min-h-"))!);
    const padY = px(headerClasses.find((token) => token.startsWith("py-"))!);
    const circle = px(classes(CIRCLE_BUTTON).find((token) => token.startsWith("size-"))!);
    const headerHeight = Math.max(minHeight, padY * 2 + circle);
    expect(headerHeight).toBe(56);

    const row = sidebar.match(/export const SIDEBAR_HEAD_ROW = "([^"]+)"/)?.[1];
    expect(row).toBeDefined();
    const rowClasses = classes(row!);
    expect(rowClasses).toContain("items-center");
    expect(px(rowClasses.find((token) => token.startsWith("h-"))!)).toBe(headerHeight);
    // no extra margin above the row on any platform: the chat header has none
    expect(sidebar).toContain("<div className={titleBarHead ? SIDEBAR_TITLE_ROW : SIDEBAR_HEAD_ROW}");
    expect(sidebar).not.toMatch(/h-11 items-center justify-between/);
  });

  it("with the logo on, sits under the same 36px macOS inset strip the chat column draws", () => {
    const head = sidebar.slice(sidebar.indexOf("<div data-sidebar-head"), sidebar.indexOf("{/* Bot list."));
    expect(head).toMatch(/\(macInset \|\| browser\) && \(density === "icons" \|\| showLogo\) && \(\s*<div className=\{cn\("flex h-9 items-center"/);
    expect(chatView).toContain('{(macInset || browser) && <div className="content-topbar-strip" />}');
    expect(styles).toMatch(/\[data-skin="pulsatrix-light"\] \.content-topbar-strip \{[^}]*height: 36px;/);
  });

  it("with no logo, puts search and New in the title bar's 48px row, level with the lights", () => {
    expect(sidebar).toContain("const titleBarHead = (macInset || browser) && !showLogo;");
    const row = sidebar.match(/export const SIDEBAR_TITLE_ROW = "([^"]+)"/)?.[1];
    expect(row).toBeDefined();
    const rowClasses = classes(row!);
    expect(rowClasses).toContain("items-center");
    expect(px(rowClasses.find((token) => token.startsWith("h-"))!)).toBe(48);
    expect(rowClasses).toContain("pr-4");
  });
});
