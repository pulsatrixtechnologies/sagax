import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import type { FeatureFlagConfig } from "@/lib/feature-flags";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("localStorage", { getItem: () => "browser" });
  return { config: {} as FeatureFlagConfig, browserMcp: true, dispatch: vi.fn() };
});

vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: {
        ...original.initialState,
        appSettingsSection: "experimental",
        config: { box: { configured: false }, ...fixture.config },
        instances: [{
          instanceId: "fixture", driverKind: "claudeAgent", displayName: "Fixture",
          models: { default: "fixture", options: [] }, snapshot: { state: "available" },
          capabilities: { browserMcp: fixture.browserMcp },
        } as InstanceInfo],
      },
      dispatch: fixture.dispatch,
      flushBotPatches: vi.fn(),
    }),
  };
});

import { SettingsModal } from "./SettingsModal";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { ComputerPanel } from "./ComputerPanel";
import { WorksOnSetting } from "./computer/WorksOnSetting";
import { AccessSection } from "./bot-settings/AccessSection";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";

function BotAccess({ bot }: { bot: Bot }) {
  return createElement(AccessSection, { bot, derived: useBotSettingsDerived(bot) });
}

const bot = { id: "install-fixture", name: "Scout", modelSelection: { instanceId: "fixture" }, browser: false } as Bot;
const switchTag = (markup: string, label: string) => {
  const match = markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  expect(match, `missing switch: ${label}`).not.toBeNull();
  return match![0];
};
const settings = () => renderToStaticMarkup(createElement(SettingsModal));
const access = () => renderToStaticMarkup(createElement(BotAccess, { bot }));
const panel = (browser: boolean) => renderToStaticMarkup(createElement(ConfirmProvider, null, createElement(ComputerPanel, { bot: { ...bot, browser } })));

beforeEach(async () => {
  const { ExperimentalSettings } = await import("./lazy-settings-sections");
  await ExperimentalSettings.preload();
  fixture.config = { features: { browser: false }, browserEngine: { kind: "unavailable", installable: true } };
  fixture.browserMcp = true;
  fixture.dispatch.mockClear();
});
afterAll(() => vi.unstubAllGlobals());

describe("browser installation opt-in", () => {
  it("exposes the fresh workspace opt-in before installation without enabling it automatically", () => {
    const toggle = switchTag(settings(), "Enable the built-in browser");
    expect(toggle).toContain('aria-checked="false"');
    expect(toggle).not.toContain("disabled=");
    expect(panel(false)).not.toContain("Install the browser engine");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("allows an explicitly disabled bot to opt in after the workspace, and Works on offers no browser destination", () => {
    expect(access()).not.toContain("Give this bot a built-in browser");
    fixture.config.features = { browser: true };
    const markup = access();
    const toggle = switchTag(markup, "Give this bot a built-in browser");
    expect(toggle).toContain('aria-checked="false"');
    expect(toggle).not.toContain("disabled=");
    const worksOn = renderToStaticMarkup(createElement(WorksOnSetting, { bot: { ...bot, browser: false } }));
    // Workspace is always Auto (owner 2026-10-18): Browser is not a choice
    expect(worksOn).not.toContain('data-works-on-choice="browser"');
    expect(panel(false)).not.toContain("data-works-on-setting");
    expect(panel(false)).not.toContain("Install the browser engine");
    expect(panel(true)).not.toContain("Install the browser engine");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("keeps both opt-ins unavailable when the server cannot install the engine", () => {
    fixture.config.browserEngine = { kind: "unavailable", installable: false, reason: "Unsupported platform" };
    expect(switchTag(settings(), "Enable the built-in browser")).toContain("disabled=");
    fixture.config.features = { browser: true };
    expect(switchTag(access(), "Give this bot a built-in browser")).toContain("disabled=");
    expect(panel(true)).not.toContain("Install the browser engine");
  });

  it("preserves the per-bot provider capability gate", () => {
    fixture.config.features = { browser: true };
    fixture.browserMcp = false;
    expect(switchTag(access(), "Give this bot a built-in browser")).toContain("disabled=");
  });
});
