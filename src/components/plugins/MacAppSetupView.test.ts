// @vitest-environment happy-dom
// One setup page per Apple app: loading, then the steps, or a readable error
// with Retry; never a blank page (2026-11-06).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const status = {
  available: true,
  onThisMac: true,
  apps: [{ id: "calendar", enabled: false, permissions: { automation: "notAsked" } }],
};
vi.mock("@/lib/mac-apps-setup", () => ({
  loadMacApps: vi.fn(async () => status),
  setMacAppEnabled: vi.fn(async (_app: string, enabled: boolean) => ({ ...status, apps: [{ ...status.apps[0], enabled }] })),
  testMacApp: vi.fn(async () => ({ ok: true, count: 3, names: ["Work", "Home", "Family"] })),
  openMacAppPermissionPane: vi.fn(async () => {}),
  askMacAppAutomation: vi.fn(async () => ({ ...status, apps: [{ ...status.apps[0], permissions: { automation: "granted" } }] })),
}));
vi.mock("@/lib/i18n", () => ({
  t: (key: string, vars?: Record<string, string | number>) => (vars?.count != null ? `${key}:${vars.count}` : key),
}));

import { askMacAppAutomation, loadMacApps, openMacAppPermissionPane, setMacAppEnabled, testMacApp } from "@/lib/mac-apps-setup";
import { MacAppSetupView } from "./MacAppSetupView";

async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(MacAppSetupView, { app: "calendar", onBack: () => {}, trail: [] })); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe("Apple app setup page", () => {
  it("shows the permission, the test and the switch", async () => {
    const { host, done } = await mount();
    expect(host.querySelector('[data-mac-app-step="automation"]')).not.toBeNull();
    await act(async () => { host.querySelector<HTMLElement>("[data-mac-app-test]")!.click(); });
    expect(testMacApp).toHaveBeenCalledWith("calendar");
    expect(host.querySelector("[data-mac-app-test-result]")?.textContent).toContain("testResultMany:3");
    const toggle = host.querySelector<HTMLElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => { toggle.click(); });
    expect(setMacAppEnabled).toHaveBeenCalledWith("calendar", true);
    done();
  });

  it("says why it could not load, with Retry, instead of an empty page", async () => {
    vi.mocked(loadMacApps).mockRejectedValueOnce(new Error("connectApps.mac.notOnThisMac"));
    const { host, done } = await mount();
    const block = host.querySelector<HTMLElement>("[data-mac-app-load-error]");
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain("connectApps.mac.notOnThisMac");
    await act(async () => { block!.querySelector<HTMLElement>("button")!.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[data-mac-app-step="automation"]')).not.toBeNull();
    done();
  });
  // Same Automation path as Messages: ask once, then a refusal opens Settings (2026-11-06).
  it("asks macOS for Automation when it was never asked", async () => {
    const { host, done } = await mount();
    const ask = host.querySelector<HTMLElement>("[data-mac-app-ask-automation]");
    expect(ask, "the Ask for access button").not.toBeNull();
    await act(async () => { ask!.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(askMacAppAutomation).toHaveBeenCalledWith("calendar");
    expect(host.querySelector("[data-mac-app-ask-automation]")).toBeNull();
    done();
  });

  it("sends a refusal to System Settings, Automation", async () => {
    vi.mocked(loadMacApps).mockResolvedValueOnce({ ...status, apps: [{ ...status.apps[0], permissions: { automation: "denied" } }] } as Awaited<ReturnType<typeof loadMacApps>>);
    const { host, done } = await mount();
    expect(host.querySelector("[data-mac-app-ask-automation]")).toBeNull();
    expect(host.querySelector("[data-mac-app-automation-denied]")).not.toBeNull();
    await act(async () => { host.querySelector<HTMLElement>("[data-mac-app-open-automation]")!.click(); });
    expect(openMacAppPermissionPane).toHaveBeenCalledWith("automation");
    done();
  });

  it("shows why the test failed", async () => {
    vi.mocked(testMacApp).mockRejectedValueOnce(new Error("Calendar returned an error"));
    const { host, done } = await mount();
    await act(async () => { host.querySelector<HTMLElement>("[data-mac-app-test]")!.click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[data-mac-app-test-error][role="alert"]')).not.toBeNull();
    done();
  });
});
