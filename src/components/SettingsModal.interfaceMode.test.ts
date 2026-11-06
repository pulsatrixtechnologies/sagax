import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AppSettingsSection } from "@/state/store";
import { SettingsModal } from "./SettingsModal";

const fixture = vi.hoisted(() => ({ section: "general" as AppSettingsSection }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [] }, dispatch: vi.fn() }),
}));

const stored = new Map<string, string>();

beforeEach(async () => {
  stored.clear();
  fixture.section = "general";
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
  const { AppearanceSettings } = await import("./lazy-settings-sections");
  await AppearanceSettings.preload();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

describe("Settings Simple and Advanced", () => {
  it("starts in Advanced: the switch is on and the technical sections show", () => {
    const html = render();
    expect(html).toContain('aria-label="Advanced mode"');
    expect(html).toContain('aria-checked="true"');
    for (const id of ["engines", "usage", "computer", "experimental"]) {
      expect(html, id).toContain(`<option value="${id}"`);
    }
  });

  // #2080 (L0): Simple hides no page but Experimental; it folds the
  // technical cards of each page under "Advanced" instead
  // #2080 L2: the switch lives on General > Interface; Simple folds the Advanced cards there,
  // the fold (filled once mounted) keeps the way back one click away
  it("in Simple (chosen), the switch is named in General and only Experimental hides", () => {
    stored.set("sagax.interfaceMode.v1", "simple");
    const html = render();
    expect(html).toContain('data-settings-card="general.advancedFold"');
    expect(html).not.toContain("data-settings-scope");
    expect(html).toContain('<option value="account"');
    expect(html).toContain('<option value="appearance"');
    for (const id of ["connections", "connectedApps", "experimental"]) {
      expect(html, id).not.toContain(`<option value="${id}"`);
    }
    for (const id of ["engines", "computer", "providers", "voice"]) {
      expect(html, id).toContain(`<option value="${id}"`);
    }
    // 2026-10-15: Usage (the person's own plan and cost) shows in Simple too
    expect(html).toContain('<option value="usage"');
    expect(html).not.toContain('aria-label="Show tool calls in chat"');
    expect(html).not.toContain("Maximum turn length");
  });

  it("shows the current sections when Advanced is the stored choice", () => {
    stored.set("sagax.interfaceMode.v1", "advanced");
    const html = render();
    expect(html).toContain('aria-label="Advanced mode"');
    expect(html).toContain('aria-checked="true"');
    for (const id of ["engines", "usage", "computer", "experimental"]) {
      expect(html, id).toContain(`<option value="${id}"`);
    }
    // Integrations is no longer an entry: it is part of Models and voice.
    expect(html).not.toContain('<option value="connections"');
    fixture.section = "appearance";
    expect(render()).toContain('aria-label="Show tool calls in chat"');
  });
});
