// The docked bot panel and the chat column are two sibling panels in one
// app frame (JC, 2026-10-08): the same header height above both, so their
// top edges and header circles line up in every skin; on Pulsatrix Light,
// two light cards with the same top, bottom, radius and border, one gap
// apart, the panel's right margin equal to the chat card's left margin; and
// a stored panel width never pushes the panel past the window's right edge.
// These read the sources: the shared tokens and classes are the contract.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const styles = read("../styles.css");
const retro98 = read("../styles/retro98.css");
const chatView = read("./ChatView.tsx");
const botPanel = read("./BotSettingsDialog.tsx");
const personPanel = read("./PersonPanel.tsx");

/** The body of the first rule whose selector list is exactly `selector`. */
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};
const token = (name: string) => rule(styles, ":root").match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
const GAP = "var(--app-frame-gap)";

describe("app frame tokens", () => {
  it("live once on :root, so no skin carries its own numbers", () => {
    expect(token("app-topbar-height")).toBe("56px");
    expect(token("app-frame-gap")).toBe("8px");
    expect(token("app-chat-min-width")).toBe("360px");
    for (const name of ["app-topbar-height", "app-frame-gap", "app-chat-min-width"]) {
      expect(styles.match(new RegExp(`--${name}:`, "g"))).toHaveLength(1);
    }
  });

  it("set the header height of the chat header's own circle row", () => {
    // min-h-[52px] py-2.5 around 36px circles (size-9): 10 + 36 + 10.
    expect(chatView).toMatch(/"@container\/chathead [^"]*\bpy-2\.5\b/);
    expect(10 + 36 + 10).toBe(Number.parseInt(token("app-topbar-height")!, 10));
  });
});

describe("chat column and bot panel", () => {
  it("both carry .content-topbar and .content-card-body", () => {
    for (const source of [chatView, botPanel, personPanel]) {
      expect(source).toMatch(/"content-topbar[\s"]/);
      expect(source).toMatch(/className="content-card-body /);
    }
    for (const source of [botPanel, personPanel]) expect(source).toMatch(/className="app-docked-panel /);
  });

  it("share one header height in every skin, outranking h-12 and min-h-[52px]", () => {
    expect(rule(styles, ".content-topbar")).toContain("min-height: var(--app-topbar-height);");
    // Unlayered: a rule inside @layer would lose to Tailwind's utilities.
    const at = styles.indexOf("\n.content-topbar {");
    const before = styles.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, "");
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(depth).toBe(0);
    // No skin sets a header height of its own on top of the token.
    expect(styles).not.toMatch(/\.content-topbar \{[^}]*min-height: \d/);
    // Hibou 98 keeps its 20px caption bar.
    expect(rule(retro98, '[data-skin="retro98"] .app-docked-panel > div.h-12')).toContain("min-height: 0 !important;");
  });

  it("let the panel give way to the chat column's minimum on a desktop row", () => {
    const desktop = styles.slice(styles.indexOf("@media (min-width: 1024px) {\n  .app-docked-panel {"));
    expect(rule(desktop, "  .app-docked-panel")).toContain("flex-shrink: 1;");
    expect(rule(desktop, "  .app-content-frame:has(~ .app-docked-panel)")).toContain("min-width: var(--app-chat-min-width);");
  });
});

describe("Pulsatrix Light inset frame", () => {
  const card = () => rule(styles, '[data-skin="pulsatrix-light"] .content-card-body');
  const chatCard = () => rule(styles, '[data-skin="pulsatrix-light"] .app-content-frame .content-card-body');

  it("draws both cards from one rule: gap above, below and right, radius and border", () => {
    expect(card()).toContain(`margin: ${GAP} ${GAP} ${GAP} 0;`);
    expect(card()).toContain("border-radius: var(--radius-xl);");
    expect(card()).toContain("border: 1px solid var(--color-hairline);");
    expect(card()).not.toMatch(/box-shadow/);
  });

  it("gives the chat card the gap on its left too, so the panel's right margin equals it", () => {
    expect(chatCard().replace(/^[^{]*\{/, "").trim()).toBe(`margin-left: ${GAP};`);
  });

  it("never trims one card's border, radius or margin to fuse it with the other", () => {
    const light = [...styles.matchAll(/\[data-skin="pulsatrix-light"\][^{]*content-card-body[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    for (const body of light) {
      expect(body).not.toMatch(/border-(top|bottom)-(left|right)-radius:\s*0/);
      expect(body).not.toMatch(/border-(left|right):\s*0/);
      expect(body).not.toMatch(/margin-(left|right):\s*0/);
    }
  });

  it("keeps the frame numbers in tokens, not in the frame rules", () => {
    const frame = styles.slice(
      styles.indexOf('[data-skin="pulsatrix-light"] .app-content-frame,\n[data-skin="pulsatrix-light"] .app-docked-panel {'),
      styles.indexOf("/* The navy top band."),
    );
    expect(frame).not.toMatch(/margin[^;]*\b8px/);
    expect(rule(styles, '[data-skin="pulsatrix-light"] .content-topbar')).not.toMatch(/min-height/);
  });
});

describe("docked panel scrolling", () => {
  // Short window (JC, 2026-10-08): the settings list was cut after "Model" and
  // could not be scrolled. The card scrolls, its children never shrink.
  const groupPanel = read("./GroupPanel.tsx");
  const body = (source: string) => source.match(/className="(content-card-body [^"]*)"/)?.[1] ?? "";

  it("makes the bot, person and group panel card the scroll container", () => {
    for (const source of [botPanel, personPanel, groupPanel]) {
      const classes = body(source).split(/\s+/);
      for (const c of ["flex", "min-h-0", "flex-1", "flex-col", "overflow-y-auto", "overflow-x-hidden"]) expect(classes, c).toContain(c);
    }
  });

  it("stops the tab content (Details, Library, Computer) from shrinking inside it", () => {
    for (const source of [botPanel, personPanel, groupPanel]) expect(body(source)).toContain("[&>*]:shrink-0");
  });

  it("keeps the header and the tab strip out of the card's scroll region", () => {
    for (const source of [botPanel, personPanel]) {
      expect(source.indexOf('"content-topbar')).toBeLessThan(source.indexOf('className="content-card-body'));
      expect(source).toMatch(/content-topbar relative flex h-12 shrink-0/);
    }
  });

  it("lets Pulsatrix Light's card rule keep the scroll of a scrolling card", () => {
    const light = rule(styles, '[data-skin="pulsatrix-light"] .content-card-body.overflow-y-auto');
    expect(light).toContain("overflow-y: auto;");
    expect(light).toContain("overflow-x: hidden;");
    expect(body(groupPanel)).toContain("overflow-y-auto");
  });

  it("has no separate floating variant of the docked panel", () => {
    expect(read("./FloatingBotsHost.tsx")).not.toMatch(/BotSettingsDialog|PersonPanel/);
  });
});
