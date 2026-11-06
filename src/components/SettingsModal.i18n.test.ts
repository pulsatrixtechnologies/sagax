// The picker that switches the language sits inside this screen, so the screen
// has to answer to it while it is open. The trap is module scope: SECTIONS is
// built once at import time, and a label resolved there would keep the language
// the app booted in no matter what the picker says.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";

// This suite has no DOM. The screen only asks the desktop bridge whether it is
// there, so an empty window answers it the way a browser tab does.
beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= {};
  // the skin picker reads the attribute main.tsx stamps before first paint
  (globalThis as { document?: unknown }).document ??= { documentElement: { dataset: {} } };
});

// Analytics boots PostHog on import, which wants a real browser.
// Pinned to Advanced: these cover the Advanced rail; Simple has its own suite.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
}));

async function renderSettings(): Promise<string> {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(SettingsModal)));
}

afterEach(() => {
  setLocale("en");
});

describe("Settings → General", () => {
  it("renders in the language the picker selected, and re-renders in the next one", async () => {
    setLocale("pt-br");
    const pt = await renderSettings();
    expect(pt).toContain("Configurações");

    // same module instance, no reload: a frozen label would still say
    // "Geral" here
    setLocale("ja");
    const ja = await renderSettings();
    expect(ja).toContain("設定");
    expect(ja).toContain("外観");
    expect(ja).not.toContain(">Aparência<");
  });

  it("says Réglages in French, with the Advanced row translated", async () => {
    setLocale("fr");
    const fr = await renderSettings();
    expect(fr).toContain(">Réglages<");
    // Account opens first: the account card, then a grey Language and region heading (#2080 L2)
    expect(fr).toContain(">Langue et région</h3>");
    expect(fr).toContain(">Apparence</button>");
    expect(fr).not.toMatch(/[\u2013\u2014]/);
  });

  it("stays English when no language is picked", async () => {
    setLocale("en");
    const en = await renderSettings();
    expect(en).toContain("Settings");
    expect(en).toContain(">Models</button>");
    expect(en).toContain(">Voice</button>");
    expect(en).toContain(">Language and region</h3>");
  });

  it("offers a labeled compact section picker without removing desktop navigation", async () => {
    const html = await renderSettings();
    expect(html).toMatch(/<select[^>]*aria-label="Settings"[^>]*sm:hidden/);
    expect(html).toContain('<option value="appearance">Appearance</option>');
    // Pair devices is hidden since 2026-10-14
    expect(html).not.toContain('<option value="companion"');
    expect(html).toMatch(/<nav[^>]*hidden[^>]*sm:flex/);
    expect(html).toContain('id="app-settings-title" class="sr-only"');
  });
});
