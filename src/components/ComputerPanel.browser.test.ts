import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { browserAvailable, type FeatureFlagConfig } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { visibilityState: "visible" });
  const view = { current: "browser" };
  vi.stubGlobal("localStorage", { getItem: () => view.current });
  return { config: {} as FeatureFlagConfig & { cloudHome?: boolean }, view, advanced: true };
});
// These cover the Advanced panel unless a test switches fixture.advanced off.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({
    state: { config: { box: { configured: false }, ...fixture.config }, instances: [], computerControl: {}, routines: [], routineRuns: [] },
    dispatch: vi.fn(),
    flushBotPatches: vi.fn(),
  }),
}));
import { ComputerPanel } from "./ComputerPanel";
import { BrowserPanel } from "./BrowserPanel";

afterAll(() => vi.unstubAllGlobals());
const bot = { id: "browser-fixture", name: "Browser fixture", modelSelection: { instanceId: "fixture" } } as Bot;
const render = (config: FeatureFlagConfig & { cloudHome?: boolean }, browser?: boolean) => {
  fixture.config = config;
  return renderToStaticMarkup(createElement(ComputerPanel, { bot: { ...bot, browser } }));
};

// Sagax 0.1.0 (8a563e929) dropped the Browser view from the Computer panel;
// it is back as browser mode: the screen picker's Browser chip, offered where
// the built-in browser is on, shows BrowserPanel in the screen's frame. The
// panel opens on the screen. The install and repair states live in
// BrowserPanel, rendered on its own here.
const renderBrowser = (config: FeatureFlagConfig & { cloudHome?: boolean }, browser?: boolean) => {
  fixture.config = config;
  return renderToStaticMarkup(createElement(BrowserPanel, { bot: { ...bot, browser } }));
};

describe("Browser panel installation access", () => {
  const missing = { kind: "unavailable", installable: true } as const;

  it("shows the real install panel before the engine is available", () => {
    const config = { features: { browser: true }, browserEngine: missing };
    expect(renderBrowser(config)).toContain("Install the browser engine");
    expect(browserAvailable(config)).toBe(false);
  });

  it("offers browser mode in the screen picker and opens on the screen", () => {
    const off = render({ features: { browser: false } });
    expect(off).not.toContain('data-computer-choice="browser"');
    const missingEngine = render({ features: { browser: true }, browserEngine: missing });
    expect(missingEngine).toContain('data-computer-choice="browser"');
    expect(missingEngine).toContain('aria-selected="true" data-computer-choice="screen"');
    expect(missingEngine).not.toContain("Install the browser engine");
    const ready = render({ features: { browser: true }, browserEngine: { kind: "engine" } }, true);
    expect(ready).toContain(">Browser<");
    expect(ready).not.toContain("Loading browser…");
    expect(ready).not.toContain("data-browser-view");
  });

  it("chooses the screen with one drop-down, in Simple and Advanced mode alike", () => {
    for (const advanced of [true, false]) {
      fixture.advanced = advanced;
      const markup = render({ features: { browser: true }, browserEngine: missing });
      // one button naming the screen shown, opening a list of the same choices
      expect(markup, `advanced=${advanced}`).toMatch(/<button[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"/);
      expect(markup).toContain('aria-label="Screen shown: Screen"');
      expect(markup).toMatch(/role="listbox" aria-label="Show the screen of"[^>]*hidden=""/);
      expect(markup.match(/role="option"/g)).toHaveLength(2);
      expect(markup).not.toContain('role="radiogroup"');
    }
    fixture.advanced = true;
  });

  it("keeps the per-bot opt-in gate", () => {
    const markup = renderBrowser({ features: { browser: true }, browserEngine: missing }, false);
    expect(markup).not.toContain("Install the browser engine");
    expect(markup).toContain("Enable the browser in this bot’s profile");
  });

  it("does not offer an install on unsupported hosts and still shows a ready engine", () => {
    expect(renderBrowser({ features: { browser: true }, browserEngine: { kind: "unavailable", installable: false } })).not.toContain("Install the browser engine");
    // A ready engine opens the live screen at once. Watching is not an admin check.
    // The screen is the calm one from 0.8.24: connecting reads "Waking up…" (BrowserPanel maps connecting to the starting state).
    const ready = renderBrowser({ features: { browser: true }, browserEngine: { kind: "engine" } });
    expect(ready).toContain("Waking up…");
    expect(ready).toContain('data-computer-source="browser"');
    expect(ready).not.toContain("Only admins of this installation");
  });

  it("keeps Chrome setup failure and progress visible even when the binary exists", () => {
    const failed = renderBrowser({ features: { browser: true }, browserEngine: { kind: "engine", installError: "Chrome download failed" } });
    expect(failed).toContain("Chrome download failed");
    expect(failed).toContain("Retry browser installation");
    const installing = renderBrowser({ features: { browser: true }, browserEngine: { kind: "engine", installing: true } });
    expect(installing).toContain("Installing…");
    expect(installing).toContain('disabled=""');
  });
});

describe("Computer panel on a narrow screen", () => {
  it("covers the window below md instead of docking a 400px column", () => {
    // A phone reaches this panel through the browser (remote access). Docked
    // at its stored width it pushed the chat to zero and ran off the right
    // edge, where `body { overflow: hidden }` cut it off. Below md it takes
    // the window like the settings and inspector panels do; the inline width
    // still sizes it beside the chat on wider screens.
    const markup = render({});
    const aside = /<aside class="([^"]*)"/.exec(markup)!;
    expect(aside[1].split(" ")).toEqual(expect.arrayContaining(["max-md:absolute", "max-md:inset-0", "max-md:z-40", "max-md:w-full!"]));
    // Nothing to drag against when the panel is the whole window.
    const separator = /<div role="separator"[^>]*class="([^"]*)"/.exec(markup)!;
    expect(separator[1].split(" ")).toContain("max-md:hidden");
  });
});

describe("Computer panel header", () => {
  it("names its icon-only close button", () => {
    expect(render({})).toContain(`aria-label="${t("computer.close")}"`);
  });
});
