import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clickByAccessibleNameJs, closePluginsJs, openPanelAria, overlaysOpenJs } from "./ui-click.ts";

describe("renderer e2e click helpers", () => {
  it("uses the possessive panel aria from chat.openPanelAria", () => {
    expect(openPanelAria("Quill")).toBe("Open Quill's panel");
    expect(openPanelAria("Quill")).not.toBe("Open Quill panel");
  });

  it("embeds the accessible name in a DOM click that bypasses hit-testing", () => {
    const source = clickByAccessibleNameJs("Open Quill's profile");
    expect(source).toContain("Open Quill's profile");
    expect(source).toContain(".click()");
    expect(source).toContain("aria-label");
  });

  it("prefers a visible match inside the top dialog over the first node in the page", () => {
    const source = clickByAccessibleNameJs("Create team");
    expect(source).toContain("Create team");
    expect(source).toContain("[role=dialog]");
    expect(source).toContain("data-bot-catalog-modal");
    expect(source).toContain("getBoundingClientRect");
  });

  it("treats the bot catalog modal as an overlay that covers the sidebar", () => {
    expect(overlaysOpenJs()).toContain("data-bot-catalog-modal");
    expect(overlaysOpenJs()).toContain("[role=dialog]");
  });
});

describe("Plugins' close in the bot tools smoke (#3910)", () => {
  it("names Plugins' own close button, never a button called just Close", () => {
    expect(closePluginsJs()).toContain("[data-plugins-page] [data-tour='apps-close']");
    const smoke = readFileSync(new URL("./bot-tools-ui.e2e.test.ts", import.meta.url), "utf8");
    expect(smoke).not.toMatch(/click\(\s*["']Close["']\s*\)/);
    expect(smoke).toContain("closePluginsJs()");
    // the frame still carries the mark the helper names
    const frame = readFileSync(new URL("../../src/components/PluginsPanel.tsx-parts/PluginsPanelView.tsx", import.meta.url), "utf8");
    expect(frame).toContain('data-tour="apps-close"');
    expect(frame).toContain("data-plugins-page={page.page}");
  });
});

describe("openNewBotDialog reuse", () => {
  it("reuses an open dialog only when Create bot is on it", () => {
    const src = readFileSync(new URL("./compose-flow.ts", import.meta.url), "utf8");
    expect(src).toContain('trim() === "Create bot"');
    expect(src).toContain("createBotReady");
    expect(src).toContain('snap.includes("Create bot")');
  });
});
