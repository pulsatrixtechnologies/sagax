// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mac-messages-setup", () => ({
  loadMessagesSetup: vi.fn(async () => ({
    available: true,
    onThisMac: true,
    useMessages: false,
    permissions: { fullDiskAccess: "denied", automation: "notAsked" },
  })),
  openMessagesPermissionPane: vi.fn(async () => {}),
  permissionTone: (state: string) => (state === "granted" ? "ok" : state === "denied" ? "warn" : "muted"),
  setMessagesEnabled: vi.fn(async (useMessages: boolean) => ({
    available: true,
    onThisMac: true,
    useMessages,
    permissions: { fullDiskAccess: "granted", automation: "granted" },
  })),
  testMessagesSetup: vi.fn(async () => ({ conversationCount: 2, names: ["Ada Example", "Bea Example"] })),
}));

vi.mock("@/lib/i18n", () => ({
  t: (key: string, vars?: Record<string, string | number>) => {
    if (vars?.count != null) return `${key}:${vars.count}`;
    return key;
  },
}));

import { loadMessagesSetup, setMessagesEnabled } from "@/lib/mac-messages-setup";
import { MessagesSetupView } from "./MessagesSetupView";
import { MacAppsInstalledSection } from "./MacAppsView";

describe("Mac Messages setup surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Installed Mac section", () => {
    const html = renderToStaticMarkup(createElement(MacAppsInstalledSection, {
      status: {
        available: true,
        onThisMac: true,
        apps: [
          { id: "messages", enabled: true, permissions: { automation: "granted", fullDiskAccess: "granted" } },
          { id: "mail", enabled: false, permissions: { automation: "notAsked" } },
          { id: "calendar", enabled: false, permissions: { automation: "notAsked" } },
          { id: "contacts", enabled: false, permissions: { automation: "notAsked" } },
          { id: "reminders", enabled: false, permissions: { automation: "notAsked" } },
          { id: "notes", enabled: false, permissions: { automation: "notAsked" } },
        ],
      },
      onOpen: () => {},
    }));
    expect(html).toContain("data-plugins-mac");
    // one row per Apple app
    for (const app of ["messages", "mail", "calendar", "contacts", "reminders", "notes"]) expect(html).toContain(`data-mac-app="${app}"`);
    // no "See all" to a page with the same one row (#2104)
    expect(html).not.toContain("connectApps.mac.seeAll");
    expect(html).toContain("connectApps.mac.messages.rowOn");
  });

  it("renders setup shell with loading then steps markers in markup contract", () => {
    // SSR first paint is the loading shell (effects do not run in renderToStaticMarkup).
    const html = renderToStaticMarkup(createElement(MessagesSetupView, {
      onBack: () => {},
      trail: [{ label: "Mac", onSelect: () => {} }],
    }));
    expect(html).toContain('data-messages-setup=""');
    expect(html).toContain("connectApps.mac.messages.loading");
  });

  // #2080 L1/L3: the Settings > Computer "Messages" shortcut is gone; this
  // setup holds the same switch (the same /api/messages useMessages).
  it("holds the switch that lets the bots use Messages", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(MessagesSetupView, { onBack: () => {}, trail: [] })); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    const step = host.querySelector<HTMLElement>('[data-messages-step="enable"]')!;
    expect(step, "the enable step").not.toBeNull();
    expect(step.textContent).toContain("connectApps.mac.messages.enable");
    const toggle = step.querySelector<HTMLElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => { toggle.click(); });
    expect(setMessagesEnabled).toHaveBeenCalledWith(true);
    act(() => root.unmount());
    host.remove();
  });

  // The blank page (2026-11-06): on an organization server /api/messages
  // answers 404 messages_not_on_this_mac; the page now says so, with Retry.
  it("never stays blank when the setup cannot load", async () => {
    vi.mocked(loadMessagesSetup).mockRejectedValueOnce(new Error("connectApps.mac.notOnThisMac"));
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(MessagesSetupView, { onBack: () => {}, trail: [] })); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    const block = host.querySelector<HTMLElement>("[data-messages-load-error]");
    expect(block, "the load error").not.toBeNull();
    expect(block!.querySelector('[role="alert"]')?.textContent).toContain("connectApps.mac.notOnThisMac");
    expect(block!.textContent).toContain("connectApps.mac.retry");
    act(() => root.unmount());
    host.remove();
  });
});
